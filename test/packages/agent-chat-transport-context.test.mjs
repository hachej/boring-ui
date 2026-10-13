import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { createFakeChatModel } from '@hachej/boring-testing/model';

// The `context` field of a submit: stored by the host through `requestContext` before the conversation sees the input.
const endpoint = 'https://fixture.invalid/chat';
const json = { 'content-type': 'application/json' };

async function fixture(t, extra) {
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const order = [];
  const submit = conversation.submit.bind(conversation);
  const watched = new Proxy(conversation, { get: (target, key) => key === 'submit' ? (...args) => { order.push('submit'); return submit(...args); } : Reflect.get(target, key, target) });
  const handler = createChatTransportHandler({ authenticate: async () => ({ conversation: watched, context, ...extra(order) }) });
  t.after(() => harness.close(context));
  const post = body => handler(new Request(`${endpoint}?op=submit`, { method: 'POST', headers: json, body: JSON.stringify({ requestId: crypto.randomUUID(), content: 'Hello', ...body }) }));
  return { post, order };
}

test('the screen context is handed to the host before the conversation sees the submit', async t => {
  const seen = [];
  const { post, order } = await fixture(t, order => ({ requestContext: value => { order.push('context'); seen.push(value); } }));
  const response = await post({ context: { name: 'Progrès', params: { range: 30 } } });
  assert.equal(response.status, 200);
  assert.deepEqual(seen, [{ name: 'Progrès', params: { range: 30 } }]);
  assert.deepEqual(order, ['context', 'submit']);
});

test('a submit without context does not call the host, and a non-object or oversized context is invalid', async t => {
  const seen = [];
  const { post, order } = await fixture(t, () => ({ requestContext: value => { seen.push(value); } }));
  assert.equal((await post({})).status, 200);
  assert.deepEqual(seen, []);
  for (const bad of ['text', 7, null, [1], { note: 'x'.repeat(4097) }]) {
    const response = await post({ context: bad });
    assert.equal(response.status, 400, JSON.stringify(bad).slice(0, 30));
    assert.equal((await response.json()).reason, 'invalid-request');
  }
  assert.deepEqual(seen, []);
  assert.deepEqual(order, ['submit'], 'only the valid submit reached the conversation');
  assert.equal((await post({ context: { note: 'x'.repeat(4000) } })).status, 200, 'under the limit is accepted');
});

test('a host without requestContext ignores the field, even a malformed one', async t => {
  const { post, order } = await fixture(t, () => ({}));
  assert.equal((await post({ context: { name: 'Progrès' } })).status, 200);
  assert.equal((await post({ context: 'not an object' })).status, 200);
  assert.deepEqual(order, ['submit', 'submit']);
});
