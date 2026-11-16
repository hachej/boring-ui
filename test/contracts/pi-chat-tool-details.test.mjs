import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/pi-chat-tool-details-test`;
mkdirSync(out, { recursive: true });
await build({ entryPoints: [`${root}registry/pi-chat/pi-chat.tsx`], outfile: `${out}/chat.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { PiChat } = await import(pathToFileURL(`${out}/chat.mjs`).href);

const COMMAND = 'grep -r invoice-0121 /srv/fictional/ledger';
const ERROR = 'Traceback (most recent call last): KeyError invoice-0121';
const assistant = (content, extra = {}) => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'stop', timestamp: 1, ...extra });
const call = (id, name, args) => ({ type: 'toolCall', id, name, arguments: args });
const result = (id, name, text, isError) => ({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError, timestamp: 2 });
const entry = (id, model) => ({ id, kind: 'message', byTaskId: 1, model });
// A turn that ends on a failure (a failure the run got past is already quiet): one tool that works, one that fails with raw arguments and a raw error.
const turn = [
  { id: 10, kind: 'message', model: [{ role: 'user', content: 'Find the fictional invoice', timestamp: 0 }] },
  entry(11, [assistant([call('a', 'read', { path: 'fictional/notes.md' }), call('b', 'bash', { command: COMMAND })])]),
  entry(12, [result('a', 'read', 'fictional notes', false), result('b', 'bash', ERROR, true)]),
];

test('PiChat toolDetails="none" keeps a failed step closed and plain, and the default is unchanged', async t => {
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
  const render = async (props = {}, entries = turn) => {
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view: { entries, docs: {} }, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    await act(async () => ui.render(createElement(PiChat, { controller, header: false, ...props })));
  };
  const get = id => container.querySelector(`[data-testid="${id}"]`);
  const all = id => container.querySelectorAll(`[data-testid="${id}"]`);
  const failedCard = () => [...all('tool-card')].find(card => card.dataset.status === 'failed');
  const SENTENCE = 'This did not work out.';

  // Default: today's behaviour, the failed step opens with its arguments and its error.
  await render();
  assert.equal(all('tool-details').length, 1, 'the failed step is open');
  assert.match(container.textContent, /grep -r invoice-0121/);
  assert.match(container.textContent, /KeyError/);
  assert.match(get('activity-label').textContent, /bash/i, 'the header names the tool');
  assert.equal(get('tool-failed-summary'), null);
  await render({ toolDetails: 'auto' });
  assert.equal(all('tool-details').length, 1, '"auto" is the default');

  // "none": neither string anywhere, the card is closed with no disclosure, the plain sentence is on its line, the header names no tool.
  await render({ toolDetails: 'none' });
  assert.doesNotMatch(container.textContent, /grep|KeyError|Traceback|invoice-0121|fictional\/notes/);
  assert.equal(all('tool-details').length, 0, 'no step is open');
  assert.equal(failedCard().querySelector('button'), null, 'no disclosure on the step');
  assert.equal(get('tool-failed-summary').textContent, SENTENCE);
  assert.equal(failedCard().querySelector('[data-testid="tool-status"]').textContent, 'Failed');
  assert.ok(failedCard().contains(get('tool-failed-summary')), 'the sentence belongs to the failed step');
  assert.equal(get('activity-label').textContent, 'A step did not work out');
  assert.doesNotMatch(get('activity-label').textContent, /bash|shell/i);

  // The host's own words: a string, or a function of the tool.
  await render({ toolDetails: 'none', labels: { toolFailedSummary: 'Not this time.' } });
  assert.equal(get('tool-failed-summary').textContent, 'Not this time.');
  await render({ toolDetails: 'none', labels: { toolFailedSummary: tool => `${tool} stopped.` } });
  assert.equal(get('tool-failed-summary').textContent, 'bash stopped.');
  await render({ toolDetails: 'none', locale: 'fr' });
  assert.equal(get('tool-failed-summary').textContent, 'Cela n’a pas abouti.');
  assert.equal(get('activity-label').textContent, 'Une étape n’a pas abouti');

  // `mode="developer"` does not bring the details back: only the kit's own developer switch does.
  await render({ toolDetails: 'none', mode: 'developer' });
  assert.doesNotMatch(container.textContent, /grep|KeyError/);
  window.happyDOM.setURL('https://fictional.invalid/?chatMode=developer');
  await act(async () => ui.render(null));
  await render({ toolDetails: 'none' });
  // The failed step is open with its details; the step that worked has its disclosure but stays closed (closed content is not mounted).
  assert.equal(all('tool-details').length, 1, 'developer switch: the failed step shows its details');
  assert.match(container.textContent, /grep -r invoice-0121/);
  assert.match(container.textContent, /KeyError/);
  window.happyDOM.setURL('https://fictional.invalid/?chatMode=expert');
  await act(async () => ui.render(null));
  await render({ toolDetails: 'none' });
  assert.equal(all('tool-details').length, 0);

  // A host card keeps priority over the step.
  await render({ toolDetails: 'none', renderTool: toolCall => toolCall.name === 'bash' ? { content: createElement('p', { 'data-testid': 'host-card' }, 'Host card') } : undefined });
  assert.ok(get('host-card'), 'renderTool still draws its own card');

  // A tool result with no call shows the sentence, not the raw text.
  const orphan = [turn[0], { id: 20, kind: 'message', model: [result('zz', 'bash', ERROR, true)] }];
  await render({}, orphan);
  assert.match(get('tool-error').textContent, /KeyError/);
  await render({ toolDetails: 'none' }, orphan);
  assert.equal(get('tool-error').textContent, SENTENCE);
});
