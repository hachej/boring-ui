// Request/Response over postMessage, so a page can talk to code in a Web Worker with the same `fetch` it would use for a
// server. The worker side serves Requests; the page side returns a `fetch`. Bodies cross as transferred ReadableStreams
// (a response stream stays live until it ends), and aborting a fetch aborts the Request the worker is serving.

/** The message surface this module needs: a Worker or MessagePort (page side) or the worker's global scope (worker side). */
export interface MessageEndpoint {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
  postMessage(message: unknown): void;
}
/** A Worker-like endpoint (a Worker or one end of a MessageChannel): also reports start-up errors and can be terminated. */
export interface WorkerEndpoint {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
  postMessage(message: unknown): void;
  terminate?(): void;
}

export type RequestRoute = (request: Request) => Response | Promise<Response>;

interface FetchMessage { readonly type: 'fetch'; readonly id: number; readonly url: string; readonly method: string; readonly headers: [string, string][]; readonly body?: ArrayBuffer }
interface AbortMessage { readonly type: 'abort'; readonly id: number }
interface ResponseMessage { readonly type: 'response'; readonly id: number; readonly status: number; readonly headers: [string, string][]; readonly body: ReadableStream<Uint8Array> | null; readonly error?: string }

const headerPairs = (headers: Headers): [string, string][] => { const pairs: [string, string][] = []; headers.forEach((value, name) => pairs.push([name, value])); return pairs; };
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

/**
 * Worker side. `route` (or a promise of it, while the worker boots) answers each Request. The page's `connectWorker(...).ready`
 * settles when the route is available, or rejects when booting failed (with the boot error's message and, when it has a string `code`, that `code`). Returns a function that stops serving.
 */
export function serveRequests(route: RequestRoute | Promise<RequestRoute>, scope: MessageEndpoint = globalThis as unknown as MessageEndpoint): () => void {
  const routing = Promise.resolve(route);
  const inFlight = new Map<number, AbortController>();
  let stopped = false;
  const onMessage = async (event: MessageEvent): Promise<void> => {
    const message = event.data;
    if (stopped || !isObject(message)) return;
    if (message['type'] === 'abort') { inFlight.get((message as unknown as AbortMessage).id)?.abort(); return; }
    if (message['type'] !== 'fetch') return;
    const { id, url, method, headers, body } = message as unknown as FetchMessage;
    const aborter = new AbortController();
    inFlight.set(id, aborter);
    try {
      const handle = await routing;
      const request = new Request(url, { method, headers, signal: aborter.signal, ...(body ? { body } : {}) });
      const response = await handle(request);
      // A streaming body stays abortable until it ends; the page cancelling its reader cancels this body too.
      const stream = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ flush: () => { inFlight.delete(id); } })) ?? null;
      if (!stream) inFlight.delete(id);
      const reply: ResponseMessage = { type: 'response', id, status: response.status, headers: headerPairs(response.headers), body: stream };
      scope.postMessage(reply, stream ? [stream as unknown as Transferable] : []);
    } catch (error) {
      inFlight.delete(id);
      const reply: ResponseMessage = { type: 'response', id, status: 500, headers: [['content-type', 'application/json']], body: null, error: String(error instanceof Error ? error.stack ?? error.message : error) };
      scope.postMessage(reply);
    }
  };
  scope.addEventListener('message', event => { void onMessage(event); });
  routing.then(() => scope.postMessage({ type: 'ready' }), (error: unknown) => scope.postMessage({ type: 'failed', error: String(error instanceof Error ? error.stack ?? error.message : error),
    ...(error instanceof Error ? { message: error.message } : {}), ...(typeof (error as { code?: unknown } | null)?.code === 'string' ? { code: (error as { code: string }).code } : {}) }));
  return () => { stopped = true; for (const aborter of inFlight.values()) aborter.abort(); inFlight.clear(); };
}

export interface WorkerConnection {
  /** Same shape as `fetch`; requests are answered by the worker. */
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Resolves when the worker's route is ready; rejects when it failed to boot. */
  readonly ready: Promise<void>;
  readonly terminate: () => void;
}

/** Page side. `worker` is a module-worker URL (a Worker is created for it) or an existing Worker-like endpoint. */
export function connectWorker(worker: string | URL | WorkerEndpoint | Worker): WorkerConnection {
  const endpoint = (typeof worker === 'string' || worker instanceof URL ? new Worker(worker, { type: 'module' }) : worker) as WorkerEndpoint;
  let next = 0;
  const pending = new Map<number, { resolve: (response: Response) => void; reject: (error: unknown) => void }>();
  const ready = new Promise<void>((resolve, reject) => {
    const boot = (event: MessageEvent): void => {
      const message = event.data;
      if (!isObject(message)) return;
      if (message['type'] === 'ready') { endpoint.removeEventListener('message', boot); resolve(); }
      if (message['type'] === 'failed') { endpoint.removeEventListener('message', boot); reject(Object.assign(new Error(String(message['message'] ?? message['error'])), typeof message['code'] === 'string' ? { code: message['code'] } : {})); }
    };
    endpoint.addEventListener('message', boot);
    endpoint.addEventListener('error', event => reject(new Error(event.message || 'The worker failed to start')));
  });
  ready.catch(() => {});
  endpoint.addEventListener('message', event => {
    const message = event.data;
    if (!isObject(message) || message['type'] !== 'response') return;
    const { id, status, headers, body, error } = message as unknown as ResponseMessage;
    const waiter = pending.get(id);
    pending.delete(id);
    if (error) console.error('worker:', error);
    // A null-body status must not carry a body.
    waiter?.resolve(new Response(status === 204 || status === 205 || status === 304 ? null : body, { status, headers }));
  });

  async function workerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    request.signal.throwIfAborted();
    const id = ++next;
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
    request.signal.throwIfAborted();
    const response = new Promise<Response>((resolve, reject) => pending.set(id, { resolve, reject }));
    request.signal.addEventListener('abort', () => {
      endpoint.postMessage({ type: 'abort', id });
      pending.get(id)?.reject(new DOMException('Aborted', 'AbortError'));
      pending.delete(id);
    }, { once: true });
    const message: FetchMessage = { type: 'fetch', id, url: request.url, method: request.method, headers: headerPairs(request.headers), ...(body ? { body } : {}) };
    endpoint.postMessage(message, body ? [body] : []);
    return response;
  }
  return { fetch: workerFetch, ready, terminate: () => endpoint.terminate?.() };
}
