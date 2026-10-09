// Browser stand-in for `node:worker_threads` on the side that starts workers (pi-codemode's CodemodeSandbox).
// It maps Node's Worker onto a module Web Worker: `workerData` travels as the first message, events use Node names.
type Listener = (value: never) => void;
export class Worker {
  #worker: InstanceType<typeof globalThis.Worker>;
  #listeners: Record<string, Listener[]> = { message: [], error: [], exit: [] };
  constructor(url: string | URL, options: { readonly workerData?: unknown } = {}) {
    this.#worker = new globalThis.Worker(url, { type: 'module' });
    this.#worker.onmessage = event => { for (const listener of this.#listeners['message']!) (listener as (value: unknown) => void)(event.data); };
    this.#worker.onerror = event => { event.preventDefault?.(); for (const listener of this.#listeners['error']!) (listener as (value: Error) => void)(new Error(event.message || 'Worker failed')); };
    this.#worker.postMessage({ __workerData: options.workerData });
  }
  on(event: string, listener: Listener): this { this.#listeners[event]?.push(listener); return this; }
  postMessage(message: unknown): void { this.#worker.postMessage(message); }
  // A Web Worker reports no exit code; the host only listens for `exit` to notice crashes, which arrive as `error`.
  terminate(): Promise<number> { this.#worker.terminate(); return Promise.resolve(0); }
}
export const isMainThread = true;
export const parentPort = null;
export const workerData = undefined;
