// Offline libraries in the interactive HTML preview (`<!-- lib: d3 -->`), driven through the real InteractiveFrame the HTML pane renders:
// a declared library is usable inside the page with no network, a page that declares none never loads the library's chunk, an unknown name
// shows a plain error and the page still renders, and in a consumer's bundle the library is a chunk only a dynamic import reaches.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = resolve(root, '.cache/html-offline-libs-test');

test('declaredLibraries reads one grammar: comma-separated names in `<!-- lib: ... -->` comments', async () => {
  const { declaredLibraries } = await import('@hachej/boring-ui-kit/offline-libs');
  assert.deepEqual(declaredLibraries('<!-- lib: d3 --><p>x</p>'), ['d3']);
  assert.deepEqual(declaredLibraries('<!--lib:d3,Chart--><!-- lib : d3 -->\n<!-- lib: topo -->'), ['d3', 'chart', 'topo']);
  assert.deepEqual(declaredLibraries('<!-- a library: d3 --><!-- library d3 --><p>d3</p>'), []);
  assert.deepEqual(declaredLibraries('<!-- lib: -->'), []);
});

test('the base bundle does not carry a library: its source sits in a chunk only a dynamic import reaches', async () => {
  const result = await build({ entryPoints: [resolve(root, 'packages/ui/dist/offline-libs.js')], bundle: true, splitting: true, write: false, outdir: out,
    format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' });
  const outputs = Object.entries(result.metafile.outputs);
  const entry = outputs.find(([, output]) => output.entryPoint?.endsWith('dist/offline-libs.js'))[1];
  assert.deepEqual(entry.imports.filter(edge => edge.kind === 'import-statement'), [], 'no static import of a library');
  assert.equal(entry.imports.filter(edge => edge.kind === 'dynamic-import').length, 1, 'one dynamic import per library');
  assert.ok(entry.bytes < 4096, `the entry chunk is ${entry.bytes} bytes`);
  const chunk = outputs.find(([, output]) => output.entryPoint?.endsWith('offline-libs/d3.js'))[1];
  assert.ok(chunk.bytes > 200_000, 'the library itself is the lazy chunk');
});

test('InteractiveFrame supplies a declared library offline, only when declared', { timeout: 60000 }, async t => {
  const bundled = await build({ entryPoints: [resolve(root, 'registry/viewer-frame/interactive-html.tsx')], bundle: true, write: true, outfile: resolve(out, 'interactive-html.mjs'),
    format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  assert.equal(bundled.errors.length, 0);
  const window = new Window({ url: 'https://fictional.invalid/', settings: { enableJavaScriptEvaluation: false, disableIframePageLoading: true } });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const { createElement } = await import('react');
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { InteractiveFrame } = await import(resolve(out, 'interactive-html.mjs'));
  const { offlineLibraries } = await import('@hachej/boring-ui-kit/offline-libs');
  let loads = 0;
  const original = offlineLibraries.d3.load;
  offlineLibraries.d3.load = () => { loads++; return original(); };
  cleanups.push(() => { offlineLibraries.d3.load = original; });

  async function show(text) {
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(InteractiveFrame, { text, sources: [] })));
    // The library loads lazily (a 250 KB chunk read from disk): wait for the frame or an alert, not a fixed 20 ms or 3 s that a loaded runner misses (CI run 44040205326). A page that really never renders still fails, at 20 s.
    for (let waited = 0; waited < 20000 && !container.querySelector('iframe, [role=alert]'); waited += 20) await act(async () => { await new Promise(done => setTimeout(done, 20)); });
    await act(async () => { await new Promise(done => setTimeout(done, 20)); });
    cleanups.push(async () => { await act(async () => root.unmount()); container.remove(); });
    const frame = container.querySelector('iframe');
    return { frame, srcdoc: frame?.getAttribute('srcdoc') ?? '', alerts: [...container.querySelectorAll('[role=alert]')].map(node => node.textContent) };
  }
  /** What the sandboxed page would run, in order, in a context with no globals but its own and no network. */
  function run(srcdoc) {
    const context = vm.createContext({ result: undefined });
    for (const [, script] of srcdoc.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(script.replaceAll('<\\/script', '</script'), context);
    return context;
  }

  const declared = await show('<!-- lib: d3 --><svg></svg><script>result = d3.scaleLinear().domain([0, 10]).range([0, 100])(5) + ":" + d3.version;</script>');
  assert.equal(loads, 1);
  assert.ok(declared.frame, 'the page renders');
  assert.deepEqual(declared.alerts, []);
  assert.equal(declared.frame.getAttribute('sandbox'), 'allow-scripts');
  assert.match(declared.srcdoc, /connect-src 'none'/);
  assert.doesNotMatch(declared.srcdoc, /<script[^>]*\ssrc=|https?:\/\/[^"' ]*\.js/, 'no external script');
  assert.ok(declared.srcdoc.indexOf('d3js.org v7.9.1') < declared.srcdoc.indexOf('result = d3'), 'the library comes before the page script');
  assert.equal(run(declared.srcdoc).result, '50:7.9.1', 'the page used d3 offline');

  loads = 0;
  const plain = await show('<p>No library</p><script>result = typeof d3;</script>');
  assert.equal(loads, 0, 'a page without a declaration never loads the chunk');
  assert.ok(plain.frame, 'rendered without waiting');
  assert.doesNotMatch(plain.srcdoc, /d3js\.org/);
  assert.equal(run(plain.srcdoc).result, 'undefined');

  const unknown = await show('<!-- lib: d3, nope --><p id="still-here">Still here</p>');
  assert.equal(unknown.alerts.length, 1);
  assert.match(unknown.alerts[0], /Unknown library "nope"/);
  assert.match(unknown.alerts[0], /Available: d3/);
  assert.ok(unknown.frame && unknown.srcdoc.includes('id="still-here"'), 'the document still renders');
  assert.match(unknown.srcdoc, /d3js\.org/, 'the known library next to the unknown one still loads');
});
