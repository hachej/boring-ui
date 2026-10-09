// Node `http` ↔ web Fetch for hosts that serve the Fetch handlers of these packages from `node:http`.
//
// The request body is read into memory first (bounded), never handed over as `Readable.toWeb(incoming)`: a handler that answers
// without reading the body, or stops reading at its size cap, cancels that web stream while Node keeps pushing data into it, and
// the resulting "Controller is already closed" error is thrown outside any request and kills the process.
//
// The response is streamed: headers are flushed at once (a watch stream must reach the browser before its first frame), each
// chunk waits for `drain` when the socket is full, and the web body is cancelled when the client goes away, so a closed
// connection stops the handler's stream (for example a chat watch) instead of buffering it forever.
import type { IncomingMessage, ServerResponse } from 'node:http';

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

/** Reads at most `maxBytes` of the body. Returns `undefined` when the body is larger (answer 413) or the client went away. */
export async function readBody(incoming: IncomingMessage, maxBytes = DEFAULT_MAX_BYTES): Promise<Uint8Array | undefined> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of incoming as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > maxBytes) { incoming.resume(); return undefined; }
      chunks.push(chunk);
    }
  } catch { return undefined; }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}

export interface WebRequestOptions {
  /** Aborts the web request, for example when the Node response closes. */
  readonly signal?: AbortSignal;
  /** Largest accepted body (default 16 MiB). */
  readonly maxBytes?: number;
}

/** The web `Request` for an incoming Node request, or `undefined` when its body is over `maxBytes` or unreadable. */
export async function webRequest(incoming: IncomingMessage, url: string | URL, { signal, maxBytes = DEFAULT_MAX_BYTES }: WebRequestOptions = {}): Promise<Request | undefined> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  const init: RequestInit = { method: incoming.method ?? 'GET', headers, ...(signal ? { signal } : {}) };
  if (init.method === 'GET' || init.method === 'HEAD') return new Request(url, init);
  const body = await readBody(incoming, maxBytes);
  return body === undefined ? undefined : new Request(url, { ...init, body: body as Uint8Array<ArrayBuffer> });
}

export interface SendWebResponseOptions {
  /** Stops sending (the web body is cancelled), in addition to the Node response closing. */
  readonly signal?: AbortSignal;
}

/**
 * Write a web `Response` to a Node response: status and headers first (flushed immediately; multiple `set-cookie` values kept),
 * then the body chunk by chunk, waiting for `drain` whenever `write()` returns false. When the client disconnects or `signal`
 * aborts, the web body is cancelled and this resolves. A body that fails mid-stream destroys the connection, so the client
 * sees a truncated response rather than a clean end, and the error is rethrown.
 */
export async function sendWebResponse(response: Response, outgoing: ServerResponse, { signal }: SendWebResponseOptions = {}): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => { if (name !== 'set-cookie') headers[name] = value; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  outgoing.writeHead(response.status, headers);
  outgoing.flushHeaders();
  if (!response.body) { outgoing.end(); return; }
  const reader = response.body.getReader();
  let gone = false;
  const stop = () => { gone = true; void reader.cancel().catch(() => {}); };
  const closed = () => { if (!outgoing.writableFinished) stop(); };
  if (signal?.aborted) stop();
  signal?.addEventListener('abort', stop, { once: true });
  outgoing.on('close', closed);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || gone || outgoing.destroyed) break;
      if (!outgoing.write(value)) {
        await new Promise<void>(resolve => {
          const go = () => { outgoing.off('drain', go); outgoing.off('close', go); signal?.removeEventListener('abort', go); resolve(); };
          outgoing.on('drain', go); outgoing.on('close', go); signal?.addEventListener('abort', go, { once: true });
        });
      }
    }
  } catch (error) {
    if (gone || outgoing.destroyed) return;
    outgoing.destroy(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    signal?.removeEventListener('abort', stop);
    outgoing.off('close', closed);
  }
  if (gone) { if (!outgoing.destroyed) outgoing.destroy(); return; }
  if (!outgoing.destroyed) outgoing.end();
}
