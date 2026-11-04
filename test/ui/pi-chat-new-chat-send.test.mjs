// A message sent right after New chat never goes to the conversation being left (D-1499): the real PiChat over the real
// useConversationsClient, with the create call and the list reload held open. Fictional text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const held = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const LIST = { conversations: [{ id: 'old', title: 'Ancienne', lastMessage: null, updatedAt: 1, archived: false }] };

test('a message sent right after New chat does not reach the conversation being left', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act, useState } = await import('react'); const { createRoot } = await import('react-dom/client');
  const { useConversationsClient } = await import('@hachej/boring-ui-kit/chat-react');
  const out = new URL('../../.cache/pi-chat-new-chat-send/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('chat.mjs', out);
  await build({ stdin: { contents: `export { PiChat } from './pi-chat/pi-chat.tsx';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'ts' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { PiChat } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });

  const chat = (id, text) => {
    const sends = [];
    const snapshot = { identity: {}, conversationId: id, connection: { kind: 'connected' }, view: { entries: [], docs: {} }, draft: { text, attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    return { sends, controller: new Proxy({
      getSnapshot: () => snapshot, subscribe: () => () => {}, setText: () => {}, setAttachments: () => {},
      send: async (kind, content) => { sends.push({ kind, content }); return { id: 'fictional-submission' }; },
    }, { get: (target, key) => key in target ? target[key] : async () => {} }) };
  };

  // What the host does: one chat per selected conversation, keyed by it, with the client's `conversations`.
  const open = async (createReply, reloadHeld) => {
    const chats = { old: chat('old', 'Bonjour'), new: chat('new', '') };
    let client, selected = 'old', creating = false;
    const fetch = async request => {
      if (request.method !== 'POST') { if (creating) await reloadHeld?.promise; return Response.json(LIST); }
      creating = true;
      return createReply.promise;
    };
    const Host = () => {
      const [id, setId] = useState('old');
      selected = id;
      client = useConversationsClient({ endpoint: 'https://fictional.invalid/conversations', fetch, activeId: id, onSelect: setId, pollMs: 1000000 });
      return client ? createElement(PiChat, { key: id, controller: chats[id].controller, header: false, conversations: client }) : null;
    };
    await act(async () => root.render(createElement(Host, { key: Math.random() })));
    return { chats, onNew: () => act(async () => { client.onNew(); }), selected: () => selected };
  };
  const input = () => element.querySelector('[data-testid=composer-input]');
  const submit = () => act(async () => { element.querySelector('[data-testid=composer]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });

  await t.test('while the create call is out, the old conversation takes no message', async () => {
    const reply = held();
    const page = await open(reply);
    assert.equal(input()?.disabled, false, 'the composer works before New chat');
    await page.onNew();
    assert.equal(input()?.disabled, true, 'the composer waits for the new conversation');
    await submit();
    assert.equal(page.chats.old.sends.length, 0, 'nothing went to the conversation being left');
    await act(async () => { reply.resolve(Response.json({ conversationId: 'new' })); });
    assert.equal(page.selected(), 'new');
    assert.equal(input()?.disabled, false, 'the new conversation takes messages');
  });

  await t.test('the new conversation opens without waiting for the list to reload', async () => {
    const reply = held(), reload = held();
    const page = await open(reply, reload);
    await page.onNew();
    await act(async () => { reply.resolve(Response.json({ conversationId: 'new' })); });
    assert.equal(page.selected(), 'new');
    assert.equal(input()?.disabled, false, 'it takes messages at once');
    await act(async () => { reload.resolve(); });
  });

  await t.test('a refused create gives the composer back, on the same conversation', async () => {
    const reply = held();
    const page = await open(reply);
    await page.onNew();
    await act(async () => { reply.resolve(new Response('refused', { status: 500 })); });
    assert.equal(page.selected(), 'old');
    assert.equal(input()?.disabled, false, 'the old conversation still takes messages');
    await submit();
    assert.equal(page.chats.old.sends.length, 1, 'and its message goes out');
  });
});
