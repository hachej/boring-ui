import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// The live preview in happy-dom: the chat card (opens only on click), the preview view and its banner, « Fermer », Esc, « Partager » and the note,
// the frame's sandbox attribute, the messages from the frame, and the kill switch. Its own process: DOM globals
// must not leak into the other test files.
const root = fileURLToPath(new URL('../../', import.meta.url));
let bundles = 0;
async function bundle(name, source) {
  const out = `${root}.cache/live-preview-render-test`;
  mkdirSync(out, { recursive: true });
  const outfile = `${out}/${name.replace(/\.tsx?$/, '')}.mjs`;
  const entry = source ? `${out}/${name}` : `${root}registry/${name}`;
  if (source) writeFileSync(entry, source);
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${root}examples/app-shell` }, logLevel: 'silent' });
  writeFileSync(`${out}/package.json`, '{"type":"module"}');
  return import(`${pathToFileURL(outfile).href}?fresh=${++bundles}`);
}

function dom(t) {
  const names = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'MutationObserver', 'ResizeObserver', 'Event', 'CustomEvent', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'DOMRect', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const window = new Window({ url: 'https://fictional.invalid/' });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(?:getComputedStyle|requestAnimationFrame|cancelAnimationFrame|matchMedia|getSelection)$/.test(name) ? window[name].bind(window) : window[name] });
  t.after(() => { for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  return window;
}


const Icon = () => null;
let Screen = () => null;
const nav = [{ id: 'home', label: 'Accueil', icon: Icon, render: () => Screen() }];
const details = { kind: 'boring.preview', previewId: '3f1c2b0e-0000-4000-8000-000000000001', title: 'Carte du jour', source: 'export default function Card() { return null; }', sampleProps: { steps: 12 } };

async function setup(t, { preview } = {}) {
  const window = dom(t);
  const lib = await bundle('entry.ts', `export { AppShell } from '${root}registry/app-shell/app-shell.tsx';\nexport * from '${root}registry/live-preview/preview.ts';\nexport * from '${root}registry/live-preview/frame-protocol.ts';\n`);
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  Screen = () => h('div', { 'data-testid': 'card-host' }, lib.previewCardFor({ details }, { id: 'call-1' })?.content);
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const reactRoot = createRoot(container);
  await act(async () => reactRoot.render(h(lib.AppShell, { layout: 'screen', title: 'Forme', nav, route: { id: 'home', onChange() {} }, locale: 'fr', preview })));
  const click = async el => { assert.ok(el, 'the control exists'); await act(async () => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))); };
  const cardButton = () => container.querySelector('[data-testid=card-host] button');
  return { lib, act, window, container, click, cardButton, unmount: () => act(async () => reactRoot.unmount()) };
}
const q = (c, id) => c.container.querySelector(`[data-testid=${id}]`);
const text = el => el?.textContent ?? '';
const flush = (c, ms = 5) => c.act(async () => new Promise(done => setTimeout(done, ms)));
/** A message as the browser would deliver it from `source`. */
const fromWindow = (c, source, data) => c.act(async () => { c.window.dispatchEvent(Object.assign(new c.window.Event('message'), { data, source, origin: 'null' })); });

test('the card opens nothing until its click', async t => {
  const c = await setup(t, { preview: { enabled: true } });
  assert.match(text(c.cardButton()), /Prévisualiser/);
  assert.equal(q(c, 'preview-view'), null, 'the card alone opens nothing');
  await c.click(c.cardButton());
  assert.match(text(q(c, 'preview-banner')), /Prévisualisation · Carte du jour/);
  await c.unmount();
});

test('enabled=false: the card is disabled and no view opens', async t => {
  const c = await setup(t, { preview: { enabled: false } });
  assert.equal(c.cardButton().disabled, true);
  await c.click(c.cardButton());
  assert.equal(q(c, 'preview-view'), null);
  await c.unmount();
  const none = await setup(t, {});
  assert.equal(none.cardButton().disabled, true, 'no preview prop is off too');
  await none.unmount();
});

test('the frame is sandbox="allow-scripts" exactly, and loads the host-served frame page', async t => {
  const c = await setup(t, { preview: { enabled: true, frameUrl: '/assets/preview-frame.html' } });
  await c.click(c.cardButton());
  const frame = q(c, 'preview-frame');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(frame.getAttribute('src'), '/assets/preview-frame.html');
  assert.equal(frame.hasAttribute('srcdoc'), false);
  await c.unmount();
});

test('Fermer and Escape close the view; Partager shows only with onSharePreview', async t => {
  const c = await setup(t, { preview: { enabled: true } });
  await c.click(c.cardButton());
  assert.equal(q(c, 'preview-share'), null, 'no share without the host callback');
  await c.click(q(c, 'preview-close'));
  assert.equal(q(c, 'preview-view'), null);
  await c.click(c.cardButton());
  await c.act(async () => c.window.dispatchEvent(new c.window.KeyboardEvent('keydown', { key: 'Escape' })));
  assert.equal(q(c, 'preview-view'), null, 'Escape closes');
  await c.unmount();
});

test('Partager closes the view and shows the note, with the PR link when given', async t => {
  const shared = [];
  const c = await setup(t, { preview: { enabled: true, onSharePreview: async p => { shared.push(p); return { prUrl: 'https://example.invalid/pr/7' }; } } });
  await c.click(c.cardButton());
  await c.click(q(c, 'preview-share'));
  await flush(c);
  assert.deepEqual(shared, [{ previewId: details.previewId }]);
  assert.equal(q(c, 'preview-view'), null, 'the view closed');
  assert.match(text(q(c, 'preview-note')), /Proposé — visible après mise en ligne/);
  assert.equal(q(c, 'preview-note').querySelector('a').getAttribute('href'), 'https://example.invalid/pr/7');
  await c.unmount();
});

test('a share refused with already_open counts as shared; any other refusal keeps the view and shows the message', async t => {
  let failure = Object.assign(new Error('already open'), { code: 'already_open', prUrl: 'https://example.invalid/pr/3' });
  const c = await setup(t, { preview: { enabled: true, onSharePreview: async () => { throw failure; } } });
  await c.click(c.cardButton());
  await c.click(q(c, 'preview-share'));
  await flush(c);
  assert.equal(q(c, 'preview-view'), null);
  assert.equal(q(c, 'preview-note').querySelector('a').getAttribute('href'), 'https://example.invalid/pr/3');
  failure = Object.assign(new Error('Le dépôt est indisponible'), { code: 'upstream' });
  await c.click(c.cardButton());
  await c.click(q(c, 'preview-share'));
  await flush(c);
  assert.ok(q(c, 'preview-view'), 'the view stays open');
  assert.match(text(q(c, 'preview-error')), /Le dépôt est indisponible/);
  await c.unmount();
});

test('only messages from the preview iframe window count: errors reach onPreviewError, intents show a toast', async t => {
  const errors = [];
  const c = await setup(t, { preview: { enabled: true, onPreviewError: e => errors.push(e) } });
  await c.click(c.cardButton());
  const frameWindow = q(c, 'preview-frame').contentWindow ?? {};
  const tag = c.lib.FRAME_TAG;
  await fromWindow(c, {}, { boring: tag, type: 'error', message: 'from a stranger' });
  assert.deepEqual(errors, [], 'a message from another window is ignored');
  await fromWindow(c, frameWindow, { boring: tag, type: 'error', message: 'Unexpected token (1:5)' });
  assert.deepEqual(errors, [{ previewId: details.previewId, message: 'Unexpected token (1:5)' }]);
  assert.match(text(q(c, 'preview-error')), /Unexpected token/);
  await fromWindow(c, frameWindow, { boring: tag, type: 'intent', name: 'onSelect', args: '["a"]' });
  assert.match(text(q(c, 'preview-intent')), /Intention : onSelect\("a"\)/);
  await c.unmount();
});
