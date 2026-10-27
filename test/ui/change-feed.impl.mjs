// The workspace page invalidates its file views from the provider's change feed (ruling 2): the tree, the history panel and the
// @ search reload when the feed's seq moves; `fileTree.refreshKey` stays for a provider without a feed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

/**
 * A change feed the test pushes events into, with the protocol's cursor: a stream without `since` delivers the events after the moment it
 * is connected; with `since` it replays the retained events after that seq first. `hold()` delays the next connections (a slow network)
 * until the returned function is called.
 */
function pushFeed() {
  const log = [], wakers = new Set();
  let seq = 100, gate;
  return {
    push: path => { log.push({ kind: 'change', path, revision: null, source: 'agent', seq: ++seq, at: Date.now() }); for (const wake of [...wakers]) wake(); },
    hold: () => { let open; gate = new Promise(resolve => { open = resolve; }); return () => { gate = undefined; open(); }; },
    changes: ({ since, signal } = {}) => {
      const connecting = gate;
      return { async *[Symbol.asyncIterator]() {
        if (connecting) await connecting;
        let cursor = since ?? seq;
        while (!signal?.aborted) {
          const next = log.find(event => event.seq > cursor);
          if (next) { cursor = next.seq; yield next; continue; }
          // An aborted stream stops waiting, so it never takes events from the stream that replaced it.
          await new Promise(resolve => { const wake = () => { wakers.delete(wake); resolve(); }; wakers.add(wake); signal?.addEventListener('abort', wake, { once: true }); });
        }
      } };
    },
  };
}

async function harness(t) {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Text', 'CustomEvent', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'confirm', 'sessionStorage', 'localStorage', 'ResizeObserver'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1200, height: 800, left: 0, right: 1200, top: 0, bottom: 800, x: 0, y: 0 });
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/change-feed-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('workspace.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-app/agent-workspace.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', plugins: [{ name: 'bundle-file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { AgentWorkspace } = await import(output.href);
  const { createNativeChatController } = await import('@hachej/boring-ui-kit/native-chat');
  const element = window.document.createElement('div'); window.document.body.append(element); const root = createRoot(element);
  const chat = createNativeChatController({ identity: { runtimeId: 'fictional', scopeId: 'fictional', principalId: 'alice' },
    conversation: { id: 1 }, context: { value: () => undefined, toString: () => 'fictional' }, history: false,
    source: { open: async () => ({ value: { conversation: { id: 1 }, entries: [], docs: {} }, start() {}, closed: new Promise(() => {}), stop: async () => ({ kind: 'stopped' }) }) } });
  t.after(async () => {
    await act(async () => root.unmount()); chat.dispose(); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const settle = async (done, what) => { for (let n = 0; n < 100 && !done(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); assert.ok(done(), what); };

  return { window, element, root, chat, act, createElement, settle, AgentWorkspace };
}

test('the agent workspace reloads the tree, the open history panel and the @ search from the change feed', async t => {
  const { window, element, root, chat, act, createElement, settle, AgentWorkspace } = await harness(t);
  const feed = pushFeed();
  const calls = { list: 0, history: 0, search: [] };
  const locate = path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } });
  const identity = { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' };
  const binding = { identity, workspace: { providerId: 'fictional', instanceId: 'one', incarnation: 'one', viewId: 'one' }, locate,
    read: async () => ({ kind: 'missing' }), publish: async () => ({ kind: 'unavailable', reason: 'fictional' }), lookup: async () => ({ kind: 'not-found' }),
    list: async () => { calls.list++; return { entries: [{ path: 'notes.md', kind: 'file', size: 5 }] }; },
    search: async request => { calls.search.push(request.query); return { entries: [{ path: 'notes.md', kind: 'file', size: 5 }] }; },
    history: async () => { calls.history++; return [{ revision: 'a'.repeat(40), savedAt: 1, source: 'agent' }]; },
    changes: feed.changes,
  };
  await act(async () => root.render(createElement(AgentWorkspace, { controller: chat, conversationId: '1', revisionProvider: binding })));
  await act(async () => element.querySelector('[data-testid=workspace-library]').click());
  await settle(() => element.querySelector('[role=treeitem][data-path="notes.md"]'), 'the tree lists the file');
  // Open the history panel of the file.
  await act(async () => element.querySelector('button[aria-label="Actions for notes.md"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  await act(async () => window.document.querySelector('[role=menuitem][data-action=history]').click());
  await settle(() => calls.history === 1, 'the history panel loads once');

  // An agent write arrives on the feed: the tree and the open history panel reload, keyed on the new seq.
  const listed = calls.list;
  await act(async () => feed.push('notes.md'));
  await settle(() => calls.list > listed && calls.history === 2, `the tree and the history reload (list ${calls.list}, history ${calls.history})`);

  // @ search: a repeated query is served from the results of the same seq; a change event drops them.
  const textarea = element.querySelector('[data-testid=workspace-chat-surface] textarea');
  const type = async value => act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
    textarea.setSelectionRange?.(value.length, value.length);
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await type('@no');
  await settle(() => calls.search.length === 1, 'the first @ search asks the provider');
  await type('@n');
  await settle(() => calls.search.length === 2, 'another query asks the provider');
  await type('@no');
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  assert.deepEqual(calls.search, ['no', 'n'], 'the same query at the same seq is not asked again');
  await act(async () => feed.push('other.md'));
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  await type('@n');
  await settle(() => calls.search.length === 3, 'after a change the next query asks again');
  await type('@no');
  await settle(() => calls.search.length === 4, 'the earlier results were dropped by the change event');
  assert.deepEqual(calls.search, ['no', 'n', 'n', 'no']);

  // The picker stays open on '@no'; a pushed change searches that query again (the open menu is invalidated, not only later typing).
  const before = calls.search.length;
  await act(async () => feed.push('third.md'));
  await settle(() => calls.search.length === before + 1 && calls.search.at(-1) === 'no', 'an open picker searches again after a pushed change');

  // Another workspace binding, same query, no feed event yet: it must search its own workspace and never show the first one's names.
  const other = pushFeed();
  const otherSearches = [];
  const secondBinding = { ...binding, identity: { ...identity, principalId: 'bob', initiatorId: 'bob' }, workspace: { ...binding.workspace, instanceId: 'two', incarnation: 'two' },
    search: async request => { otherSearches.push(request.query); return { entries: [{ path: 'other-workspace.md', kind: 'file', size: 1 }] }; }, changes: other.changes };
  await act(async () => root.render(createElement(AgentWorkspace, { controller: chat, conversationId: '1', revisionProvider: secondBinding })));
  await settle(() => otherSearches.includes('no'), 'the second binding searches the open query itself');
  await settle(() => [...window.document.querySelectorAll('[data-testid=mention-item]')].some(item => item.dataset.path === 'other-workspace.md'), 'the second binding results show');
  assert.ok(![...window.document.querySelectorAll('[data-testid=mention-item]')].some(item => item.dataset.path === 'notes.md'), 'the first workspace names are never shown');
  const [secondTextarea] = [element.querySelector('[data-testid=workspace-chat-surface] textarea')];
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(secondTextarea, '@n');
    secondTextarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await settle(() => otherSearches.length >= 2, 'the second binding keeps searching its own workspace');
  assert.ok(![...window.document.querySelectorAll('[data-testid=mention-item]')].some(item => item.dataset.path === 'notes.md'), 'still no names of the first workspace');
});

test('an @ search result of one workspace binding is never shown in another, even before any change event', async t => {
  const { window, element, root, chat, act, createElement, settle, AgentWorkspace } = await harness(t);
  const locate = path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } });
  const make = (principalId, name, searches) => ({ identity: { scopeId: 'fictional', principalId, initiatorId: principalId }, workspace: { providerId: 'fictional', instanceId: principalId, incarnation: principalId, viewId: principalId }, locate,
    read: async () => ({ kind: 'missing' }), publish: async () => ({ kind: 'unavailable', reason: 'fictional' }), lookup: async () => ({ kind: 'not-found' }),
    list: async () => ({ entries: [] }), history: async () => [],
    search: async request => { searches.push(request.query); return { entries: [{ path: name, kind: 'file', size: 1 }] }; },
    changes: () => ({ async *[Symbol.asyncIterator]() { await new Promise(() => {}); } }) });
  const first = [], second = [];
  const a = make('alice', 'alice-secret.md', first), b = make('bob', 'bob-file.md', second);
  await act(async () => root.render(createElement(AgentWorkspace, { controller: chat, conversationId: '1', revisionProvider: a })));
  const textarea = () => element.querySelector('[data-testid=workspace-chat-surface] textarea');
  const type = async value => act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea(), value);
    textarea().setSelectionRange?.(value.length, value.length);
    textarea().dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await type('@no');
  await settle(() => first.length === 1 && window.document.querySelector('[data-testid=mention-item][data-path="alice-secret.md"]'), 'alice sees her own result');
  await type('');
  await act(async () => root.render(createElement(AgentWorkspace, { controller: chat, conversationId: '1', revisionProvider: b })));
  await type('@no');
  await settle(() => second.includes('no'), 'bob\'s workspace is searched');
  await settle(() => window.document.querySelector('[data-testid=mention-item][data-path="bob-file.md"]'), 'bob sees his own result');
  assert.equal(window.document.querySelector('[data-testid=mention-item][data-path="alice-secret.md"]'), null, 'alice\'s names are never shown to bob');
});

test('switching the binding while the picker is open hides the previous binding\'s results before the new search settles', async t => {
  const { window, element, root, chat, act, createElement, settle, AgentWorkspace } = await harness(t);
  const quiet = () => ({ async *[Symbol.asyncIterator]() { await new Promise(() => {}); } });
  const locate = path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } });
  const make = (principalId, search) => ({ identity: { scopeId: 'fictional', principalId, initiatorId: principalId }, workspace: { providerId: 'fictional', instanceId: principalId, incarnation: principalId, viewId: principalId }, locate,
    read: async () => ({ kind: 'missing' }), publish: async () => ({ kind: 'unavailable', reason: 'fictional' }), lookup: async () => ({ kind: 'not-found' }),
    list: async () => ({ entries: [] }), history: async () => [], search, changes: quiet });
  const alice = make('alice', async () => ({ entries: [{ path: 'alice-secret.md', kind: 'file', size: 1 }] }));
  const bobSearches = [];
  const bob = make('bob', async request => { bobSearches.push(request.query); return new Promise(() => {}); });
  await act(async () => root.render(createElement(AgentWorkspace, { controller: chat, conversationId: '1', revisionProvider: alice })));
  const textarea = () => element.querySelector('[data-testid=workspace-chat-surface] textarea');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea(), '@no');
    textarea().setSelectionRange?.(3, 3);
    textarea().dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await settle(() => window.document.querySelector('[data-testid=mention-item][data-path="alice-secret.md"]'), 'alice sees her own result');
  await act(async () => root.render(createElement(AgentWorkspace, { controller: chat, conversationId: '1', revisionProvider: bob })));
  await settle(() => bobSearches.includes('no'), 'bob\'s search starts and stays pending');
  await act(async () => new Promise(resolve => setTimeout(resolve, 200)));
  assert.equal(window.document.querySelector('[data-testid=mention-item][data-path="alice-secret.md"]'), null, 'alice\'s rows are not displayed while bob\'s search is pending');
  assert.equal(window.document.querySelectorAll('[data-testid=mention-item]').length, 0, 'nothing from alice is selectable');
});

test('a hidden tab holds no change feed; shown again it resumes from its last event, so no change is missed', async t => {
  const { window, element, root, chat, act, createElement, settle, AgentWorkspace } = await harness(t);
  const feed = pushFeed();
  const streams = { opened: 0, open: 0 };
  const changes = request => { streams.opened++; streams.open++; request.signal.addEventListener('abort', () => streams.open--, { once: true }); return feed.changes(request); };
  const files = ['notes.md'];
  let listed = 0;
  const locate = path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } });
  const binding = { identity: { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' }, workspace: { providerId: 'fictional', instanceId: 'one', incarnation: 'one', viewId: 'one' }, locate,
    read: async () => ({ kind: 'missing' }), publish: async () => ({ kind: 'unavailable', reason: 'fictional' }), lookup: async () => ({ kind: 'not-found' }),
    list: async () => { listed++; return { entries: files.map(path => ({ path, kind: 'file', size: 5 })) }; }, search: async () => ({ entries: [] }), history: async () => [], changes };
  const write = async path => { files.push(path); await act(async () => feed.push(path)); };
  const shows = path => element.querySelector(`[role=treeitem][data-path="${path}"]`);
  let visibility = 'visible';
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => visibility });
  const show = async value => { visibility = value; await act(async () => window.document.dispatchEvent(new window.Event('visibilitychange'))); };
  await act(async () => root.render(createElement(AgentWorkspace, { controller: chat, conversationId: '1', revisionProvider: binding })));
  await act(async () => element.querySelector('[data-testid=workspace-library]').click());
  await settle(() => shows('notes.md') && streams.open === 1, 'the tree lists the file over one open feed');
  await write('seen.md');
  await settle(() => shows('seen.md'), 'a change on the open feed reloads the tree');

  await show('hidden');
  await settle(() => streams.open === 0, `the hidden tab releases its feed (open ${streams.open})`);
  // A change while the tab is hidden; then the tab is shown on a slow network, and another change lands before the feed is connected.
  await write('while-hidden.md');
  const connect = feed.hold();
  await show('visible');
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  await write('while-connecting.md');
  await act(async () => connect());
  await settle(() => streams.open === 1 && streams.opened === 2, `shown again, the feed reconnects (open ${streams.open}, opened ${streams.opened})`);
  await settle(() => shows('while-hidden.md') && shows('while-connecting.md'), 'the changes made while hidden and while reconnecting both show');
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  const settled = listed;
  await write('after.md');
  await settle(() => listed > settled && shows('after.md'), 'the reconnected feed still drives reloads');
});

test('a file open before the endpoint\'s binding is discovered is not read again when the binding arrives', async t => {
  const { element, root, chat, act, createElement, settle, AgentWorkspace } = await harness(t);
  const { openNodeConnection } = await import('@hachej/boring-files/sqlite');
  const { openSqliteFileSystem } = await import('@hachej/boring-files/sqlite-filesystem');
  const { createWorkspaceJournal } = await import('@hachej/boring-files/journal');
  const { createWorkspaceProvider } = await import('@hachej/boring-files/workspace');
  const { createRevisionHandler } = await import('@hachej/boring-files/revision-handler');
  const db = openNodeConnection(':memory:');
  t.after(() => db.close());
  const fs = openSqliteFileSystem({ connection: db, workspace: 'fictional', cwd: '/workspace' });
  const provider = createWorkspaceProvider({ fs, journal: createWorkspaceJournal(db), identity: { providerId: 'files', instanceId: 'fictional', incarnation: fs.incarnation, viewId: 'published' } });
  const identity = { principalId: 'alice', scopeId: 'fictional', initiatorId: 'alice' };
  const locate = path => ({ resource: { providerId: 'files', path }, view: { kind: 'published' } });
  // A 1x1 PNG: an image view reads its bytes once, it does not poll.
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64'));
  assert.equal((await provider.publication.publish({ operationId: 'seed-badge', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: locate('badge.png'), expected: { kind: 'absent' }, bytes: png, mediaType: 'image/png' }] }, identity)).kind, 'committed');
  const handler = createRevisionHandler({ resolve: async () => ({ provider, access: identity, release() {} }) });
  // The binding answers late, after the file is open; every resource read is counted.
  let answer; const discovered = new Promise(resolve => { answer = resolve; });
  const reads = { count: 0 }, bound = { asked: false };
  const fetch = async request => {
    if (request.method === 'GET' && !new URL(request.url).searchParams.has('op')) { bound.asked = true; await discovered; }
    else if (request.method === 'POST' && !request.headers.has('x-boring-catalog') && (await request.clone().json()).kind === 'read') reads.count++;
    return handler(request);
  };
  const resources = { endpoint: 'https://fictional.invalid/api/resources', fetch, identity, locate };
  await act(async () => root.render(createElement(AgentWorkspace, { controller: chat, conversationId: '1', resources, opened: { kind: 'file', path: 'badge.png' }, onOpenedChange() {} })));
  await settle(() => reads.count === 1 && bound.asked, `the open file is read once while the binding is pending (reads ${reads.count})`);
  await act(async () => answer());
  await settle(() => element.querySelector('[data-testid=workspace-library]'), 'the binding arrived: the Library is offered');
  await act(async () => new Promise(resolve => setTimeout(resolve, 300)));
  assert.equal(reads.count, 1, 'the open file is not read again when the binding arrives');
});
