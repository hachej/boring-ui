// Stale missing-path lookups on a network file system shared with another client (EFS, NFS): a path created by a command in
// the Code Interpreter can be reported `not_found` by this host for a while, because its NFS client keeps a negative dentry until
// the directory's attributes are revalidated. This wraps the mounted files' READ operations: a miss shortly after a command ran
// forces the parent directory to revalidate (it is opened and read through the same no-follow walk) and looks again, with a
// short backoff, until the window ends. Writes are never retried; no other error is retried; confinement is unchanged.
import { posix } from 'node:path';
import type { Context } from '@earendil-works/chord/context';
import type { FileError, Result } from '@earendil-works/pi-durable/env';
import type { MountedFiles } from './mounted-files.js';

export interface StaleMissOptions {
  /** How long after a command a miss is not believed (ms). 0 disables. */
  readonly windowMs: number;
  /** When the last command finished (ms since epoch), 0 if none ran; and whether one is running now. */
  readonly activity: () => { readonly running: boolean; readonly lastEndedAt: number };
  /** Maps a path of the caller's namespace to its parent directory in the same namespace (undefined: no parent to revalidate). */
  readonly parentOf?: (path: string) => string | undefined;
  readonly now?: () => number;
}

const BACKOFF_MS = [25, 50, 100, 200, 400, 500] as const;
const pause = (ms: number, signal: AbortSignal | undefined): Promise<void> => new Promise(resolve => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
});

export function withStaleMissRetry(files: MountedFiles, options: StaleMissOptions): MountedFiles {
  const { windowMs, activity } = options;
  if (!(windowMs > 0)) return files;
  const now = options.now ?? Date.now;
  const parentOf = options.parentOf ?? (path => { const parent = posix.dirname(path); return parent === path ? undefined : parent; });

  /** Opens and reads the nearest existing ancestor of `path`: close-to-open revalidation drops the negative dentry. */
  async function revalidate(path: string, context: Context): Promise<void> {
    for (let directory = parentOf(path); directory !== undefined; directory = parentOf(directory)) {
      if (context.abortSignal?.aborted) return;
      let reader;
      try { reader = await files.openDirReader(directory, context); } catch { return; }
      if (!reader.ok) { if (reader.error.code === 'not_found') continue; return; }
      try { await reader.value.next(1, context); } catch { /* the lookup that follows reports what happens */ } finally { try { await reader.value.close(context); } catch { /* released with the walk */ } }
      return;
    }
  }

  /** Runs `run`; a miss within the window is rechecked after revalidating the parent, until the window, the deadline or an abort. */
  async function retried<T>(path: string, context: Context, isMiss: (result: Result<T, FileError>) => boolean, run: () => Promise<Result<T, FileError>>): Promise<Result<T, FileError>> {
    let result = await run();
    if (!isMiss(result)) return result;
    const { running, lastEndedAt } = activity();
    const started = now();
    // A command still running may create the file at any moment: the window then counts from this call.
    const until = running ? started + windowMs : lastEndedAt + windowMs;
    // A Context deadline is its abort signal (withTimeout aborts it), so the abort check below covers it.
    const limit = until;
    for (let attempt = 0; now() < limit && !context.abortSignal?.aborted; attempt++) {
      await revalidate(path, context);
      result = await run();
      if (!isMiss(result)) return result;
      const wait = Math.min(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!, limit - now());
      if (wait <= 0) break;
      await pause(wait, context.abortSignal);
    }
    return result;
  }

  const missed = <T>(result: Result<T, FileError>): boolean => !result.ok && result.error.code === 'not_found';
  const false_ = (result: Result<boolean, FileError>): boolean => result.ok && !result.value;
  return {
    ...files,
    readTextFile: (path, context) => retried(path, context, missed, () => files.readTextFile(path, context)),
    readBinaryFile: (path, context) => retried(path, context, missed, () => files.readBinaryFile(path, context)),
    readTextLines: (path, lines, context) => retried(path, context, missed, () => files.readTextLines(path, lines, context)),
    openTextLineReader: (path, context) => retried(path, context, missed, () => files.openTextLineReader(path, context)),
    openBinaryReader: (path, readerOptions, context) => retried(path, context, missed, () => files.openBinaryReader(path, readerOptions, context)),
    openDirReader: (path, context) => retried(path, context, missed, () => files.openDirReader(path, context)),
    fileInfo: (path, context) => retried(path, context, missed, () => files.fileInfo(path, context)),
    listDir: (path, context) => retried(path, context, missed, () => files.listDir(path, context)),
    canonicalPath: (path, context) => retried(path, context, missed, () => files.canonicalPath(path, context)),
    exists: (path, context) => retried(path, context, false_, () => files.exists(path, context)),
  };
}
