// A host folder (or the host's view of a mounted one) as a Pi `FileSystem`, every operation confined to it by the no-follow
// walk of `no-follow-fs.ts` (D-2087): code that shares the folder can swap a directory for a link between a check and an open,
// so no path is checked and then opened; each component is opened from its parent's directory fd with O_NOFOLLOW.
import { posix } from 'node:path';
import { FileError, err, ok } from '@earendil-works/pi-durable/env';
import type { FileInfo, FileSystem, Result } from '@earendil-works/pi-durable/env';
import { boundedMessage } from './bounded-error.js';
import { createNoFollowFileSystem } from './no-follow-fs.js';
import type { NoFollowWatchTarget } from './no-follow-fs.js';

const within = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);

/** The file operations of a `FileSystem`; the caller adds `id`, `cwd`, the temporary-file operations and `cleanup`. */
export type MountedFiles = Omit<FileSystem, 'id' | 'cwd' | 'createTempDir' | 'createTempFile' | 'cleanup'>;

export interface MountedFilesOptions {
  /** The folder on this host. */
  readonly root: string;
  /** Where the caller's paths name that folder (the same as `root` for a plain folder). */
  readonly mountPath: string;
  /** The working directory of relative paths, read per call: a facade may change it. */
  readonly cwd: () => string;
}

/** Paths in `mountPath`'s namespace, mapped onto `root`; a path or link that leaves `root` is refused. `close` releases the folder's fd. */
export function createMountedFiles(options: MountedFilesOptions): { readonly files: MountedFiles; readonly outside: (path: string) => FileError; close(): Promise<void> } {
  const { root, mountPath, cwd } = options;
  const namespace = (path: string): string => posix.resolve(cwd(), path);
  const toLocal = (path: string): string | undefined => {
    const absolute = namespace(path);
    return within(absolute, mountPath) ? posix.join(root, absolute.slice(mountPath.length)) : undefined;
  };
  const fromLocal = (path: string, base = root): string => within(path, base) ? posix.join(mountPath, path.slice(base.length)) : mountPath;
  const outside = (path: string): FileError => new FileError('permission_denied', boundedMessage(`Outside the workspace: ${namespace(path)}`), namespace(path));
  const walk = createNoFollowFileSystem({ root, outside: path => outside(fromLocal(path)) });
  const mapError = (error: FileError): FileError => new FileError(error.code, boundedMessage(error.message.split(root).join(mountPath)),
    error.path !== undefined && within(error.path, root) ? fromLocal(error.path) : error.path, error);
  const mapInfo = (info: FileInfo): FileInfo => ({ ...info, path: fromLocal(info.path) });
  async function guarded<T>(paths: readonly string[], run: (...locals: string[]) => Promise<Result<T, FileError>>): Promise<Result<T, FileError>> {
    const locals: string[] = [];
    for (const path of paths) {
      const mapped = toLocal(path);
      if (mapped === undefined) return err(outside(path));
      locals.push(mapped);
    }
    let result: Result<T, FileError>;
    try { result = await run(...locals); } catch (error) { return err(new FileError('unknown', boundedMessage(error), namespace(paths[0] ?? '.'))); }
    return result.ok ? result : err(mapError(result.error));
  }
  const files: MountedFiles = {
    absolutePath: async path => ok(namespace(path)),
    joinPath: async parts => ok(posix.join(...parts)),
    readTextFile: (path, context) => guarded([path], file => walk.readTextFile(file, context)),
    readBinaryFile: (path, context) => guarded([path], file => walk.readBinaryFile(file, context)),
    readTextLines: (path, lines, context) => guarded([path], file => walk.readTextLines(file, lines, context)),
    openTextLineReader: (path, context) => guarded([path], file => walk.openTextLineReader(file, context)),
    openBinaryReader: (path, readerOptions, context) => guarded([path], file => walk.openBinaryReader(file, readerOptions, context)),
    // The reader's entries carry host paths; map them into the workspace namespace like `listDir`.
    openDirReader: async (path, context) => {
      const opened = await guarded([path], directory => walk.openDirReader(directory, context));
      if (!opened.ok) return opened;
      const reader = opened.value;
      return ok({
        next: async (maxEntries, readContext) => {
          const page = await reader.next(maxEntries, readContext);
          return page.ok ? ok({ ...page.value, entries: page.value.entries.map(mapInfo) }) : err(mapError(page.error));
        },
        close: readContext => reader.close(readContext),
      });
    },
    // Watched through the same walk (directory fds, never a path), with its paths reported in the workspace's namespace.
    watch: async (targets, onChange, context) => {
      const mapped: NoFollowWatchTarget[] = [];
      for (const target of targets) {
        const local = toLocal(target.path);
        if (local === undefined) return err(outside(target.path));
        mapped.push({ local, recursive: target.recursive === true, hidden: target.exclude?.hidden === true, names: new Set(target.exclude?.names ?? []) });
      }
      const watcher = await walk.watch(mapped, change => onChange(change.kind === 'paths' ? { kind: 'paths', paths: change.paths.map(path => fromLocal(path)) } : change.kind === 'failed' ? { kind: 'failed', error: mapError(change.error) } : change), context);
      return watcher.ok ? ok({ mode: watcher.value.mode, stop: stopContext => watcher.value.stop(stopContext) }) : err(mapError(watcher.error));
    },
    writeFile: (path, content, context) => guarded([path], file => walk.writeFile(file, content, context)),
    appendFile: (path, content, context) => guarded([path], file => walk.appendFile(file, content, context)),
    truncateFile: (path, size, context) => guarded([path], file => walk.truncateFile(file, size, context)),
    flushFile: (path, context) => guarded([path], file => walk.flushFile(file, context)),
    renameFile: (source, destination, context) => guarded([source, destination], (from, to) => walk.renameFile(from!, to!, context)),
    fileInfo: async (path, context) => { const info = await guarded([path], file => walk.fileInfo(file, context)); return info.ok ? ok(mapInfo(info.value)) : info; },
    listDir: async (path, context) => { const list = await guarded([path], directory => walk.listDir(directory, context)); return list.ok ? ok(list.value.map(mapInfo)) : list; },
    canonicalPath: async (path, context) => {
      const resolved = await guarded([path], file => walk.canonicalPath(file, context));
      return resolved.ok ? ok(fromLocal(resolved.value)) : resolved;
    },
    exists: (path, context) => guarded([path], file => walk.exists(file, context)),
    createDir: (path, directory, context) => guarded([path], file => walk.createDir(file, directory, context)),
    remove: (path, removal, context) => guarded([path], file => walk.remove(file, removal, context)),  };
  return { files, outside, close: () => walk.close() };
}
