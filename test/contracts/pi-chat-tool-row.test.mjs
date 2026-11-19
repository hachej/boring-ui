import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/pi-chat-tool-row-test`;
mkdirSync(out, { recursive: true });
await build({ entryPoints: [`${root}registry/pi-chat/pi-chat.tsx`], outfile: `${out}/chat.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { PiChat } = await import(pathToFileURL(`${out}/chat.mjs`).href);
await build({ stdin: { contents: `export { ApprovalCard } from './registry/pi-chat-approval/approval-card.tsx';`, resolveDir: root, loader: 'tsx' },
  outfile: `${out}/cards.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { ApprovalCard } = await import(pathToFileURL(`${out}/cards.mjs`).href);

const assistant = (content, extra = {}) => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 1, ...extra });
const call = (id, name, args = { query: `fictional-${id}` }) => ({ type: 'toolCall', id, name, arguments: args });
const result = (id, name, text, isError = false) => ({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError, timestamp: 2 });
const entry = (id, model) => ({ id, kind: 'message', byTaskId: 1, model });
const user = { id: 10, kind: 'message', model: [{ role: 'user', content: 'Search the fictional mailbox', timestamp: 0 }] };
const live = (extra = {}) => ({ 'pi.live': { run: { taskId: 1 }, ...extra } });
const running = { entries: [user, entry(11, [assistant([call('a', 'search')])])], docs: live() };
const finished = { entries: [user, entry(11, [assistant([call('a', 'search')])]), entry(12, [result('a', 'search', 'found nothing'), assistant([{ type: 'text', text: 'Nothing found.' }])])], docs: {} };

test('PiChat step row shows a pulsing dot, never a second spinner; hideTools hides rows but not approvals or errors', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'sessionStorage', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT'];
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
  const render = async (view, props = {}) => {
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    await act(async () => ui.render(createElement(PiChat, { controller, header: false, ...props })));
  };
  const get = id => container.querySelector(`[data-testid="${id}"]`);
  const all = id => container.querySelectorAll(`[data-testid="${id}"]`);
  const spinners = scope => scope.querySelectorAll('[data-slot="spinner"]');

  // Running: the row has a muted pulsing dot and no spinner; the working line owns the one spinner.
  await render(running);
  assert.ok(get('activity'), 'the row is there');
  assert.equal(spinners(get('activity')).length, 0, 'no spinner in the tool row');
  assert.equal(spinners(get('agent-status')).length, 1, 'the working line has its spinner');
  assert.equal(spinners(container).length, 1, 'one spinner on screen');
  const dot = get('activity-dot');
  assert.ok(dot, 'a dot while running');
  assert.match(dot.className, /animate-pulse/);
  assert.match(dot.className, /motion-reduce:animate-none/, 'static under reduced motion');
  assert.match(dot.className, /bg-muted-foreground/);
  assert.doesNotMatch(dot.className, /animate-spin/);

  // Finished: no dot, no spinner.
  await render(finished);
  assert.ok(get('activity'));
  assert.equal(get('activity-dot'), null, 'a finished step shows no dot');
  assert.equal(spinners(container).length, 0);

  // hideTools: no rows while running or after, the working line carries the state.
  await render(running, { hideTools: true });
  assert.equal(all('activity').length, 0); assert.equal(all('tool-card').length, 0); assert.equal(get('activity-dot'), null);
  assert.ok(get('agent-status')); assert.equal(spinners(container).length, 1);
  await render(finished, { hideTools: true });
  assert.equal(all('activity').length, 0); assert.equal(all('tool-card').length, 0);
  assert.match(container.textContent, /Nothing found\./);

  // A failed step still shows, and so does an approval waiting for the person.
  const failed = { entries: [user, entry(11, [assistant([call('b', 'search')])]), entry(12, [result('b', 'search', 'boom', true)])], docs: {} };
  await render(failed, { hideTools: true });
  assert.ok(get('activity'), 'a failure that needs the person stays');
  const gated = { entries: [user, entry(11, [assistant([call('g', 'delete_all', { path: 'fictional/x' })])])], docs: live({ tools: [{ callId: 'g', details: { 'boring.approval': { summary: 'Delete fictional files?' } } }] }) };
  await render(gated, { hideTools: true, cards: { approval: ApprovalCard } });
  assert.ok(get('approval-card'), 'the approval stays');

  // Default unchanged: false by default and explicitly.
  await render(finished, { hideTools: false });
  assert.ok(get('activity'));
});
