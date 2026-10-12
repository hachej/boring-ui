// The ambient bar remembers where it was moved under `storageKey`: in sessionStorage by default, in localStorage with `storage="local"`.
// The grip's arrow keys move the bar through the same write path as a drag, so the test needs no pointer capture.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

async function harness(t) {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'confirm', 'sessionStorage', 'localStorage', 'ResizeObserver', 'KeyboardEvent', 'addEventListener', 'removeEventListener', 'matchMedia', 'innerWidth', 'innerHeight'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, right: 1200, top: 0, bottom: 800, x: 0, y: 0 });
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/ambient-position-test/', import.meta.url);
  mkdirSync(out, { recursive: true });
  const output = new URL('ambient.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-ambient/ambient.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const { AmbientChat } = await import(output.href);
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const element = window.document.createElement('div');
  window.document.body.append(element);
  const root = createRoot(element);
  const chat = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'alice' },
    conversation: { id: 1 }, context: { value: () => undefined, toString: () => 'fictional' }, history: false,
    source: { open: async () => ({ value: { conversation: { id: 1 }, entries: [], docs: {} }, start() {}, closed: new Promise(() => {}), stop: async () => ({ kind: 'stopped' }) }) } });
  t.after(async () => {
    await act(async () => root.unmount());
    chat.dispose();
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  return { window, element, root, chat, act, createElement, AmbientChat };
}

/** Renders the bar with the given storage props, moves it one step up with the grip's arrow key, and returns the storage contents. */
async function moveOnce(t, props) {
  const { window, element, root, chat, act, createElement, AmbientChat } = await harness(t);
  const key = 'test.ambient.position';
  await act(async () => root.render(createElement(AmbientChat, { controller: chat, storageKey: key, ...props })));
  const grip = element.querySelector('[data-testid="ambient-grip"]');
  assert.ok(grip, 'the bar shows its grip');
  await act(async () => { grip.focus(); grip.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });
  const read = storage => storage.getItem(key);
  return { key, local: read(window.localStorage), session: read(window.sessionStorage) };
}

test('ambient bar remembers its position in localStorage with storage="local"', async t => {
  const { key, local, session } = await moveOnce(t, { storage: 'local' });
  assert.ok(local, 'the position is written to localStorage');
  assert.deepEqual(JSON.parse(local), { right: 16, bottom: 32 });
  assert.equal(session, null, 'nothing is written to sessionStorage');
  assert.ok(key);
});

test('ambient bar keeps the sessionStorage default when storage is omitted', async t => {
  const { local, session } = await moveOnce(t, {});
  assert.ok(session, 'the position is written to sessionStorage by default');
  assert.deepEqual(JSON.parse(session), { right: 16, bottom: 32 });
  assert.equal(local, null, 'nothing is written to localStorage by default');
});

/** Presses an arrow key on the grip, the same write path a drag uses. */
async function press(window, act, element, key) {
  const grip = element.querySelector('[data-testid="ambient-grip"]');
  assert.ok(grip, 'the bar shows its grip');
  await act(async () => { grip.focus(); grip.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true })); });
}

test('ambient bar restores a position saved in localStorage with storage="local"', async t => {
  const { window, element, root, chat, act, createElement, AmbientChat } = await harness(t);
  const key = 'test.ambient.position';
  window.localStorage.setItem(key, JSON.stringify({ right: 100, bottom: 200 }));
  await act(async () => root.render(createElement(AmbientChat, { controller: chat, storageKey: key, storage: 'local' })));
  // One step up from the restored corner: the write proves the restored origin (100, 200) was used.
  await press(window, act, element, 'ArrowUp');
  assert.deepEqual(JSON.parse(window.localStorage.getItem(key)), { right: 100, bottom: 216 });
  assert.equal(window.sessionStorage.getItem(key), null, 'the restored position is not read from sessionStorage');
});

test('ambient bar follows a storage prop change after mount for the next move', async t => {
  const { window, element, root, chat, act, createElement, AmbientChat } = await harness(t);
  const key = 'test.ambient.position';
  await act(async () => root.render(createElement(AmbientChat, { controller: chat, storageKey: key, storage: 'local' })));
  await press(window, act, element, 'ArrowUp');
  const afterLocal = JSON.parse(window.localStorage.getItem(key));
  assert.deepEqual(afterLocal, { right: 16, bottom: 32 });
  // Switch to sessionStorage while mounted: the next move writes there and leaves localStorage as it was.
  await act(async () => root.render(createElement(AmbientChat, { controller: chat, storageKey: key, storage: 'session' })));
  await press(window, act, element, 'ArrowUp');
  assert.deepEqual(JSON.parse(window.sessionStorage.getItem(key)), { right: 16, bottom: 48 });
  assert.deepEqual(JSON.parse(window.localStorage.getItem(key)), afterLocal, 'localStorage is not written after the switch');
});
