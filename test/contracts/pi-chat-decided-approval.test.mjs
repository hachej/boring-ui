import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

// An approval whose decision is recorded is not waiting for the person: the chat keeps saying it works and no toast asks for input.
// DECIDED_SOURCE_ROOT points the same test at another checkout's items (the fail-first proof against the pre-fix code).
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.DECIDED_SOURCE_ROOT ?? root;
const out = `${root}.cache/pi-chat-decided-approval-test`;
mkdirSync(out, { recursive: true });
await build({ stdin: { contents: `export { PiChat } from './registry/pi-chat/pi-chat.tsx'; export { watchConversation } from './registry/pi-ambient/notifications.tsx';`, resolveDir: source, loader: 'tsx' },
  outfile: `${out}/chat.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { PiChat, watchConversation } = await import(pathToFileURL(`${out}/chat.mjs`).href);

const assistant = content => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'toolUse', timestamp: 1 });
const user = { id: 10, kind: 'message', model: [{ role: 'user', content: 'Tidy the fictional folder', timestamp: 0 }] };
const gated = { id: 11, kind: 'message', byTaskId: 1, model: [assistant([{ type: 'toolCall', id: 'g', name: 'delete_all', arguments: { path: 'fictional/x' } }])] };
const view = decision => ({ entries: [user, gated], docs: { 'pi.live': { run: { taskId: 1 }, tools: [{ callId: 'g', details: { 'boring.approval': { summary: 'Delete fictional files?', ...(decision ? { decision } : {}) } } }] } } });
const snapshotOf = v => ({ identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view: v, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false });

test('PiChat: a decided approval does not show the waiting status', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div'); document.body.append(container);
  const ui = createRoot(container);
  t.after(async () => {
    await act(async () => ui.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  let snapshot;
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const render = async (v, props = {}) => { snapshot = snapshotOf(v); await act(async () => ui.render(createElement(PiChat, { controller, mode: 'developer', ...props }))); };
  const get = id => container.querySelector(`[data-testid="${id}"]`);

  // Undecided: the chat waits for the person (control for the assertions below).
  await render(view(undefined));
  assert.equal(get('agent-status')?.textContent, 'Waiting for your answer');
  assert.equal(get('answer-waiting')?.dataset.kind, 'approval');

  // Decided, the gated call not yet finished: the run carries on by itself.
  await render(view('approved'));
  assert.equal(get('agent-status')?.textContent, 'Agent is working', 'a decided approval is not waiting for an answer');
  assert.equal(get('answer-waiting'), null);
  await render(view('approved'), { presentation: 'natural' });
  assert.ok(get('preparing'), 'natural presentation keeps its preparing status');
  assert.equal(get('answer-waiting'), null);
});

test('watchConversation: a decided approval raises no input toast', () => {
  let snapshot = snapshotOf({ entries: [user], docs: {} });
  const listeners = new Set();
  const controller = { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); } };
  const pushed = [];
  const store = { push: item => pushed.push(item), dismiss: () => {} };
  const stop = watchConversation(controller, store, { conversationId: 'fictional', title: 'Fictional chat' });
  snapshot = snapshotOf(view('denied'));
  for (const listener of listeners) listener();
  assert.deepEqual(pushed.filter(item => item.kind === 'input'), []);
  // Control: the same call undecided asks for input, with the one notice text.
  snapshot = snapshotOf({ entries: [user], docs: {} });
  for (const listener of listeners) listener();
  snapshot = snapshotOf(view(undefined));
  for (const listener of listeners) listener();
  assert.deepEqual(pushed.filter(item => item.kind === 'input').map(item => item.summary), ['Approve: Delete fictional files?']);
  stop();
});
