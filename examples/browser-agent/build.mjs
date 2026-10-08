// Bundles for the in-browser agent: the page, the agent worker (Harness, SQLite, models, workspace) and the
// pi-codemode worker. Node built-ins resolve to the browser shims of @hachej/boring-browser/build; upstream code is unchanged.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { browserBundleOptions, codemodeWorkerEntry, quickjsWasm, sqliteWasmFiles } from '@hachej/boring-browser/build';

const here = name => fileURLToPath(new URL(name, import.meta.url));

/** Returns { '/app.js': text, '/agent-worker.js': text, '/codemode-worker.js': text, '/vendor/*.wasm': bytes }. */
export async function buildBrowserAgent({ page = here('./page/app.jsx'), worker = here('./worker/agent-worker.js'), minify = false } = {}) {
  const options = side => browserBundleOptions(side, { minify });
  const outdir = here('./out');
  const [app, agent, codemode] = await Promise.all([
    page ? build({ ...options('page'), entryPoints: [page], jsx: 'automatic', outdir, metafile: true }) : null,
    build({ ...options('agent'), entryPoints: [worker], outdir }),
    build({ ...options('codemode'), entryPoints: [codemodeWorkerEntry()], outdir }),
  ]);
  const js = result => result.outputFiles.find(file => file.path.endsWith('.js')).text;
  const files = {
    ...(app ? { '/app.js': js(app), '/app-bundle.css': app.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n') } : {}),
    '/agent-worker.js': js(agent),
    '/codemode-worker.js': js(codemode),
    ...sqliteWasmFiles(),
    '/vendor/quickjs.wasm': quickjsWasm(),
  };
  // The page bundle's source files, so a check can prove the UI bundle carries no kernel (BORING-PI-5). Not served.
  if (app) Object.defineProperty(files, 'pageInputs', { value: Object.keys(app.metafile.inputs), enumerable: false });
  return files;
}
