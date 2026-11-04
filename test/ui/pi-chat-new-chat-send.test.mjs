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
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'matchMedia', 'sessionStorage', 'localStorage', 'location', 'IS_REACT_ACT_ENVIRONMENT'];
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

  const chat = (id, text, docs = {}) => {
    const sends = [], typed = [], stops = [];
    const snapshot = { identity: {}, conversationId: id, connection: { kind: 'connected' }, view: { entries: [], docs }, draft: { text, attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    return { sends, typed, stops, controller: new Proxy({
      getSnapshot: () => snapshot, subscribe: () => () => {}, setText: value => { typed.push(value); }, setAttachments: () => {},
      send: async (kind, content) => { sends.push({ kind, content }); return { id: 'fictional-submission' }; },
      stop: async () => { stops.push('stop'); },
    }, { get: (target, key) => key in target ? target[key] : async () => {} }) };
  };

  let drawn = 0;
  const open = async ({ create = held(), reload, change, oldText = 'Bonjour', Chat = PiChat, chatProps = {}, options = {}, oldDocs, selectLag = 0, newText = 'Salut', controllerLag = 0 } = {}) => {
    const chats = { old: chat('old', oldText, oldDocs), new: chat('new', newText), other: chat('other', '') };
    const page = { chats, creates: 0, deletes: [], create, selected: 'old', endpoint: undefined };
    let listed = ['old'];
    page.list = ids => { listed = ids; };
    const fetch = async request => {
      if (request.url.includes('op=delete')) { const { conversationId } = await request.json(); page.deletes.push(conversationId); listed = listed.filter(id => id !== conversationId); return Response.json({ deleted: true }); }
      if (request.method === 'POST') { page.creates += 1; const reply = await page.create.promise; if (reply.ok) listed = ['old', 'new']; return reply; }
      if (request.url.includes('/two')) return Response.json({ conversations: [row('other')] });
      // One poll is asked before the create and answers late; the first read after the create is the client's reload, and later polls stay out.
      if (page.lagging) {
        if (!page.lagging.asked) { page.lagging.asked = true; const rows = listed; await page.lagging.promise; return Response.json({ conversations: rows.map(row) }); }
        if (listed.length === 1 || page.lagging.reloaded) return new Promise(() => {});
        page.lagging.reloaded = true;
      }
      if (listed.length > 1) await reload?.promise;
      if (page.holdAfter !== undefined && page.holdAfter-- === 0) await page.listHold.promise;
      return Response.json({ conversations: listed.map(id => ({ ...row(id), lastMessage: page.said?.[id] ?? null })) });
    };
    const Host = () => {
      const [id, setId] = useState('old');
      const [endpoint, setEndpoint] = useState('https://fictional.invalid/one');
      const [mount, setMount] = useState(0);
      // A host can change its active conversation before its controller catches up.
      const [shown, setShown] = useState('old');
      useEffect(() => { if (!controllerLag) return undefined; const timer = setTimeout(() => setShown(id), controllerLag); return () => clearTimeout(timer); }, [id]);
      page.remount = () => setMount(value => value + 1);
      page.endpoint = setEndpoint;
      page.go = setId;
      page.selected = id;
      page.client = useConversationsClient({ endpoint, fetch, activeId: id, onSelect: selected => { if (selectLag) setTimeout(() => setId(selected), selectLag); else setId(selected); }, pollMs: 1000000, ...(change ? { onChange: () => change.promise } : {}), ...options });
      // As the example apps do: a selection the list does not hold yet goes back to the first row.
      const items = page.client?.items;
      useEffect(() => { if (items?.length && !items.some(item => item.id === id)) setId(items[0].id); }, [items, id]);
      return page.client ? createElement(Chat, { key: `${id}:${mount}`, controller: chats[controllerLag ? shown : id].controller, header: false, conversations: page.client, ...chatProps }) : null;
    };
    page.rebuild = () => act(async () => root.render(createElement(Host, { key: drawn++ })));
    await page.rebuild();
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
    assert.equal(page.client.items.map(item => item.id).join(), 'other', 'the first list\'s late reload does not replace the new owner\'s list');
    assert.equal(page.selected, 'other');
  });

  await t.test('a suggestion picked while leaving is not written into the old draft', async () => {
    const page = await open({ oldText: '', chatProps: { suggestions: [{ label: 'Une idée', text: 'Une idée fictive' }] } });
    await page.onNew();
    await act(async () => { element.querySelector('[data-testid=suggestion]').click(); });
    assert.equal(page.chats.old.typed.length, 0);
    await settle(() => page.create.resolve(answer()));
  });

  await t.test('a poll asked before the create and answering after the reload does not take the new conversation back', async () => {
    const change = held();
    const page = await open({ change, options: { pollMs: 5 } });
    page.lagging = held();
    await act(async () => { await new Promise(done => setTimeout(done, 30)); });
    assert.equal(page.lagging.asked, true, 'the poll is out');
    await page.onNew();
    await settle(() => page.create.resolve(answer()));
    await settle(() => page.lagging.resolve());
    await settle(() => change.resolve());
    assert.equal(page.selected, 'new', 'it did not fall back to the old conversation');
    await submit();
    assert.equal(page.chats.new.sends.length, 1, 'the message goes to the new conversation');
    assert.equal(page.chats.old.sends.length, 0);
  });

  for (const [name, Chat, chatProps] of [['PiChat', PiChat, {}], ['AmbientChat', AmbientChat, { defaultState: 'expanded' }]]) {
    await t.test(`${name}: a running reply can still be stopped while leaving`, async () => {
      const page = await open({ Chat, chatProps, oldDocs: { 'pi.live': { run: { taskId: 1 } } } });
      await page.onNew();
      assert.equal(enabled(), false, 'the composer waits for the new conversation');
      const stop = element.querySelector('[data-testid=composer-submit]');
      assert.equal(stop.getAttribute('data-state'), 'stop');
      assert.equal(stop.disabled, false, 'Stop stays available');
      await act(async () => { stop.click(); });
      assert.equal(page.chats.old.stops.length, 1, 'the reply is stopped');
      await submit();
      assert.equal(page.chats.old.sends.length, 0, 'and nothing was queued on the old conversation');
      await settle(() => page.create.resolve(answer()));
    });
  }

  // D-1501: the New chat button keeps the focus otherwise, so typing goes nowhere and Space makes another conversation.
  for (const [name, Chat, chatProps] of [['PiChat', PiChat, {}], ['AmbientChat', AmbientChat, { defaultState: 'expanded' }]]) {
    await t.test(`${name}: the cursor is in the new conversation's box once it opens`, async () => {
      const page = await open({ Chat, chatProps });
      const button = document.createElement('button'); document.body.append(button); button.focus();
      await page.onNew();
      await settle(() => page.create.resolve(answer()));
      assert.equal(page.selected, 'new');
      assert.equal(document.activeElement === input(), true, 'the person can type at once');
      button.remove();
    });
  }

  await t.test('a field the person moved to keeps the cursor', async () => {
    const page = await open();
    const field = document.createElement('input'); document.body.append(field);
    await page.onNew();
    field.focus();
    await settle(() => page.create.resolve(answer()));
    assert.equal(page.selected, 'new');
    assert.equal(document.activeElement === field, true);
    field.remove();
  });

  await t.test('a refused create leaves the focus off the button, where a Space would press New again', async () => {
    const page = await open();
    const button = document.createElement('button'); document.body.append(button); button.focus();
    await page.onNew();
    await settle(() => page.create.resolve(new Response('no', { status: 500 })));
    assert.equal(page.selected, 'old');
    assert.equal(document.activeElement === button, false);
    button.remove();
  });

  await t.test('a later remount of the new conversation does not take the cursor again', async () => {
    const page = await open();
    await page.onNew();
    await settle(() => page.create.resolve(answer()));
    const button = document.createElement('button'); document.body.append(button); button.focus();
    await settle(() => page.remount());
    assert.equal(document.activeElement === button, true);
    button.remove();
  });

  await t.test('the New button lets go of the focus, so a key typed then cannot press it again', async () => {
    const page = await open();
    const button = document.createElement('button'); document.body.append(button);
    button.addEventListener('click', () => page.client.onNew());
    button.focus();
    await act(async () => { button.click(); });
    assert.equal(document.activeElement === button, false, 'while the conversation is on its way');
    await settle(() => page.create.resolve(answer()));
    assert.equal(document.activeElement === input(), true);
    button.remove();
  });

  await t.test('a refused create leaves a field the person moved to alone', async () => {
    const page = await open();
    const button = document.createElement('button'); document.body.append(button); button.focus();
    const field = document.createElement('input'); document.body.append(field);
    await page.onNew();
    field.focus();
    await settle(() => page.create.resolve(new Response('no', { status: 500 })));
    assert.equal(document.activeElement === field, true);
    button.remove(); field.remove();
  });

  await t.test('the cursor still arrives when the host opens the conversation late', async () => {
    const page = await open({ selectLag: 1200 });
    await page.onNew();
    await settle(() => page.create.resolve(answer()));
    await act(async () => { await new Promise(done => setTimeout(done, 1300)); });
    assert.equal(page.selected, 'new');
    assert.equal(document.activeElement === input(), true);
  });

  await t.test('New works at once after a conversation opens', async () => {
    const page = await open();
    await page.onNew();
    await settle(() => page.create.resolve(answer()));
    assert.equal(page.selected, 'new');
    await page.onNew();
    await settle();
    assert.equal(page.creates, 2);
  });

  await t.test('coming back to a conversation made earlier does not take the cursor again', async () => {
    const page = await open();
    await page.onNew();
    await settle(() => page.create.resolve(answer()));
    await settle(() => page.client.onSelect('old'));
    const button = document.createElement('button'); document.body.append(button); button.focus();
    await settle(() => page.client.onSelect('new'));
    assert.equal(page.selected, 'new');
    assert.equal(document.activeElement === button, true);
    button.remove();
  });

  // D-1529: the box is held then, so the start of the message was lost and the rest could be sent as if whole.
  const pressNew = async page => {
    const button = document.createElement('button'); document.body.append(button);
    button.addEventListener('click', () => page.client.onNew());
    button.focus();
    await act(async () => { button.click(); });
    return button;
  };
  const noHeldField = () => document.querySelector('[data-testid=new-chat-typing]') === null;

  for (const [name, Chat, chatProps] of [['PiChat', PiChat, {}], ['AmbientChat', AmbientChat, { defaultState: 'expanded' }]]) {
    await t.test(`${name}: what is typed as the conversation opens lands whole in its box`, async () => {
      const page = await open({ Chat, chatProps, newText: '' });
      const button = await pressNew(page);
      assert.equal(document.activeElement === input(), false, 'the old box takes nothing');
      document.activeElement.value = 'first ok';
      await settle(() => page.create.resolve(answer()));
      assert.equal(page.selected, 'new');
      assert.equal(page.chats.new.typed.at(-1), 'first ok');
      assert.equal(page.chats.old.typed.length, 0, 'the draft being left is untouched');
      assert.equal(page.chats.new.sends.length + page.chats.old.sends.length, 0, 'nothing is sent by typing');
      assert.equal(page.creates, 1);
      assert.equal(document.activeElement === input(), true);
      assert.equal(noHeldField(), true);
      button.remove();
    });
  }

  // D-1564: a dead key still open when the box comes back. The browser shows it in the field, then the keyboard commits the letter to whatever has the focus.
  const compose = (field, name) => act(async () => { field.dispatchEvent(new window.Event(name, { bubbles: true })); await new Promise(done => setTimeout(done, 0)); });
  const heldField = () => document.querySelector('[data-testid=new-chat-typing]');

  for (const [name, Chat, chatProps] of [['PiChat', PiChat, {}], ['AmbientChat', AmbientChat, { defaultState: 'expanded' }]]) {
    await t.test(`${name}: a dead key open as the conversation opens finishes in the field, then lands whole, with no stray accent`, async () => {
      const page = await open({ Chat, chatProps, newText: '' });
      const button = await pressNew(page);
      const field = document.activeElement;
      field.value = 'abcdefgh';
      await compose(field, 'compositionstart');
      field.value = 'abcdefgh^';
      await settle(() => page.create.resolve(answer()));
      assert.equal(page.selected, 'new');
      assert.equal(page.chats.new.typed.length, 0, 'an open accent is not handed over');
      assert.equal(document.activeElement === field, true, 'the next letter must still reach the field');
      field.value = 'abcdefghê';
      await compose(field, 'compositionend');
      assert.deepEqual(page.chats.new.typed, ['abcdefghê']);
      assert.equal(page.chats.old.typed.length, 0, 'the draft being left is untouched');
      assert.equal(document.activeElement === input(), true);
      assert.equal(noHeldField(), true);
      assert.equal(page.creates, 1);
      button.remove();
    });
  }

  for (const [keys, committed] of [['^ then ^', '^^'], ['^ then z', '^z'], ['^ then Space', '^ '], ['^ then Backspace', 'ab']]) {
    await t.test(`${keys}: what the browser commits is what lands`, async () => {
      const page = await open({ newText: '' });
      const button = await pressNew(page);
      const field = document.activeElement;
      field.value = 'ab';
      await compose(field, 'compositionstart');
      field.value = 'ab^';
      await settle(() => page.create.resolve(answer()));
      field.value = keys === '^ then Backspace' ? committed : `ab${committed}`;
      await compose(field, 'compositionend');
      assert.deepEqual(page.chats.new.typed, [keys === '^ then Backspace' ? committed : `ab${committed}`]);
      button.remove();
    });
  }

  await t.test('a dead key held across the hold still composes in the field', async () => {
    const page = await open({ newText: '' });
    const button = await pressNew(page);
    const field = document.activeElement;
    field.value = 't';
    await compose(field, 'compositionstart');
    field.value = 't^';
    field.value = 'tê';
    await compose(field, 'compositionend');
    field.value = 'tête';
    await settle(() => page.create.resolve(answer()));
    assert.deepEqual(page.chats.new.typed, ['tête']);
    button.remove();
  });

  await t.test('an accent left open past the three seconds is still handed over when it ends', { timeout: 6000 }, async () => {
    const page = await open({ newText: '' });
    const button = await pressNew(page);
    const field = document.activeElement;
    await compose(field, 'compositionstart');
    field.value = 'ab^';
    await settle(() => page.create.resolve(answer()));
    await act(async () => { await new Promise(done => setTimeout(done, 3100)); });
    assert.equal(heldField() === field, true, 'what was typed is still there');
    field.value = 'abê';
    await compose(field, 'compositionend');
    assert.deepEqual(page.chats.new.typed, ['abê']);
    assert.equal(noHeldField(), true);
    button.remove();
  });

  await t.test('moving to another field with an accent open hands the text over and leaves the focus there', async () => {
    const page = await open({ newText: '' });
    const button = await pressNew(page);
    const field = document.activeElement;
    field.value = 'ab';
    await compose(field, 'compositionstart');
    await settle(() => page.create.resolve(answer()));
    assert.equal(page.chats.new.typed.length, 0);
    const other = document.createElement('input'); document.body.append(other);
    await settle(() => other.focus());
    assert.deepEqual(page.chats.new.typed, ['ab']);
    assert.equal(document.activeElement === other, true);
    assert.equal(noHeldField(), true);
    other.remove(); button.remove();
  });

  await t.test('picking another conversation with an accent open leaves no field, and the draft untouched', async () => {
    const page = await open({ newText: '' });
    const button = await pressNew(page);
    const field = document.activeElement;
    field.value = 'ab^';
    await compose(field, 'compositionstart');
    await settle(() => page.create.resolve(answer()));
    await settle(() => page.client.onSelect('old'));
    assert.equal(noHeldField(), true);
    assert.equal(page.chats.old.typed.length, 0);
    assert.equal(page.chats.new.typed.length, 0);
    button.remove();
  });

  await t.test('a host whose controller comes after its active conversation: the text waits, and the old draft is untouched', async () => {
    const page = await open({ controllerLag: 100, newText: '' });
    const button = await pressNew(page);
    document.activeElement.value = 'first';
    await settle(() => page.create.resolve(answer()));
    assert.equal(page.selected, 'new');
    assert.equal(page.chats.old.typed.length, 0);
    await act(async () => { await new Promise(done => setTimeout(done, 200)); });
    assert.equal(page.chats.old.typed.length, 0);
    assert.equal(page.chats.new.typed.at(-1), 'first');
    assert.equal(document.activeElement === input(), true);
    button.remove();
  });

  await t.test('a second New keeps its typing past the first one\'s wait', async () => {
    const page = await open({ selectLag: 5000 });
    const button = await pressNew(page);
    await settle(() => page.create.resolve(answer()));
    await act(async () => { await new Promise(done => setTimeout(done, 1000)); });
    page.create = held();
    button.focus();
    await act(async () => { button.click(); });
    document.activeElement.value = 'second';
    await act(async () => { await new Promise(done => setTimeout(done, 2200)); });
    assert.equal(document.querySelector('[data-testid=new-chat-typing]')?.value, 'second');
    await settle(() => page.create.resolve(new Response('no', { status: 500 })));
    button.remove();
  });

  await t.test('a double click on New: what is typed after it still reaches the box', async () => {
    const page = await open({ newText: '' });
    const button = await pressNew(page);
    document.activeElement.value = 'first ';
    button.focus();
    await act(async () => { button.click(); });
    const typing = document.querySelector('[data-testid=new-chat-typing]');
    assert.equal(document.activeElement === typing, true, 'the keys still go to the hidden field');
    typing.value += 'second';
    await settle(() => page.create.resolve(answer()));
    assert.equal(page.chats.new.typed.at(-1), 'first second');
    assert.equal(page.creates, 1);
    button.remove();
  });

  await t.test('Enter typed as the conversation opens sends nothing', async () => {
    const page = await open();
    const button = await pressNew(page);
    const key = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(key);
    assert.equal(key.defaultPrevented, true);
    await settle(() => page.create.resolve(answer()));
    assert.equal(page.chats.old.sends.length + page.chats.new.sends.length, 0);
    button.remove();
  });

  await t.test('after a refused create the typed text is gone, and the old draft untouched', async () => {
    const page = await open();
    const button = await pressNew(page);
    document.activeElement.value = 'first';
    await settle(() => page.create.resolve(new Response('no', { status: 500 })));
    assert.equal(page.selected, 'old');
    assert.equal(page.chats.old.typed.length, 0);
    assert.equal(noHeldField(), true);
    assert.equal(document.activeElement === button, false, 'a Space typed next must not press New again');
    button.remove();
  });

  const failed = () => element.querySelector('[data-testid=new-chat-failed]');
  const hasFailed = () => failed() !== null;
  const rest = () => act(async () => { await new Promise(done => setTimeout(done, 30)); });

  await t.test('a refused create says the conversation was not made, and that what was typed was not kept', async () => {
    const page = await open();
    const button = await pressNew(page);
    document.activeElement.value = 'first';
    assert.equal(hasFailed(), false, 'nothing is wrong yet');
    await settle(() => page.create.resolve(new Response('no', { status: 500 })));
    assert.equal(failed()?.getAttribute('role'), 'alert');
    assert.match(failed()?.textContent ?? '', /wasn't made/);
    assert.match(failed()?.textContent ?? '', /typed wasn't kept/);
    assert.equal(page.chats.old.typed.length, 0, 'the old draft is untouched');
    assert.equal(page.chats.old.sends.length, 0, 'nothing is sent');
    assert.equal(enabled(), true, 'the composer works again');
    button.remove();
  });

  await t.test('a refused create with nothing typed does not talk about typed text', async () => {
    const page = await open();
    await page.onNew();
    await settle(() => page.create.resolve(new Response('no', { status: 500 })));
    assert.match(failed()?.textContent ?? '', /wasn't made/);
    assert.doesNotMatch(failed()?.textContent ?? '', /typed/);
  });

  await t.test('a create answered without a conversation says so too', async () => {
    const page = await open();
    await page.onNew();
    await settle(() => page.create.resolve(Response.json({})));
    assert.match(failed()?.textContent ?? '', /wasn't made/);
  });

  await t.test('no answer in time says so, and the late answer leaves no empty row', async () => {
    const page = await open({ options: { openTimeoutMs: 20 } });
    const button = await pressNew(page);
    document.activeElement.value = 'first';
    await act(async () => { await new Promise(done => setTimeout(done, 60)); });
    assert.match(failed()?.textContent ?? '', /typed wasn't kept/);
    await settle(() => page.create.resolve(answer()));
    await rest();
    assert.equal(page.deletes.join(), 'new', 'the conversation the person was told does not exist is removed');
    assert.equal(page.client.items.map(item => item.id).join(), 'old');
    assert.equal(page.selected, 'old');
    assert.equal(page.creates, 1);
    assert.equal(page.chats.old.typed.length, 0);
    button.remove();
  });

  await t.test('a late answer for a conversation the person already opened leaves it', async () => {
    const page = await open({ options: { openTimeoutMs: 20 } });
    await page.onNew();
    await act(async () => { await new Promise(done => setTimeout(done, 60)); });
    page.list(['old', 'new']);
    await settle(() => page.client.reload());
    await settle(() => page.client.onSelect('new'));
    await settle(() => page.create.resolve(answer()));
    await rest();
    assert.equal(page.deletes.length, 0);
    assert.equal(page.selected, 'new');
  });

  await t.test('a late answer for a conversation the person opened and left leaves it', async () => {
    const page = await open({ options: { openTimeoutMs: 20 } });
    await page.onNew();
    await act(async () => { await new Promise(done => setTimeout(done, 60)); });
    page.list(['old', 'new']);
    await settle(() => page.client.reload());
    await settle(() => page.client.onSelect('new'));
    await settle(() => page.client.onSelect('old'));
    await settle(() => page.create.resolve(answer()));
    await rest();
    assert.equal(page.deletes.length, 0);
    assert.equal(page.client.items.map(item => item.id).join(), 'old,new');
  });

  await t.test('a conversation opened while the late answer checks the list stays', async () => {
    const page = await open({ options: { openTimeoutMs: 20 } });
    await page.onNew();
    await act(async () => { await new Promise(done => setTimeout(done, 60)); });
    page.listHold = held();
    page.holdAfter = 1; // The client's reload passes; its check of the row waits.
    await settle(() => page.create.resolve(answer()));
    await rest();
    await settle(() => page.client.onSelect('new'));
    await settle(() => page.listHold.resolve());
    await rest();
    assert.equal(page.deletes.length, 0);
    assert.equal(page.selected, 'new');
  });

  await t.test('a conversation opened after the chat was rebuilt stays when the late answer comes', async () => {
    const page = await open({ options: { openTimeoutMs: 20 } });
    await page.onNew();
    await act(async () => { await new Promise(done => setTimeout(done, 60)); });
    page.list(['old', 'new']); // The server has made it; its answer is still on the way.
    await page.rebuild();
    await rest();
    await settle(() => page.client.onSelect('new'));
    await settle(() => page.client.onSelect('old'));
    await settle(() => page.create.resolve(answer()));
    await rest();
    assert.equal(page.deletes.length, 0);
  });

  await t.test('a late answer for a conversation that has a message, from another tab, leaves it', async () => {
    const page = await open({ options: { openTimeoutMs: 20 } });
    await page.onNew();
    await act(async () => { await new Promise(done => setTimeout(done, 60)); });
    page.said = { new: 'a message from another tab' };
    await settle(() => page.create.resolve(answer()));
    await rest();
    assert.equal(page.deletes.length, 0);
    assert.equal(page.client.items.map(item => item.id).join(), 'old,new');
  });

  await t.test('a host refresh that fails after a create that worked still opens it, with no message', async () => {
    const change = {};
    change.promise = new Promise((_, refuse) => { change.refuse = refuse; });
    change.promise.catch(() => {});
    const page = await open({ change });
    await page.onNew();
    await settle(() => page.create.resolve(answer()));
    await settle(() => change.refuse(new Error('the host could not refresh')));
    await rest();
    assert.equal(hasFailed(), false, 'the conversation was made');
    assert.equal(page.selected, 'new');
    assert.equal(page.deletes.length, 0);
  });

  await t.test('picking a conversation during the hold says nothing, and its late answer leaves no empty row', async () => {
    const page = await open();
    await page.onNew();
    await settle(() => page.client.onSelect('old'));
    await settle(() => page.create.resolve(answer()));
    await rest();
    assert.equal(hasFailed(), false);
    assert.equal(page.deletes.join(), 'new');
  });

  await t.test('the message goes on the next New, a picked conversation, another conversation, or when closed', async () => {
    const refuse = async page => { page.create = held(); await page.onNew(); await settle(() => page.create.resolve(new Response('no', { status: 500 }))); assert.equal(hasFailed(), true); };
    const page = await open();
    await refuse(page);
    await settle(() => failed().querySelector('button').click());
    assert.equal(hasFailed(), false, 'closed');
    await refuse(page);
    await settle(() => page.client.onSelect('old'));
    assert.equal(hasFailed(), false, 'picked');
    await refuse(page);
    page.list(['old', 'new']);
    await settle(() => page.client.reload());
    await settle(() => page.go('new'));
    assert.equal(hasFailed(), false, 'the host moved to another conversation');
    await settle(() => page.go('old'));
    assert.equal(hasFailed(), true, 'it belongs to the conversation the person stayed in');
    page.create = held();
    await page.onNew();
    assert.equal(hasFailed(), false, 'a new try');
    await settle(() => page.create.resolve(answer()));
    assert.equal(page.selected, 'new');
    assert.equal(hasFailed(), false);
  });

  await t.test('a working New chat shows no message', async () => {
    const page = await open();
    await page.onNew();
    await settle(() => page.create.resolve(answer()));
    assert.equal(page.selected, 'new');
    assert.equal(hasFailed(), false);
    assert.equal(page.deletes.length, 0);
  });

  await t.test('the ambient chat shows the message too', async () => {
    const page = await open({ Chat: AmbientChat, chatProps: { defaultState: 'expanded' } });
    await page.onNew();
    await settle(() => page.create.resolve(new Response('no', { status: 500 })));
    assert.match(failed()?.textContent ?? '', /wasn't made/);
  });

  await t.test('another owner\'s list leaves the late conversation where it is, with no message', async () => {
    const page = await open();
    await page.onNew();
    await settle(() => page.endpoint('https://fictional.invalid/two'));
    await settle(() => page.create.resolve(answer()));
    await rest();
    assert.equal(hasFailed(), false);
    assert.equal(page.deletes.length, 0);
  });

  await t.test('picking the old conversation during the hold leaves its draft untouched', async () => {
    const page = await open();
    const button = await pressNew(page);
    document.activeElement.value = 'first';
    await settle(() => page.client.onSelect('old'));
    await settle(() => page.create.resolve(answer()));
    assert.equal(page.chats.old.typed.length, 0);
    assert.equal(noHeldField(), true);
    button.remove();
  });

  await t.test('a person who moved to another field keeps it, and what came before reaches the box', async () => {
    const page = await open({ newText: '' });
    const button = await pressNew(page);
    document.activeElement.value = 'first';
    const field = document.createElement('input'); document.body.append(field); field.focus();
    await settle(() => page.create.resolve(answer()));
    assert.equal(page.chats.new.typed.at(-1), 'first');
    assert.equal(document.activeElement === field, true);
    button.remove(); field.remove();
  });

  await t.test('a phone gets no hidden field, so no keyboard opens unasked', async () => {
    const stock = globalThis.matchMedia;
    globalThis.matchMedia = query => ({ matches: query.includes('coarse'), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    try {
      const page = await open();
      const button = await pressNew(page);
      assert.equal(document.activeElement === button, false, 'Space cannot press New again');
      assert.equal(noHeldField(), true);
      assert.equal(document.activeElement?.tagName === 'TEXTAREA', false);
      await settle(() => page.create.resolve(answer()));
      assert.equal(document.activeElement === input(), false);
      button.remove();
    } finally { globalThis.matchMedia = stock; }
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
