// While a turn runs the conversation list is refreshed every 4 s by one clock, never while the tab is hidden, and once on return (D-1638):
// the real PiChat, with a host's own `conversations` config that has only `reload`, and with the real useConversationsClient given `busy`. Fictional data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

test('PiChat refreshes the conversation list on one 4 s clock while a turn runs, not while hidden', { timeout: 60000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'addEventListener', 'removeEventListener', 'matchMedia', 'sessionStorage', 'localStorage', 'location', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  let visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const { useConversationsClient } = await import('@hachej/boring-ui-kit/chat-react');
  const out = new URL('../../.cache/pi-chat-conversations-reload/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('chat.mjs', out);
  await build({ stdin: { contents: `export { PiChat } from './pi-chat/pi-chat.tsx';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'ts' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { PiChat } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  const snapshot = { identity: {}, conversationId: 'a', connection: { kind: 'connected' }, view: { entries: [], docs: { 'pi.live': { run: { taskId: 1 } } } }, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: () => () => {}, setText: () => {}, setAttachments: () => {}, send: async () => ({ id: 'fictional-submission' }), stop: async () => {} }, { get: (target, key) => key in target ? target[key] : async () => {} });
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  t.after(async () => { await act(async () => root.unmount()); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const tick = ms => act(async () => { t.mock.timers.tick(ms); await Promise.resolve(); });
  const change = state => { visibility = state; return act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); }); };

  // A host with its own config: only `reload`, no call to the hook.
  let reloads = 0;
  const own = { items: [], onSelect: () => {}, reload: async () => { reloads += 1; } };
  await act(async () => root.render(createElement(PiChat, { controller, header: false, conversations: own })));
  const base = reloads;
  await tick(12_000);
  assert.equal(reloads - base, 3, 'visible: one refresh every 4 s');
  const before = reloads;
  await change('hidden');
  await tick(60_000);
  assert.equal(reloads === before, true, `hidden: no call, though the turn is still marked running (${reloads - before} calls)`);
  await change('visible');
  assert.equal(reloads - before, 1, 'one refresh on return');

  // A host that gives `busy: true` to the hook: the hook's clock is the only one.
  await act(async () => root.render(createElement('div')));
  let lists = 0;
  const fetch = async () => { lists += 1; return Response.json({ conversations: [] }); };
  const Host = () => {
    const client = useConversationsClient({ endpoint: '/api/pm/conversations', fetch, activeId: 'a', onSelect: () => {}, busy: true });
    return client ? createElement(PiChat, { controller, header: false, conversations: client }) : null;
  };
  await act(async () => root.render(createElement(Host)));
  await tick(0);
  const start = lists;
  await tick(12_000);
  assert.equal(lists - start, 3, `busy and visible for 12 s: ${lists - start} list calls on one 4 s cadence, not two clocks`);
});
