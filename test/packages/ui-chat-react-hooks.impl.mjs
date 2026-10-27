import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import * as hooks from '@hachej/boring-ui-kit/chat-react';

const window = new Window({ url: 'https://fictional.invalid/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'localStorage']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, createElement: h, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
test.after(() => window.happyDOM.close());
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function mount(t, hook, initial) {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element); let api;
  const Probe = props => { api = hook(props); return h('p', null, api?.status ?? 'mounted'); };
  const render = props => act(async () => root.render(h(StrictMode, null, h(Probe, props))));
  await render(initial);
  t.after(async () => { await act(async () => root.unmount()); element.remove(); });
  return { get api() { return api; }, render, element };
}
function controller() {
  let snapshot = { view: { entries: [], docs: {} }, draft: { text: '', version: 0 }, disposed: false };
  const listeners = new Set();
  return { getSnapshot: () => snapshot, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, listeners,
    setText: text => { snapshot = { ...snapshot, draft: { text, version: snapshot.draft.version + 1 } }; for (const fn of listeners) fn(); },
    update: next => { snapshot = { ...snapshot, ...next }; for (const fn of listeners) fn(); } };
}

test('useChatView selects the existing snapshot, memoizes by view and selector and detaches only its subscription', async t => {
  const chat = controller(); let selections = 0;
  const select = view => { selections++; return { count: view?.entries.length ?? 0 }; };
  const page = await mount(t, p => hooks.useChatView(p.controller, p.select), { controller: chat, select });
  const first = page.api; const calls = selections;
  await act(async () => chat.setText('another draft'));
  assert.equal(page.api, first); assert.equal(selections, calls);
  assert.equal(chat.listeners.size, 1);
  await act(async () => chat.update({ view: { entries: [{}], docs: {} } }));
  assert.equal(page.api.count, 1);
  await page.render({ controller: chat, select: view => view.entries.length * 2 });
  assert.equal(page.api, 2);
  const other = controller(); await page.render({ controller: other, select });
  assert.equal(page.api.count, 0); assert.equal(chat.listeners.size, 0); assert.equal(other.listeners.size, 1);
  assert.equal(chat.getSnapshot().disposed, false);
});

test('per-conversation ownership fences late acquisition and connect, disposes once, and preserves concrete capabilities in StrictMode', async t => {
  const created = [], waiting = [];
  const create = () => { const gate = deferred(); const value = { custom: () => 'concrete', disposed: 0, dispose: async () => { value.disposed++; } }; created.push(value); waiting.push(gate); return gate.promise.then(() => value); };
  const page = await mount(t, p => hooks.useControllerPerConversation({ ...p, key: p.selection, create }), { selection: 'a' });
  assert.equal(waiting.length, 2, 'StrictMode owns two independent acquisitions');
  await act(async () => waiting[1].resolve());
  assert.equal(page.api.status, 'ready'); assert.equal(page.api.controller.custom(), 'concrete');
  await page.render({ selection: 'b' });
  assert.notEqual(page.api.status, 'ready');
  await act(async () => { waiting[0].resolve(); waiting[2].resolve(); });
  assert.deepEqual(created.map(c => c.disposed), [1, 1, 0]);
  await page.render({ selection: undefined });
  assert.equal(page.api.status, 'connecting'); assert.equal(created[2].disposed, 1);
});

test('per-conversation retries failed connect after asynchronous teardown and cancels its retry timer on switch', async t => {
  const created = []; let attempts = 0;
  const create = () => { const value = { disposed: 0, dispose: async () => { value.disposed++; } }; created.push(value); return value; };
  const page = await mount(t, p => hooks.useControllerPerConversation({ ...p, key: p.selection, create, connect: async () => { if (++attempts === 1) throw new Error('fictional offline'); }, retryMs: 15 }), { selection: undefined });
  await page.render({ selection: 'a' });
  assert.equal(page.api.status, 'offline'); assert.match(String(page.api.error), /fictional offline/);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  assert.equal(page.api.status, 'ready'); assert.equal(created[0].disposed, 1);
  await page.render({ selection: undefined });
  const count = attempts; await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(attempts, count);
});

test('transcript window reveals and resets without owning scroll, and row chunks keep stable runs after prepend', async t => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ key: String(i) }));
  const page = await mount(t, p => ({ window: hooks.useTranscriptWindow(p.rows, 60, 40), chunks: hooks.useRowChunks(p.rows, 20) }), { rows });
  assert.equal(page.api.window.hidden, 40); assert.equal(page.api.window.visible(rows).length, 60);
  const run = page.api.chunks[0];
  await act(async () => page.api.window.reveal());
  assert.equal(page.api.window.hidden, 0);
  await act(async () => page.api.window.reset()); assert.equal(page.api.window.hidden, 40);
  await act(async () => page.api.window.revealTo('0')); assert.equal(page.api.window.hidden, 0);
  await page.render({ rows: [{ key: 'earlier' }, ...rows] });
  assert.equal(page.api.chunks[1], run); assert.equal(page.api.chunks[0][0].key, 'earlier');
});

test('draft and placement public hooks preserve registration ownership, switch and clear semantics', async t => {
  const chat = controller(); localStorage.clear();
  const page = await mount(t, p => { hooks.useChatDraft(chat, p.id); hooks.useChatPlacement(chat, p.placement); }, { id: 'one', placement: 'docked' });
  await act(async () => chat.setText('fictional draft'));
  assert.equal(localStorage.getItem('pi-chat:draft:one'), 'fictional draft');
  assert.equal(hooks.readChatPlacement(chat), 'docked');
  await page.render({ id: 'two', placement: 'floating' });
  assert.equal(chat.getSnapshot().draft.text, ''); assert.equal(hooks.readChatPlacement(chat), 'floating');
  await act(async () => chat.setText('')); assert.equal(localStorage.getItem('pi-chat:draft:two'), null);
});

test('conversations client polls, searches and uses latest selection callback for create and fork', async t => {
  const calls = [], selected = [], changed = [];
  const fetch = async request => { const url = new URL(request.url); const body = request.method === 'POST' ? await request.json() : undefined; calls.push({ url, body }); return Response.json(body ? { conversationId: 'new' } : { conversations: [{ id: 1, title: null, lastMessage: 'hello', updatedAt: 1, archived: false }] }); };
  const initial = { endpoint: 'https://fictional.invalid/conversations', fetch, activeId: '1', onSelect: id => selected.push(id), onChange: () => changed.push(true), pollMs: 10000 };
  const page = await mount(t, p => hooks.useConversationsClient(p), initial);
  assert.equal(page.api.items[0].id, '1');
  const abort = new AbortController(); await page.api.search('plan', { archived: true }, abort.signal);
  assert.equal(calls.at(-1).url.searchParams.get('q'), 'plan'); assert.equal(calls.at(-1).url.searchParams.get('archived'), '1');
  await act(async () => { await page.api.rename('1', 'Plan'); await page.api.archive('1', true); await page.api.remove('1'); });
  await page.render({ ...initial, activeId: '2', onSelect: id => selected.push('latest:' + id) });
  await act(async () => page.api.fork('entry'));
  assert.equal(calls.find(c => c.url.searchParams.get('op') === 'fork').body.conversationId, '2');
  await act(async () => page.api.onNew());
  assert.deepEqual(selected, ['latest:new', 'latest:new']); assert.equal(changed.length, 5);
});

test('useRemoteChat keeps identity-equal selections, reads latest context and placement, and disposes on owner/conversation change', async t => {
  const submits = [], watches = [], cancelled = [];
  const fetch = async request => {
    const url = new URL(request.url), id = url.searchParams.get('c'), op = url.searchParams.get('op');
    if (op === 'watch') {
      watches.push(id);
      request.signal.addEventListener('abort', () => cancelled.push(id), { once: true });
      return new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode(JSON.stringify({ kind: 'view', view: { conversation: { id }, entries: [], docs: {} } }) + '\n')); }, cancel() { cancelled.push(id); } }));
    }
    if (op === 'submit') { submits.push(await request.json()); return Response.json({ submissionId: submits.length }); }
    return new Response('{}', { status: 404 });
  };
  const initial = { conversationId: 'one', identity: { runtimeId: 'r', scopeId: 's', principalId: 'p' }, endpoint: id => 'https://fictional.invalid/chat?c=' + id, fetch, requestContext: () => ({ name: 'first', placement: 'untrusted' }) };
  const page = await mount(t, p => hooks.useRemoteChat(p), initial);
  assert.equal(page.api.status, 'ready'); const first = page.api.controller;
  const presenter = await mount(t, p => hooks.useChatPlacement(p.controller, p.placement), { controller: first, placement: 'docked' });
  await act(async () => first.send('followUp', { text: 'hello' }));
  const before = watches.length;
  await page.render({ ...initial, identity: { ...initial.identity }, requestContext: () => ({ name: 'latest' }) });
  assert.equal(page.api.controller, first); assert.equal(watches.length, before);
  await presenter.render({ controller: first, placement: 'floating' });
  await act(async () => first.send('followUp', { text: 'again' }));
  assert.deepEqual(submits.map(s => s.context), [{ name: 'first', placement: 'docked' }, { name: 'latest', placement: 'floating' }]);
  await page.render({ ...initial, conversationId: 'two' });
  assert.equal(first.getSnapshot().disposed, true); assert.equal(page.api.status, 'ready');
  const second = page.api.controller; assert.notEqual(second, first); assert.equal(second.getSnapshot().conversationId, 'two');
  await page.render({ ...initial, conversationId: 'two', identity: { ...initial.identity, principalId: 'another' } });
  assert.equal(second.getSnapshot().disposed, true); assert.equal(page.api.controller.getSnapshot().identity.principalId, 'another');
  const last = page.api.controller; await page.render({ ...initial, identity: undefined });
  assert.equal(page.api.status, 'connecting'); assert.equal(last.getSnapshot().disposed, true);
  assert.ok(cancelled.includes('one')); assert.ok(cancelled.includes('two'));
});

test('transcript history paging retains the loaded window without moving the host scroll position', async t => {
  const scroller = document.createElement('div'); scroller.scrollTop = 123;
  let loads = 0;
  const initial = { rows: Array.from({ length: 60 }, (_, i) => ({ key: 'active-' + i })), history: { state: { kind: 'ready', entries: [], hasMore: true }, connected: true, load: async () => { loads++; } } };
  const page = await mount(t, p => hooks.useTranscriptWindow(p.rows, 60, 40, p.history, false), initial);
  await act(async () => page.api.scrollRef(scroller));
  await act(async () => { page.api.reveal(); page.api.reveal(); }); assert.equal(loads, 1);
  const earlier = Array.from({ length: 40 }, (_, i) => ({ key: 'earlier-' + i }));
  await page.render({ ...initial, rows: [...earlier, ...initial.rows] });
  assert.equal(page.api.hidden, 0); assert.equal(page.api.loaded, 40); assert.equal(scroller.scrollTop, 123);
});


test('per-conversation switching while connect waits cannot publish or double-dispose the old adapter', async t => {
  const gate = deferred(), created = [];
  const page = await mount(t, p => hooks.useControllerPerConversation({ key: p.selection,
    create: () => { const value = { id: p.selection, disposed: 0, dispose: async () => { value.disposed++; } }; created.push(value); return value; },
    connect: c => c.id === 'old' ? gate.promise : Promise.resolve(),
  }), { selection: undefined });
  await page.render({ selection: 'old' }); assert.equal(page.api.status, 'connecting');
  await page.render({ selection: 'new' }); assert.equal(page.api.status, 'ready');
  assert.equal(page.api.controller.id, 'new'); assert.equal(created[0].disposed, 1);
  await act(async () => gate.resolve());
  assert.equal(page.api.controller.id, 'new'); assert.equal(created[0].disposed, 1);
});
