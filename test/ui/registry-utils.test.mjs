import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function harness(t) {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'IS_REACT_ACT_ENVIRONMENT', 'sessionStorage', 'localStorage', 'ResizeObserver'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] });
  const out = new URL('../../.cache/registry-utils/', import.meta.url); mkdirSync(out, { recursive: true });
  for (const name of ['use-media', 'persisted']) await build({ entryPoints: [new URL(`../../registry/utils/${name}.ts`, import.meta.url).pathname], outfile: new URL(`${name}.mjs`, out).pathname, bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'silent' });
  const media = await import(new URL('use-media.mjs', out).href), persisted = await import(new URL('persisted.mjs', out).href);
  const { createElement: h, act, useRef } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const element = window.document.createElement('div'); window.document.body.append(element);
  const root = createRoot(element);
  t.after(async () => { await act(async () => root.unmount()); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  return { window, root, element, h, act, useRef, ...media, ...persisted };
}

test('source-distributed useMedia replaces its query subscription without confusing coarse pointer with phone width', async t => {
  const { window, root, element, h, act, useMedia, usePhone, PHONE_BELOW, PHONE_QUERY } = await harness(t);
  assert.equal(PHONE_BELOW, 768);
  assert.equal(PHONE_QUERY, '(width < 768px)');
  let coarse = true;
  const lists = new Map();
  window.matchMedia = query => {
    if (!lists.has(query)) lists.set(query, { matches: query === '(pointer: coarse)' ? coarse : false, listeners: new Set(), addEventListener(_type, listener) { this.listeners.add(listener); }, removeEventListener(_type, listener) { this.listeners.delete(listener); } });
    return lists.get(query);
  };
  function Probe({ query }) { return h('output', { 'data-phone': usePhone(), 'data-match': useMedia(query) }); }
  await act(async () => root.render(h(Probe, { query: '(pointer: coarse)' })));
  assert.equal(element.firstChild.dataset.phone, 'false', 'a coarse pointer alone is not a phone');
  assert.equal(element.firstChild.dataset.match, 'true');
  await act(async () => root.render(h(Probe, { query: '(prefers-reduced-motion: reduce)' })));
  assert.equal(lists.get('(pointer: coarse)').listeners.size, 0, 'old query is detached');
  assert.equal(element.firstChild.dataset.match, 'false');
  const active = lists.get('(prefers-reduced-motion: reduce)');
  await act(async () => { active.matches = true; for (const listener of active.listeners) listener(); });
  assert.equal(element.firstChild.dataset.match, 'true');
  await act(async () => root.render(null));
  assert.ok([...lists.values()].every(list => list.listeners.size === 0));
});

test('shared viewport and keyboard inset track resize/scroll, ignore pinch zoom and release browser observers', async t => {
  const { window, root, element, h, act, useRef, useVisualViewport, useKeyboardInset } = await harness(t);
  const viewport = new window.EventTarget();
  Object.assign(viewport, { offsetTop: 0, height: 800, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  const active = new Set();
  const add = viewport.addEventListener.bind(viewport), remove = viewport.removeEventListener.bind(viewport);
  viewport.addEventListener = (type, listener) => { active.add(listener); add(type, listener); };
  viewport.removeEventListener = (type, listener) => { active.delete(listener); remove(type, listener); };
  let observed = 0, disconnected = 0, resize;
  globalThis.ResizeObserver = class { constructor(callback) { resize = callback; } observe() { observed++; } disconnect() { disconnected++; } };
  let bottom = 800;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ bottom });
  function Probe({ enabled }) {
    const ref = useRef(null), box = useVisualViewport();
    useKeyboardInset(ref, enabled);
    return h('section', { ref, 'data-box': JSON.stringify(box) });
  }
  await act(async () => root.render(h(Probe, { enabled: true })));
  const section = element.firstChild;
  assert.equal(section.style.getPropertyValue('--composer-keyboard-inset'), '0px');
  await act(async () => { viewport.height = 500; viewport.offsetTop = 30; viewport.dispatchEvent(new window.Event('resize')); });
  assert.equal(section.style.getPropertyValue('--composer-keyboard-inset'), '270px');
  await act(async () => { viewport.offsetTop = 40; viewport.dispatchEvent(new window.Event('scroll')); });
  assert.equal(section.style.getPropertyValue('--composer-keyboard-inset'), '260px');
  await act(async () => { viewport.scale = 2; viewport.height = 200; viewport.dispatchEvent(new window.Event('resize')); });
  assert.deepEqual(JSON.parse(section.dataset.box), { top: 40, height: 500 }, 'pinch zoom keeps the unzoomed viewport');
  bottom = 700;
  await act(async () => resize());
  assert.equal(section.style.getPropertyValue('--composer-keyboard-inset'), '160px', 'element resize uses its own bottom');
  await act(async () => root.render(h(Probe, { enabled: false })));
  assert.equal(section.style.getPropertyValue('--composer-keyboard-inset'), '', 'disabled inset leaves no stale style');
  await act(async () => root.render(null));
  assert.equal(active.size, 0);
  assert.equal(disconnected, observed);
});

test('persisted helpers preserve storage encodings and treat denied reads/writes and malformed JSON as absent conveniences', async t => {
  const { window, readPersisted, writePersisted, readPersistedJson, writePersistedJson, readFlag, writeFlag } = await harness(t);
  writeFlag('floating', true);
  assert.equal(window.sessionStorage.getItem('floating'), '1');
  assert.equal(readFlag('floating'), true);
  writeFlag('floating', false);
  assert.equal(window.sessionStorage.getItem('floating'), null);
  assert.equal(readFlag('floating'), false);
  writePersisted('dock.open', '0', 'local');
  assert.equal(readPersisted('dock.open', 'local'), '0', 'explicit closed differs from absent');
  assert.equal(readPersisted('dock.open'), null, 'session remains the default');
  writePersistedJson('position', { right: 16, bottom: 32 }, 'local');
  assert.deepEqual(readPersistedJson('position', 'local'), { right: 16, bottom: 32 });
  window.sessionStorage.setItem('broken', '{');
  assert.equal(readPersistedJson('broken'), null);
  for (const name of ['sessionStorage', 'localStorage']) {
    Object.defineProperty(globalThis, name, { configurable: true, get() { throw new Error('fixture denied getter'); } });
    const persist = name === 'localStorage' ? 'local' : 'session';
    assert.equal(readPersisted('position', persist), null);
    assert.doesNotThrow(() => writePersisted('position', 'new', persist));
    Object.defineProperty(globalThis, name, { configurable: true, value: { getItem() { throw new Error('fixture denied read'); }, setItem() { throw new Error('fixture quota'); }, removeItem() { throw new Error('fixture denied delete'); } } });
    assert.equal(readPersistedJson('position', persist), null);
    assert.doesNotThrow(() => writePersistedJson('position', {}, persist));
    assert.doesNotThrow(() => writePersisted('position', null, persist));
  }
});
