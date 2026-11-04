// A question card waiting does not block sending, and no harness text shows in natural presentation (D-1489): the real PiChat and
// QuestionCard over a native view at the controller boundary. Fictional text only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';

const QUESTION = 'Quel port choisir ?';
const ask = (id, args = { question: QUESTION }) => ({ type: 'toolCall', id, name: 'ask_user', arguments: args });
const assistant = (content, stopReason = content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop') => ({ role: 'assistant', content, api: 'fictional', provider: 'fictional', model: 'fictional', usage: {}, stopReason, timestamp: 1 });
const failed = (id, text) => ({ role: 'toolResult', toolCallId: id, toolName: 'ask_user', content: [{ type: 'text', text }], isError: true, timestamp: 2 });
const user = { id: 1, kind: 'message', model: [{ role: 'user', content: 'Prépare la tournée.', timestamp: 0 }] };
const round = (id, ...model) => ({ id, kind: 'message', byTaskId: 1, model });
const running = { 'pi.live': { run: { taskId: 1 } } };

const waiting = { entries: [user, round(2, assistant([ask('q')]))], docs: running };
const ABORTED = '<harness>\n[error] Tool ask_user was aborted\n</harness>';
const stopped = { entries: [user, round(2, assistant([ask('q')])), round(3, failed('q', ABORTED), assistant([], 'aborted'))], docs: {} };
const INVALID = 'Validation failed for tool "ask_user":\n  - options: must have 2 items\n\nReceived arguments:\n{\n  "question": "Quel port choisir ?",\n  "options": ["Port-Imaginaire"]\n}';
const ANSWERED = JSON.stringify({ kind: 'answered', answer: 'Le port du nord.' });
const answered = (...content) => ({ role: 'toolResult', toolCallId: 'q', toolName: 'ask_user', content: content.map(text => ({ type: 'text', text })), isError: false, timestamp: 2 });
const settled = { entries: [user, round(2, assistant([ask('q')])), round(3, answered(ANSWERED))], docs: running };
const warned = { entries: [user, round(2, assistant([ask('q')])), round(3, answered(ANSWERED, '<harness>\n[warning] Fictional output note\n</harness>'))], docs: running };
const invalid = { entries: [user, round(2, assistant([ask('q', { question: QUESTION, options: ['Port-Imaginaire'] })])), round(3, failed('q', INVALID), assistant([{ type: 'text', text: 'Je reformule.' }]))], docs: {} };

test('a typed message answers the waiting question, and natural presentation shows no harness text', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'sessionStorage', 'localStorage', 'addEventListener', 'removeEventListener', 'matchMedia', 'innerWidth', 'innerHeight', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/pi-chat-question-send/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('chat.mjs', out);
  await build({ stdin: { contents: `export { PiChat } from './pi-chat/pi-chat.tsx'; export { QuestionCard } from './pi-chat-question/question-card.tsx';`, resolveDir: new URL('../../registry/', import.meta.url).pathname, loader: 'ts' }, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { PiChat, QuestionCard } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });

  let snapshot, sends, answers, reply, calls;
  const setDraft = change => { snapshot = { ...snapshot, draft: { ...snapshot.draft, ...change } }; };
  const controller = new Proxy({
    getSnapshot: () => snapshot, subscribe: () => () => {},
    setText: text => setDraft({ text }), setAttachments: attachments => setDraft({ attachments }),
    send: async (kind, content) => { calls.push('send'); sends.push({ kind, content }); return { id: 'fictional-submission' }; },
    stop: async () => { calls.push('stop'); },
  }, { get: (target, key) => key in target ? target[key] : async () => {} });
  const answer = async (id, text) => { answers.push({ id, text }); return reply; };
  let drawn = 0;
  const draw = async (view, draft = {}, props = {}) => {
    sends = []; answers = []; calls = []; reply = { kind: 'answered' };
    snapshot = { identity: {}, conversationId: 'fictional', connection: { kind: 'connected' }, view, draft: { text: '', attachments: [], version: 0, ...draft }, outbox: [], history: { kind: 'disabled' }, send: { kind: 'idle' }, stop: 'idle', disposed: false };
    await act(async () => root.render(createElement(PiChat, { key: drawn++, controller, header: false, presentation: 'natural', cards: { question: QuestionCard }, actions: { answer }, ...props })));
  };
  const button = () => element.querySelector('[data-testid=composer] button[data-state]')?.getAttribute('data-state');
  const submit = () => act(async () => { element.querySelector('[data-testid=composer]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  const leaks = () => {
    assert.doesNotMatch(element.textContent, /harness|\[error\]|ask_user|Received arguments|was aborted|Validation failed/, 'no harness text or tool arguments on the page');
    assert.equal(Boolean(element.querySelector('[data-testid=question-card]')), false, 'no failed card');
  };
  const image = { id: 'photo', name: 'port.png', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } };

  await t.test('nothing typed: the primary button still stops the agent', async () => {
    await draw(waiting);
    assert.equal(button(), 'stop');
  });
  await t.test('text typed: the primary button sends, and the message answers the question', async () => {
    await draw(waiting, { text: 'Le port du nord.' });
    assert.equal(button(), 'send');
    assert.equal(Boolean(element.querySelector('[data-testid=composer-queue]')), false, 'nothing to queue');
    await submit();
    assert.deepEqual(answers, [{ id: JSON.stringify([2, 'q']), text: 'Le port du nord.' }]);
    assert.equal(sends.length, 0, 'not queued behind a run that waits for it');
    assert.equal(snapshot.draft.text, '', 'the composer empties');
  });
  await t.test('a picture goes after the answer, as a message of its own', async () => {
    await draw(waiting, { text: 'Celui-ci.', attachments: [image] });
    await submit();
    assert.deepEqual(answers.map(item => item.text), ['Celui-ci.']);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].kind, 'followUp');
    assert.deepEqual(sends[0].content.attachments.map(item => item.id), ['photo']);
    assert.equal(sends[0].content.text, '');
  });
  await t.test('a picture with no words still answers, with its name', async () => {
    await draw(waiting, { attachments: [image] });
    assert.equal(button(), 'send');
    await submit();
    assert.deepEqual(answers.map(item => item.text), ['port.png']);
    assert.equal(sends.length, 1);
  });
  for (const [why, outcome] of [['refuses it (options only, or too long)', { kind: 'denied', reason: 'The answer is not one of the options' }], ['has not started yet', { kind: 'unknown-question' }]]) {
    await t.test(`a question that ${why} is superseded: the run stops, then the message is sent`, async () => {
      await draw(waiting, { text: 'Autre chose.' });
      reply = outcome;
      await submit();
      assert.deepEqual(calls, ['stop', 'send'], 'stopped before sending, or the message waits behind the question');
      assert.equal(sends[0].content.text, 'Autre chose.');
    });
  }
  await t.test('a question that no longer waits: the message is sent as usual', async () => {
    await draw(waiting, { text: 'Le port du nord.' });
    reply = { kind: 'conflict', reason: 'The question was cancelled' };
    await submit();
    assert.deepEqual(calls, ['send'], 'answered elsewhere: the run goes on');
    assert.equal(sends[0].content.text, 'Le port du nord.');
  });
  await t.test('a second message sent before the first is settled does not stop the first', async () => {
    let refuse;
    const held = async (id, text) => { answers.push({ id, text }); await new Promise(resolve => { refuse = resolve; }); return { kind: 'denied' }; };
    await draw(waiting, { text: 'Premier.' }, { actions: { answer: held } });
    await submit();
    setDraft({ text: 'Second.' });
    await submit();
    await act(async () => { refuse(); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(answers.length, 1, 'the question is tried once');
    assert.deepEqual(calls, ['stop', 'send', 'send'], 'one stop, then both messages in order');
    assert.deepEqual(sends.map(item => item.content.text), ['Premier.', 'Second.']);
  });
  await t.test('pending feedback stays out of the answer, and stays pending', async () => {
    let attached = 0, marked = 0;
    const sendContext = { count: 1, attach: async text => { attached++; return { kind: 'ok', text: `${text}\n[rapport fictif]` }; }, sent: () => { marked++; } };
    await draw(waiting, { text: 'Le port du nord.' }, { sendContext });
    await submit();
    assert.deepEqual(answers.map(item => item.text), ['Le port du nord.']);
    assert.equal(attached, 0, 'not attached to the answer');
    assert.equal(marked, 0, 'still to send');
  });
  await t.test('a host with no answer path keeps queueing', async () => {
    await draw(waiting, { text: 'Le port du nord.' }, { actions: {} });
    assert.equal(button(), 'stop');
  });
  await t.test('once answered the form goes away and the answer shows', async () => {
    await draw(settled);
    assert.equal(Boolean(element.querySelector('[data-testid=question-input]')), false, 'no form left');
    assert.match(element.querySelector('[data-testid=question-answer]')?.textContent ?? '', /Le port du nord\./);
  });
  await t.test('a warning from the harness on an answered question stays out', async () => {
    await draw(warned);
    assert.doesNotMatch(element.textContent, /harness|Fictional output note|"kind"/);
    assert.match(element.querySelector('[data-testid=question-answer]')?.textContent ?? '', /Le port du nord\./);
  });
  await t.test('an answer that itself mentions harness tags is shown whole', async () => {
    const quoted = JSON.stringify({ kind: 'answered', answer: 'Garder <harness>ceci</harness> tel quel.' });
    await draw({ entries: [user, round(2, assistant([ask('q')])), round(3, answered(quoted))], docs: running });
    assert.match(element.querySelector('[data-testid=question-answer]')?.textContent ?? '', /Garder <harness>ceci<\/harness> tel quel\./);
  });
  await t.test('a stopped question leaves no harness text, live or after reload', async () => { await draw(stopped); leaks(); });
  await t.test('a refused question shows neither the validation error nor its arguments', async () => {
    await draw(invalid);
    leaks();
    assert.match(element.textContent, /Je reformule\./);
  });
});
