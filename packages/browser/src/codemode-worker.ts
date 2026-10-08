// Entry of the Web Worker that runs one pi-codemode script; bundle it as its own entry point (see `browserBundleOptions`
// in `@hachej/boring-browser/build`). The upstream worker module is unchanged: it reads `workerData` and `parentPort`
// from the bundle-time `worker_threads` shim, so it is evaluated only after the first message delivers the worker data.
const scope = globalThis as unknown as { __workerData?: unknown; addEventListener(type: 'message', listener: (event: MessageEvent) => void): void; removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void };
scope.addEventListener('message', function first(event) {
  const data: unknown = event.data;
  if (data === null || typeof data !== 'object' || !('__workerData' in data)) return;
  scope.removeEventListener('message', first);
  scope.__workerData = (data as { __workerData: unknown }).__workerData;
  void import('@earendil-works/pi-codemode/worker');
});
