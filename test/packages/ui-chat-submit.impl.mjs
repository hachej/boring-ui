import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import * as chatView from '@hachej/boring-ui-kit/chat-view';
import * as chatReact from '@hachej/boring-ui-kit/chat-react';

// SUBMIT_BASELINE names a module that holds the pre-extraction logic (the cards' inline state) under the same names; used to show
// the same tests pass against the old path. Unset, the tests run against the public kit output.
const baseline = process.env.SUBMIT_BASELINE ? await import(process.env.SUBMIT_BASELINE) : undefined;
const { useSubmitOutcome } = baseline ?? chatReact;
const { parseQuestion, formAnswer, splitFormAnswer, parseAnswer } = baseline ?? chatView;

const window = new Window({ url: 'https://fictional.invalid/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, createElement: h, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
test.after(() => window.happyDOM.close());

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function mount(t, options) {
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element); let api; let mounted = true;
  const Probe = props => { api = useSubmitOutcome(props); return h('p', null, 'probe'); };
  await act(async () => root.render(h(StrictMode, null, h(Probe, options))));
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
  t.after(async () => { await unmount(); element.remove(); });
  return { get api() { return api; }, unmount };
}
const words = { refused: kind => `refused:${kind}`, notSent: 'not sent' };

test('an accepted send is sending, then sent; the value stays', async t => {
  const gate = deferred(); const seen = [];
  const page = await mount(t, { ...words, send: value => { seen.push(value); return gate.promise; } });
  let pending; await act(async () => { pending = page.api.submit('Approve'); });
  assert.equal(page.api.sending, 'Approve'); assert.equal(page.api.sent, undefined);
  await act(async () => { gate.resolve({ kind: 'answered' }); await pending; });
  assert.equal(page.api.sending, undefined); assert.equal(page.api.sent, 'Approve'); assert.equal(page.api.refusal, undefined);
  assert.deepEqual(seen, ['Approve']);
});

test('a second submit while one is in flight is dropped', async t => {
  const gate = deferred(); let calls = 0;
  const page = await mount(t, { ...words, send: () => { calls++; return gate.promise; } });
  let first, second;
  await act(async () => { first = page.api.submit('Approve'); });
  await act(async () => { second = page.api.submit('Deny'); });
  assert.equal(calls, 1); assert.equal(page.api.sending, 'Approve');
  await act(async () => { gate.resolve({ kind: 'answered' }); await first; await second; });
  assert.equal(page.api.sent, 'Approve');
});

test('a refusal shows its reason, else the caller words for its kind, and the next send clears it', async t => {
  const outcomes = [{ kind: 'denied', reason: 'Not yours to answer.' }, { kind: 'conflict' }, { kind: 'answered' }];
  const gate = deferred(); let next = 0;
  const page = await mount(t, { ...words, send: async () => { const outcome = outcomes[next++]; if (outcome.kind === 'answered') await gate.promise; return outcome; } });
  await act(async () => { await page.api.submit('a'); });
  assert.equal(page.api.refusal, 'Not yours to answer.'); assert.equal(page.api.sent, undefined); assert.equal(page.api.sending, undefined);
  await act(async () => { await page.api.submit('a'); });
  assert.equal(page.api.refusal, 'refused:conflict');
  let pending; await act(async () => { pending = page.api.submit('a'); });
  assert.equal(page.api.refusal, undefined, 'a new send clears the last refusal');
  await act(async () => { gate.resolve(); await pending; });
  assert.equal(page.api.sent, 'a');
});

test('a thrown send is its message when an Error, else the caller words, and can be retried', async t => {
  const failures = [new Error('network down'), 'plain string'];
  const page = await mount(t, { ...words, send: async () => { if (failures.length) throw failures.shift(); return { kind: 'answered' }; } });
  await act(async () => { await page.api.submit('x'); });
  assert.equal(page.api.refusal, 'network down'); assert.equal(page.api.sending, undefined);
  await act(async () => { await page.api.submit('x'); });
  assert.equal(page.api.refusal, 'not sent');
  await act(async () => { await page.api.submit('x'); });
  assert.equal(page.api.sent, 'x'); assert.equal(page.api.refusal, undefined);
});

test('a send that settles after unmount sets no state and warns of nothing', async t => {
  const gate = deferred(); const errors = [];
  const original = console.error; console.error = (...args) => { errors.push(args.join(' ')); };
  t.after(() => { console.error = original; });
  const page = await mount(t, { ...words, send: () => gate.promise });
  let pending; await act(async () => { pending = page.api.submit('Approve'); });
  await page.unmount();
  gate.resolve({ kind: 'answered' }); await pending;
  assert.deepEqual(errors, []);
});

test('the submit of the latest render reads the latest send', async t => {
  const calls = [];
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element); let api;
  const Probe = props => { api = useSubmitOutcome(props); return null; };
  t.after(async () => { await act(async () => root.unmount()); element.remove(); });
  await act(async () => root.render(h(Probe, { ...words, send: async value => { calls.push(['one', value]); return { kind: 'answered' }; } })));
  await act(async () => root.render(h(Probe, { ...words, send: async value => { calls.push(['two', value]); return { kind: 'answered' }; } })));
  await act(async () => { await api.submit('v'); });
  assert.deepEqual(calls, [['two', 'v']]);
});

const call = args => ({ type: 'toolCall', id: 'call-1', name: 'ask_user', arguments: args });
const result = (text, isError = false) => ({ role: 'toolResult', toolCallId: 'call-1', toolName: 'ask_user', content: [{ type: 'text', text }], isError, timestamp: 0 });

test('parseQuestion reads a single question and refuses untrusted shapes', () => {
  assert.deepEqual(parseQuestion(call({ question: 'Which colour?', options: ['red', 'blue'] })), { question: 'Which colour?', options: ['red', 'blue'], allowFreeText: true, items: [] });
  assert.equal(parseQuestion(call({ question: 'Q', options: ['a'], allowFreeText: false })).allowFreeText, false);
  assert.equal(parseQuestion(call({ question: 'Q', allowFreeText: false })).allowFreeText, true, 'free text is always allowed with no options');
  assert.deepEqual(parseQuestion(call({ question: 7, options: 'red', questions: 'x', allowFreeText: 'no' })), { question: '', options: [], allowFreeText: true, items: [] });
  assert.deepEqual(parseQuestion(call({ options: ['', 3, null, 'ok', 'a', 'b', 'c', 'd', 'e'] })).options, ['ok', 'a', 'b', 'c', 'd', 'e'], 'non-strings and empty strings dropped, then capped at 6');
  assert.deepEqual(parseQuestion(call({})), { question: '', options: [], allowFreeText: true, items: [] });
});

test('parseQuestion reads a form: up to 8 questions, bad entries skipped', () => {
  const questions = [{ question: 'One', options: ['a', 'b'] }, null, 'text', { question: '' }, { options: ['x'] }, { question: 'Two' }];
  assert.deepEqual(parseQuestion(call({ question: 'Form', questions })).items, [{ question: 'One', options: ['a', 'b'] }, { question: 'Two', options: [] }]);
  const many = Array.from({ length: 12 }, (_, i) => ({ question: `Q${i}` }));
  assert.equal(parseQuestion(call({ question: 'Form', questions: many })).items.length, 8);
});

test('formAnswer and splitFormAnswer round trip, including skipped and multi-line answers', () => {
  if (!splitFormAnswer) return; // the old copy did not export it
  const items = [{ question: 'Colour?', options: [] }, { question: 'Size?', options: [] }, { question: 'Notes?', options: [] }];
  const text = formAnswer(items, ['  red ', '', 'line one\nline two'], 'skipped');
  assert.equal(text, '1. Colour?\n→ red\n\n2. Size?\n→ skipped\n\n3. Notes?\n→ line one\nline two');
  assert.deepEqual(splitFormAnswer(items, text), ['red', 'skipped', 'line one\nline two']);
  assert.equal(formAnswer(items, [], 'none'), '1. Colour?\n→ none\n\n2. Size?\n→ none\n\n3. Notes?\n→ none');
});

test('splitFormAnswer returns undefined for text that is not a form answer', () => {
  if (!splitFormAnswer) return;
  const items = [{ question: 'A?', options: [] }, { question: 'B?', options: [] }];
  assert.equal(splitFormAnswer(items, 'just words'), undefined);
  assert.equal(splitFormAnswer(items, '1. A?\n→ yes'), undefined, 'the second question is missing');
  assert.equal(splitFormAnswer(items, '1. A?\n→ yes\n\n2. Other?\n→ no'), undefined, 'a different second question');
  assert.equal(splitFormAnswer(items, ''), undefined);
  assert.deepEqual(splitFormAnswer([], 'anything'), [], 'no questions: no answers');
});

test('parseAnswer reads answered results and falls back to the failure text', () => {
  assert.equal(parseAnswer(undefined), undefined);
  assert.deepEqual(parseAnswer(result('{"kind":"answered","answer":"blue"}')), { answer: 'blue' });
  assert.deepEqual(parseAnswer(result('{"kind":"answered","answer":5}')), { failure: '{"kind":"answered","answer":5}' });
  assert.deepEqual(parseAnswer(result('{"kind":"skipped"}')), { failure: '{"kind":"skipped"}' });
  assert.deepEqual(parseAnswer(result('not json')), { failure: 'not json' });
  assert.deepEqual(parseAnswer(result('null')), { failure: 'null' });
  assert.deepEqual(parseAnswer(result('{"kind":"answered","answer":"x"}', true)), { failure: '{"kind":"answered","answer":"x"}' }, 'an error result is never an answer');
  const withHarness = { ...result(''), content: [{ type: 'text', text: '{"kind":"answered","answer":"ok"}' }, { type: 'text', text: '<harness>diagnostic for the model</harness>' }] };
  assert.deepEqual(parseAnswer(withHarness), { answer: 'ok' });
  assert.deepEqual(parseAnswer({ ...withHarness, isError: true, content: [{ type: 'text', text: 'Stopped.' }, { type: 'text', text: '<harness>x</harness>' }] }), { failure: 'Stopped.' });
});

test('watchConversation needs no injected question parser', { skip: baseline !== undefined }, () => {
  const source = { getSnapshot: () => ({ connection: { kind: 'connected' }, view: { entries: [], docs: {} }, draft: { text: '', version: 0 } }), subscribe: () => () => {} };
  const store = chatReact.createNotificationStore();
  const stop = chatReact.watchConversation(source, store, { conversationId: 'c1', title: 'Fictional chat' });
  stop();
  assert.deepEqual(store.getSnapshot(), []);
});
