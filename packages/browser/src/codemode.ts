import type { CodemodeSandboxOptions } from '@earendil-works/pi-codemode';

export interface BrowserCodemodeOptions {
  /** Where the page serves `quickjs.wasm` (`quickjsWasm()` from `@hachej/boring-browser/build` reads the file at build time). */
  readonly wasmUrl: string | URL;
  /** Where the page serves the bundled `@hachej/boring-browser/codemode-worker` entry. */
  readonly workerUrl: string | URL;
}

/**
 * `{ wasm, workerUrl }` for `new CodemodeSandbox({ ...browserCodemode(...), tools })` inside a browser. Upstream
 * pi-codemode runs unchanged: QuickJS in a nested module Web Worker, started through the bundle-time `worker_threads`
 * shim from `@hachej/boring-browser/build`. The WebAssembly module compiles once; reuse the returned object for every sandbox.
 * The page must be cross-origin isolated (`SharedArrayBuffer` carries pi-codemode's interrupt buffer).
 */
export function browserCodemode(options: BrowserCodemodeOptions): Required<Pick<CodemodeSandboxOptions, 'wasm' | 'workerUrl'>> {
  const base = globalThis.location?.href;
  const wasmUrl = new URL(options.wasmUrl, base);
  const wasm = (async (): Promise<WebAssembly.Module> => {
    try { return await WebAssembly.compileStreaming(fetch(wasmUrl)); }
    catch { return WebAssembly.compile(await (await fetch(wasmUrl)).arrayBuffer()); } // a host that does not send application/wasm
  })();
  wasm.catch(() => {}); // surfaced by the sandbox that awaits it
  return { wasm, workerUrl: new URL(options.workerUrl, base) };
}
