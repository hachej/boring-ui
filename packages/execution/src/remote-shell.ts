import { awaitWithContext, withAbortSignal } from '@earendil-works/chord/context';
import type { Context } from '@earendil-works/chord';
import { ExecutionError, err } from '@earendil-works/pi-durable/env';
import type { Shell } from '@earendil-works/pi-durable/env';
import type { WorkspaceIdentity, WorkspaceLease } from './contracts.js';
import { contentType, frame, identity, nativeVersion, positiveLimit, sameIdentity, schema, version, wireOptions } from './remote-shell-protocol.js';
import type { ShellResult } from './remote-shell-protocol.js';
import { randomUUID } from '@hachej/boring-files/platform';
import { shellCommand } from './fs-readers.js';
export { createRemoteShellHandler } from './remote-shell-handler.js';
export type { RemoteShellAccess, RemoteShellHandlerOptions } from './remote-shell-handler.js';

export interface RemoteShellOptions {
  readonly identity: WorkspaceIdentity;
  readonly endpoint: string | URL;
  /** Trusted authenticated transport. It must honor redirect:error and must not retry command requests. */
  readonly fetch: (request: Request) => Promise<Response>;
  readonly maxRequestBytes?: number;
  readonly maxFrameBytes?: number;
}

/** Borrow the remote workspace. Cleanup cancels this lease's transports, not the provider or another lease. */
export function createRemoteShellLease(options: RemoteShellOptions): WorkspaceLease<Shell> {
  const selected = identity(options.identity), endpoint = new URL(options.endpoint);
  if (!['https:', 'http:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.hash) throw new TypeError('Expected an HTTP endpoint without URL credentials or fragment');
  const fetch = options.fetch;
  const maxRequestBytes = positiveLimit(options.maxRequestBytes ?? 65_536), maxFrameBytes = positiveLimit(options.maxFrameBytes ?? 1_048_576);
  const active = new Set<AbortController>();
  let closed = false;
  const release = async () => { closed = true; for (const request of active) request.abort(); active.clear(); };
  const environment: Shell = {
    cleanup: release,
    exec: async (command, options, context) => {
      if (closed) return err(new ExecutionError('shell_unavailable', 'Remote shell lease is closed'));
      if (context.abortSignal?.aborted) return err(new ExecutionError('aborted', 'Command aborted before dispatch'));
      const onOutput = options?.onOutput;
      if (onOutput !== undefined && typeof onOutput !== 'function') return err(new ExecutionError('callback_error', 'Expected a synchronous output callback'));
      const requestId = randomUUID(), abort = new AbortController();
      const signal = context.abortSignal ? AbortSignal.any([abort.signal, context.abortSignal]) : abort.signal;
      const local = withAbortSignal(signal, context);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let dispatched = false;
      active.add(abort);
      try {
        const { onOutput: _callback, ...arguments_ } = options ?? {};
        const body = JSON.stringify({ schema, version, nativeVersion, requestId, identity: selected, command: shellCommand(command), options: wireOptions(arguments_), output: onOutput !== undefined });
        if ((typeof command !== 'string' && !Array.isArray(command)) || new TextEncoder().encode(body).byteLength > maxRequestBytes) return err(new ExecutionError('shell_unavailable', 'Remote shell request is invalid or exceeds its byte limit'));
        const request = new Request(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body, redirect: 'error', signal });
        dispatched = true;
        const pending = fetch(request);
        void pending.then(response => { if (signal?.aborted) void response.body?.cancel().catch(() => {}); }, () => {});
        const response = await awaitWithContext(pending, local);
        if (response.redirected || response.status !== 200 || response.headers.get('content-type')?.split(';')[0]?.trim() !== contentType || !response.body) {
          void response.body?.cancel().catch(() => {});
          return err(new ExecutionError('unknown', `Remote shell response refused or unavailable (${response.status}); command outcome is unconfirmed`));
        }
        reader = response.body.getReader();
        let sequence = 0, header = false, terminal: ShellResult | undefined;
        for await (const value of frames(reader, local, maxFrameBytes)) {
          if (signal.aborted) throw new Error('Remote shell observation aborted');
          const current = frame(value, requestId, sequence++);
          if (terminal !== undefined) throw new Error('Data after terminal result');
          if (!header) {
            if (current.type !== 'header' || !sameIdentity(current.identity, selected)) throw new Error('Remote workspace identity mismatch');
            header = true;
          } else if (current.type === 'output') {
            try { onOutput?.(current.text, context, { stream: current.stream }); }
            catch { return err(new ExecutionError('callback_error', 'Local output callback failed; remote termination is unconfirmed')); }
          } else if (current.type === 'result') terminal = current.result;
          else throw new Error('Duplicate remote shell header');
        }
        if (signal.aborted || !header || terminal === undefined) throw new Error('Missing terminal acknowledgement');
        return terminal;
      } catch {
        return err(new ExecutionError(signal.aborted ? 'aborted' : dispatched ? 'unknown' : 'shell_unavailable', dispatched
          ? 'Remote shell observation ended; prior effects may remain and remote termination is unconfirmed'
          : 'Invalid remote shell request; command was not dispatched'));
      } finally {
        abort.abort(); active.delete(abort);
        if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
    },
  };
  return { identity: selected, environment, ownership: 'borrowed', release };
}

async function* frames(reader: ReadableStreamDefaultReader<Uint8Array>, context: Context, limit: number): AsyncGenerator<unknown> {
  let pieces: Uint8Array[] = [], length = 0;
  while (true) {
    const item = await awaitWithContext(reader.read(), context);
    if (item.done) {
      if (length !== 0) throw new Error('Truncated remote shell frame');
      return;
    }
    let start = 0;
    while (start < item.value.byteLength) {
      const newline = item.value.indexOf(10, start), end = newline === -1 ? item.value.byteLength : newline;
      const piece = item.value.subarray(start, end);
      length += piece.byteLength;
      if (length > limit) throw new Error('Remote shell frame exceeds its byte limit');
      pieces.push(piece);
      if (newline === -1) break;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const part of pieces) { bytes.set(part, offset); offset += part.byteLength; }
      pieces = []; length = 0;
      yield JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      start = newline + 1;
    }
  }
}
