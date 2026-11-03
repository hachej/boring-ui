// The drawing viewer block (D-1398) through its public entry points, the kind and DrawingViewer, as an app installs them: an unreadable
// file shows an inline error without loading a renderer, the renderers stay out of the chunks an app loads up front, and the parse
// description. The drawing itself (Excalidraw and draw.io in real Chromium) is examples/drawing-viewer/journey.mjs. Fictional fixtures only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = join(root, '.cache/drawing-viewer-test');
mkdirSync(out, { recursive: true });
const fixture = name => readFileSync(join(root, 'test/fixtures/drawing', name), 'utf8');

test('the kind and the drawing module load no renderer up front: Excalidraw and the draw.io viewer are reached only by a dynamic import', async () => {
  const result = await build({ entryPoints: [join(root, 'registry/drawing-viewer/drawing-kind.tsx')], bundle: true, splitting: true, write: false, outdir: join(out, 'split'),
    format: 'esm', platform: 'browser', jsx: 'automatic', packages: 'external', metafile: true, logLevel: 'silent' });
  const outputs = Object.entries(result.metafile.outputs).map(([path, output]) => ({ path: resolve(path), ...output }));
  const entry = outputs.find(output => output.entryPoint);
  const seen = new Set([entry.path]);
  for (const path of seen) for (const edge of outputs.find(output => output.path === path).imports) if (!edge.external && edge.kind === 'import-statement') seen.add(resolve(edge.path));
  const eager = outputs.filter(output => seen.has(output.path));
  const inputs = eager.flatMap(output => Object.keys(output.inputs).map(input => relative(root, resolve(input))));
  assert.deepEqual(inputs.filter(input => /drawing-viewer\/(drawing-viewer|excalidraw-render|drawio-render|drawio-frame)\./.test(input)), [], 'the kind loads no view module up front');
  assert.deepEqual(eager.flatMap(output => output.imports.filter(edge => edge.external).map(edge => edge.path)).filter(path => /excalidraw|drawio-viewer/.test(path)), [], 'nor a renderer package');
  const lazy = outputs.filter(output => !seen.has(output.path)).flatMap(output => output.imports.filter(edge => edge.external && edge.kind === 'dynamic-import').map(edge => edge.path));
  assert.ok(lazy.includes('@excalidraw/excalidraw'), 'Excalidraw is imported dynamically');
  assert.ok(lazy.includes('@hachej/boring-ui-kit/drawio-viewer'), 'the vendored draw.io viewer is imported dynamically');
});

const DOM = ['window', 'document', 'navigator', 'location', 'HTMLElement', 'Element', 'Node', 'Text', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
let kit;
async function page(t) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const globals = new Map(DOM.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of DOM) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  if (!kit) {
    writeFileSync(join(out, 'entry.tsx'), `export { drawingKind, createDrawingKind } from '${root}registry/drawing-viewer/drawing-kind.tsx';
export { DrawingViewer, describeDrawing, drawingFormat } from '${root}registry/drawing-viewer/drawing-viewer.tsx';`);
    await build({ entryPoints: [join(out, 'entry.tsx')], outfile: join(out, 'kit.mjs'), bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external',
      alias: { '@': join(root, 'examples/app-shell') }, logLevel: 'silent' });
    kit = await import(pathToFileURL(join(out, 'kit.mjs')).href);
  }
  const { act, createElement, Suspense } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  t.after(async () => {
    await act(async () => ui.unmount()); container.remove(); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const settle = async () => { for (let i = 0; i < 20; i++) await act(async () => new Promise(done => setTimeout(done, 5))); };
  return { render: async element => { await act(async () => ui.render(createElement(Suspense, { fallback: null }, element))); await settle(); }, $: selector => document.querySelector(selector), h: createElement };
}

test('an unreadable drawing shows an inline error through the kind, in English and in French, and loads no renderer', async t => {
  const view = await page(t);
  assert.equal(kit.drawingKind.match({ resource: { path: 'plans/garden.excalidraw' } }), true);
  assert.equal(kit.drawingKind.match({ resource: { path: 'plans/bakery.drawio' } }), true);
  assert.equal(kit.drawingKind.match({ resource: { path: 'plans/flow.diagram.json' } }), false);
  assert.equal(kit.drawingKind.label, 'Drawing');
  await view.render(kit.drawingKind.renderer({ text: fixture('broken.excalidraw'), artifact: { title: 'Broken', target: { resource: { path: 'plans/broken.excalidraw' } } } }));
  const viewer = view.$('[data-boring=drawing-viewer]');
  assert.equal(viewer.dataset.state, 'error');
  assert.equal(view.$('[data-testid=drawing-error]').dataset.reason, 'unreadable');
  assert.match(view.$('[data-testid=drawing-error]').textContent, /This drawing cannot be shown/);
  assert.equal(view.$('img'), null);
  const french = kit.createDrawingKind({ locale: 'fr' });
  assert.equal(french.label, 'Dessin');
  await view.render(french.renderer({ text: '<html><body>not a diagram</body></html>' }));
  assert.equal(view.$('[data-testid=drawing-error]').dataset.reason, 'unreadable');
  assert.match(view.$('[data-testid=drawing-error]').textContent, /Ce dessin ne peut pas être affiché/);
  await view.render(view.h(kit.DrawingViewer, { text: '<mxfile><diagram>', path: 'x.drawio' }));
  assert.equal(view.$('[data-boring=drawing-viewer]').dataset.format, 'drawio');
  // The kind takes the file's name from the artifact, as the panel passes it: a standalone <diagram> named .drawio is a draw.io file.
  await view.render(kit.drawingKind.renderer({ text: '<?xml version="1.0"?>\n<diagram id="a">x</diagram>', artifact: { title: 'A', target: { resource: { path: 'a.drawio' } } } }));
  assert.equal(view.$('[data-boring=drawing-viewer]').dataset.format, 'drawio');
});

test('the format comes from the name, else from the text; the description names every shape and arrow', async () => {
  await build({ entryPoints: [join(root, 'registry/drawing-viewer/drawing.ts')], outfile: join(out, 'drawing.mjs'), bundle: true, format: 'esm', platform: 'neutral', logLevel: 'silent' });
  const drawing = await import(pathToFileURL(join(out, 'drawing.mjs')).href);
  assert.equal(drawing.drawingFormat('a.excalidraw.json'), 'excalidraw');
  assert.equal(drawing.drawingFormat('a.drawio.xml'), 'drawio');
  assert.equal(drawing.drawingFormat(undefined, fixture('oakfield-garden.excalidraw')), 'excalidraw');
  assert.equal(drawing.drawingFormat(undefined, fixture('bakery-morning.drawio')), 'drawio');
  assert.equal(drawing.drawingFormat('notes.md', '# notes'), undefined);
  assert.equal(drawing.drawingFormat(undefined, '<?xml version="1.0"?>\n<diagram id="a">x</diagram>'), 'drawio');
  const text = drawing.describeDrawing({ format: 'drawio', bounds: { x: 0, y: 0, width: 300, height: 120 },
    shapes: [{ id: 'a', kind: 'rectangle', x: 0, y: 0, width: 100, height: 60, label: 'Mix dough', fill: '#fff2cc' }, { id: 'b', kind: 'ellipse', x: 200, y: 0, width: 100, height: 60, label: 'Bake' }],
    arrows: [{ id: 'e', kind: 'arrow', from: 'a', to: 'b', points: [[100, 30], [200, 30]], label: 'rest 1 h' }] });
  assert.equal(text, 'A draw.io drawing of 2 shapes and 1 arrows, 300×120.\n- rectangle a "Mix dough" at (0, 0), 100×60, fill #fff2cc\n- ellipse b "Bake" at (200, 0), 100×60\n- arrow e "rest 1 h" from "Mix dough" to "Bake"');
});
