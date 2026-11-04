// A message sent right after New chat never goes to the conversation being left (D-1499): the real PiChat and AmbientChat over the real
// useConversationsClient, in a host that opens a conversation only once it is listed, as the example apps and Studio do. Fictional text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const held = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const row = id => ({ id, title: id, lastMessage: null, updatedAt: 1, archived: false });
const answer = () => Response.json({ conversationId: 'new' });

test('a message sent right after New chat does not reach the conversation being left', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act, useEffect, useState } = await import('react'); const { createRoot } = await import('react-dom/client');
  const { useConversationsClient } = await import('@hachej/boring-ui-kit/chat-react');
  const out = new URL('../../.cache/pi-chat-new-chat-send/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('chat.mjs', out);
  await build({ stdin: { contents: `export { PiChat } from './pi-chat/pi-chat.tsx'; export { AmbientChat } from './pi-ambient/ambient.tsx';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'ts' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { PiChat, AmbientChat } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });

  const chat = (id, text) => {
    const sends = [], typed = [];
    const snapshot = { identity: {}, conversationId: id, connection: { kind: 'connected' }, view: { entries: [], docs: {} }, draft: { text, attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    return { sends, typed, controller: new Proxy({
      getSnapshot: () => snapshot, subscribe: () => () => {}, setText: value => { typed.push(value); }, setAttachments: () => {},
      send: async (kind, content) => { sends.push({ kind, content }); return { id: 'fictional-submission' }; },
    }, { get: (target, key) => key in target ? target[key] : async () => {} }) };
  };

  let drawn = 0;
  const open = async ({ create = held(), reload, change, oldText = 'Bonjour', Chat = PiChat, chatProps = {}, options = {} } = {}) => {
    const chats = { old: chat('old', oldText), new: chat('new', 'Salut') };
    const page = { chats, creates: 0, create, selected: 'old', endpoint: undefined };
    let listed = ['old'];
    const fetch = async request => {
      if (request.method === 'POST') { page.creates += 1; const reply = await create.promise; if (reply.ok) listed = ['old', 'new']; return reply; }
      if (listed.length > 1) await reload?.promise;
      return Response.json({ conversations: listed.map(row) });
    };
    const Host = () => {
      const [id, setId] = useState('old');
      const [endpoint, setEndpoint] = useState('https://fictional.invalid/one');
      page.endpoint = setEndpoint;
      page.selected = id;
      page.client = useConversationsClient({ endpoint, fetch, activeId: id, onSelect: setId, pollMs: 1000000, ...(change ? { onChange: () => change.promise } : {}), ...options });
      // As the example apps do: a selection the list does not hold yet goes back to the first row.
      const items = page.client?.items;
      useEffect(() => { if (items?.length && !items.some(item => item.id === id)) setId(items[0].id); }, [items, id]);
      return page.client ? createElement(Chat, { key: id, controller: chats[id].controller, header: false, conversations: page.client, ...chatProps }) : null;
    };
    await act(async () => root.render(createElement(Host, { key: drawn++ })));
    page.onNew = () => act(async () => { page.client.onNew(); });
    return page;
  };
  const input = () => element.querySelector('[data-testid=composer-input]');
  const enabled = () => input()?.disabled === false;
  const submit = () => act(async () => { element.querySelector('[data-testid=composer]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  const settle = (fn = () => {}) => act(async () => { fn(); await new Promise(done => setTimeout(done, 0)); });

  await t.test('while the create call is out, the old conversation takes no message', async () => {
    const page = await open();
    assert.equal(enabled(), true, 'the composer works before New chat');
    await page.onNew();
    assert.equal(enabled(), false, 'the composer waits for the new conversation');
    await submit();
    assert.equal(page.chats.old.sends.length, 0, 'nothing went to the conversation being left');
    await settle(() => page.create.resolve(answer()));
    assert.equal(page.selected, 'new');
    assert.equal(enabled(), true, 'the new conversation takes messages');
    await submit();
    assert.equal(page.chats.new.sends.length, 1, 'the message goes to the new conversation');
    assert.equal(page.chats.old.sends.length, 0, 'and not to the old one');
  });

  await t.test('a host that needs the row listed stays on the new conversation, with the list slow', async () => {
    const reload = held();
    const page = await open({ reload });
    await page.onNew();
    await settle(() => page.create.resolve(answer()));
    assert.equal(enabled(), false, 'still leaving while the list reloads');
    await submit();
    assert.equal(page.chats.old.sends.length, 0, 'nothing went to the old conversation');
    await settle(() => reload.resolve());
    assert.equal(page.selected, 'new', 'it did not fall back to the old conversation');
    await submit();
    assert.equal(page.chats.new.sends.length, 1);
    assert.equal(page.chats.old.sends.length, 0);
  });

  await t.test('the composer waits for the host\'s own refresh too', async () => {
    const change = held();
    const page = await open({ change });
    await page.onNew();
    await settle(() => page.create.resolve(answer()));
    assert.equal(enabled(), false, 'still leaving while the host refreshes');
    await submit();
    assert.equal(page.chats.old.sends.length, 0);
    await settle(() => change.resolve());
    assert.equal(page.selected, 'new');
    assert.equal(enabled(), true);
  });

  await t.test('a second New while one is on its way makes no second conversation', async () => {
    const page = await open();
    await page.onNew();
    await page.onNew();
    assert.equal(page.creates, 1);
    await settle(() => page.create.resolve(answer()));
  });

  await t.test('a refused create gives the composer back, on the same conversation', async () => {
    const page = await open();
    await page.onNew();
    await settle(() => page.create.resolve(new Response('refused', { status: 500 })));
    assert.equal(page.selected, 'old');
    assert.equal(enabled(), true, 'the old conversation still takes messages');
    await submit();
    assert.equal(page.chats.old.sends.length, 1, 'and its message goes out');
  });

  await t.test('a create that never answers gives the composer back, and its late answer moves nothing', async () => {
    const page = await open({ options: { openTimeoutMs: 20 } });
    await page.onNew();
    assert.equal(enabled(), false);
    await act(async () => { await new Promise(done => setTimeout(done, 60)); });
    assert.equal(enabled(), true, 'the chat can send again');
    await settle(() => page.create.resolve(answer()));
    assert.equal(page.selected, 'old', 'a late answer does not take the person away');
  });

  await t.test('another list gives the composer back', async () => {
    const page = await open();
    await page.onNew();
    assert.equal(enabled(), false);
    await settle(() => page.endpoint('https://fictional.invalid/two'));
    assert.equal(enabled(), true);
    await settle(() => page.create.resolve(answer()));
  });

  await t.test('a suggestion picked while leaving is not written into the old draft', async () => {
    const page = await open({ oldText: '', chatProps: { suggestions: [{ label: 'Une idée', text: 'Une idée fictive' }] } });
    await page.onNew();
    await act(async () => { element.querySelector('[data-testid=suggestion]').click(); });
    assert.equal(page.chats.old.typed.length, 0);
    await settle(() => page.create.resolve(answer()));
  });

  await t.test('AmbientChat waits too', async () => {
    const page = await open({ Chat: AmbientChat, chatProps: { defaultState: 'expanded' } });
    assert.equal(enabled(), true, 'the composer works before New chat');
    await page.onNew();
    assert.equal(enabled(), false);
    await submit();
    assert.equal(page.chats.old.sends.length, 0);
    await settle(() => page.create.resolve(answer()));
  });
});
