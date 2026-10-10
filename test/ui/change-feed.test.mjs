// The workspace page invalidates its file views from the provider's change feed (ruling 2): the tree, the history panel and the
// @ search reload when the feed's seq moves; `fileTree.refreshKey` stays for a provider without a feed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

/** A change feed the test pushes events into. */
function pushFeed() {
  const queued = [], waiting = [];
  let seq = 100;
  return {
    push: path => { const event = { kind: 'change', path, revision: null, source: 'agent', seq: ++seq, at: Date.now() }; const wake = waiting.shift(); if (wake) wake(event); else queued.push(event); },
    changes: ({ signal } = {}) => ({ async *[Symbol.asyncIterator]() {
      while (!signal?.aborted) {
        const event = queued.shift() ?? await new Promise(resolve => { waiting.push(resolve); signal?.addEventListener('abort', () => resolve(undefined), { once: true }); });
        if (event) yield event;
      }
    } }),
  };
}

test('the agent workspace reloads the tree, the open history panel and the @ search from the change feed', async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'confirm', 'sessionStorage', 'localStorage', 'ResizeObserver'];
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
  await act(async () => element.querySelector('button[aria-label="History of notes.md"]').click());
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
});
