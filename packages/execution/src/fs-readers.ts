// Pi 1.0.3 asks every `FileSystem` for positional readers, paged directory readers and watchers. Environments here that hold no open
// file handles (the in-memory virtual file system) build the readers on whole-file and whole-directory reads they
// already have: a reader keeps the bytes or entries as they were when opened. They report no changes: `watch` is `not_supported`. The remote file system does not use this: its worker has native positional
// readers, which `remote-files-positional.ts` forwards without moving the whole file.
import { FileError, LineScanner, ok, err } from '@earendil-works/pi-durable/env';
import type { BinaryReader, DirReader, FileInfo, FileSystem, FileWatcher, Result } from '@earendil-works/pi-durable/env';
import type { Context } from '@earendil-works/chord';

type Source = Pick<FileSystem, 'readBinaryFile' | 'fileInfo' | 'listDir' | 'canonicalPath'>;

export function snapshotReaders(source: Source): Pick<FileSystem, 'openBinaryReader' | 'openDirReader' | 'watch'> {
  const guard = (closed: boolean, path: string, context: Context): FileError | undefined =>
    context.abortSignal?.aborted ? new FileError('aborted', 'Operation aborted', path) : closed ? new FileError('invalid', 'Reader is closed', path) : undefined;
  return {
    openBinaryReader: async (path, options, context): Promise<Result<BinaryReader, FileError>> => {
      // `fileInfo` describes the final path itself. A symbolic link is followed unless the caller refuses it (`noFollow`).
      const link = await source.fileInfo(path, context);
      if (!link.ok) return link;
      let resolved = path;
      if (link.value.kind === 'symlink' && !options?.noFollow) {
        const canonical = await source.canonicalPath(path, context);
        if (!canonical.ok) return canonical;
        resolved = canonical.value;
      }
      const info = resolved === path ? link : await source.fileInfo(resolved, context);
      if (!info.ok) return info;
      if (info.value.kind === 'directory') return err(new FileError('is_directory', 'EISDIR: illegal operation on a directory', path));
      if (info.value.kind !== 'file') return err(new FileError('invalid', 'Not a regular file', path));
      const content = await source.readBinaryFile(resolved, context);
      if (!content.ok) return content;
      const bytes = content.value, opened: FileInfo = { ...info.value, size: bytes.length };
      let closed = false;
      return ok({
        info: async inner => { const failed = guard(closed, path, inner); return failed ? err(failed) : ok({ ...opened }); },
        read: async (offset, length, inner) => {
          const failed = guard(closed, path, inner);
          if (failed) return err(failed);
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) return err(new FileError('invalid', 'Offset and length must be non-negative integers', path));
          return ok(bytes.slice(offset, offset + length));
        },
        scanLines: async ({ startLine, endLine }, inner) => {
          const failed = guard(closed, path, inner);
          if (failed) return err(failed);
          if (!Number.isSafeInteger(startLine) || startLine < 0 || (endLine !== undefined && (!Number.isSafeInteger(endLine) || endLine <= startLine))) {
            return err(new FileError('invalid', 'Line range must be non-negative integers with endLine > startLine', path));
          }
          const scanner = new LineScanner(startLine, endLine);
          scanner.push(bytes);
          return ok(scanner.finish());
        },
        close: async () => { closed = true; },
      });
    },
    openDirReader: async (path, context): Promise<Result<DirReader, FileError>> => {
      // Resolve the directory once: a later change of the environment's cwd must not move this reader to another directory.
      const directory = await source.canonicalPath(path, context);
      if (!directory.ok) return directory;
      const listed = await source.listDir(directory.value, context);
      if (!listed.ok) return listed;
      const prefix = directory.value === '/' ? '' : directory.value;
      const pending = listed.value.filter(entry => entry.kind === 'file' || entry.kind === 'directory' || entry.kind === 'symlink').map(entry => `${prefix}/${entry.name}`);
      let offset = 0, closed = false;
      return ok({
        next: async (maxEntries, inner) => {
          const failed = guard(closed, path, inner);
          if (failed) return err(failed);
          if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) return err(new FileError('invalid', 'maxEntries must be a positive integer', path));
          // Stat only the entries this page consumes; an entry removed since the open is skipped, as Pi's readers allow.
          const page: FileInfo[] = [];
          while (page.length < maxEntries && offset < pending.length) {
            const info = await source.fileInfo(pending[offset++]!, inner);
            if (info.ok) page.push(info.value);
            else if (info.error.code !== 'not_found') return err(info.error);
          }
          return ok({ entries: page, done: offset >= pending.length });
        },
        close: async () => { closed = true; },
      });
    },
    watch: async (): Promise<Result<FileWatcher, FileError>> => err(new FileError('not_supported', 'This environment does not report file changes')),
  };
}

/** A POSIX shell command that runs exactly `argv`: each word single-quoted. These environments run commands through a shell. */
export function shellCommand(command: string | readonly string[]): string {
  return typeof command === 'string' ? command : command.map(word => `'${word.replaceAll("'", `'\\''`)}'`).join(' ');
}
