// A Pi `FileSystem` whose files live in SQLite tables: the workspace backend for hosts without a disk (a Durable Object, a browser
// worker) and the one backend whose multi-file conditional batches commit in one transaction (see `createWorkspaceProvider`).
// It runs on any `SqliteConnection` (`openNodeConnection`, a Durable Object's storage, a browser's SQLite Wasm), synchronously, so a
// write is one SQLite transaction and a rename is atomic. Regular files and directories only: no symbolic or hard links, no modes.
import type { Context } from '@earendil-works/chord';
import { FileError, LineScanner, err, ok } from '@earendil-works/pi-durable/env';
import type { BinaryReader, DirReader, FileInfo, FileSystem, FileWatcher, Result, TextLineReader, WatchChange, WatchTarget } from '@earendil-works/pi-durable/env';
import { randomUUID } from './platform.js';
import { registerSqliteBatch } from './sqlite-batch.js';
import type { SqliteConnection } from './sqlite.js';

export interface SqliteFileSystemOptions {
  /** The database. The host owns it: `cleanup` leaves it open. */
  readonly connection: SqliteConnection;
  /** Which workspace's rows: one database can hold several workspaces. */
  readonly workspace: string;
  /** The absolute working directory, created when missing (for example `/workspace`). Relative paths resolve against `cwd`. */
  readonly cwd: string;
}

/** A Pi `FileSystem` plus the incarnation of its rows: new when the workspace was first created in this database. */
export interface SqliteFileSystem extends FileSystem {
  readonly incarnation: string;
}

type Row = { readonly kind: string; readonly size: number; readonly mtime: number };

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return `/${parts.join('/')}`;
}
const dirname = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const within = (base: string, path: string) => path === base || path.startsWith(base === '/' ? '/' : `${base}/`);

// Results, errors and line scans are Pi's own (`@earendil-works/pi-durable/env`, its portable contracts: no engine), so this file
// system answers exactly like Pi's environments.
const fileError = (code: FileError['code'], message: string, path?: string): FileError => new FileError(code, message, path);
const isFileError = (error: unknown): error is FileError => error instanceof FileError;

/** How often a watcher compares snapshots: SQLite reports no changes, so the watcher polls (`mode: 'polling'`). */
const WATCH_INTERVAL_MS = 1000;

/** A FileError whose message starts with the POSIX code, as shells and Git read it. */
const failure = (code: FileError['code'], errno: string, path: string, what: string) => fileError(code, `${errno}: ${what}, '${path}'`, path);
const missing = (path: string) => failure('not_found', 'ENOENT', path, 'no such file or directory');

export function openSqliteFileSystem(options: SqliteFileSystemOptions): SqliteFileSystem {
  const { connection: db, workspace } = options;
  if (typeof workspace !== 'string' || workspace === '') throw new TypeError('A workspace name is required');
  if (typeof options.cwd !== 'string' || !options.cwd.startsWith('/')) throw new TypeError('An absolute working directory is required');
  const now = () => Date.now();

  function row(path: string): Row | undefined {
    if (path === '/') return { kind: 'directory', size: 0, mtime: 0 };
    const found = db.get<{ kind: string; size: number | bigint; mtime_ms: number | bigint }>('SELECT kind, coalesce(length(bytes), 0) AS size, mtime_ms FROM boring_workspace_files WHERE workspace = ? AND path = ?', workspace, path);
    return found ? { kind: found.kind, size: Number(found.size), mtime: Number(found.mtime_ms) } : undefined;
  }
  /** Why `path` does not exist: an ancestor that is a file makes it `ENOTDIR`, otherwise `ENOENT`. */
  function absent(path: string): FileError {
    for (let ancestor = dirname(path); ancestor !== '/'; ancestor = dirname(ancestor)) {
      const found = row(ancestor);
      if (found) return found.kind === 'directory' ? missing(path) : failure('not_directory', 'ENOTDIR', path, 'not a directory');
    }
    return missing(path);
  }
  function existing(path: string): Row {
    const found = row(path);
    if (!found) throw absent(path);
    return found;
  }
  function directory(path: string): void {
    if (existing(path).kind !== 'directory') throw failure('not_directory', 'ENOTDIR', path, 'not a directory');
  }
  /** The parent of a path about to be created must be a directory; the error names the path. */
  function parent(path: string): void {
    const found = row(dirname(path));
    if (!found) throw absent(path);
    if (found.kind !== 'directory') throw failure('not_directory', 'ENOTDIR', path, 'not a directory');
  }
  function bytes(path: string): Uint8Array {
    if (existing(path).kind === 'directory') throw failure('is_directory', 'EISDIR', path, 'illegal operation on a directory');
    const found = db.get<{ bytes: Uint8Array }>('SELECT bytes FROM boring_workspace_files WHERE workspace = ? AND path = ?', workspace, path);
    if (!(found?.bytes instanceof Uint8Array)) throw fileError('unknown', 'Invalid stored bytes', path);
    return Uint8Array.from(found.bytes);
  }
  function put(path: string, kind: 'file' | 'directory', content: Uint8Array | null): void {
    db.run('INSERT INTO boring_workspace_files (workspace, path, parent, kind, bytes, mtime_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(workspace, path) DO UPDATE SET kind = excluded.kind, bytes = excluded.bytes, mtime_ms = excluded.mtime_ms',
      workspace, path, dirname(path), kind, content, now());
  }
  function write(path: string, content: Uint8Array): void {
    if (path === '/') throw failure('is_directory', 'EISDIR', path, 'illegal operation on a directory');
    const found = row(path);
    if (found?.kind === 'directory') throw failure('is_directory', 'EISDIR', path, 'illegal operation on a directory');
    // Like Pi's own environments (NodeExecutionEnv), a write creates the missing parent directories; a parent that is a file still fails.
    if (!found) { if (!row(dirname(path))) makeDirectory(dirname(path), true); parent(path); }
    put(path, 'file', content);
  }
  function makeDirectory(path: string, recursive: boolean): void {
    const found = row(path);
    if (found) {
      if (found.kind !== 'directory') throw failure('invalid', 'EEXIST', path, 'file already exists');
      if (!recursive) throw failure('invalid', 'EEXIST', path, 'file already exists');
      return;
    }
    if (recursive) makeDirectory(dirname(path), true); else parent(path);
    put(path, 'directory', null);
  }
  const children = (path: string) => db.all<{ path: string }>('SELECT path FROM boring_workspace_files WHERE workspace = ? AND parent = ? ORDER BY path', workspace, path).map(item => item.path);
  /** Every row at or below `path`. */
  const subtree = (path: string) => `workspace = ? AND (path = ? OR substr(path, 1, ?) = ?)`;
  const subtreeArgs = (path: string) => [workspace, path, path.length + 1, `${path}/`] as const;
  const info = (path: string, found: Row): FileInfo => ({ name: basename(path), path, kind: found.kind === 'directory' ? 'directory' : 'file', size: found.size, mtimeMs: found.mtime });

  db.transaction('write', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS boring_workspaces (workspace TEXT PRIMARY KEY, incarnation TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS boring_workspace_files (
        workspace TEXT NOT NULL, path TEXT NOT NULL, parent TEXT NOT NULL, kind TEXT NOT NULL, bytes BLOB, mtime_ms INTEGER NOT NULL,
        PRIMARY KEY (workspace, path)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS boring_workspace_files_parent ON boring_workspace_files (workspace, parent);
    `);
    db.run('INSERT OR IGNORE INTO boring_workspaces VALUES (?, ?)', workspace, randomUUID());
    makeDirectory(normalize(options.cwd), true);
  });
  const incarnation = db.get<{ incarnation: string }>('SELECT incarnation FROM boring_workspaces WHERE workspace = ?', workspace)?.incarnation;
  if (typeof incarnation !== 'string') throw new Error('The workspace has no incarnation');

  async function run<Value>(path: string, context: Context, mode: 'read' | 'write', work: (absolute: string) => Value): Promise<Result<Value, FileError>> {
    if (context.abortSignal?.aborted) return err(fileError('aborted', 'Operation aborted', path));
    if (typeof path !== 'string' || path.includes('\0')) return err(fileError('invalid', 'Invalid path', String(path)));
    try { return ok(db.transaction(mode, () => work(normalize(path.startsWith('/') ? path : `${fs.cwd}/${path}`)))); }
    catch (error) { return err(isFileError(error) ? error : fileError('unknown', error instanceof Error ? error.message : String(error), path)); }
  }
  async function temporary(prefix: string, suffix: string, kind: 'file' | 'directory', context: Context): Promise<Result<string, FileError>> {
    if (`${prefix}${suffix}`.includes('/')) return err(fileError('invalid', 'Temporary names must be basenames'));
    return run('/tmp', context, 'write', () => {
      makeDirectory('/tmp', true);
      const path = `/tmp/${prefix}${randomUUID()}${suffix}`;
      put(path, kind, kind === 'file' ? new Uint8Array() : null);
      return path;
    });
  }
  const text = (path: string) => new TextDecoder().decode(bytes(path));
  /** The size and modification time of every watched path, to compare between polls. */
  function snapshot(targets: readonly WatchTarget[]): Map<string, string> {
    const seen = new Map<string, string>();
    const hidden = (name: string, target: WatchTarget) => (target.exclude?.hidden && name.startsWith('.')) || target.exclude?.names?.includes(name);
    for (const target of targets) {
      const root = normalize(target.path.startsWith('/') ? target.path : `${fs.cwd}/${target.path}`), found = row(root);
      seen.set(root, found ? `${found.kind}:${found.size}:${found.mtime}` : 'missing');
      if (found?.kind !== 'directory') continue;
      const rows = target.recursive
        ? db.all<{ path: string; kind: string; size: number | bigint; mtime_ms: number | bigint }>(`SELECT path, kind, coalesce(length(bytes), 0) AS size, mtime_ms FROM boring_workspace_files WHERE ${subtree(root)} AND path != ?`, ...subtreeArgs(root), root)
        : db.all<{ path: string; kind: string; size: number | bigint; mtime_ms: number | bigint }>('SELECT path, kind, coalesce(length(bytes), 0) AS size, mtime_ms FROM boring_workspace_files WHERE workspace = ? AND parent = ?', workspace, root);
      for (const item of rows) {
        if (item.path.slice(root.length + (root === '/' ? 0 : 1)).split('/').some(name => hidden(name, target))) continue;
        seen.set(item.path, `${item.kind}:${Number(item.size)}:${Number(item.mtime_ms)}`);
      }
    }
    return seen;
  }
  const encode = (content: string | Uint8Array) => typeof content === 'string' ? new TextEncoder().encode(content) : Uint8Array.from(content);

  const fs: SqliteFileSystem = {
    id: `sqlite:${workspace}`, cwd: normalize(options.cwd), incarnation,
    absolutePath: (path, context) => run(path, context, 'read', absolute => absolute),
    joinPath: async (parts, context) => {
      if (context.abortSignal?.aborted) return err(fileError('aborted', 'Operation aborted'));
      const joined = parts.join('/');
      return ok(joined.startsWith('/') ? normalize(joined) : normalize(`/${joined}`).slice(1) || '.');
    },
    readTextFile: (path, context) => run(path, context, 'read', text),
    readBinaryFile: (path, context) => run(path, context, 'read', bytes),
    // The reader holds the bytes as they were when opened: it keeps reading that file even if its path is renamed or rewritten.
    // There are no symbolic links here, so `noFollow` changes nothing.
    openBinaryReader: (path, _options, context) => run(path, context, 'read', absolute => {
      const content = bytes(absolute), opened = info(absolute, existing(absolute));
      let closed = false;
      const guard = (inner: Context): FileError | undefined => inner.abortSignal?.aborted ? fileError('aborted', 'Operation aborted', absolute)
        : closed ? fileError('invalid', 'Binary reader is closed', absolute) : undefined;
      const reader: BinaryReader = {
        info: async inner => { const failed = guard(inner); return failed ? err(failed) : ok({ ...opened }); },
        read: async (offset, length, inner) => {
          const failed = guard(inner);
          if (failed) return err(failed);
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) return err(fileError('invalid', 'Offset and length must be non-negative integers', absolute));
          return ok(content.slice(offset, offset + length));
        },
        scanLines: async ({ startLine, endLine }, inner) => {
          const failed = guard(inner);
          if (failed) return err(failed);
          if (!Number.isSafeInteger(startLine) || startLine < 0 || (endLine !== undefined && (!Number.isSafeInteger(endLine) || endLine <= startLine))) {
            return err(fileError('invalid', 'Line range must be non-negative integers with endLine > startLine', absolute));
          }
          // Pi's own scanner over the bytes held in the row: the same answer as Pi's Node environment for the same file.
          const scanner = new LineScanner(startLine, endLine);
          scanner.push(content);
          return ok(scanner.finish());
        },
        close: async () => { closed = true; },
      };
      return reader;
    }),
    readTextLines: (path, options, context) => run(path, context, 'read', absolute => {
      const lines = text(absolute).split('\n');
      if (lines.at(-1) === '') lines.pop();
      return options?.maxLines === undefined ? lines : lines.slice(0, Math.max(0, options.maxLines));
    }),
    openTextLineReader: (path, context) => run(path, context, 'read', absolute => {
      const content = text(absolute);
      let offset = 0, closed = false;
      const reader: TextLineReader = {
        readLine: async inner => {
          if (inner.abortSignal?.aborted) return err(fileError('aborted', 'Operation aborted', absolute));
          if (closed) return err(fileError('invalid', 'Text line reader is closed', absolute));
          if (offset === content.length) return ok(undefined);
          const newline = content.indexOf('\n', offset);
          const line = { text: content.slice(offset, newline === -1 ? undefined : newline), terminated: newline !== -1 };
          offset = newline === -1 ? content.length : newline + 1;
          return ok(line);
        },
        close: async () => { closed = true; },
      };
      return reader;
    }),
    writeFile: (path, content, context) => run(path, context, 'write', absolute => write(absolute, encode(content))),
    appendFile: (path, content, context) => run(path, context, 'write', absolute => {
      const added = encode(content);
      if (!row(absolute)) return write(absolute, added);
      const before = bytes(absolute), joined = new Uint8Array(before.length + added.length);
      joined.set(before); joined.set(added, before.length);
      write(absolute, joined);
    }),
    truncateFile: (path, size, context) => run(path, context, 'write', absolute => {
      if (!Number.isSafeInteger(size) || size < 0) throw fileError('invalid', 'File size must be a non-negative safe integer', absolute);
      const before = bytes(absolute), after = new Uint8Array(size);
      after.set(before.subarray(0, size));
      write(absolute, after);
    }),
    // Every write is already a committed SQLite transaction.
    flushFile: (path, context) => run(path, context, 'read', absolute => { existing(absolute); }),
    // One transaction: a reader sees the old or the new path, never both or neither. A directory moves with everything below it.
    renameFile: (source, destination, context) => run(source, context, 'write', from => {
      const to = normalize(destination.startsWith('/') ? destination : `${fs.cwd}/${destination}`);
      const moved = existing(from);
      if (from === to) return;
      if (from === '/' || within(from, to)) throw failure('invalid', 'EINVAL', to, 'cannot move a directory into itself');
      const target = row(to);
      if (target) {
        if (moved.kind !== 'directory' && target.kind === 'directory') throw failure('is_directory', 'EISDIR', to, 'illegal operation on a directory');
        if (moved.kind === 'directory' && target.kind !== 'directory') throw failure('not_directory', 'ENOTDIR', to, 'not a directory');
        if (target.kind === 'directory' && children(to).length) throw failure('invalid', 'ENOTEMPTY', to, 'directory not empty');
        db.run('DELETE FROM boring_workspace_files WHERE workspace = ? AND path = ?', workspace, to);
      } else parent(to);
      db.run(`UPDATE boring_workspace_files SET path = ? || substr(path, ?), parent = CASE WHEN path = ? THEN ? ELSE ? || substr(parent, ?) END WHERE ${subtree(from)}`,
        to, from.length + 1, from, dirname(to), to, from.length + 1, ...subtreeArgs(from));
    }),
    fileInfo: (path, context) => run(path, context, 'read', absolute => info(absolute, existing(absolute))),
    listDir: (path, context) => run(path, context, 'read', absolute => {
      directory(absolute);
      return children(absolute).map(child => info(child, existing(child)));
    }),
    // The entries as they were when opened, in path order, paged by `next`.
    openDirReader: (path, context) => run(path, context, 'read', absolute => {
      directory(absolute);
      const entries = children(absolute).map(child => info(child, existing(child)));
      let offset = 0, closed = false;
      const reader: DirReader = {
        next: async (maxEntries, inner) => {
          if (inner.abortSignal?.aborted) return err(fileError('aborted', 'Operation aborted', absolute));
          if (closed) return err(fileError('invalid', 'Directory reader is closed', absolute));
          if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) return err(fileError('invalid', 'maxEntries must be a positive integer', absolute));
          const page = entries.slice(offset, offset + maxEntries);
          offset += page.length;
          return ok({ entries: page, done: offset >= entries.length });
        },
        close: async () => { closed = true; },
      };
      return reader;
    }),
    // SQLite reports no changes, so the watcher compares snapshots of the watched rows. The first snapshot is taken before the
    // watcher is returned, so a change made after `watch` resolves is always seen.
    watch: async (targets, onChange, context) => {
      if (context.abortSignal?.aborted) return err(fileError('aborted', 'Operation aborted'));
      if (!Array.isArray(targets) || targets.some(target => typeof target?.path !== 'string' || target.path.includes('\0'))) return err(fileError('invalid', 'Invalid watch target'));
      let previous: Map<string, string>;
      try { previous = db.transaction('read', () => snapshot(targets)); } catch (error) { return err(isFileError(error) ? error : fileError('unknown', String(error))); }
      let stopped = false;
      const report = (change: WatchChange) => { if (!stopped) try { onChange(change); } catch { /* the host's callback cannot stop the watcher */ } };
      const timer = setInterval(() => {
        if (stopped) return;
        let next: Map<string, string>;
        try { next = db.transaction('read', () => snapshot(targets)); }
        catch (error) { report({ error: isFileError(error) ? error : fileError('unknown', String(error)) }); stopped = true; clearInterval(timer); return; }
        const changed = [...new Set([...previous.keys(), ...next.keys()])].filter(path => previous.get(path) !== next.get(path));
        previous = next;
        if (changed.length) report({ paths: changed });
      }, WATCH_INTERVAL_MS);
      const watcher: FileWatcher = { mode: 'polling', close: async () => { stopped = true; clearInterval(timer); } };
      return ok(watcher);
    },
    canonicalPath: (path, context) => run(path, context, 'read', absolute => { existing(absolute); return absolute; }),
    exists: (path, context) => run(path, context, 'read', absolute => row(absolute) !== undefined),
    createDir: (path, options, context) => run(path, context, 'write', absolute => {
      // Like `mkdir -p`, an existing directory is fine when recursive (the default).
      if (options?.recursive !== false && row(absolute)?.kind === 'directory') return;
      makeDirectory(absolute, options?.recursive !== false);
    }),
    remove: (path, options, context) => run(path, context, 'write', absolute => {
      const found = row(absolute);
      if (!found) { if (options?.force) return; throw absent(absolute); }
      if (absolute === '/' || absolute === fs.cwd) throw failure('permission_denied', 'EPERM', absolute, 'the workspace root cannot be removed');
      if (found.kind === 'directory' && !options?.recursive && children(absolute).length) throw failure('invalid', 'ENOTEMPTY', absolute, 'directory not empty');
      db.run(`DELETE FROM boring_workspace_files WHERE ${subtree(absolute)}`, ...subtreeArgs(absolute));
    }),
    createTempDir: (prefix, context) => temporary(prefix ?? 'tmp-', '', 'directory', context),
    createTempFile: (options, context) => temporary(options?.prefix ?? 'tmp-', options?.suffix ?? '', 'file', context),
    cleanup: async () => {},
  };
  registerSqliteBatch(fs, {
    connection: db,
    bytes: path => { const found = row(normalize(path)); return !found ? null : found.kind === 'directory' ? undefined : bytes(normalize(path)); },
    write: (path, content) => { const absolute = normalize(path); makeDirectory(dirname(absolute), true); write(absolute, content); },
  });
  return fs;
}
