import { z } from 'zod';
import { awaitWithContext, withAbortSignal } from '@earendil-works/chord/context';
import type { Context } from '@earendil-works/chord';
import { FileError, ok, err } from '@earendil-works/pi-durable/env';
import type { FileSystem, Result, TextLine, TextLineReader } from '@earendil-works/pi-durable/env';
import type { WorkspaceIdentity, WorkspaceLease } from './contracts.js';
import { bytes, fileInfo, line, nothing, envelope, streamFrame, schema, version, nativeVersion, streamType, identity, sameIdentity, positiveLimit, result, wireCall, requestInput } from './remote-files-protocol.js';
import type { RemoteFileSystemCall } from './remote-files-protocol.js';
import { frameReader, readJson } from './remote-files-io.js';
import { randomUUID } from '@hachej/boring-files/platform';
import { snapshotReaders } from './fs-readers.js';
export { createRemoteFileSystemHandler } from './remote-files-handler.js';
export type { RemoteFileSystemAccess, RemoteFileSystemHandlerOptions } from './remote-files-handler.js';
export type { RemoteFileSystemCall } from './remote-files-protocol.js';

export interface RemoteFileSystemOptions {
  readonly identity: WorkspaceIdentity;
  readonly filesystemId: string;
  readonly cwd: string;
  readonly endpoint: string | URL;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxFrameBytes?: number;
}

interface Connection {
  readonly response: Response;
  readonly requestId: string;
  readonly local: Context;
  readonly abort: AbortController;
  readonly detach: () => void;
  readonly dispose: () => Promise<void>;
  readonly setFrames: (close: () => Promise<void>) => void;
}

export function createRemoteFileSystemLease(options: RemoteFileSystemOptions): WorkspaceLease<FileSystem> {
  const selected = identity(options.identity), filesystemId = z.string().min(1).parse(options.filesystemId);
  const endpoint = new URL(options.endpoint), fetch = options.fetch;
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) throw new TypeError('Expected an HTTP endpoint without credentials or fragment');
  let cwd = z.string().parse(options.cwd), closed = false;
  const maxRequestBytes = positiveLimit(options.maxRequestBytes ?? 1_048_576), maxResponseBytes = positiveLimit(options.maxResponseBytes ?? 4_194_304);
  const maxFrameBytes = positiveLimit(options.maxFrameBytes ?? 1_048_576), active = new Set<() => Promise<void>>();
  const unavailable = (message: string) => new FileError('unknown', message + '; prior remote effects may remain');
  const connect = async (call: RemoteFileSystemCall, context: Context): Promise<Result<Connection, FileError>> => {
    if (closed) return err(new FileError('invalid', 'Remote filesystem lease is closed'));
    if (context.abortSignal?.aborted) return err(new FileError('aborted', 'Filesystem operation aborted before dispatch'));
    const abort = new AbortController(), requestId = randomUUID();
    const onAbort = () => abort.abort(), detach = () => context.abortSignal?.removeEventListener('abort', onAbort);
    const local = withAbortSignal(abort.signal, context);
    let response: Response | undefined, closeFrames: (() => Promise<void>) | undefined, dispatched = false;
    const dispose = async (): Promise<void> => {
      detach(); abort.abort(); active.delete(dispose);
      if (closeFrames) await closeFrames(); else if (response?.body) void response.body.cancel().catch(() => {});
    };
    active.add(dispose); context.abortSignal?.addEventListener('abort', onAbort, { once: true });
    try {
      const body = JSON.stringify({ schema, version, nativeVersion, requestId, identity: selected, filesystemId, cwd, call: wireCall(call) });
      requestInput(JSON.parse(body));
      if (new TextEncoder().encode(body).length > maxRequestBytes) throw new TypeError('Filesystem request byte limit exceeded');
      if (context.abortSignal?.aborted || closed) { await dispose(); return err(new FileError('aborted', 'Filesystem operation aborted before dispatch')); }
      const request = new Request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: abort.signal, redirect: 'error' });
      dispatched = true;
      const pending = fetch(request);
      void pending.then(value => { if (abort.signal.aborted) void value.body?.cancel().catch(() => {}); }, () => {});
      response = await awaitWithContext(pending, local);
      if (response.redirected || response.status !== 200 || !response.body) throw new TypeError('Filesystem response unavailable');
      return ok({ response, requestId, local, abort, detach, dispose, setFrames: (close: () => Promise<void>) => { closeFrames = close; } });
    } catch {
      const cancelled = context.abortSignal?.aborted === true;
      await dispose();
      if (cancelled) return err(new FileError('aborted', dispatched ? 'Filesystem operation aborted; prior remote effects may remain' : 'Filesystem operation aborted before dispatch'));
      return err(dispatched ? unavailable('Filesystem acknowledgement was not received') : new FileError('invalid', 'Invalid remote filesystem request'));
    }
  };
  const matches = (value: { readonly requestId: string; readonly identity: WorkspaceIdentity; readonly filesystemId: string }, requestId: string): boolean => value.requestId === requestId && sameIdentity(value.identity, selected) && value.filesystemId === filesystemId;
  const invoke = async <Value>(call: RemoteFileSystemCall, output: z.ZodType<Value>, context: Context): Promise<Result<Value, FileError>> => {
    const connected = await connect(call, context);
    if (!connected.ok) return connected;
    const connection = connected.value;
    try {
      if (connection.response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') throw new TypeError('Invalid filesystem response type');
      const value = envelope.parse(await readJson(connection.response.body, connection.local, maxResponseBytes));
      if (!matches(value, connection.requestId) || connection.abort.signal.aborted) throw new TypeError('Filesystem response identity mismatch');
      return result(value.result, output);
    } catch {
      if (context.abortSignal?.aborted) return err(new FileError('aborted', 'Filesystem operation aborted; prior remote effects may remain'));
      return err(unavailable('Filesystem acknowledgement was invalid or interrupted'));
    } finally { await connection.dispose(); }
  };
  const open: FileSystem['openTextLineReader'] = async (path, context) => {
    const connected = await connect({ method: 'openTextLineReader', args: [path] }, context);
    if (!connected.ok) return connected;
    const connection = connected.value;
    let retained = false;
    try {
      if (connection.response.headers.get('content-type')?.split(';')[0]?.trim() === 'application/json') {
        const value = envelope.parse(await readJson(connection.response.body, connection.local, maxResponseBytes));
        if (!matches(value, connection.requestId)) throw new TypeError('Filesystem response identity mismatch');
        return result(value.result, z.never());
      }
      if (connection.response.headers.get('content-type')?.split(';')[0]?.trim() !== streamType || !connection.response.body) throw new TypeError('Invalid filesystem stream type');
      const frames = frameReader(connection.response.body, maxFrameBytes);
      connection.setFrames(frames.close);
      const first = streamFrame.parse(await awaitWithContext(frames.next(), connection.local));
      if (first.type !== 'opened' || !matches(first, connection.requestId) || connection.abort.signal.aborted) throw new TypeError('Filesystem stream identity mismatch');
      connection.detach();
      let sequence = 1, pending: Promise<unknown> | undefined, busy = false, ended = false, readerClosed = false;
      const close = async (): Promise<void> => { if (readerClosed) return; readerClosed = true; await connection.dispose(); };
      const reader: TextLineReader = {
        close,
        readLine: async readContext => {
          if (readContext.abortSignal?.aborted) return err(new FileError('aborted', 'Read wait was cancelled; the line has not been consumed'));
          if (readerClosed || closed) return err(new FileError('invalid', 'Remote line reader is closed'));
          if (ended) return ok(undefined);
          if (connection.abort.signal.aborted) return err(new FileError('invalid', 'Remote line reader is closed'));
          if (busy) return err(new FileError('invalid', 'A line read is already pending'));
          busy = true;
          try {
            pending ??= frames.next();
            const value = await awaitWithContext(pending, withAbortSignal(connection.abort.signal, readContext));
            if (readContext.abortSignal?.aborted) return err(new FileError('aborted', 'Read wait was cancelled; the line has not been consumed'));
            if (readerClosed || connection.abort.signal.aborted) throw new TypeError('Reader closed during read');
            const frame = streamFrame.parse(value);
            if (frame.requestId !== connection.requestId || frame.sequence !== sequence || frame.type === 'opened') throw new TypeError('Filesystem line sequence mismatch');
            if (frame.type === 'end') {
              pending = frames.next().then(tail => { if (tail !== undefined) throw new TypeError('Data after filesystem EOF'); return value; });
              await awaitWithContext(pending, withAbortSignal(connection.abort.signal, readContext));
              if (readContext.abortSignal?.aborted) return err(new FileError('aborted', 'Read wait was cancelled; the line has not been consumed'));
              pending = undefined; ended = true; await connection.dispose();
              return ok(undefined);
            }
            const decoded: Result<TextLine, FileError> = result(frame.result, line);
            pending = undefined; sequence++;
            return decoded;
          } catch {
            if (readContext.abortSignal?.aborted && !connection.abort.signal.aborted) return err(new FileError('aborted', 'Read wait was cancelled; the line has not been consumed'));
            await close(); return err(unavailable('Remote line observation was interrupted'));
          } finally { busy = false; }
        },
      };
      retained = true; return ok(reader);
    } catch { return err(unavailable('Remote line reader could not be opened')); }
    finally { if (!retained) await connection.dispose(); }
  };
  const release = async (): Promise<void> => { closed = true; await Promise.all([...active].map(close => close())); };
  const readers = snapshotReaders({ readBinaryFile: (path, context) => environment.readBinaryFile(path, context), fileInfo: (path, context) => environment.fileInfo(path, context), listDir: (path, context) => environment.listDir(path, context) });
  const environment: FileSystem = {
    ...readers, id: filesystemId, get cwd() { return cwd; }, set cwd(value) { cwd = value; }, cleanup: release,
    absolutePath: (path, context) => invoke({ method: 'absolutePath', args: [path] }, z.string(), context),
    joinPath: (parts, context) => invoke({ method: 'joinPath', args: [parts] }, z.string(), context),
    readTextFile: (path, context) => invoke({ method: 'readTextFile', args: [path] }, z.string(), context),
    openTextLineReader: open,
    readTextLines: (path, options, context) => invoke({ method: 'readTextLines', args: [path, options] }, z.array(z.string()), context),
    readBinaryFile: (path, context) => invoke({ method: 'readBinaryFile', args: [path] }, bytes, context),
    writeFile: (path, content, context) => invoke({ method: 'writeFile', args: [path, content] }, nothing, context),
    appendFile: (path, content, context) => invoke({ method: 'appendFile', args: [path, content] }, nothing, context),
    truncateFile: (path, size, context) => invoke({ method: 'truncateFile', args: [path, size] }, nothing, context),
    flushFile: (path, context) => invoke({ method: 'flushFile', args: [path] }, nothing, context),
    renameFile: (from, to, context) => invoke({ method: 'renameFile', args: [from, to] }, nothing, context),
    fileInfo: (path, context) => invoke({ method: 'fileInfo', args: [path] }, fileInfo, context),
    listDir: (path, context) => invoke({ method: 'listDir', args: [path] }, z.array(fileInfo), context),
    canonicalPath: (path, context) => invoke({ method: 'canonicalPath', args: [path] }, z.string(), context),
    exists: (path, context) => invoke({ method: 'exists', args: [path] }, z.boolean(), context),
    createDir: (path, options, context) => invoke({ method: 'createDir', args: [path, options] }, nothing, context),
    remove: (path, options, context) => invoke({ method: 'remove', args: [path, options] }, nothing, context),
    createTempDir: (prefix, context) => invoke({ method: 'createTempDir', args: [prefix] }, z.string(), context),
    createTempFile: (options, context) => invoke({ method: 'createTempFile', args: [options] }, z.string(), context),
  };
  return { identity: selected, environment, ownership: 'borrowed', release };
}
