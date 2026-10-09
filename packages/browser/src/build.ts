// Node-side build helpers for running Pi, pi-codemode, just-bash and isomorphic-git in a browser bundle. Node built-ins that
// bundled code imports resolve to the small shims in `./shims`; no upstream package is forked or patched.
// Use with esbuild:
//   build({ ...browserBundleOptions('agent'), entryPoints: ['worker.js'] })
//   build({ ...browserBundleOptions('codemode'), entryPoints: [codemodeWorkerEntry()] })
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** `page` (the UI), `agent` (the Harness worker) or `codemode` (the nested pi-codemode worker). */
export type BrowserBundleSide = 'page' | 'agent' | 'codemode';

/** The part of esbuild's plugin API the shims use, so this package needs no esbuild dependency. */
export interface ShimPluginBuild {
  onResolve(options: { readonly filter: RegExp }, callback: (args: { readonly path: string }) => { readonly path: string } | undefined): void;
}
export interface ShimPlugin { readonly name: string; setup(build: ShimPluginBuild): void }

const shim = (name: string): string => fileURLToPath(new URL(`./shims/${name}.js`, import.meta.url));

/** esbuild plugin that maps `path`, `crypto`, `worker_threads` and the Node-only modules these libraries import to browser shims. */
export function browserShims(side: BrowserBundleSide): ShimPlugin {
  const unavailable = shim('unavailable');
  const map: Record<string, string> = {
    path: shim('path'), 'node:path': shim('path'), 'node:crypto': shim('crypto'), crypto: shim('crypto'),
    'node:worker_threads': shim(side === 'codemode' ? 'worker-threads-worker' : 'worker-threads-host'),
    worker_threads: shim(side === 'codemode' ? 'worker-threads-worker' : 'worker-threads-host'),
    'node:fs/promises': unavailable, 'node:module': unavailable, 'node:http': unavailable, 'node:zlib': unavailable,
  };
  return { name: 'boring-browser-shims', setup(build) {
    build.onResolve({ filter: /^(node:)?(path|crypto|worker_threads|fs\/promises|module|http|zlib)$/ }, args => map[args.path] ? { path: map[args.path]! } : undefined);
  } };
}

export interface BrowserBundleOptions {
  /** Minify the bundle (identifiers, whitespace and syntax). Default `false`, so a bundle stays readable while you debug it. */
  readonly minify?: boolean;
}

/** esbuild options shared by every browser bundle; spread them and add `entryPoints`, `outdir` and (for the page) `jsx`. */
export function browserBundleOptions(side: BrowserBundleSide, { minify = false }: BrowserBundleOptions = {}) {
  return {
    ...(minify ? { minify: true } : {}),
    bundle: true, write: false, format: 'esm' as const, platform: 'browser' as const, target: 'es2023', logLevel: 'silent' as const,
    conditions: ['browser'], define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [browserShims(side)],
    // isomorphic-git expects Node's global `Buffer`; this needs the `buffer` package installed next to your build.
    ...(side === 'agent' ? { inject: [shim('buffer-global')] } : {}),
  };
}

/** Absolute path of the pi-codemode worker entry to bundle as `side: 'codemode'`. */
export const codemodeWorkerEntry = (): string => fileURLToPath(new URL('./codemode-worker.js', import.meta.url));

/** The QuickJS wasm file of the installed pi-codemode, to serve at the `wasmUrl` you give `browserCodemode`. */
export function quickjsWasm(): Uint8Array {
  const fromCodemode = createRequire(fileURLToPath(import.meta.resolve('@earendil-works/pi-codemode')));
  return readFileSync(fromCodemode.resolve('quickjs-wasi/quickjs.wasm'));
}

/**
 * Files SQLite Wasm needs next to your page, keyed by the URL to serve each at: `/vendor/sqlite3.wasm` (pass that URL as
 * `wasmUrl` to `openBrowserSqlite`) and `/sqlite3-opfs-async-proxy.js` (the module probes its default `opfs` VFS at start-up,
 * although `@hachej/boring-browser/sqlite` uses `opfs-sahpool`).
 */
export function sqliteWasmFiles(): Record<string, Uint8Array> {
  const wasm = import.meta.resolve('@sqlite.org/sqlite-wasm/sqlite3.wasm');
  return { '/vendor/sqlite3.wasm': readFileSync(fileURLToPath(wasm)), '/sqlite3-opfs-async-proxy.js': readFileSync(fileURLToPath(new URL('./sqlite3-opfs-async-proxy.js', wasm))) };
}
