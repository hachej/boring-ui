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
// D-2198: a read that publishes its progress, a two-question form, a reply that cites a file.
const reading = { entries: [user, round(2, assistant([{ type: 'toolCall', id: 'r', name: 'read', arguments: { path: 'uploads/releve-fictif.pdf' } }]))], docs: { 'pi.live': { run: { taskId: 1 }, tools: [{ callId: 'r', status: 'running', details: { progress: '3 lignes sur 9' } }] } } };
const FORM = { question: 'Deux précisions', questions: [{ question: 'Quel exercice ?', options: ['2025', '2026'] }, { question: 'Quel journal ?', options: ['Achats', 'Ventes'] }] };
const formAsking = { entries: [user, round(2, assistant([ask('q', FORM)]))], docs: running };
const replied = { entries: [user, round(2, assistant([{ type: 'toolCall', id: 'r', name: 'read', arguments: { path: 'uploads/releve-fictif.pdf' } }])), round(3, { role: 'toolResult', toolCallId: 'r', toolName: 'read', content: [{ type: 'text', text: '9 lignes' }], isError: false, timestamp: 2 }), round(4, assistant([{ type: 'text', text: 'Rapproché. Voir @uploads/ecarts-fictifs.csv.' }]))], docs: {} };

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
      globalThis.__question = bar.question;
      return <>{bar.status ? <AgentStatus {...bar.status} /> : null}
        {bar.reply ? <p data-testid="probe-reply" data-used={bar.reply.used.join(',')} data-files={bar.reply.files.join(',')}>{bar.reply.text}</p> : null}
        <button type="button" data-testid="probe-read" onClick={bar.markRead}>read</button>
        <AgentBar onSend={bar.onSend} onHistory={() => {}} {...(bar.historyBadge ? { historyBadge: bar.historyBadge } : {})} {...(bar.question ? { question: bar.question } : {})} /></>;
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
  await t.test('D-2198: while a tool runs the status is its own words and progress, not « En cours »', async () => {
    await draw(reading);
    const words = element.querySelector('[data-testid=agent-status]')?.textContent ?? '';
    assert.equal(words.includes('Lecture uploads/releve-fictif.pdf · 3 lignes sur 9'), true, words);
    assert.equal(words.includes('En cours'), false);
  });
  await t.test('D-2198: a two-question form asks both questions in turn and answers them together, never « Pas de réponse »', async () => {
    await draw(formAsking);
    assert.equal(q('agent-question')?.getAttribute('aria-label'), 'Quel exercice ?');
    assert.equal(q('agent-question-step')?.textContent, 'Deux précisions · 1 sur 2');
    await act(async () => { [...element.querySelectorAll('[data-choice]')].find(node => node.textContent === '2026').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    assert.equal(answers.length, 0, 'nothing is answered before the last question');
    assert.equal(q('agent-question')?.getAttribute('aria-label'), 'Quel journal ?');
    assert.equal(q('agent-question-step')?.textContent, 'Deux précisions · 2 sur 2');
    assert.equal(q('agent-question-answered')?.textContent.includes('2026'), true);
    await act(async () => { [...element.querySelectorAll('[data-choice]')].find(node => node.textContent === 'Ventes').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    assert.equal(answers.length, 1);
    assert.equal(answers[0].text, '1. Quel exercice ?\n→ 2026\n\n2. Quel journal ?\n→ Ventes');
    assert.equal(answers[0].text.includes('Pas de réponse'), false);
  });
  await t.test('D-2198 AC-8: a blank answer to a form question is not an answer: the question stays, nothing is sent', async () => {
    await draw(formAsking);
    await act(async () => { globalThis.__question.onAnswer({ text: '   ', source: 'text' }); });
    assert.equal(q('agent-question')?.getAttribute('aria-label'), 'Quel exercice ?', 'still the first question');
    assert.equal(answers.length, 0);
  });
  await t.test('D-2198: a reply after a run is kept with the dot until read; history found at mount is not a new reply', async () => {
    await draw(replied);
    assert.equal(q('probe-reply'), null, 'the history is not unread');
    assert.equal(q('agent-bar-history-badge'), null);
    await draw(reading);
    await publish(replied);
    assert.equal(q('probe-reply')?.textContent, 'Rapproché. Voir @uploads/ecarts-fictifs.csv.');
    assert.equal(q('probe-reply')?.getAttribute('data-used'), 'releve-fictif.pdf', 'what the run used');
    assert.equal(q('probe-reply')?.getAttribute('data-files'), 'uploads/ecarts-fictifs.csv', 'the file it cites');
    assert.equal(q('agent-bar-history-badge')?.getAttribute('aria-label'), 'Nouvelle réponse');
    await act(async () => { q('probe-read').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    assert.equal(q('probe-reply'), null, 'read');
    assert.equal(q('agent-bar-history-badge'), null);
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
