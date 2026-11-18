// AtlasViewer (registry/atlas-viewer) rendered for real in happy-dom with the kit's Base UI toggle group and dialog: the flows in order with their
// arrows' labels, the phone/desktop and light/dark switch, the changed/new badges, the large view, the words. A fictional index only; strings compared.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const shots = (id, status = 'same') => [390, 1280].flatMap(viewport => ['light', 'dark'].map(mode => ({ viewport, mode, file: `${id}.${viewport}.${mode}.png`, sha256: 'x', consoleErrors: [], status })));
const INDEX = {
  version: 1, commit: 'fictif-2', url: 'http://fictif.invalid', createdAt: '2026-11-18T00:00:00.000Z',
  states: [
    { id: 'list.open', page: '/', title: 'The list', shots: shots('list.open') },
    { id: 'add.typing', page: '/', title: 'Typing', flow: 'Add an item', shots: shots('add.typing', 'changed') },
    { id: 'add.added', page: '/', title: 'Added', flow: 'Add an item', after: 'Add', shots: [...shots('add.added', 'new').filter(s => s.viewport === 390), { viewport: 1280, mode: 'light', file: 'add.added.1280.light.png', consoleErrors: ['boom'], status: 'new' }] },
  ],
};

const mount = async (t, props = {}) => {
  const window = new Window({ url: 'https://fictif.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'KeyboardEvent', 'PointerEvent', 'MouseEvent', 'FocusEvent', 'Event', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const given = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof given === 'function' && /^[a-z]/.test(name) ? given.bind(window) : given });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/atlas-viewer-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('atlas-viewer.mjs', out);
  await build({ stdin: { contents: `export { AtlasViewer, groupAtlas } from './atlas-viewer/atlas-viewer.tsx';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external' });
  const { AtlasViewer } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  await act(async () => root.render(createElement(AtlasViewer, { index: INDEX, shotUrl: file => `/shots/${file}`, ...props })));
  const all = sel => [...document.querySelectorAll(sel)];
  const click = async target => { await act(async () => { target.click(); await new Promise(resolve => setTimeout(resolve, 0)); }); };
  const byLabel = label => document.querySelector(`[aria-label="${label}"]`);
  const imgs = () => all('[data-testid=atlas-state] img').map(i => i.getAttribute('src'));
  return { all, click, byLabel, imgs };
};

test('flows first in order with their arrows, loose states after; phone light by default; badges from --since', async t => {
  const ui = await mount(t);
  assert.deepEqual(ui.all('[data-testid=atlas-flow] h3').map(h => h.textContent), ['Add an item', 'Screens']);
  assert.deepEqual(ui.all('[data-testid=atlas-state]').map(b => b.getAttribute('data-state-id')), ['add.typing', 'add.added', 'list.open']);
  assert.deepEqual(ui.all('[data-testid=atlas-arrow]').map(a => a.textContent), ['Add'], 'one arrow, between the two states of the flow, with its label');
  assert.deepEqual(ui.imgs(), ['/shots/add.typing.390.light.png', '/shots/add.added.390.light.png', '/shots/list.open.390.light.png']);
  assert.deepEqual(ui.all('[data-testid=atlas-status]').map(b => b.textContent), ['changed', 'new'], 'no badge for same');
  assert.match(document.body.textContent, /fictif-2/);
});

test('desktop and dark switch the shots; a missing shot says so and cannot open', async t => {
  const ui = await mount(t);
  await ui.click(ui.byLabel('Desktop'));
  assert.deepEqual(ui.imgs(), ['/shots/add.typing.1280.light.png', '/shots/add.added.1280.light.png', '/shots/list.open.1280.light.png']);
  await ui.click(ui.byLabel('Dark'));
  assert.deepEqual(ui.imgs(), ['/shots/add.typing.1280.dark.png', '/shots/list.open.1280.dark.png']);
  const missing = document.querySelector('[data-state-id="add.added"]');
  assert.equal(missing.disabled, true);
  assert.match(missing.textContent, /No shot at this size/);
});

test('a click opens the shot large with its id, page, size, theme and console errors; French by setting', async t => {
  const ui = await mount(t, { viewport: 1280, locale: 'fr' });
  assert.equal(document.querySelector('[data-testid=atlas-large]'), null);
  await ui.click(document.querySelector('[data-state-id="add.added"]'));
  const large = document.querySelector('[data-testid=atlas-large]');
  assert.equal(large.querySelector('img').getAttribute('src'), '/shots/add.added.1280.light.png');
  assert.match(large.textContent, /Added/);
  assert.match(large.textContent, /nouveau/);
  assert.match(large.textContent, /add\.added · \/ · 1280 · light · 1 erreur de console/);
  assert.deepEqual(ui.all('[data-testid=atlas-flow] h3').map(h => h.textContent), ['Add an item', 'Écrans']);
});
