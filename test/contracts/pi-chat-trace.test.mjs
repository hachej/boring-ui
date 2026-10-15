import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.TRACE_SOURCE_ROOT ?? root;
const out = `${root}.cache/pi-chat-trace-test`;
mkdirSync(out, { recursive: true });
await build({ entryPoints: [`${source}registry/pi-chat/pi-chat.tsx`], outfile: `${out}/chat.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { PiChat } = await import(pathToFileURL(`${out}/chat.mjs`).href);
const call = (id, name) => ({ type: 'toolCall', id, name, arguments: { path: `fictional/${id}.json` } });
const assistant = content => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 1 });
const result = (id, name, isError = false) => ({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text: isError ? 'Fictional permission refused' : '{"fictional":true}' }], isError, timestamp: 2 });
const view = (failed = false, running = false) => ({
  entries: [
    { id: 1, kind: 'message', model: [{ role: 'user', content: 'Inspect fictional files', timestamp: 0 }] },
    { id: 2, kind: 'message', byTaskId: 1, model: [assistant([{ type: 'thinking', thinking: 'Check the fictional files first.' }, call('a', 'read'), call('b', 'read')])] },
    ...running ? [] : [{ id: 3, kind: 'message', byTaskId: 1, model: [result('a', 'read'), result('b', 'read', failed), assistant([{ type: 'text', text: 'Inspection finished.' }])] }],
  ],
  docs: running ? { 'pi.live': { run: { taskId: 1 } } } : {},
});

// This is a presentation fixture at the public controller boundary, not execution/recovery evidence.
test('PiChat composes nested Trace lines without changing native input or host tool routing', async t => {
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
  const render = async (native, props = {}) => {
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view: native, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    await act(async () => ui.render(createElement(PiChat, { controller, mode: 'developer', ...props })));
  };
  const get = id => container.querySelector(`[data-testid="${id}"]`);
  const trigger = element => element.querySelector('[data-slot="trace-collapsible-trigger"]');
  const native = view();
  const before = JSON.stringify(native);
  await render(native);
  assert.equal(get('activity').getAttribute('data-slot'), 'trace');
  assert.equal(trigger(get('activity')).getAttribute('aria-expanded'), 'false');
  await act(async () => trigger(get('activity')).click());
  assert.equal(trigger(get('activity')).getAttribute('aria-expanded'), 'true');
  assert.equal(container.querySelectorAll('[data-testid="activity-step"]').length, 3);
  await act(async () => trigger(get('tool-card')).click());
  assert.match(get('tool-details').textContent, /fictional\/a\.json/);
  assert.match(get('tool-details').textContent, /"fictional":true/);
  await act(async () => trigger(get('reasoning')).click());
  assert.match(get('reasoning-text').textContent, /Check the fictional files first/);
  assert.equal(JSON.stringify(native), before, 'presentation does not mutate native model input');

  await render(view(false, true));
  const running = container.querySelector('[data-testid="tool-card"] [data-slot="trace-line"]');
  assert.equal(running.getAttribute('data-status'), 'running');
  assert.match(get('activity-label').textContent, /Reading/);

  await render(view(true));
  const failed = container.querySelector('[data-testid="tool-card"][data-status="failed"]');
  assert.equal(failed.querySelector('[data-slot="trace-line"]').getAttribute('data-status'), 'error');
  assert.equal(trigger(failed).getAttribute('aria-expanded'), 'true');
  assert.match(failed.querySelector('[role="alert"]').textContent, /Fictional permission refused/);

  await render(view(), { mode: 'expert' });
  if (trigger(get('activity')).getAttribute('aria-expanded') === 'false') await act(async () => trigger(get('activity')).click());
  assert.equal(trigger(get('tool-card')), null, 'quiet successful steps are plain lines');
  assert.equal(get('tool-details'), null, 'quiet successful calls expose no raw arguments');
  await render(view(), { renderTool: call => ({ content: createElement('div', { 'data-testid': 'host-card' }, call.name), inline: true }) });
  assert.equal(container.querySelectorAll('[data-testid="host-card"]').length, 2, 'host cards remain outside the activity');
  assert.equal(get('host-card').closest('[data-testid="activity"]'), null);
  await render(view(), { groupTool: () => false });
  assert.equal(container.querySelectorAll('[data-testid="tool-card"]').length, 2, 'ungrouped tools still render');
  assert.equal(get('tool-card').closest('[data-testid="activity"]'), null);
});
