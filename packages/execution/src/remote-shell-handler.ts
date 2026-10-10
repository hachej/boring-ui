import { awaitWithContext, withAbortSignal } from '@earendil-works/chord/context';
import type { Context } from '@earendil-works/chord';
import { ExecutionError, err } from '@earendil-works/pi-durable/env';
import type { Shell, ShellExecOptions, ShellOutputInfo } from '@earendil-works/pi-durable/env';
import { guardStatus, hasJsonContentType, readJsonBody } from '@hachej/boring-files/request-guard';
import type { WorkspaceIdentity } from './contracts.js';
import { contentType, identity, nativeVersion, positiveLimit, requestInput, sameIdentity, schema, version, wireResult } from './remote-shell-protocol.js';

export interface RemoteShellAccess {
  readonly identity: WorkspaceIdentity;
  readonly shell: Shell;
  readonly context: Context;
  /** Abort on authorization/identity changes, including while the command is silent. */
  readonly revoked: AbortSignal;
  readonly authorize: (command: string, options: Readonly<Omit<ShellExecOptions, 'onOutput'>>) => boolean | Promise<boolean>;
  /** Host qualification of the selected native Shell. Spill paths remain in that workspace. */
  readonly supports: { readonly timeout: boolean; readonly spill: boolean };
}
export interface RemoteShellHandlerOptions {
  /** Authenticate, enforce origin/CSRF policy, and select an existing borrowed workspace. */
  readonly authenticate: (request: Request) => Promise<RemoteShellAccess | null>;
  readonly maxRequestBytes?: number;
  readonly maxFrameBytes?: number;
  readonly maxQueuedBytes?: number;
}

function failure(status: number): Response {
  return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}
export function createRemoteShellHandler(options: RemoteShellHandlerOptions): (request: Request) => Promise<Response> {
  const maxRequestBytes = positiveLimit(options.maxRequestBytes ?? 65_536), maxFrameBytes = positiveLimit(options.maxFrameBytes ?? 1_048_576);
  const maxQueuedBytes = positiveLimit(options.maxQueuedBytes ?? 4_194_304);
  if (maxQueuedBytes < maxFrameBytes) throw new TypeError('Remote shell queue must hold one maximum-sized frame');
  return async request => {
    if (request.method !== 'POST') return failure(405);
    if (!hasJsonContentType(request.headers)) return failure(415);
    let access: RemoteShellAccess | null;
    try { access = await options.authenticate(request); } catch { return failure(503); }
    if (!access) return failure(401);
    const { shell, authorize, revoked, supports } = access;
    const selected = identity(access.identity), stop = new AbortController();
    const context = withAbortSignal(AbortSignal.any([request.signal, revoked, stop.signal]), access.context);
    const signal = context.abortSignal;
    let input: ReturnType<typeof requestInput>;
    try { input = requestInput(await readJsonBody(request, maxRequestBytes, signal)); }
    catch (error) { return failure(guardStatus(error)); }
    if (!sameIdentity(input.identity, selected)) return failure(409);
    if (input.options.timeout !== undefined && supports.timeout !== true || input.options.spill !== undefined && supports.spill !== true) return failure(422);
    try {
      if (signal?.aborted || await awaitWithContext(Promise.resolve(authorize(input.command, structuredClone(input.options))), context) !== true || signal?.aborted) return failure(403);
    } catch { return failure(503); }
    let ended = false, sequence = 0;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    function fail(): void {
      if (ended) return;
      ended = true;
      signal?.removeEventListener('abort', fail);
      controller.error(new Error('Remote shell stream interrupted; command outcome is unconfirmed'));
      stop.abort();
    }
    function send(value: object): void {
      if (ended || signal?.aborted) throw new Error('Remote shell transport closed');
      const bytes = new TextEncoder().encode(JSON.stringify({ ...value, requestId: input.requestId, sequence: sequence++ }) + '\n');
      if (bytes.byteLength > maxFrameBytes || (controller.desiredSize ?? 0) < bytes.byteLength) { fail(); throw new Error('Remote shell output limit exceeded'); }
      controller.enqueue(bytes);
    }
    async function execute(): Promise<void> {
      try {
        if (signal?.aborted || ended) return;
        const result = await shell.exec(input.command, { ...input.options, ...(input.output ? { onOutput: (text: string, _context: unknown, info: ShellOutputInfo) => send({ type: 'output', text, stream: info.stream, ...(info.skipped === undefined ? {} : { skipped: info.skipped }) }) } : {}) }, context);
        if (await awaitWithContext(Promise.resolve(authorize(input.command, structuredClone(input.options))), context) !== true || signal?.aborted || ended) { fail(); return; }
        send({ type: 'result', result: wireResult(result) });
        ended = true; signal?.removeEventListener('abort', fail); controller.close();
      } catch {
        if (!ended && !signal?.aborted) {
          try { send({ type: 'result', result: wireResult(err(new ExecutionError('unknown', 'Remote provider failed; prior effects may remain'))) }); }
          catch { fail(); return; }
          ended = true; signal?.removeEventListener('abort', fail); controller.close();
        }
      }
    }
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        signal?.addEventListener('abort', fail, { once: true });
        if (signal?.aborted) { fail(); return; }
        try { send({ type: 'header', schema, version, nativeVersion, identity: selected }); }
        catch { fail(); return; }
        void execute();
      },
      cancel() { fail(); },
    }, { highWaterMark: maxQueuedBytes, size: bytes => bytes.byteLength });
    return new Response(body, { headers: { 'content-type': contentType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  };
}
