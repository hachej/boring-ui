// D-257 step 3: the question, approval, sub-agent and artifact cards are optional items. Core-only, through the public PiChat entry:
// a question or approval waiting for the person shows a visible "waiting for your answer" notice with no answer UI (the run is never
// silently blocked), a sub-agent call stays an ordinary tool step and artifact results get no card. Fictional data only.
// CARDS_SOURCE_ROOT points the test at another checkout (fail-first proof: the code before step 3 always drew the built-in cards).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.CARDS_SOURCE_ROOT ?? root;
const out = `${root}.cache/pi-chat-cards-core-test`;
mkdirSync(out, { recursive: true });
await build({ entryPoints: [`${source}registry/pi-chat/pi-chat.tsx`], outfile: `${out}/chat.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
const { PiChat } = await import(pathToFileURL(`${out}/chat.mjs`).href);

const assistant = content => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason: 'toolUse', timestamp: 1 });
const result = (id, name, text, details) => ({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], isError: false, timestamp: 2, ...(details ? { details } : {}) });
const artifact = { schema: 'boring.artifact', version: 1, title: 'Fictional plan', type: 'markdown', mediaType: 'text/markdown', target: { resource: { providerId: 'fictional', path: 'plan.md' }, view: { kind: 'published' } }, revision: 'r1' };
const delegated = { kind: 'boring.delegate', version: 1, agent: 'fictional-researcher', conversationId: 7, status: 'done', startedAt: 1, durationMs: 10, toolCalls: 1, tokens: { input: 1, output: 1 } };
const view = () => ({
  entries: [
    { id: 1, kind: 'message', model: [{ role: 'user', content: 'Plan the fictional trip', timestamp: 0 }] },
    { id: 2, kind: 'message', byTaskId: 1, model: [assistant([
      { type: 'toolCall', id: 'd', name: 'delegate', arguments: { agent: 'fictional-researcher', task: 'Find fictional trains' } },
      { type: 'toolCall', id: 'p', name: 'present', arguments: { path: 'plan.md' } },
      { type: 'toolCall', id: 'q', name: 'ask_user', arguments: { question: 'Which fictional day?', options: ['Monday', 'Tuesday'] } },
      { type: 'toolCall', id: 'g', name: 'fictional_delete', arguments: { path: 'fictional/a.txt' } },
    ])] },
    { id: 3, kind: 'message', byTaskId: 1, model: [result('d', 'delegate', 'Found two fictional trains', delegated), result('p', 'present', JSON.stringify({ artifact }))] },
  ],
  // The gated call publishes its summary on its running slot before it asks, as `requireApproval` does.
  docs: { 'pi.live': { run: { taskId: 1 }, tools: [{ callId: 'g', details: { 'boring.approval': { summary: 'Delete fictional file?' } } }] } },
});

test('core-only PiChat: waiting notice for questions and approvals, tool step for a sub-agent, no artifact card', async t => {
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
  const snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view: view(), draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
  const controller = new Proxy({ getSnapshot: () => snapshot, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const answered = [];
  await act(async () => ui.render(createElement(PiChat, { controller, mode: 'developer', actions: { answer: async (id, answer) => { answered.push([id, answer]); return { kind: 'answered' }; } }, artifacts: { open: () => {} } })));
  const all = id => [...container.querySelectorAll(`[data-testid="${id}"]`)];

  const notices = all('answer-waiting');
  assert.equal(notices.length, 2, 'one waiting notice for the question and one for the approval');
  for (const notice of notices) {
    assert.equal(notice.getAttribute('role'), 'status', 'the notice is announced');
    assert.match(notice.textContent, /waiting for your answer/i, 'and says the run waits for the person');
    assert.equal(notice.querySelectorAll('button, input, textarea, select, a').length, 0, 'the notice offers no answer UI');
  }
  assert.deepEqual(notices.map(notice => notice.dataset.kind).sort(), ['approval', 'question']);
  assert.equal(all('question-card').length, 0, 'no question card without pi-chat-question');
  assert.equal(all('approval-card').length, 0, 'no approval card without pi-chat-approval');
  assert.equal(all('subagent-card').length, 0, 'no sub-agent card without pi-chat-subagent');
  assert.equal(all('artifact-card').length, 0, 'no artifact card without pi-artifacts');
  // The finished calls sit in the turn's collapsed activity block: open it as the person would.
  for (const trigger of container.querySelectorAll('[data-testid="activity"] > [data-slot] > button, [data-testid="activity"] button[aria-expanded="false"]')) await act(async () => trigger.click());
  const steps = all('tool-card').map(node => node.dataset.tool);
  assert.ok(steps.includes('delegate'), 'the sub-agent call stays an ordinary tool step');
  assert.ok(steps.includes('present'), 'the artifact call stays an ordinary tool step');
  assert.deepEqual(answered, [], 'nothing was answered for the person');
});
