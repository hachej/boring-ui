import { awaitWithContext, withAbortSignal, withoutAbortSignal } from '@earendil-works/chord/context';
import type { Context } from '@earendil-works/chord';
import { FileError, err } from '@earendil-works/pi-durable/env';
import type { FileSystem, Result, TextLineReader } from '@earendil-works/pi-durable/env';
import type { WorkspaceIdentity, WorkspaceLease } from './contracts.js';
import { identity, sameIdentity, positiveLimit, nativeVersion, schema, version, streamType, requestInput, wireResult } from './remote-files-protocol.js';
import type { RemoteFileSystemCall } from './remote-files-protocol.js';
import { guardStatus, hasJsonContentType, readJsonBody } from '@hachej/boring-files/request-guard';

export interface RemoteFileSystemAccess {
  readonly identity: WorkspaceIdentity;
  readonly filesystemId: string;
  readonly context: Context;
  readonly revoked: AbortSignal;
  readonly bindFileSystem: (cwd: string, context: Context) => Promise<WorkspaceLease<FileSystem>>;
  readonly authorize: (call: RemoteFileSystemCall, cwd: string) => boolean | Promise<boolean>;
}
export interface RemoteFileSystemHandlerOptions {
  readonly authenticate: (request: Request) => Promise<RemoteFileSystemAccess | null>;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxFrameBytes?: number;
  readonly onCleanupError?: (error: unknown) => void;
}
const refused = (status: number): Response => new Response(null, { status, headers: { 'cache-control': 'no-store' } });
function invoke(fs: FileSystem, call: RemoteFileSystemCall, context: Context): Promise<Result<unknown, FileError>> {
  switch (call.method) {
    case 'absolutePath': return fs.absolutePath(...call.args, context);
    case 'joinPath': return fs.joinPath(...call.args, context);
    case 'readTextFile': return fs.readTextFile(...call.args, context);
    case 'openTextLineReader': return fs.openTextLineReader(...call.args, context);
    case 'readTextLines': return fs.readTextLines(...call.args, context);
    case 'readBinaryFile': return fs.readBinaryFile(...call.args, context);
    case 'writeFile': return fs.writeFile(...call.args, context);
    case 'appendFile': return fs.appendFile(...call.args, context);
    case 'truncateFile': return fs.truncateFile(...call.args, context);
    case 'flushFile': return fs.flushFile(...call.args, context);
    case 'renameFile': return fs.renameFile(...call.args, context);
    case 'fileInfo': return fs.fileInfo(...call.args, context);
    case 'listDir': return fs.listDir(...call.args, context);
    case 'canonicalPath': return fs.canonicalPath(...call.args, context);
    case 'exists': return fs.exists(...call.args, context);
    case 'createDir': return fs.createDir(...call.args, context);
    case 'remove': return fs.remove(...call.args, context);
    case 'createTempDir': return fs.createTempDir(...call.args, context);
    case 'createTempFile': return fs.createTempFile(...call.args, context);
  }
}

export function createRemoteFileSystemHandler(options: RemoteFileSystemHandlerOptions): (request: Request) => Promise<Response> {
  const maxRequestBytes = positiveLimit(options.maxRequestBytes ?? 1_048_576), maxResponseBytes = positiveLimit(options.maxResponseBytes ?? 4_194_304);
  const maxFrameBytes = positiveLimit(options.maxFrameBytes ?? 1_048_576);
  return async request => {
    if (request.method !== 'POST') return refused(405);
    if (!hasJsonContentType(request.headers)) return refused(415);
    let access: RemoteFileSystemAccess | null;
    try { access = await options.authenticate(request); } catch { return refused(503); }
    if (!access) return refused(401);
    const selected = identity(access.identity), { filesystemId, bindFileSystem, authorize, revoked } = access;
    const stop = new AbortController(), context = withAbortSignal(AbortSignal.any([request.signal, revoked, stop.signal]), access.context);
    const signal = context.abortSignal, cleanupContext = withoutAbortSignal(access.context);
    let input: ReturnType<typeof requestInput>;
    try { input = requestInput(await readJsonBody(request, maxRequestBytes, signal)); } catch (error) { return refused(guardStatus(error)); }
    if (!sameIdentity(input.identity, selected) || input.filesystemId !== filesystemId) return refused(409);
    const binding = { schema, version, nativeVersion, requestId: input.requestId, identity: selected, filesystemId };
    const reply = (result: Result<unknown, FileError>): Response => {
      const body = new TextEncoder().encode(JSON.stringify({ ...binding, result: wireResult(result) }));
      if (body.length > maxResponseBytes) return refused(503);
      return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    };
    const permitted = async (): Promise<boolean> => !signal?.aborted
      && await awaitWithContext(Promise.resolve(authorize(structuredClone(input.call), input.cwd)), context) === true && !signal?.aborted;
    let lease: WorkspaceLease<FileSystem> | undefined, released = false, transferred = false;
    let closeReader: (() => Promise<void>) | undefined;
    const release = async (): Promise<void> => { if (!lease || released) return; released = true; await lease.release(cleanupContext); };
    const matches = (): boolean => !!lease && sameIdentity(lease.identity, selected) && lease.environment.id === filesystemId && lease.environment.cwd === input.cwd;
    try {
      if (!await permitted()) return reply(err(new FileError('permission_denied', 'Filesystem operation is not permitted')));
      const pending = Promise.resolve(bindFileSystem(input.cwd, context)).then(value => {
        lease = value;
        if (signal?.aborted) void release().catch(error => options.onCleanupError?.(error));
        return value;
      });
      lease = await awaitWithContext(pending, context);
      if (!matches() || signal?.aborted) return refused(409);
      if (!await permitted() || !matches()) return reply(err(new FileError('permission_denied', 'Filesystem binding is no longer permitted')));
      if (input.call.method !== 'openTextLineReader') {
        const result = await invoke(lease.environment, input.call, context);
        if (!await permitted() || !matches()) return refused(403);
        return reply(result);
      }
      const opened = await lease.environment.openTextLineReader(...input.call.args, context);
      if (!opened.ok) { if (!await permitted() || !matches()) return refused(403); return reply(opened); }
      let reader: TextLineReader | undefined = opened.value;
      let closing: Promise<void> | undefined;
      const close = (): Promise<void> => closing ??= Promise.resolve().then(async () => {
        const current = reader; reader = undefined;
        try { if (current) await current.close(cleanupContext); } finally { await release(); }
      });
      closeReader = close;
      if (!await permitted() || !matches()) { await close(); return refused(403); }
      let ended = false, sequence = 1;
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const frame = (value: object): Uint8Array => {
        const bytes = new TextEncoder().encode(JSON.stringify(value) + '\n');
        if (bytes.length > maxFrameBytes) throw new TypeError('Filesystem frame exceeds its byte limit');
        return bytes;
      };
      const interrupt = (): void => {
        if (ended) return;
        ended = true; signal?.removeEventListener('abort', interrupt);
        controller.error(new Error('Remote file stream interrupted'));
        void close().catch(error => options.onCleanupError?.(error));
      };
      const stream = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
          controller.enqueue(frame({ ...binding, type: 'opened', sequence: 0 }));
          signal?.addEventListener('abort', interrupt, { once: true });
          if (signal?.aborted) interrupt();
        },
        async pull() {
          try {
            if (ended) return;
            if (!await permitted() || !reader || !matches()) { interrupt(); return; }
            const result = await reader.readLine(context);
            if (ended) return;
            if (!await permitted() || !matches()) { interrupt(); return; }
            if (result.ok && result.value === undefined) {
              await close();
              if (ended || signal?.aborted) return;
              controller.enqueue(frame({ requestId: input.requestId, sequence: sequence++, type: 'end' }));
              ended = true; signal?.removeEventListener('abort', interrupt); controller.close();
            } else controller.enqueue(frame({ requestId: input.requestId, sequence: sequence++, type: 'line', result: wireResult(result) }));
          } catch { interrupt(); }
        },
        async cancel() { ended = true; signal?.removeEventListener('abort', interrupt); stop.abort(); await close(); },
      }, { highWaterMark: 1 });
      transferred = true;
      return new Response(stream, { headers: { 'content-type': streamType, 'cache-control': 'no-store' } });
    } catch { return refused(503); }
    finally { if (!transferred) { if (closeReader) await closeReader(); else await release(); } }
  };
}
