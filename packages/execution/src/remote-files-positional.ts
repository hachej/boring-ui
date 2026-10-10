// Pi's `BinaryReader` and `DirReader` keep an open handle; a stateless request cannot. Over the remote-files wire each reader call
// is one request that opens the worker's own native reader, answers a bounded range, page or scan, and closes it again. The client
// remembers what the file looked like when it was opened and the worker refuses a request when the file no longer matches, which is
// the stateless counterpart of Pi's "all calls see the same file".
import { FileError, err, ok } from '@earendil-works/pi-durable/env';
import type { BinaryReader, DirReader, FileInfo, FileSystem, LineScan, Result } from '@earendil-works/pi-durable/env';
import type { Context } from '@earendil-works/chord';
import { z } from 'zod';
import { bytes, dirPage, fileInfo, lineScan, maxDirPageEntries, maxRangeBytes } from './remote-files-protocol.js';
import type { DirPage, ExpectedFile, PositionalCall, ReaderOptions, RemoteFileSystemCall } from './remote-files-protocol.js';

const changed = (left: ExpectedFile, right: ExpectedFile): boolean => left.size !== right.size || left.mtimeMs !== right.mtimeMs;
const changedFile = (path: string) => new FileError('invalid', 'The file changed since it was opened', path);
const closedReader = (what: string, path: string) => new FileError('invalid', `${what} is closed`, path);
const aborted = (context: Context, path: string): FileError | undefined => context.abortSignal?.aborted ? new FileError('aborted', 'Operation aborted', path) : undefined;

/** Worker side: serve one positional call over the worker's native `FileSystem`. `cleanup` closes readers after the request context ends. */
export async function servePositional(fs: FileSystem, call: PositionalCall, context: Context, cleanup: Context, maxResponseBytes: number): Promise<Result<unknown, FileError>> {
  if (call.method === 'readDirPage') return serveDirPage(fs, call.args, context, cleanup);
  const [path, options] = call.args;
  const opened = await fs.openBinaryReader(path, options, context);
  if (!opened.ok) return opened;
  const reader = opened.value;
  try {
    const before = await reader.info(context);
    if (!before.ok) return before;
    if (call.method === 'binaryInfo') return before;
    const expected: ExpectedFile = (call.method === 'readRange' ? call.args[4] : call.args[3]) ?? before.value;
    if (changed(before.value, expected)) return err(changedFile(path));
    let produced: Result<unknown, FileError>;
    if (call.method === 'readRange') {
      const [, , offset, length] = call.args;
      if (length > maxRangeBytes(maxResponseBytes)) return err(new FileError('invalid', 'The range exceeds the remote response limit', path));
      produced = await reader.read(offset, length, context);
    } else {
      const { startLine, endLine } = call.args[2];
      if (endLine !== undefined && endLine <= startLine) return err(new FileError('invalid', 'Invalid line range', path));
      produced = await reader.scanLines(call.args[2], context);
    }
    if (!produced.ok) return produced;
    // A change while the range was read or the file scanned would mix two versions of it.
    const after = await reader.info(context);
    if (!after.ok) return after;
    return changed(after.value, expected) ? err(changedFile(path)) : produced;
  } finally { await reader.close(cleanup); }
}

async function serveDirPage(fs: FileSystem, [path, offset, maxEntries, expectedMtimeMs]: Extract<PositionalCall, { method: 'readDirPage' }>['args'], context: Context, cleanup: Context): Promise<Result<unknown, FileError>> {
  const stamp = async (): Promise<Result<number, FileError>> => {
    // A symbolic link's own timestamps say nothing about the directory behind it.
    const canonical = await fs.canonicalPath(path, context);
    if (!canonical.ok) return canonical;
    const info = await fs.fileInfo(canonical.value, context);
    return info.ok ? ok(info.value.mtimeMs) : info;
  };
  const opened = await fs.openDirReader(path, context);
  if (!opened.ok) return opened;
  const reader = opened.value;
  try {
    const before = await stamp();
    if (!before.ok) return before;
    if (expectedMtimeMs !== undefined && before.value !== expectedMtimeMs) return err(new FileError('invalid', 'The directory changed since it was opened', path));
    const entries: FileInfo[] = [];
    let done = false, skip = offset;
    while (skip > 0 && !done) {
      const page = await reader.next(Math.min(skip, maxDirPageEntries), context);
      if (!page.ok) return page;
      skip -= page.value.entries.length; done = page.value.done;
      if (page.value.entries.length === 0 && !page.value.done) return err(new FileError('unknown', 'The native directory reader made no progress', path));
    }
    if (maxEntries > 0 && !done) {
      const page = await reader.next(maxEntries, context);
      if (!page.ok) return page;
      entries.push(...page.value.entries); done = page.value.done;
      if (entries.length === 0 && !done) return err(new FileError('unknown', 'The native directory reader made no progress', path));
    }
    const after = await stamp();
    if (!after.ok) return after;
    if (after.value !== before.value) return err(new FileError('invalid', 'The directory changed while it was being read', path));
    return ok({ entries, done, mtimeMs: before.value });
  } finally { await reader.close(cleanup); }
}

type Invoke = <Value>(call: RemoteFileSystemCall, output: z.ZodType<Value>, context: Context) => Promise<Result<Value, FileError>>;

/** Client side: Pi's `openBinaryReader` and `openDirReader` over `invoke`, one bounded request per call. */
export function remoteReaders(invoke: Invoke, maxResponseBytes: number): Pick<FileSystem, 'openBinaryReader' | 'openDirReader'> {
  const chunk = maxRangeBytes(maxResponseBytes);
  return {
    openBinaryReader: async (requested, options, context): Promise<Result<BinaryReader, FileError>> => {
      // Resolve once: the lease's cwd can change later, and every request of this reader must name the file it opened.
      const resolved = await invoke({ method: 'absolutePath', args: [requested] }, z.string(), context);
      if (!resolved.ok) return resolved;
      const path = resolved.value;
      const wire: ReaderOptions | undefined = options?.noFollow === undefined ? undefined : { noFollow: options.noFollow };
      const info = await invoke({ method: 'binaryInfo', args: [path, wire] }, fileInfo, context);
      if (!info.ok) return info;
      const opened: FileInfo = info.value, expected: ExpectedFile = { size: opened.size, mtimeMs: opened.mtimeMs };
      let closed = false;
      const refuse = (inner: Context): FileError | undefined => aborted(inner, path) ?? (closed ? closedReader('Binary reader', path) : undefined);
      return ok({
        info: async inner => { const failed = refuse(inner); return failed ? err(failed) : ok({ ...opened }); },
        read: async (offset, length, inner) => {
          const failed = refuse(inner);
          if (failed) return err(failed);
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) return err(new FileError('invalid', 'Offset and length must be non-negative safe integers', path));
          const parts: Uint8Array[] = [];
          let total = 0;
          while (total < length) {
            const want = Math.min(length - total, chunk);
            const piece = await invoke({ method: 'readRange', args: [path, wire, offset + total, want, expected] }, bytes, inner);
            if (!piece.ok) return piece;
            parts.push(piece.value); total += piece.value.length;
            if (piece.value.length < want) break;
          }
          if (parts.length === 1) return ok(parts[0]!);
          const joined = new Uint8Array(total);
          let position = 0;
          for (const part of parts) { joined.set(part, position); position += part.length; }
          return ok(joined);
        },
        // The worker's native reader scans in place; moving the file to count its newlines here would defeat a bounded read.
        scanLines: async (range, inner): Promise<Result<LineScan, FileError>> => {
          const failed = refuse(inner);
          if (failed) return err(failed);
          const { startLine, endLine } = range;
          if (!Number.isSafeInteger(startLine) || startLine < 0 || (endLine !== undefined && (!Number.isSafeInteger(endLine) || endLine <= startLine))) return err(new FileError('invalid', 'Invalid line range', path));
          return invoke({ method: 'scanLines', args: [path, wire, endLine === undefined ? { startLine } : { startLine, endLine }, expected] }, lineScan, inner);
        },
        close: async () => { closed = true; },
      });
    },
    openDirReader: async (requested, context): Promise<Result<DirReader, FileError>> => {
      const resolved = await invoke({ method: 'absolutePath', args: [requested] }, z.string(), context);
      if (!resolved.ok) return resolved;
      const path = resolved.value;
      const probe = await invoke({ method: 'readDirPage', args: [path, 0, 0, undefined] }, dirPage, context);
      if (!probe.ok) return probe;
      const mtimeMs = probe.value.mtimeMs;
      let offset = 0, done = false, closed = false, busy = false;
      return ok({
        next: async (maxEntries, inner) => {
          const failed = aborted(inner, path) ?? (closed ? closedReader('Directory reader', path) : undefined);
          if (failed) return err(failed);
          if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) return err(new FileError('invalid', 'maxEntries must be a positive safe integer', path));
          if (busy) return err(new FileError('invalid', 'A directory read is already pending', path));
          busy = true;
          try {
            const entries: FileInfo[] = [];
            while (!done && entries.length < maxEntries) {
              const page: Result<DirPage, FileError> = await invoke({ method: 'readDirPage', args: [path, offset, Math.min(maxEntries - entries.length, maxDirPageEntries), mtimeMs] }, dirPage, inner);
              if (!page.ok) return page;
              entries.push(...page.value.entries); offset += page.value.entries.length; done = page.value.done;
              if (page.value.entries.length === 0 && !done) break;
            }
            return ok({ entries, done });
          } finally { busy = false; }
        },
        close: async () => { closed = true; },
      });
    },
  };
}
