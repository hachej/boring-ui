// Browser stand-in for `node:worker_threads` inside a pi-codemode worker. The codemode worker entry sets
// `globalThis.__workerData` from the first message before the upstream worker module is evaluated.
const listeners = new Map<unknown, (event: MessageEvent) => void>();
export const parentPort = {
  postMessage: (message: unknown): void => globalThis.postMessage(message),
  on(event: string, listener: (message: unknown) => void) {
    if (event !== 'message') return this;
    const wrapped = (message: MessageEvent): void => listener(message.data);
    listeners.set(listener, wrapped);
    globalThis.addEventListener('message', wrapped);
    return this;
  },
};
export const workerData = (globalThis as { __workerData?: unknown }).__workerData;
export const isMainThread = false;
