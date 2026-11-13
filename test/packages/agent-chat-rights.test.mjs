import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const endpoint = 'https://fixture.invalid/chat';
const json = { 'content-type': 'application/json' };
const until = async (label, check) => { const deadline = Date.now() + 5000; while (!check()) { assert.ok(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 10)); } };

// The viewer is refused by `allow` for every effect, as a person who may look but not act. Everything below is read from that side.
test('a viewer that allow refuses cannot send, stop, answer, withdraw or change the model, still watches live, and no hidden field leaves in any frame', async t => {
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const reached = [];
  const hide = view => ({ ...view, entries: view.entries.map(entry => ({ ...entry, data: undefined })) });
  const handler = createChatTransportHandler({ authenticate: async () => ({
    conversation, context, allow: () => false, project: hide,
    answer: async (...args) => { reached.push(['answer', args]); return { kind: 'answered' }; },
    configure: async change => { reached.push(['configure', change]); return { kind: 'configured' }; },
    abortSubmission: async id => { reached.push(['withdraw', id]); return { kind: 'withdrawn' }; },
  }) });
  const post = (op, body) => handler(new Request(`${endpoint}?op=${op}`, { method: 'POST', headers: json, body: JSON.stringify(body) }));
  assert.equal((await post('submit', { requestId: 'refused-1', content: 'Hello' })).status, 403);
  assert.equal((await post('abort', {})).status, 403);
  assert.equal((await post('answer', { callId: 'c1', answer: 'yes' })).status, 403);
  assert.equal((await post('configure', { model: { provider: 'fictional', modelId: 'fictional-large' } })).status, 403);
  assert.equal((await post('withdraw', { submissionId: 1 })).status, 403);
  assert.deepEqual(reached, [], 'nothing reached the host');
  assert.equal(fake.calls.length, 0, 'no model call started');

  const response = await handler(new Request(`${endpoint}?op=watch`));
  const reader = response.body.getReader(), decoder = new TextDecoder(), seen = [];
  let rest = '';
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      rest += decoder.decode(value, { stream: true });
      const lines = rest.split('\n'); rest = lines.pop();
      for (const line of lines) if (line) seen.push(line);
    }
  })();
  await until('the first view', () => seen.length > 0);
  await conversation.submit({ type: 'write', entry: { kind: 'fictional.note', data: { secret: 'HIDDEN-FIELD' }, model: [{ role: 'user', content: 'A visible fictional note', timestamp: 0 }] } }, context);
  await until('the live update', () => seen.some(line => line.includes('A visible fictional note')));
  await reader.cancel(); await pump.catch(() => undefined);
  assert.ok(seen.every(line => !line.includes('HIDDEN-FIELD')), 'no frame carries the hidden field');
});
