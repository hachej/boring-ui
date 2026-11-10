// D-2085: the agent bar driven by the chat controller PiChat takes. The real AgentBar, AgentQuestion and AgentStatus over a fake controller
// (fictional view, same boundary as pi-chat-question-send): the agent asks, the card shows its choices, a tap answers and the run goes on;
// while it works the status says so and Annuler stops it; the bar's text is sent like the composer's.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const HOOK = new URL('../../registry/agent-bar/use-agent-bar-chat.ts', import.meta.url);
const ask = (id, args) => ({ type: 'toolCall', id, name: 'ask_user', arguments: args });
const assistant = (content, stopReason = content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop') => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason, timestamp: 1 });
const user = { id: 1, kind: 'message', model: [{ role: 'user', content: 'Prépare la tournée.', timestamp: 0 }] };
const round = (id, ...model) => ({ id, kind: 'message', byTaskId: 1, model });
const running = { 'pi.live': { run: { taskId: 1 } } };
const result = text => ({ role: 'toolResult', toolCallId: 'q', toolName: 'ask_user', content: [{ type: 'text', text }], isError: false, timestamp: 2 });
const QUESTION = { question: 'Quel port choisir ?', options: ['Port du nord', 'Port du sud'] };
const asking = { entries: [user, round(2, assistant([ask('q', QUESTION)]))], docs: running };
const answeredRunning = { entries: [user, round(2, assistant([ask('q', QUESTION)])), round(3, result(JSON.stringify({ kind: 'answered', answer: 'Port du sud' })))], docs: running };
const working = { entries: [user], docs: running };
const idle = { entries: [user, round(2, assistant([{ type: 'text', text: 'Fait.' }]))], docs: {} };

test('AgentBar, AgentQuestion and AgentStatus follow the chat controller through useAgentBarChat', { timeout: 30000 }, async t => {
  assert.ok(existsSync(HOOK), 'registry/agent-bar/use-agent-bar-chat.ts exists (the supported way to drive AgentBar from a chat controller)');
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'sessionStorage', 'localStorage', 'addEventListener', 'removeEventListener', 'matchMedia', 'innerWidth', 'innerHeight', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/agent-bar-chat/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('bar.mjs', out);
  await build({ stdin: { contents: `
    import { AgentBar, AgentStatus } from './agent-bar/agent-bar.tsx';
    import { useAgentBarChat } from './agent-bar/use-agent-bar-chat.ts';
    export function Harness({ controller, actions }) {
      const bar = useAgentBarChat(controller, { actions });
      return <>{bar.status ? <AgentStatus {...bar.status} /> : null}<AgentBar onSend={bar.onSend} {...(bar.question ? { question: bar.question } : {})} /></>;
    }`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'tsx' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' } });
  const { Harness } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });

  let snapshot, sends, answers, stops, listeners;
  const publish = async view => { snapshot = { ...snapshot, view }; await act(async () => { for (const listener of [...listeners]) listener(); }); };
  const controller = new Proxy({
    getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setText: text => { snapshot = { ...snapshot, draft: { ...snapshot.draft, text } }; }, setAttachments: () => {},
    send: async (kind, content) => { sends.push({ kind, content }); return { id: 'fictional-submission' }; },
    stop: async () => { stops++; },
  }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const answer = async (id, text) => { answers.push({ id, text }); await publish(answeredRunning); return { kind: 'answered' }; };
  const draw = async view => {
    sends = []; answers = []; stops = 0; listeners = new Set();
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view, draft: { text: '', attachments: [], version: 0 }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    await act(async () => root.render(createElement(Harness, { key: Math.random(), controller, actions: { answer } })));
  };
  const q = id => element.querySelector(`[data-testid=${id}]`);

  await t.test('the pending ask_user shows as the agent question with its choices; a tap answers and the run continues', async () => {
    await draw(asking);
    assert.equal(q('agent-question')?.getAttribute('aria-label'), QUESTION.question);
    const choices = [...element.querySelectorAll('[data-choice]')].map(node => node.textContent);
    assert.deepEqual(choices, QUESTION.options);
    await act(async () => { [...element.querySelectorAll('[data-choice]')][1].dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    assert.deepEqual(answers, [{ id: JSON.stringify([2, 'q']), text: 'Port du sud' }]);
    assert.equal(sends.length, 0, 'the answer goes through the answer action, not as a queued message');
    assert.equal(q('agent-question'), null, 'answered: the card is gone');
    assert.equal(q('agent-status')?.getAttribute('data-state'), 'working', 'the run goes on');
  });
  await t.test('text sent from the bar while the question is open answers it', async () => {
    await draw(asking);
    const input = q('agent-bar-input');
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Plutôt le nord'); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
    await act(async () => { input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    assert.deepEqual(answers.map(item => item.text), ['Plutôt le nord']);
    assert.equal(sends.length, 0);
  });
  await t.test('while the run works the status says working, and Annuler stops it; when it ends the status is done', async () => {
    await draw(working);
    assert.equal(q('agent-status')?.getAttribute('data-state'), 'working');
    assert.equal(q('agent-question'), null);
    const cancel = [...element.querySelectorAll('[data-testid=agent-status] button')].find(node => node.textContent === 'Annuler');
    await act(async () => { cancel.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    assert.equal(stops, 1, 'the controller is stopped once');
    await publish(idle);
    assert.equal(q('agent-status')?.getAttribute('data-state'), 'done');
    assert.equal(q('agent-status-spinner'), null);
  });
  await t.test('no run and no question: no status line; the bar text is sent like the composer sends it', async () => {
    await draw({ entries: [], docs: {} });
    assert.equal(q('agent-status'), null);
    const input = q('agent-bar-input');
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Prépare la tournée'); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
    await act(async () => { input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    assert.equal(sends.length, 1);
    assert.equal(sends[0].kind, 'followUp');
    assert.equal(sends[0].content.text, 'Prépare la tournée');
    assert.equal(answers.length, 0);
  });
});
