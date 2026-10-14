import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// The live preview in happy-dom: Replaceable in place: the chat card (starts only on click), the sandboxed frame in the slot, the banner, « Fermer », « Partager » and the note,
// the frame's sandbox attribute, the messages from the frame (errors bring the original back), no storage, and the kill switch. Its own process: DOM globals
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
const KEY = 'forme.home.list';
const details = { kind: 'boring.preview', previewId: '3f1c2b0e-0000-4000-8000-000000000001', key: KEY, title: 'Liste du jour', source: 'export default function List() { return null; }' };
const ORIGINAL = 'Liste d’origine';

async function setup(t, { preview, mount = true, key = KEY } = {}) {
  const window = dom(t);
  const lib = await bundle('entry.ts', `export { AppShell } from '${root}registry/app-shell/app-shell.tsx';\nexport * from '${root}registry/live-preview/preview.ts';\nexport * from '${root}registry/live-preview/frame-protocol.ts';\n`);
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const onSelect = () => {};
  Screen = () => h('div', null,
    h('div', { 'data-testid': 'card-host' }, lib.previewCardFor({ details: { ...details, key } }, { id: 'call-1' })?.content),
    mount ? h(lib.Replaceable, { id: KEY, source: 'src/List.tsx', props: { rows: [1, 2, 3], onSelect, children: h('i') } }, h('p', { 'data-testid': 'original' }, ORIGINAL)) : null);
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
const fromWindow = (c, source, data) => c.act(async () => { c.window.dispatchEvent(Object.assign(new c.window.Event('message'), { data, source, origin: 'null' })); });

test('the card replaces nothing until its click; then the frame takes the slot and the banner shows', async t => {
  const c = await setup(t, { preview: { enabled: true, release: 'abc123' } });
  assert.match(text(c.cardButton()), /Prévisualiser/);
  assert.equal(text(q(c, 'original')), ORIGINAL);
  assert.equal(q(c, 'preview-frame'), null, 'the card alone replaces nothing');
  await c.click(c.cardButton());
  assert.ok(q(c, 'preview-frame'), 'the frame is in the slot');
  assert.equal(q(c, 'original'), null, 'in place of the original');
  assert.match(text(q(c, 'preview-banner')), /Prévisualisation · Liste du jour/);
  await c.unmount();
});

test('enabled=false: the card is disabled and every part keeps its original', async t => {
  const c = await setup(t, { preview: { enabled: false } });
  assert.equal(c.cardButton().disabled, true);
  await c.click(c.cardButton());
  assert.equal(q(c, 'preview-frame'), null);
  assert.equal(text(q(c, 'original')), ORIGINAL);
  await c.unmount();
  const none = await setup(t, {});
  assert.equal(none.cardButton().disabled, true, 'no preview prop is off too');
  await none.unmount();
});

test('the frame is sandbox="allow-scripts" exactly, loads the host-served frame page, and no storage is used', async t => {
  const c = await setup(t, { preview: { enabled: true, frameUrl: '/assets/preview-frame.html' } });
  await c.click(c.cardButton());
  const frame = q(c, 'preview-frame');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(frame.getAttribute('src'), '/assets/preview-frame.html');
  assert.equal(frame.hasAttribute('srcdoc'), false);
  assert.equal(c.window.sessionStorage.length + c.window.localStorage.length, 0, 'memory only');
  await c.unmount();
});

test('Fermer restores the original; Partager shows only with onSharePreview', async t => {
  const c = await setup(t, { preview: { enabled: true } });
  await c.click(c.cardButton());
  assert.equal(q(c, 'preview-share'), null, 'no share without the host callback');
  await c.click(q(c, 'preview-close'));
  assert.equal(q(c, 'preview-frame'), null);
  assert.equal(text(q(c, 'original')), ORIGINAL);
  assert.equal(q(c, 'preview-banner'), null);
  await c.unmount();
});

test('Partager passes key, previewId and release, restores the original and shows the note with the PR link', async t => {
  const shared = [];
  const c = await setup(t, { preview: { enabled: true, release: 'abc123', onSharePreview: async p => { shared.push(p); return { prUrl: 'https://example.invalid/pr/7' }; } } });
  await c.click(c.cardButton());
  await c.click(q(c, 'preview-share'));
  await flush(c);
  assert.deepEqual(shared, [{ key: KEY, previewId: details.previewId, release: 'abc123' }]);
  assert.equal(q(c, 'preview-frame'), null, 'the overlay is gone');
  assert.equal(text(q(c, 'original')), ORIGINAL);
  assert.match(text(q(c, 'preview-note')), /Proposé — visible après mise en ligne/);
  assert.equal(q(c, 'preview-note').querySelector('a').getAttribute('href'), 'https://example.invalid/pr/7');
  await c.unmount();
});

test('a share refused with already_open counts as shared; any other refusal keeps the preview and shows the message', async t => {
  let failure = Object.assign(new Error('already open'), { code: 'already_open', prUrl: 'https://example.invalid/pr/3' });
  const c = await setup(t, { preview: { enabled: true, onSharePreview: async () => { throw failure; } } });
  await c.click(c.cardButton());
  await c.click(q(c, 'preview-share'));
  await flush(c);
  assert.equal(q(c, 'preview-frame'), null);
  assert.equal(q(c, 'preview-note').querySelector('a').getAttribute('href'), 'https://example.invalid/pr/3');
  failure = Object.assign(new Error('Le dépôt est indisponible'), { code: 'upstream' });
  await c.click(c.cardButton());
  await c.click(q(c, 'preview-share'));
  await flush(c);
  assert.ok(q(c, 'preview-frame'), 'the preview stays');
  assert.match(text(q(c, 'preview-share-error')), /Le dépôt est indisponible/);
  failure = Object.assign(new Error('x'), { code: 'file_changed' });
  await c.click(q(c, 'preview-share'));
  await flush(c);
  assert.ok(q(c, 'preview-frame'), 'the preview stays');
  assert.match(text(q(c, 'preview-share-error')), /Le fichier a changé depuis cette version — demande au PM de régénérer/);
  await c.unmount();
});

test('only messages from the preview iframe window count: an error brings the original back and reaches onPreviewError; intents show', async t => {
  const errors = [];
  const c = await setup(t, { preview: { enabled: true, onPreviewError: e => errors.push(e) } });
  await c.click(c.cardButton());
  const frameWindow = q(c, 'preview-frame').contentWindow;
  assert.ok(frameWindow, 'the iframe has a window');
  const tag = c.lib.FRAME_TAG;
  await fromWindow(c, {}, { boring: tag, type: 'error', message: 'from a stranger' });
  assert.deepEqual(errors, [], 'a message from another window is ignored');
  await fromWindow(c, frameWindow, { boring: tag, type: 'intent', name: 'onSelect', args: '["a"]' });
  assert.match(text(q(c, 'preview-intent')), /Intention : onSelect\("a"\)/);
  await fromWindow(c, frameWindow, { boring: tag, type: 'error', message: 'Unexpected token (1:5)' });
  assert.deepEqual(errors, [{ previewId: details.previewId, message: 'Unexpected token (1:5)' }]);
  assert.match(text(q(c, 'preview-error')), /Unexpected token/);
  assert.equal(q(c, 'preview-frame'), null, 'the frame is gone');
  assert.equal(text(q(c, 'original')), ORIGINAL, 'the original renders again');
  await c.unmount();
});

test('a key with no mounted Replaceable says so in the banner; listReplaceables gives key and file', async t => {
  const c = await setup(t, { preview: { enabled: true }, key: 'forme.other.part' });
  await c.click(c.cardButton());
  assert.match(text(q(c, 'preview-absent')), /Cette partie n’est pas à l’écran/);
  assert.equal(text(q(c, 'original')), ORIGINAL, 'the mounted part is untouched');
  assert.deepEqual(c.lib.listReplaceables(), [{ key: KEY, filePath: 'src/List.tsx' }]);
  await c.unmount();
});

test('replaceablesContext lists the mounted parts as « key -> file » lines for the PM, or nothing', async t => {
  const c = await setup(t, { preview: { enabled: true } });
  assert.deepEqual(c.lib.replaceablesContext(), { replaceables: `Parties remplaçables:\n${KEY} -> src/List.tsx` });
  assert.equal(c.lib.replaceablesContext('en').replaceables.split('\n')[0], 'Replaceable parts:');
  await c.unmount();
  assert.equal(c.lib.replaceablesContext(), undefined, 'nothing mounted, nothing to say');
});
