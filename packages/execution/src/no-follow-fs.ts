// File operations confined to one host folder that another party writes at the same time (D-2087).
//
// A check on a path (lstat, realpath) followed by an open of the same path is a race: between the two, a directory can be
// swapped for a symbolic link to anywhere. Here no path is ever handed to the kernel whole. Each component is opened from
// the directory fd of its parent, `open('/proc/self/fd/<parent>/<name>', O_NOFOLLOW | ...)`, so the kernel never follows
// a link on our behalf; a link the operation follows by contract is read with readlink and its target walked again from
// the folder, the same way. Operations without an fd (rename, unlink, mkdir, rmdir) run on `/proc/self/fd/<parent>/<name>`
// of a parent reached by that walk. Linux only: without `/proc/self/fd` every operation fails closed.
import { close as closeFd, constants, open as openFd, watch as watchPath } from 'node:fs';
import { lstat, mkdir, open, opendir, readdir, readlink, realpath, rename, rmdir, stat, statfs, unlink } from 'node:fs/promises';
import type { Dir, FSWatcher, Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { posix } from 'node:path';
import type { Context } from '@earendil-works/chord/context';
import { FileError, LineScanner, StreamDecoder, err, ok } from '@earendil-works/pi-durable/env';
import type { BinaryReader, DirReader, FileChange, FileInfo, FileWatcher, LineScan, Result, TextLine, TextLineReader } from '@earendil-works/pi-durable/env';

const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_TRUNC, O_APPEND, O_DIRECTORY, O_NOFOLLOW, O_NONBLOCK } = constants;
/** Links followed in one resolution, as Linux allows (and as the earlier realpath check did). */
const MAX_HOPS = 40;
/** Largest single read of a binary reader, so a huge `length` allocates only as much as the file yields. */
const READ_CHUNK = 1024 * 1024;
/** A watcher rescans this long after the last event, and at least this often (EFS, NFS: no events from other hosts). */
const WATCH_DEBOUNCE_MS = 50;
const WATCH_POLL_MS = 2000;
const WATCH_MAX_DIRECTORIES = 10_000;
const NFS_SUPER_MAGIC = 0x6969;
const PROC_PATH = /\/proc\/self\/fd\/\d+(?:\/[^'"\s,]*)?/g;

const openDirFd = (path: string): Promise<number> => new Promise((resolve, reject) => {
  openFd(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW, (error, fd) => error ? reject(error) : resolve(fd));
});
const release = (fd: number): Promise<void> => new Promise(resolve => closeFd(fd, () => resolve()));
const at = (fd: number, name: string): string => `/proc/self/fd/${fd}/${name}`;
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | undefined)?.code;
const within = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);

/** A resolution left the folder (a `..` above it, a link whose target is outside, or more than 40 links). */
class Outside extends Error {}
/** This host has no `/proc/self/fd`: fail closed rather than fall back to path calls. */
class Unsupported extends Error {}
/** A watched tree grew past the directory budget. */
class TooLarge extends Error {}

export interface NoFollowOptions {
  /** The folder; every operation stays inside it. Paths given to the operations are host paths inside it. */
  readonly root: string;
  /** The error for a host path whose resolution leaves the folder. */
  readonly outside: (local: string) => FileError;
}

/** The FileSystem operations of a confined folder, on host paths; results and errors carry the host paths asked for. */
export interface NoFollowFileSystem {
  readTextFile(local: string, context: Context): Promise<Result<string, FileError>>;
  readBinaryFile(local: string, context: Context): Promise<Result<Uint8Array, FileError>>;
  readTextLines(local: string, options: { maxLines?: number } | undefined, context: Context): Promise<Result<string[], FileError>>;
  openTextLineReader(local: string, context: Context): Promise<Result<TextLineReader, FileError>>;
  openBinaryReader(local: string, options: { noFollow?: boolean } | undefined, context: Context): Promise<Result<BinaryReader, FileError>>;
  openDirReader(local: string, context: Context): Promise<Result<DirReader, FileError>>;
  writeFile(local: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>>;
  appendFile(local: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>>;
  truncateFile(local: string, size: number, context: Context): Promise<Result<void, FileError>>;
  flushFile(local: string, context: Context): Promise<Result<void, FileError>>;
  renameFile(source: string, destination: string, context: Context): Promise<Result<void, FileError>>;
  fileInfo(local: string, context: Context): Promise<Result<FileInfo, FileError>>;
  listDir(local: string, context: Context): Promise<Result<FileInfo[], FileError>>;
  canonicalPath(local: string, context: Context): Promise<Result<string, FileError>>;
  exists(local: string, context: Context): Promise<Result<boolean, FileError>>;
  createDir(local: string, options: { recursive?: boolean } | undefined, context: Context): Promise<Result<void, FileError>>;
  remove(local: string, options: { recursive?: boolean; force?: boolean } | undefined, context: Context): Promise<Result<void, FileError>>;
  /** Whether the path, following links, stays in the folder (a missing part is fine). */
  confine(local: string, context: Context): Promise<Result<void, FileError>>;
  /**
   * Watches by the same walk: every scan reaches the targets through directory fds, so a reported path is always a name
   * listed in a directory inside the folder. Changes are the difference between two scans; events only trigger a scan.
   */
  watch(targets: readonly NoFollowWatchTarget[], onChange: (change: NoFollowChange) => void, context: Context): Promise<Result<NoFollowWatcher, FileError>>;
  /** Closes the folder's fd once no operation uses it; a later operation opens it again. */
  close(): Promise<void>;
}

export interface NoFollowWatchTarget {
  readonly local: string;
  readonly recursive: boolean;
  /** Skip names starting with `.`, and these names, below the target. */
  readonly hidden: boolean;
  readonly names: ReadonlySet<string>;
}
export type NoFollowChange = FileChange;
export type NoFollowWatcher = FileWatcher;
/** What a scan remembers of an entry; directories by identity only (their own times change with every entry). */
interface Entry { readonly kind: string; readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number }
const entryOf = (stats: Stats): Entry | undefined => {
  const kind = stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : stats.isSymbolicLink() ? 'symlink' : undefined;
  if (!kind) return undefined;
  return kind === 'directory' ? { kind, dev: stats.dev, ino: stats.ino, size: 0, mtimeMs: 0, ctimeMs: 0 }
    : { kind, dev: stats.dev, ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs };
};
const sameEntry = (a: Entry, b: Entry): boolean => a.kind === b.kind && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;

/** Where a walk ended: the final component `name` in the directory `parent` (an fd it owns unless it is the root's). */
interface Walked {
  readonly parent: number;
  readonly name: string;
  /** The resolved host path of the final component, links replaced by their targets. */
  readonly resolved: string;
  /** `/proc/self/fd/<parent>/<name>`. */
  readonly path: string;
  done(): Promise<void>;
}

interface WalkOptions {
  /** Follow a link in the final component (by hand). */
  readonly follow: boolean;
  /** Create missing directories on the way (`mkdir -p` of the parent). */
  readonly create?: boolean;
  /** A missing directory on the way ends the walk without an error (`undefined`). */
  readonly missingOk?: boolean;
}

export function createNoFollowFileSystem(options: NoFollowOptions): NoFollowFileSystem {
  const root = posix.resolve(options.root);
  /** The folder's fd, shared by every walk; `users` walks hold it, and a closed one is released when the last ends. */
  interface Root { readonly fd: number; readonly real: string; users: number; closing: boolean }
  let rooted: Promise<Root> | undefined;

  /** The folder's directory fd, opened once and kept until `close()`; retried while it fails. */
  function rootFd(): Promise<Root> {
    rooted ??= (async () => {
      const fd = await new Promise<number>((resolve, reject) => openFd(root, O_RDONLY | O_DIRECTORY, (error, value) => error ? reject(error) : resolve(value)));
      try { await stat(`/proc/self/fd/${fd}`); } catch {
        await release(fd);
        throw new Unsupported('No-follow file access needs /proc/self/fd (Linux): file operations on the shared mount are refused');
      }
      return { fd, real: await realpath(root).catch(() => root), users: 0, closing: false };
    })();
    const pending = rooted;
    pending.catch(() => { if (rooted === pending) rooted = undefined; });
    return pending;
  }
  async function acquire(): Promise<Root> {
    for (;;) {
      const base = await rootFd();
      if (!base.closing) { base.users++; return base; }
    }
  }
  async function unuse(base: Root): Promise<void> {
    if (--base.users === 0 && base.closing) await release(base.fd);
  }

  /**
   * Resolves `local` component by component from the folder's fd. Intermediate components must be directories opened with
   * O_NOFOLLOW; a link among them (or a final one with `follow`) is read and its target walked again from where it points.
   *
   * Out of scope, because both need write access outside the folder, which the interpreter's EFS access point does not
   * give: a hard link to a file outside (made from outside), and a directory held here being moved out of the folder
   * while it is walked.
   */
  async function walk(local: string, walkOptions: WalkOptions): Promise<Walked | undefined> {
    if (!within(local, root)) throw new Outside(local);
    const base = await acquire();
    let holdsRoot = false;
    const stack: number[] = [base.fd], names: string[] = [];
    let queue = local.slice(root.length).split('/');
    let budget = MAX_HOPS;
    let kept: number | undefined;
    const top = (): number => stack[stack.length - 1]!;
    const finish = (name: string): Walked => {
      const parent = top();
      kept = parent;
      const resolved = posix.join(root, ...names, name === '.' ? '' : name);
      holdsRoot = parent === base.fd;
      let finished = false;
      return { parent, name, resolved, path: at(parent, name), done: async () => {
        if (finished) return;
        finished = true;
        if (parent !== base.fd) await release(parent); else await unuse(base);
      } };
    };
    try {
      for (;;) {
        while (queue.length && (queue[0] === '' || queue[0] === '.')) queue.shift();
        const name = queue.shift();
        if (name === undefined) return finish('.');
        if (name === '..') {
          if (stack.length === 1) throw new Outside(local);
          await release(stack.pop()!); names.pop();
          continue;
        }
        const path = at(top(), name);
        const last = queue.every(part => part === '' || part === '.');
        if (last) {
          if (!walkOptions.follow) return finish(name);
          let stats: Stats;
          try { stats = await lstat(path); } catch (error) { if (codeOf(error) === 'ENOENT') return finish(name); throw error; }
          if (!stats.isSymbolicLink()) return finish(name);
        } else {
          try { stack.push(await openDirFd(path)); names.push(name); continue; } catch (error) {
            const code = codeOf(error);
            if (code === 'ENOENT' && walkOptions.create) {
              if (--budget < 0) throw new Outside(local);
              try { await mkdir(path); } catch (made) { if (codeOf(made) !== 'EEXIST') throw made; }
              queue.unshift(name);
              continue;
            }
            if (code === 'ENOENT' && walkOptions.missingOk) return undefined;
            if (code === 'ENOENT') throw error;
            let stats: Stats;
            try { stats = await lstat(path); } catch { throw error; }
            if (!stats.isSymbolicLink()) {
              if (walkOptions.missingOk && code === 'ENOTDIR') return undefined;
              throw error;
            }
          }
        }
        // A link: read it and walk its target, never letting the kernel follow it.
        if (--budget < 0) throw new Outside(local);
        let target: string;
        try { target = await readlink(path); } catch (error) {
          // Replaced by something else since: look at the component again.
          if (codeOf(error) === 'EINVAL' || codeOf(error) === 'ENOENT') { queue.unshift(name); continue; }
          throw error;
        }
        if (target.startsWith('/')) {
          const from = within(target, root) ? root : within(target, base.real) ? base.real : undefined;
          if (from === undefined) throw new Outside(local);
          while (stack.length > 1) await release(stack.pop()!);
          names.length = 0;
          queue = [...target.slice(from.length).split('/'), ...queue];
        } else {
          queue = [...target.split('/'), ...queue];
        }
      }
    } finally {
      for (const fd of stack) if (fd !== base.fd && fd !== kept) await release(fd);
      if (!holdsRoot) await unuse(base);
    }
  }

  const walked = async (local: string, walkOptions: WalkOptions): Promise<Walked> => {
    const result = await walk(local, walkOptions);
    if (!result) throw Object.assign(new Error(`ENOENT: no such file or directory, '${local}'`), { code: 'ENOENT' });
    return result;
  };

  /** Opens the final component with O_NOFOLLOW; with `follow`, a link that appeared since the walk is walked again. */
  async function openFinal<T>(local: string, walkOptions: WalkOptions, opener: (path: string) => Promise<T>): Promise<{ value: T; walk: Walked }> {
    for (let attempt = 0; ; attempt++) {
      const result = await walked(local, walkOptions);
      try { return { value: await opener(result.path), walk: result }; } catch (error) {
        let link = false;
        if (walkOptions.follow && codeOf(error) !== 'ENOENT') link = await lstat(result.path).then(stats => stats.isSymbolicLink(), () => false);
        await result.done();
        if (!link) throw error;
        if (attempt >= MAX_HOPS) throw new Outside(local);
      }
    }
  }

  const fileError = (error: unknown, local: string): FileError => {
    if (error instanceof FileError) return error;
    if (error instanceof Outside) return options.outside(local);
    if (error instanceof Unsupported) return new FileError('not_supported', error.message, local);
    const cause = error instanceof Error ? error : new Error(String(error));
    const message = cause.message.replace(PROC_PATH, local);
    switch (codeOf(error)) {
      case 'ABORT_ERR': return new FileError('aborted', message, local, cause);
      case 'ENOENT': return new FileError('not_found', message, local, cause);
      case 'EACCES': case 'EPERM': return new FileError('permission_denied', message, local, cause);
      case 'ENOTDIR': return new FileError('not_directory', message, local, cause);
      case 'EISDIR': return new FileError('is_directory', message, local, cause);
      case 'EINVAL': return new FileError('invalid', message, local, cause);
    }
    return new FileError('unknown', message, local, cause);
  };
  const aborted = (context: Context, local: string): Result<never, FileError> | undefined =>
    context.abortSignal?.aborted ? err(new FileError('aborted', 'aborted', local)) : undefined;
  async function attempt<T>(local: string, context: Context, run: () => Promise<Result<T, FileError>>): Promise<Result<T, FileError>> {
    const early = aborted(context, local);
    if (early) return early;
    try { return await run(); } catch (error) { return err(fileError(error, local)); }
  }
  const info = (local: string, stats: Stats): Result<FileInfo, FileError> => {
    const kind = stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : stats.isSymbolicLink() ? 'symlink' : undefined;
    if (!kind) return err(new FileError('invalid', 'Unsupported file type', local));
    return ok({ name: posix.basename(local), path: local, kind, size: stats.size, mtimeMs: stats.mtimeMs });
  };

  /** Opens a file for an operation, follows links by hand, and always closes it. */
  async function withFile<T>(local: string, flags: number, walkOptions: WalkOptions, run: (file: FileHandle) => Promise<T>): Promise<T> {
    const { value: file, walk: done } = await openFinal(local, walkOptions, path => open(path, flags | O_NOFOLLOW, 0o666));
    await done.done();
    try { return await run(file); } finally { await file.close().catch(() => undefined); }
  }

  const readable = O_RDONLY | O_NONBLOCK;
  const fine = (): Result<void, FileError> => ok(undefined);
  const fs: NoFollowFileSystem = {
    readTextFile: (local, context) => attempt<string>(local, context, async () =>
      ok(await withFile(local, readable, { follow: true }, file => file.readFile({ encoding: 'utf8', signal: context.abortSignal })))),
    readBinaryFile: (local, context) => attempt<Uint8Array>(local, context, async () =>
      ok(new Uint8Array(await withFile(local, readable, { follow: true }, file => file.readFile({ signal: context.abortSignal }))))),
    openTextLineReader: (local, context) => attempt<TextLineReader>(local, context, async () => {
      const { value: file, walk: done } = await openFinal(local, { follow: true }, path => open(path, readable | O_NOFOLLOW));
      await done.done();
      const late = aborted(context, local);
      if (late) { await file.close().catch(() => undefined); return late; }
      return ok(new LineReader(file, local, fileError));
    }),
    readTextLines: async (local, lineOptions, context) => {
      if (lineOptions?.maxLines !== undefined && lineOptions.maxLines <= 0) return ok([]);
      const opened = await fs.openTextLineReader(local, context);
      if (!opened.ok) return opened;
      const lines: string[] = [];
      try {
        while (lineOptions?.maxLines === undefined || lines.length < lineOptions.maxLines) {
          const line = await opened.value.readLine(context);
          if (!line.ok) return line;
          if (line.value === undefined) break;
          lines.push(line.value.text);
        }
        return ok(lines);
      } finally { await opened.value.close(context); }
    },
    openBinaryReader: (local, readerOptions, context) => attempt<BinaryReader>(local, context, async () => {
      const noFollow = readerOptions?.noFollow === true;
      let opened: { value: FileHandle; walk: Walked };
      try { opened = await openFinal(local, { follow: !noFollow }, path => open(path, readable | O_NOFOLLOW)); } catch (error) {
        // O_NOFOLLOW reports a final link as ELOOP: the contract's refusal.
        if (noFollow && (codeOf(error) === 'ELOOP' || codeOf(error) === 'EMLINK')) return err(new FileError('invalid', 'Refusing to follow a symbolic link', local, error as Error));
        throw error;
      }
      const file = opened.value;
      await opened.walk.done();
      try {
        const stats = await file.stat();
        if (!stats.isFile()) {
          await file.close().catch(() => undefined);
          return err(stats.isDirectory() ? new FileError('is_directory', 'EISDIR: illegal operation on a directory, read', local) : new FileError('invalid', 'Not a regular file', local));
        }
      } catch (error) { await file.close().catch(() => undefined); throw error; }
      const late = aborted(context, local);
      if (late) { await file.close().catch(() => undefined); return late; }
      return ok(new BinaryFileReader(file, local, fileError));
    }),
    openDirReader: (local, context) => attempt<DirReader>(local, context, async () => {
      const { value: fd, walk: done } = await openFinal(local, { follow: true }, openDirFd);
      await done.done();
      let dir: Dir;
      try { dir = await opendir(`/proc/self/fd/${fd}`); } catch (error) { await release(fd); throw error; }
      const late = aborted(context, local);
      if (late) { await dir.close().catch(() => undefined); await release(fd); return late; }
      return ok(new DirectoryReader(dir, fd, local, fileError));
    }),
    writeFile: (local, content, context) => attempt<void>(local, context, async () => {
      await withFile(local, O_WRONLY | O_CREAT | O_TRUNC | O_NONBLOCK, { follow: true, create: true }, async file => {
        if (!context.abortSignal?.aborted) await file.writeFile(content, { signal: context.abortSignal });
      });
      return aborted(context, local) ?? fine();
    }),
    appendFile: (local, content, context) => attempt<void>(local, context, async () => {
      await withFile(local, O_WRONLY | O_CREAT | O_APPEND | O_NONBLOCK, { follow: true, create: true }, file => file.writeFile(content));
      return aborted(context, local) ?? fine();
    }),
    truncateFile: (local, size, context) => attempt<void>(local, context, async () => {
      if (!Number.isSafeInteger(size) || size < 0) return err(new FileError('invalid', 'File size must be a non-negative safe integer', local));
      await withFile(local, O_RDWR | O_NONBLOCK, { follow: true }, file => file.truncate(size));
      return aborted(context, local) ?? fine();
    }),
    flushFile: (local, context) => attempt<void>(local, context, async () => {
      const directory = await withFile(local, O_RDWR | O_NONBLOCK, { follow: true }, async file => {
        if ((await file.stat()).isDirectory()) return true;
        await file.sync();
        return false;
      });
      if (directory) return err(new FileError('is_directory', 'Is a directory', local));
      return aborted(context, local) ?? fine();
    }),
    renameFile: (source, destination, context) => attempt<void>(source, context, async () => {
      const from = await walked(source, { follow: false });
      try {
        let to: Walked;
        try { to = await walked(destination, { follow: false }); } catch (error) { return err(fileError(error, destination)); }
        try { await rename(from.path, to.path); } finally { await to.done(); }
        return fine();
      } finally { await from.done(); }
    }),
    fileInfo: (local, context) => attempt<FileInfo>(local, context, async () => {
      const result = await walked(local, { follow: false });
      try { return info(local, await lstat(result.path)); } finally { await result.done(); }
    }),
    listDir: (local, context) => attempt<FileInfo[]>(local, context, async () => {
      const { value: fd, walk: done } = await openFinal(local, { follow: true }, openDirFd);
      await done.done();
      try {
        const infos: FileInfo[] = [];
        for (const name of await readdir(`/proc/self/fd/${fd}`)) {
          const late = aborted(context, local);
          if (late) return late;
          const entry = posix.join(local, name);
          let stats: Stats;
          try { stats = await lstat(at(fd, name)); } catch (error) { return err(fileError(error, entry)); }
          const listed = info(entry, stats);
          if (listed.ok) infos.push(listed.value);
        }
        return ok(infos);
      } finally { await release(fd); }
    }),
    canonicalPath: (local, context) => attempt<string>(local, context, async () => {
      const result = await walked(local, { follow: true });
      try { await lstat(result.path); return ok(result.resolved); } finally { await result.done(); }
    }),
    exists: async (local, context) => {
      const result = await fs.fileInfo(local, context);
      if (result.ok) return ok(true);
      return result.error.code === 'not_found' ? ok(false) : err(result.error);
    },
    createDir: (local, dirOptions, context) => attempt<void>(local, context, async () => {
      const recursive = dirOptions?.recursive ?? true;
      const result = await walked(local, { follow: true, create: recursive });
      try {
        try { await mkdir(result.path, 0o777); } catch (error) {
          if (!recursive || codeOf(error) !== 'EEXIST' || !(await lstat(result.path)).isDirectory()) throw error;
        }
        return fine();
      } finally { await result.done(); }
    }),
    remove: (local, removal, context) => attempt<void>(local, context, async () => {
      const recursive = removal?.recursive ?? false, force = removal?.force ?? false;
      let result: Walked;
      try { result = await walked(local, { follow: false }); } catch (error) {
        if (force && codeOf(error) === 'ENOENT') return fine();
        throw error;
      }
      try {
        let stats: Stats;
        try { stats = await lstat(result.path); } catch (error) {
          if (force && codeOf(error) === 'ENOENT') return fine();
          throw error;
        }
        if (stats.isDirectory() && !recursive) {
          return err(new FileError('unknown', `Path is a directory: rm returned EISDIR (is a directory) ${local}`, local));
        }
        await removeEntry(result.parent, result.name, force);
        return fine();
      } finally { await result.done(); }
    }),
    confine: (local, context) => attempt<void>(local, context, async () => {
      const result = await walk(local, { follow: true, missingOk: true });
      await result?.done();
      return fine();
    }),
    watch: async (targets, onChange, context) => {
      const first = targets[0]?.local ?? root;
      const early = aborted(context, first);
      if (early) return early;
      for (const target of targets) {
        const confined = await fs.confine(target.local, context);
        if (!confined.ok) return err(confined.error);
      }
      const watcher = new FdWatcher(targets, onChange);
      try { await watcher.start(); } catch (error) { await watcher.close(); return err(fileError(error, first)); }
      const late = aborted(context, first);
      if (late) { await watcher.close(); return late; }
      const nfs = await statfs(root).then(stats => stats.type === NFS_SUPER_MAGIC, () => false);
      const handle: NoFollowWatcher = { mode: nfs ? 'polling' : 'native', stop: () => watcher.close() };
      return ok(handle);
    },
    close: async () => {
      const pending = rooted;
      rooted = undefined;
      const base = await pending?.catch(() => undefined);
      if (!base || base.closing) return;
      base.closing = true;
      if (base.users === 0) await release(base.fd);
    },
  };

  /**
   * Scans its targets through the walk, compares each scan with the previous one and reports the paths that differ. Every
   * directory a scan reaches is watched as `/proc/self/fd/<fd>` (the directory itself, whatever its path now names), and
   * an event only schedules the next scan, so no reported name comes from the kernel resolving a path. Also scans every 2 s.
   */
  class FdWatcher {
    #snapshot = new Map<string, Entry>();
    #watchers = new Map<string, FSWatcher>();
    #timer: ReturnType<typeof setInterval> | undefined;
    #debounce: ReturnType<typeof setTimeout> | undefined;
    #running: Promise<void> | undefined;
    #dirty = false;
    #closed = false;
    constructor(readonly targets: readonly NoFollowWatchTarget[], readonly onChange: (change: NoFollowChange) => void) {}

    async start(): Promise<void> {
      this.#snapshot = await this.#scan();
      this.#timer = setInterval(() => this.#schedule(), WATCH_POLL_MS);
      this.#timer.unref?.();
    }

    async close(): Promise<void> {
      this.#closed = true;
      if (this.#timer) clearInterval(this.#timer);
      if (this.#debounce) clearTimeout(this.#debounce);
      for (const watcher of this.#watchers.values()) watcher.close();
      this.#watchers.clear();
      await this.#running;
    }

    #schedule(): void {
      if (this.#closed || this.#debounce) return;
      this.#debounce = setTimeout(() => { this.#debounce = undefined; this.#flush(); }, WATCH_DEBOUNCE_MS);
      this.#debounce.unref?.();
    }

    #flush(): void {
      if (this.#running) { this.#dirty = true; return; }
      this.#running = (async () => {
        try {
          do {
            this.#dirty = false;
            const next = await this.#scan();
            if (this.#closed) return;
            const paths = new Set<string>();
            for (const [path, entry] of next) { const old = this.#snapshot.get(path); if (!old || !sameEntry(old, entry)) paths.add(path); }
            for (const path of this.#snapshot.keys()) if (!next.has(path)) paths.add(path);
            this.#snapshot = next;
            if (paths.size) this.onChange({ kind: 'paths', paths: [...paths].sort() });
          } while (this.#dirty && !this.#closed);
        } catch (error) {
          if (this.#closed) return;
          if (error instanceof TooLarge) {
            this.#closed = true;
            if (this.#timer) clearInterval(this.#timer);
            for (const watcher of this.#watchers.values()) watcher.close();
            this.#watchers.clear();
            this.onChange({ kind: 'failed', error: new FileError('invalid', error.message, root) });
          } else this.onChange({ kind: 'overflow' });
        } finally { this.#running = undefined; }
      })();
    }

    /** Watches the directory open as `fd` (once per directory), so a change in it schedules a scan. */
    async #consider(fd: number, seen: Set<string>): Promise<void> {
      const stats = await stat(`/proc/self/fd/${fd}`);
      const key = `${stats.dev}:${stats.ino}`;
      seen.add(key);
      if (this.#closed || this.#watchers.has(key)) return;
      try {
        const watcher = watchPath(`/proc/self/fd/${fd}`, { persistent: false }, () => this.#schedule());
        watcher.on('error', () => {
          watcher.close();
          if (this.#watchers.get(key) === watcher) this.#watchers.delete(key);
          this.#schedule();
        });
        this.#watchers.set(key, watcher);
      } catch { /* out of watches: the periodic scan still covers it */ }
    }

    async #scan(): Promise<Map<string, Entry>> {
      const snapshot = new Map<string, Entry>(), seen = new Set<string>();
      let directories = 0;
      const record = (path: string, stats: Stats): void => { const entry = entryOf(stats); if (entry) snapshot.set(path, entry); };
      const scanDirectory = async (fd: number, local: string, target: NoFollowWatchTarget): Promise<void> => {
        if (++directories > WATCH_MAX_DIRECTORIES) throw new TooLarge(`Watched paths exceed ${WATCH_MAX_DIRECTORIES} directories`);
        await this.#consider(fd, seen);
        let names: string[];
        try { names = await readdir(`/proc/self/fd/${fd}`); } catch { return; }
        for (const name of names) {
          if ((target.hidden && name.startsWith('.')) || target.names.has(name)) continue;
          const path = posix.join(local, name);
          let stats: Stats;
          try { stats = await lstat(at(fd, name)); } catch { continue; }
          if (!snapshot.has(path)) record(path, stats);
          if (!target.recursive || !stats.isDirectory()) continue;
          // Opened without following: a directory swapped for a link since the lstat is skipped, never listed.
          let child: number;
          try { child = await openDirFd(at(fd, name)); } catch { continue; }
          try { await scanDirectory(child, path, target); } finally { await release(child); }
        }
      };
      /** Opens an existing directory by the walk (links followed by hand) and watches it; false when there is none. */
      const ancestor = async (local: string): Promise<boolean> => {
        let walked: Walked | undefined;
        try { walked = await walk(local, { follow: true, missingOk: true }); } catch { return false; }
        if (!walked) return false;
        try {
          const fd = await openDirFd(walked.path).catch(() => undefined);
          if (fd === undefined) return false;
          try { await this.#consider(fd, seen); } finally { await release(fd); }
          return true;
        } finally { await walked.done(); }
      };
      for (const target of this.targets) {
        // Its existing ancestors are watched, so a missing target's creation schedules a scan.
        const parts = target.local.slice(root.length).split('/').filter(part => part !== '' && part !== '.');
        for (let depth = 0; depth < parts.length; depth++) if (!await ancestor(posix.join(root, ...parts.slice(0, depth)))) break;
        let walked: Walked | undefined;
        // Now outside (a link changed) or not there: nothing to report under it.
        try { walked = await walk(target.local, { follow: true, missingOk: true }); } catch { continue; }
        if (!walked) continue;
        try {
          // The directory holding what the target resolves to (for a link to a file, that file's own directory).
          await this.#consider(walked.parent, seen);
          let stats: Stats;
          try { stats = await lstat(walked.path); } catch { continue; }
          if (stats.isSymbolicLink()) continue; // changed since the walk: the next scan resolves it again
          record(target.local, stats);
          if (!stats.isDirectory()) continue;
          let fd: number;
          try { fd = await openDirFd(walked.path); } catch { continue; }
          try { await scanDirectory(fd, target.local, target); } finally { await release(fd); }
        } finally { await walked.done(); }
      }
      for (const [key, watcher] of this.#watchers) if (!seen.has(key)) { watcher.close(); this.#watchers.delete(key); }
      return snapshot;
    }
  }


  /** Removes `name` in `parent`: a link or file is unlinked (never followed), a directory emptied through its own fd. */
  async function removeEntry(parent: number, name: string, force: boolean): Promise<void> {
    const path = at(parent, name);
    for (let tries = 0; ; tries++) {
      try { await unlink(path); return; } catch (error) {
        const code = codeOf(error);
        if (code === 'ENOENT' && force) return;
        if (code !== 'EISDIR' && code !== 'EPERM') throw error;
      }
      let fd: number;
      try { fd = await openDirFd(path); } catch (error) {
        const code = codeOf(error);
        if (code === 'ENOENT' && force) return;
        // Swapped for a link or a file since the unlink: unlink that instead.
        if ((code === 'ELOOP' || code === 'ENOTDIR') && tries < MAX_HOPS) continue;
        throw error;
      }
      try {
        for (const entry of await readdir(`/proc/self/fd/${fd}`)) await removeEntry(fd, entry, true);
      } finally { await release(fd); }
      try { await rmdir(path); return; } catch (error) {
        if (codeOf(error) === 'ENOENT' && force) return;
        throw error;
      }
    }
  }

  return fs;
}

type ToFileError = (error: unknown, local: string) => FileError;

/** Strict LF lines of one opened file, as Pi's Node line reader reports them. */
class LineReader implements TextLineReader {
  #decoder = new StreamDecoder();
  #chunk = new Uint8Array(64 * 1024);
  #offset = 0;
  #buffered = '';
  #ended = false;
  #closed = false;
  constructor(readonly file: FileHandle, readonly path: string, readonly toError: ToFileError) {}
  async readLine(context: Context): Promise<Result<TextLine | undefined, FileError>> {
    if (context.abortSignal?.aborted) return err(new FileError('aborted', 'aborted', this.path));
    if (this.#closed) return err(new FileError('invalid', 'Text line reader is closed', this.path));
    try {
      for (;;) {
        const newline = this.#buffered.indexOf('\n');
        if (newline !== -1) {
          const text = this.#buffered.slice(0, newline);
          this.#buffered = this.#buffered.slice(newline + 1);
          return ok({ text, terminated: true });
        }
        if (this.#ended) {
          if (this.#buffered.length === 0) return ok(undefined);
          const text = this.#buffered;
          this.#buffered = '';
          return ok({ text, terminated: false });
        }
        const { bytesRead } = await this.file.read(this.#chunk, 0, this.#chunk.length, this.#offset);
        if (context.abortSignal?.aborted) return err(new FileError('aborted', 'aborted', this.path));
        this.#offset += bytesRead;
        if (bytesRead === 0) { this.#buffered += this.#decoder.decode(); this.#ended = true; }
        else this.#buffered += this.#decoder.decode(this.#chunk.subarray(0, bytesRead));
      }
    } catch (error) { return err(this.toError(error, this.path)); }
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#buffered = '';
    await this.file.close().catch(() => undefined);
  }
}

/** Positional reads of one opened regular file. */
class BinaryFileReader implements BinaryReader {
  #closed = false;
  constructor(readonly file: FileHandle, readonly path: string, readonly toError: ToFileError) {}
  #guard(context: Context): Result<never, FileError> | undefined {
    if (context.abortSignal?.aborted) return err(new FileError('aborted', 'aborted', this.path));
    if (this.#closed) return err(new FileError('invalid', 'Binary reader is closed', this.path));
    return undefined;
  }
  async info(context: Context): Promise<Result<FileInfo, FileError>> {
    const failed = this.#guard(context);
    if (failed) return failed;
    try {
      const stats = await this.file.stat();
      const kind = stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : undefined;
      if (!kind) return err(new FileError('invalid', 'Unsupported file type', this.path));
      return ok({ name: posix.basename(this.path), path: this.path, kind, size: stats.size, mtimeMs: stats.mtimeMs });
    } catch (error) { return err(this.toError(error, this.path)); }
  }
  async read(offset: number, length: number, context: Context): Promise<Result<Uint8Array, FileError>> {
    const failed = this.#guard(context);
    if (failed) return failed;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
      return err(new FileError('invalid', 'Offset and length must be non-negative safe integers', this.path));
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < length) {
        const chunk = new Uint8Array(Math.min(length - total, READ_CHUNK));
        const { bytesRead } = await this.file.read(chunk, 0, chunk.length, offset + total);
        if (context.abortSignal?.aborted) return err(new FileError('aborted', 'aborted', this.path));
        if (bytesRead === 0) break;
        chunks.push(bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead));
        total += bytesRead;
      }
    } catch (error) { return err(this.toError(error, this.path)); }
    if (chunks.length === 1) return ok(chunks[0]!);
    const bytes = new Uint8Array(total);
    let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
    return ok(bytes);
  }
  async scanLines(range: { startLine: number; endLine?: number }, context: Context): Promise<Result<LineScan, FileError>> {
    const failed = this.#guard(context);
    if (failed) return failed;
    let scanner: LineScanner;
    try { scanner = new LineScanner(range.startLine, range.endLine); } catch { return err(new FileError('invalid', 'Invalid line range', this.path)); }
    const chunk = new Uint8Array(64 * 1024);
    try {
      for (let position = 0; ;) {
        const { bytesRead } = await this.file.read(chunk, 0, chunk.length, position);
        if (context.abortSignal?.aborted) return err(new FileError('aborted', 'aborted', this.path));
        if (bytesRead === 0) return ok(scanner.finish());
        scanner.push(chunk.subarray(0, bytesRead));
        position += bytesRead;
      }
    } catch (error) { return err(this.toError(error, this.path)); }
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.file.close().catch(() => undefined);
  }
}

/** Pages of one opened directory; entries are described through its fd, never by path. */
class DirectoryReader implements DirReader {
  #done = false;
  #closed = false;
  constructor(readonly dir: Dir, readonly fd: number, readonly path: string, readonly toError: ToFileError) {}
  async next(maxEntries: number, context: Context): Promise<Result<{ entries: FileInfo[]; done: boolean }, FileError>> {
    if (context.abortSignal?.aborted) return err(new FileError('aborted', 'aborted', this.path));
    if (this.#closed) return err(new FileError('invalid', 'Directory reader is closed', this.path));
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) return err(new FileError('invalid', 'maxEntries must be a positive safe integer', this.path));
    const entries: FileInfo[] = [];
    try {
      while (!this.#done && entries.length < maxEntries) {
        const entry = await this.dir.read();
        if (entry === null) { this.#done = true; break; }
        if (context.abortSignal?.aborted) return err(new FileError('aborted', 'aborted', this.path));
        const entryPath = posix.join(this.path, entry.name);
        let stats: Stats;
        try { stats = await lstat(at(this.fd, entry.name)); } catch (error) {
          // Removed between enumeration and lstat: not part of the listing any more.
          if (codeOf(error) === 'ENOENT') continue;
          return err(this.toError(error, entryPath));
        }
        const kind = stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : stats.isSymbolicLink() ? 'symlink' : undefined;
        if (kind) entries.push({ name: entry.name, path: entryPath, kind, size: stats.size, mtimeMs: stats.mtimeMs });
      }
      return ok({ entries, done: this.#done });
    } catch (error) { return err(this.toError(error, this.path)); }
  }
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.dir.close().catch(() => undefined);
    await release(this.fd);
  }
}
