import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// The live preview in happy-dom: Replaceable (original vs slot), the store in a real provider, the shell banner, « Partager »,
// the « × » per key, the chat card (adds only on click), a throwing sessionStorage, and the kill switch. Its own process: DOM globals
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

// A window with a sessionStorage we control (a throwing one for the storage-blocked case).
function dom(t, { storage } = {}) {
  const names = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'MutationObserver', 'ResizeObserver', 'Event', 'CustomEvent', 'EventTarget', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'DOMRect', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const window = new Window({ url: 'https://fictional.invalid/' });
  if (storage) Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => storage });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(?:getComputedStyle|requestAnimationFrame|cancelAnimationFrame|matchMedia|getSelection)$/.test(name) ? window[name].bind(window) : window[name] });
  t.after(() => { for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  return window;
}

function memory() { const map = new Map(); return { map, getItem: k => map.has(k) ? map.get(k) : null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) }; }
const Icon = () => null;
let PreviewedScreen = () => null;
let OtherScreen = () => null;
const nav = [{ id: 'home', label: 'Accueil', icon: Icon, render: () => PreviewedScreen() }, { id: 'other', label: 'Autre', icon: Icon, render: () => OtherScreen() }];
const HOUR = 60 * 60 * 1000;
const KEY = 'app.home.card';
const ORIGINAL = 'Carte d’origine';
const PREVIEW = 'Carte proposée';

async function setup(t, { storage, preview, live = true, body = ORIGINAL } = {}) {
  const window = dom(t, { storage });
  // One bundle for the shell and the live preview: the shell's provider and the replaceables must share one context.
  const lib = await bundle('entry.ts', `export { AppShell } from '${root}registry/app-shell/app-shell.tsx';\nexport * from '${root}registry/live-preview/preview.ts';\n`);
  const { AppShell } = lib;
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  PreviewedScreen = () => h(lib.Replaceable, { id: KEY, source: 'src/Card.tsx', props: { title: 'Carte' } }, h('p', null, body));
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const reactRoot = createRoot(container);
  const render = () => act(async () => reactRoot.render(h(AppShell, { layout: 'screen', title: 'Forme', nav, route: { id: 'home', onChange() {} }, locale: 'fr', preview })));
  await render();
  const flush = () => act(async () => new Promise(done => setTimeout(done, 5)));
  const click = async (el) => { assert.ok(el, 'the control exists'); await act(async () => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))); };
  return { lib, h, act, window, container, render, flush, click, unmount: () => act(async () => reactRoot.unmount()), live };
}

const text = el => el?.textContent ?? '';
const banner = c => c.querySelector('[data-testid=preview-banner]');
const slot = (c, key = KEY) => c.querySelector(`[data-boring-preview-slot="${key}"]`);
const buttonWith = (c, label) => [...c.querySelectorAll('button')].find(b => b.textContent.trim() === label);

test('Replaceable renders the original alone when there is no preview', async t => {
  const c = await setup(t);
  assert.equal(text(c.container).includes(ORIGINAL), true);
  assert.equal(slot(c.container), null);
  assert.equal(banner(c.container), null);
  await c.unmount();
});

test('Replaceable registers its key and file in listReplaceables()', async t => {
  const c = await setup(t);
  await c.flush();
  const entry = c.lib.listReplaceables().find(r => r.key === KEY);
  assert.deepEqual(entry && { key: entry.key, filePath: entry.filePath }, { key: KEY, filePath: 'src/Card.tsx' });
  await c.unmount();
});

test('an active overlay renders the slot with the neutral box and the original', async t => {
  const storage = memory();
  const now = Date.now();
  storage.setItem('boring.preview:app:sha1', JSON.stringify([{ key: KEY, source: 'src/Card.tsx', createdAt: now }]));
  const c = await setup(t, { storage, preview: { enabled: true, release: 'sha1', appId: 'app' } });
  await c.flush();
  assert.ok(slot(c.container), 'the slot is rendered');
  assert.equal(text(slot(c.container)).trim(), 'Aperçu indisponible');
  assert.equal(text(c.container).includes(ORIGINAL), true, 'the original renders too');
  await c.unmount();
});

test('an overlay expires after two hours and the original is back', async t => {
  const storage = memory();
  const realNow = Date.now;
  const start = realNow();
  storage.setItem('boring.preview:app:sha1', JSON.stringify([{ key: KEY, source: 'src/Card.tsx', createdAt: start - 2 * HOUR }]));
  const c = await setup(t, { storage, preview: { enabled: true, release: 'sha1', appId: 'app' } });
  await c.flush();
  assert.equal(slot(c.container), null, 'an overlay older than two hours is not active');
  assert.equal(banner(c.container), null);
  await c.unmount();
});

test('a different release reads no overlay: the original renders', async t => {
  const storage = memory();
  storage.setItem('boring.preview:app:sha1', JSON.stringify([{ key: KEY, source: 'src/Card.tsx', createdAt: Date.now() }]));
  const c = await setup(t, { storage, preview: { enabled: true, release: 'sha2', appId: 'app' } });
  await c.flush();
  assert.equal(slot(c.container), null);
  await c.unmount();
});

test('the kill switch: enabled=false renders the original even with stored overlays', async t => {
  const storage = memory();
  storage.setItem('boring.preview:app:sha1', JSON.stringify([{ key: KEY, source: 'src/Card.tsx', createdAt: Date.now() }]));
  const c = await setup(t, { storage, preview: { enabled: false, release: 'sha1', appId: 'app' } });
  await c.flush();
  assert.equal(slot(c.container), null);
  assert.equal(banner(c.container), null);
  assert.equal(text(c.container).includes(ORIGINAL), true);
  await c.unmount();
});

test('the shown toggle hides the slot and keeps the overlay', async t => {
  const storage = memory();
  storage.setItem('boring.preview:app:sha1', JSON.stringify([{ key: KEY, source: 'src/Card.tsx', createdAt: Date.now() }]));
  const c = await setup(t, { storage, preview: { enabled: true, release: 'sha1', appId: 'app' } });
  await c.flush();
  await c.click(buttonWith(c.container, 'Masquer'));
  assert.equal(slot(c.container), null, 'hidden: the original only');
  await c.click(buttonWith(c.container, 'Afficher'));
  assert.ok(slot(c.container), 'shown again');
  await c.unmount();
});

test('the banner appears only with enabled and at least one overlay; « Tout annuler » clears them and the original is back', async t => {
  const storage = memory();
  const c = await setup(t, { storage, preview: { enabled: true, release: 'sha1', appId: 'app' } });
  await c.flush();
  assert.equal(banner(c.container), null, 'no overlay, no banner');
  storage.setItem('boring.preview:app:sha1', JSON.stringify([{ key: KEY, source: 'src/Card.tsx', createdAt: Date.now() }]));
  await c.unmount();
  const d = await setup(t, { storage, preview: { enabled: true, release: 'sha1', appId: 'app' } });
  await d.flush();
  assert.match(text(banner(d.container)), /Prévisualisation/);
  await d.click(buttonWith(d.container, 'Tout annuler'));
  assert.equal(banner(d.container), null);
  assert.equal(slot(d.container), null);
  assert.equal(storage.map.size, 0, 'nothing stays in storage');
  await d.unmount();
});

test('the banner is off when enabled is false, even with overlays', async t => {
  const storage = memory();
  storage.setItem('boring.preview:app:sha1', JSON.stringify([{ key: KEY, source: 'src/Card.tsx', createdAt: Date.now() }]));
  const c = await setup(t, { storage, preview: { enabled: false, release: 'sha1', appId: 'app' } });
  await c.flush();
  assert.equal(banner(c.container), null);
  await c.unmount();
});

test('the × per key removes that overlay at once and the original is back', async t => {
  const storage = memory();
  storage.setItem('boring.preview:app:sha1', JSON.stringify([{ key: KEY, source: 'src/Card.tsx', createdAt: Date.now() }]));
  const c = await setup(t, { storage, preview: { enabled: true, release: 'sha1', appId: 'app' } });
  await c.flush();
  await c.click(c.container.querySelector(`[data-testid="preview-close-${KEY}"]`));
  assert.equal(slot(c.container), null);
  assert.equal(banner(c.container), null, 'no overlays left, no banner');
  assert.equal(storage.map.size, 0);
  await c.unmount();
});

test('« Partager » is shown only when onShare is passed; it calls it with ids only, removes the overlay, and shows the note with the PR link', async t => {
  const storage = memory();
  storage.setItem('boring.preview:app:sha1', JSON.stringify([{ key: KEY, source: 'src/Card.tsx', createdAt: Date.now(), previewId: 'call-7' }]));
  const calls = [];
  const onShare = async payload => { calls.push(payload); return { prUrl: 'https://example.invalid/pull/1' }; };
  const without = await setup(t, { storage, preview: { enabled: true, release: 'sha1', appId: 'app' } });
  await without.flush();
  assert.equal(buttonWith(without.container, 'Partager'), undefined, 'no button without onShare');
  await without.unmount();

  const c = await setup(t, { storage, preview: { enabled: true, release: 'sha1', appId: 'app', onShare } });
  await c.flush();
  await c.click(buttonWith(c.container, 'Partager'));
  await c.flush();
  assert.deepEqual(calls, [{ key: KEY, previewId: 'call-7', release: 'sha1' }], 'ids only: no source, no screenshot');
  assert.equal(slot(c.container), null, 'the overlay is cleared');
  assert.equal(banner(c.container), null);
  assert.equal(storage.map.size, 0);
  assert.equal(text(c.container).includes(ORIGINAL), true, 'the original renders');
  const note = c.container.querySelector('[data-testid=preview-note]');
  assert.match(text(note), /Proposé — visible après mise en ligne/);
  assert.equal(note.querySelector('a')?.getAttribute('href'), 'https://example.invalid/pull/1');
  await c.unmount();
});

test('the chat card adds the overlay only on click', async t => {
  const storage = memory();
  const c = await setup(t, { storage, preview: { enabled: true, release: 'sha1', appId: 'app' } });
  await c.flush();
  const { previewCardFor } = c.lib;
  const card = previewCardFor({ details: { kind: 'boring.preview', key: KEY, source: 'src/Card.tsx' } }, { id: 'call-9' });
  assert.ok(card, 'a boring.preview result makes a card');
  assert.equal(previewCardFor({ details: { kind: 'other' } }, { id: 'x' }), undefined, 'other results make no card');
  assert.equal(previewCardFor(undefined, { id: 'x' }), undefined, 'a running call makes no card');
  OtherScreen = () => card.content;
  await c.render();
  assert.equal(storage.map.size, 0, 'rendering the card adds nothing');
  assert.equal(slot(c.container), null);
  await c.click(buttonWith(c.container, `Prévisualiser ${KEY}`));
  await c.flush();
  const stored = JSON.parse(storage.map.get('boring.preview:app:sha1'));
  assert.deepEqual(stored.map(o => [o.key, o.source, o.previewId]), [[KEY, 'src/Card.tsx', 'call-9']]);
  assert.ok(slot(c.container), 'the slot is active after the click');
  await c.unmount();
});

test('a sessionStorage that throws: the shell renders, the original shows, add and clear do not throw', async t => {
  const broken = () => { throw new Error('blocked'); };
  const storage = { getItem: broken, setItem: broken, removeItem: broken, get length() { throw new Error('blocked'); } };
  const c = await setup(t, { storage, preview: { enabled: true, release: 'sha1', appId: 'app' } });
  await c.flush();
  assert.equal(text(c.container).includes(ORIGINAL), true);
  assert.equal(banner(c.container), null);
  await c.unmount();
});
