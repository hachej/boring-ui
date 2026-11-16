// The folded card of `AppShell composer="bar"` decides what it shows from the chat's state: a question, the work, a failed turn or a reply.
// A failed turn must be visible there (with the conversation folded the thread's own notice is out of sight) and must go with the next turn.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';

const out = new URL('../../.cache/folded-card/', import.meta.url); mkdirSync(out, { recursive: true });
const output = new URL('folded-card.mjs', out);
await build({ entryPoints: [new URL('../../registry/agent-bar/folded-card.ts', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', packages: 'external' });
const { foldedCardKind, failedReply } = await import(output.href);

const user = key => ({ key, type: 'user', message: { role: 'user', content: 'Envoie le rapport de mars.', timestamp: 0 } });
const assistant = (key, stopReason, text = '') => ({ key, type: 'assistant', parts: [], streaming: false, stopReason, text, entryId: key.slice(1), timestamp: 5, model: { provider: 'fictional', modelId: 'fictional' }, durationMs: 40 });
const none = { question: false, working: false, failed: false, reply: false };

test('the folded card shows one thing, in the order question, work, failure, reply', () => {
  const table = [
    ['nothing to show', none, undefined],
    ['a question', { ...none, question: true }, 'question'],
    ['a question over work', { ...none, question: true, working: true }, 'question'],
    ['work', { ...none, working: true }, 'working'],
    ['work of the next turn over an earlier failure', { ...none, working: true, failed: true }, 'working'],
    ['a failed turn', { ...none, failed: true }, 'failed'],
    ['a failed turn that wrote some text first', { ...none, failed: true, reply: true }, 'failed'],
    ['a reply', { ...none, reply: true }, 'reply'],
    ['a question over a failure', { ...none, question: true, failed: true }, 'question'],
  ];
  for (const [name, state, expected] of table) assert.equal(foldedCardKind(state), expected, name);
});

test('a turn failed only while the assistant\'s failed message is the last one', () => {
  const failed = assistant('a2', 'error');
  assert.equal(failedReply([]), undefined, 'empty conversation');
  assert.equal(failedReply([user('u1'), assistant('a1', 'stop', 'Fait.')]), undefined, 'a successful turn');
  assert.equal(failedReply([user('u1'), assistant('a1', 'aborted')]), undefined, 'a stopped run is not a failure');
  assert.deepEqual(failedReply([user('u1'), failed]), { key: 'a2', text: '', entryId: '2', timestamp: 5, model: { provider: 'fictional', modelId: 'fictional' }, durationMs: 40 }, 'the reference the thread\'s replyError gets');
  assert.equal(failedReply([user('u1'), failed, user('u3')]), undefined, 'the person sent again');
  assert.equal(failedReply([user('u1'), failed, user('u3'), assistant('a4', 'stop', 'Fait.')]), undefined, 'the next turn answered');
  assert.equal(failedReply([user('u1'), failed, { key: 'e', type: 'event', label: 'x' }])?.key, 'a2', 'a row that is not a message does not clear it');
});
