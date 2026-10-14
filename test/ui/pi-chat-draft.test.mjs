// The composer draft kept per conversation (registry/pi-chat/use-chat-draft.ts) in happy-dom, over a fake native chat controller:
// a draft survives a remount, two tabs sync through the storage event, storage that throws leaves the composer working, and a send clears it.
// Fictional text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT',
  'addEventListener', 'removeEventListener', 'localStorage', 'StorageEvent'];

/** A fake controller with the three things the hook uses: the draft snapshot, `setText` and `subscribe`; `send` empties the draft like the native one. */
function fakeController(initial = '') {
  let draft = { text: initial, attachments: [], version: 0 }, disposed = false;
  const listeners = new Set();
  const publish = () => { for (const listener of listeners) listener(); };
  return {
    getSnapshot: () => ({ draft, disposed }),
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    setText: text => { draft = { text, attachments: [], version: draft.version + 1 }; publish(); },
    send: () => { draft = { text: '', attachments: [], version: draft.version + 1 }; publish(); },
  };
}

test('the composer draft is kept per conversation: restored after a remount, synced across tabs, cleared by a send, and never blocked by storage', async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const setGlobal = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  for (const name of names) {
    if (name === 'localStorage') continue;
    const value = name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    setGlobal(name, typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value);
  }
  let storageBroken = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { if (storageBroken) throw new DOMException('Blocked', 'SecurityError'); return window.localStorage; } });

  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/pi-chat-draft-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('use-chat-draft.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-chat/use-chat-draft.ts', import.meta.url).pathname], outfile: output.pathname, bundle: true,
    format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const { useChatDraft } = await import(output.href);

  const element = window.document.createElement('div'); window.document.body.append(element);
  const mounted = [];
  // Mounts the hook for one controller (a tab or a remount); returns the root to unmount it.
  const mount = async (controller, key) => {
    const host = window.document.createElement('div'); element.append(host); const root = createRoot(host);
    const Probe = () => { useChatDraft(controller, key); return null; };
    await act(async () => root.render(createElement(Probe)));
    mounted.push(root);
    return root;
  };
  t.after(async () => {
    for (const root of mounted) await act(async () => { try { root.unmount(); } catch { /* already unmounted by the test */ } });
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  // A storage event as another tab delivers it (happy-dom does not fan it out to this window's listeners by itself).
  const storageEvent = key => window.dispatchEvent(new window.StorageEvent('storage', { key, newValue: window.localStorage.getItem(key) }));
  const stored = key => window.localStorage.getItem(key);
  const KEY = 'pi-chat:draft:conversation-one';

  await t.test('a half-typed message survives a reload (a remount with a fresh controller) for the same conversation only', async () => {
    const first = fakeController(), root = await mount(first, 'conversation-one');
    first.setText('Half typed about the quarterly plan');
    assert.equal(stored(KEY), 'Half typed about the quarterly plan');
    await act(async () => root.unmount());

    const reloaded = fakeController();
    await mount(reloaded, 'conversation-one');
    assert.equal(reloaded.getSnapshot().draft.text, 'Half typed about the quarterly plan');

    const other = fakeController();
    await mount(other, 'conversation-two');
    assert.equal(other.getSnapshot().draft.text, '', 'another conversation keeps its own draft');
  });

  await t.test('two tabs on one conversation show the same draft through the storage event, in both directions', async () => {
    window.localStorage.clear();
    const tabA = fakeController(), tabB = fakeController();
    await mount(tabA, 'shared');
    await mount(tabB, 'shared');
    tabA.setText('typed in tab A');
    storageEvent(PREFIX_KEY('shared'));
    assert.equal(tabB.getSnapshot().draft.text, 'typed in tab A');
    tabB.setText('answered in tab B');
    storageEvent(PREFIX_KEY('shared'));
    assert.equal(tabA.getSnapshot().draft.text, 'answered in tab B');
    // An event for another conversation's key leaves this draft alone.
    storageEvent(PREFIX_KEY('elsewhere'));
    assert.equal(tabA.getSnapshot().draft.text, 'answered in tab B');
  });

  await t.test('a send clears the stored draft, so a reload starts empty', async () => {
    window.localStorage.clear();
    const controller = fakeController(), root = await mount(controller, 'sent');
    controller.setText('a message to send');
    assert.equal(stored(PREFIX_KEY('sent')), 'a message to send');
    controller.send();
    assert.equal(stored(PREFIX_KEY('sent')), null, 'the stored draft is removed when the composer empties');
    await act(async () => root.unmount());
    const reloaded = fakeController();
    await mount(reloaded, 'sent');
    assert.equal(reloaded.getSnapshot().draft.text, '');
  });

  await t.test('storage that throws leaves the composer working: typing, sending and remounting do not throw', async () => {
    window.localStorage.clear();
    storageBroken = true;
    try {
      const controller = fakeController(), root = await mount(controller, 'blocked');
      controller.setText('typed while storage is blocked');
      assert.equal(controller.getSnapshot().draft.text, 'typed while storage is blocked');
      storageEvent(PREFIX_KEY('blocked'));
      controller.send();
      assert.equal(controller.getSnapshot().draft.text, '');
      await act(async () => root.unmount());
      const reloaded = fakeController('kept');
      await mount(reloaded, 'blocked');
      assert.equal(reloaded.getSnapshot().draft.text, 'kept', 'no restore is attempted, the controller keeps its own draft');
    } finally { storageBroken = false; }
  });

  await t.test('without a key nothing is stored', async () => {
    window.localStorage.clear();
    const controller = fakeController();
    await mount(controller, undefined);
    controller.setText('not kept');
    assert.equal(window.localStorage.length, 0);
  });
});

const PREFIX_KEY = key => 'pi-chat:draft:' + key;
