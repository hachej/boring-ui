import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.NATURAL_SOURCE_ROOT ?? root;
const out = `${root}.cache/pi-chat-natural-test`;
mkdirSync(out, { recursive: true });
await build({ entryPoints: [`${source}registry/pi-chat/pi-chat.tsx`], outfile: `${out}/chat.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { PiChat } = await import(pathToFileURL(`${out}/chat.mjs`).href);

const SECRET = '/srv/fictional/secret.py';
const assistant = (content, extra = {}) => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 1, ...extra });
const call = (id, name, args = { path: `fictional/${id}.json` }) => ({ type: 'toolCall', id, name, arguments: args });
const result = (id, name, text = '{"fictional":true}', isError = false) => ({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError, timestamp: 2 });
const artifact = { schema: 'boring.artifact', version: 1, id: 'plan', title: 'Fictional plan', type: 'markdown', mediaType: 'text/markdown', target: { resource: { providerId: 'fictional', path: 'plan.md' }, view: { kind: 'published' } }, revision: 'r1' };
const entry = (id, model, byTaskId = 1) => ({ id, kind: 'message', byTaskId, model });
// A finished turn with every kind of technical detail around its one sentence of prose.
const toolTurn = (first = 10) => [
  { id: first, kind: 'message', model: [{ role: 'user', content: 'Check the fictional files', timestamp: 0 }] },
  entry(first + 1, [assistant([{ type: 'thinking', thinking: 'Secret fictional reasoning.' }, call('a', 'read'), call('b', 'write')])]),
  entry(first + 2, [result('a', 'read'), result('b', 'write', 'denied', true), assistant([{ type: 'text', text: 'All checked.' }])]),
];
const live = (extra = {}) => ({ 'pi.live': { run: { taskId: 1 }, ...extra } });

// A presentation fixture at the public controller boundary, not execution/recovery evidence.
test('PiChat natural presentation shows prose and one status, never technical detail', async t => {
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
  const render = async (view, { snap = {}, ...props } = {}) => {
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false, ...snap };
    await act(async () => ui.render(createElement(PiChat, { controller, presentation: 'natural', mode: 'developer', ...props })));
  };
  const get = id => container.querySelector(`[data-testid="${id}"]`);
  const all = id => container.querySelectorAll(`[data-testid="${id}"]`);
  // What a screen reader meets: the spinner inside a status is hidden, the composer's own controls are not statuses of the chat.
  const statuses = () => [...container.querySelectorAll('[role="status"]')].filter(node => !node.closest('[aria-hidden="true"]'));
  const quiet = () => {
    for (const id of ['activity', 'activity-step', 'tool-card', 'tool-details', 'reasoning', 'tool-error', 'working', 'agent-status', 'conversation-files'])
      assert.equal(all(id).length, 0, `${id} is not rendered`);
    assert.doesNotMatch(container.textContent, /Secret fictional|fictional\/a\.json|denied|fictional\/b\.json/);
  };
  const oneStatus = (label = 'Preparing…') => {
    assert.equal(statuses().length, 1, `exactly one status: ${statuses().map(n => n.outerHTML.slice(0, 200)).join(' | ')}`);
    assert.equal(get('preparing').textContent, label);
  };

  // Defaults unchanged: without the prop, developer mode still shows the technical rows and the old status.
  await render({ entries: toolTurn(), docs: live() }, { presentation: undefined });
  assert.ok(get('activity'), 'activity block without the prop');
  assert.ok(get('agent-status'), 'old status without the prop');
  assert.equal(get('preparing'), null);

  // Initial history: prose only, no file discovery, no status.
  await render({ entries: toolTurn(), docs: {} });
  quiet();
  assert.match(container.textContent, /Check the fictional files/);
  assert.match(container.textContent, /All checked\./);
  assert.equal(statuses().length, 0, 'finished: no status');

  // Earlier (paged) history gets the same treatment.
  await render({ entries: [{ id: 99, kind: 'message', model: [{ role: 'user', content: 'Latest fictional question', timestamp: 5 }] }], docs: {} },
    { snap: { history: { kind: 'ready', entries: toolTurn(1), hasMore: false } } });
  quiet();
  assert.match(container.textContent, /All checked\./);

  // Live generation with nothing to say yet, a tool round and a retry: exactly one status, no shimmer row.
  const user = toolTurn()[0];
  await render({ entries: [user], docs: live({ generation: { message: { content: [] } } }) });
  oneStatus(); quiet();
  await render({ entries: [user, entry(11, [assistant([call('a', 'read')])])], docs: live({ generation: { message: { content: [call('c', 'bash', { command: `cat ${SECRET}` })] } } }) });
  oneStatus(); quiet();
  assert.doesNotMatch(container.textContent, /secret\.py/);
  await render({ entries: [user], docs: live({ generation: { retry: { attempt: 1 } } }) });
  oneStatus(); assert.equal(get('agent-status'), null);

  // Completion, a confirmed stop and the reconnecting header: no status once the work is over.
  await render({ entries: toolTurn(), docs: {} }, { snap: { stop: 'confirmed' } });
  assert.equal(statuses().length, 0);
  await render({ entries: toolTurn(), docs: { 'pi.live': { compactions: [{}] } } }, { snap: { stop: 'confirmed' } });
  assert.equal(statuses().length, 0, 'confirmed stop and no run');
  // An unconfirmed stop keeps the status and the existing notice.
  await render({ entries: [user], docs: live() }, { snap: { stop: 'unconfirmed' } });
  oneStatus(); assert.ok(get('stop-unconfirmed'));
  // A dropped connection keeps the notice and still reports unfinished work, not completion.
  await render({ entries: [user], docs: live() }, { snap: { connection: { kind: 'closed' } } });
  assert.ok(get('connection-notice')); assert.equal(get('preparing').textContent, 'Preparing…');

  // Failures show the plain label, never the raw text.
  await render({ entries: [user, entry(11, [assistant([call('a', 'bash', { command: SECRET })]), ]), entry(12, [result('a', 'bash', `Traceback (most recent call last): ${SECRET}`, true),
    assistant([], { stopReason: 'error', errorMessage: `Traceback ${SECRET} line 3` })])], docs: {} });
  quiet();
  assert.doesNotMatch(container.textContent, /Traceback|secret\.py/);
  assert.equal(get('response-error').textContent, 'The response failed');
  await render({ entries: [user, { id: 12, kind: 'message', model: [result('zz', 'bash', `Traceback ${SECRET}`, true)] }], docs: {} });
  assert.equal(all('tool-error').length, 0); assert.doesNotMatch(container.textContent, /Traceback/);
  // A blocked send says so plainly.
  await render({ entries: [user], docs: {} }, { snap: { send: { kind: 'blocked', reason: `Refused by ${SECRET}` } } });
  assert.doesNotMatch(container.textContent, /secret\.py/);
  assert.equal(get('send-blocked').textContent, 'Sending is not available right now.');

  // Question and approval cards stay, with no status while waiting for the person.
  const ask = call('q', 'ask_user', { question: 'Which fictional colour?', options: ['red', 'blue'] });
  await render({ entries: [user, entry(11, [assistant([ask])])], docs: live() });
  assert.ok(get('question-card')); assert.equal(get('preparing'), null);
  const gated = call('g', 'delete_all', { path: 'fictional/x' });
  await render({ entries: [user, entry(11, [assistant([gated])])], docs: live({ tools: [{ callId: 'g', details: { 'boring.approval': { summary: 'Delete fictional files?' } } }] }) });
  assert.ok(get('approval-card')); assert.equal(get('preparing'), null);
  assert.equal(all('tool-card').length, 0);

  // A user image and an artifact card survive; the host-detected step does not.
  const present = call('p', 'present', { path: 'plan.md' });
  await render({ entries: [{ id: 1, kind: 'message', model: [{ role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image', mimeType: 'image/png', data: 'AAAA' }], timestamp: 0 }] },
    entry(2, [assistant([present])]), entry(3, [result('p', 'present', JSON.stringify({ 'boring.artifact': true, artifact })), assistant([{ type: 'text', text: 'Plan ready.' }])])], docs: {} },
  { artifacts: { open: () => {} } });
  assert.ok(get('message-image')); assert.ok(get('artifact-card')); assert.equal(all('tool-card').length, 0);
  assert.ok(get('conversation-files'), 'artifacts and images are still listed');
  assert.equal(container.querySelector('[data-testid="conversation-file"]'), null, 'closed list');

  // The label is customisable through the existing labels prop.
  await render({ entries: [user], docs: live() }, { labels: { preparing: 'Fictional custom wording' } });
  oneStatus('Fictional custom wording');
});
