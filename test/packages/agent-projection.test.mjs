import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Harness, MemoryStorage, createRegistry, defineEntry, UserEntry, AssistantEntry, SystemEntry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createConversationProjectionHandler, createConversationTextReceiver } from '@hachej/boring-agent/projection';

async function fixture(t, overrides = {}) {
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  const revoked = new AbortController();
  t.after(() => revoked.abort());
  const checks = [];
  const access = { runtimeId: 'runtime-one', scopeId: 'fictional-project', principalId: 'alice', conversation, context,
    revoked: revoked.signal, authorize: async (identity, phase) => { checks.push({ identity, phase }); return true; },
    allowEntry: (_identity, entry) => entry.kind !== 'fixture.private', ...overrides };
  const handler = createConversationProjectionHandler({ authenticate: async request => request.headers.get('authorization') === 'Bearer fictional-token' ? access : null });
  const open = (url = 'https://fixture.invalid/conversation?version=2', init = {}) => handler(new Request(url, { headers: { authorization: 'Bearer fictional-token' }, ...init }));
  const append = text => conversation.commit(tx => tx.appendEntry(UserEntry, conversation.id, { model: [{ role: 'user', content: text, timestamp: 1 }] }), context);
  return { harness, conversation, access, revoked, checks, handler, open, append };
}

async function readFrame(reader) {
  const chunk = await reader.read();
  assert.equal(chunk.done, false);
  return JSON.parse(new TextDecoder().decode(chunk.value));
}

const assistant = content => ({ role: 'assistant', content, api: 'fixture', provider: 'fixture', model: 'no-model', timestamp: 1, stopReason: 'stop',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

test('actual native watch projects allowed text and IDs without private native fields', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await f.conversation.configure({ instructions: 'SECRET-config' }, context);
  const user = await f.append('Fictional visible text');
  await f.conversation.commit(async tx => {
    await tx.appendEntry(SystemEntry, f.conversation.id, { model: [{ role: 'system', content: 'SECRET-system' }] });
    await tx.appendEntry(defineEntry('fixture.private'), f.conversation.id, { data: { private: 'SECRET-data' }, model: [{ role: 'user', content: 'SECRET-denied-entry', timestamp: 1 }] });
    await tx.appendEntry(AssistantEntry, f.conversation.id, { model: [assistant([
      { type: 'thinking', thinking: 'SECRET-thinking' }, { type: 'text', text: 'Allowed answer' },
      { type: 'toolCall', id: 'SECRET-call', name: 'SECRET-tool', arguments: { key: 'SECRET-arguments' } },
    ])] });
  }, context);
  const response = await f.open();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const reader = response.body.getReader();
  t.after(() => reader.cancel());
  const value = await readFrame(reader);
  assert.equal(value.kind, 'snapshot');
  assert.equal(value.schema, 'boring.conversation-text');
  assert.equal(value.version, 2);
  assert.equal(value.nativeVersion, 'pi-durable@1.1.0');
  assert.deepEqual(value.source, { runtimeId: 'runtime-one', scopeId: 'fictional-project', principalId: 'alice', conversationId: f.conversation.id });
  assert.deepEqual(value.messages[0], { entryId: user.id, conversationId: f.conversation.id, messageIndex: 0, role: 'user',
    content: [{ blockIndex: 0, text: 'Fictional visible text' }], clipped: false });
  assert.deepEqual(value.messages[1].content, [{ blockIndex: 1, text: 'Allowed answer' }]);
  assert.equal(value.messages[1].clipped, false);
  assert.deepEqual(value.window, { truncated: false });
  assert.equal(JSON.stringify(value).includes('SECRET'), false);
  assert.equal('docs' in value, false);
  assert.equal(value.connection.frame, 0);
  assert(Number.isFinite(Date.parse(value.connection.observedAt)));
  assert.deepEqual(f.checks.map(check => check.phase), ['open', 'initial', 'delivery']);
});

test('native updates carry ordered deltas and reconnect starts a fresh snapshot without repeating effects', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  for (let index = 0; index < 5; index++) await f.append(`Fictional baseline ${index}`);
  const first = (await f.open()).body.getReader();
  const initial = await readFrame(first);
  const receiver = createConversationTextReceiver(initial.source);
  assert.deepEqual(receiver.read(JSON.stringify(initial)), initial);
  const next = readFrame(first);
  const entry = await f.append('one durable entry');
  const update = await next;
  assert.equal(update.kind, 'delta');
  assert.equal(update.baseFrame, 0);
  assert.equal(update.upsert.at(-1).entryId, entry.id);
  assert.equal(update.connection.frame, 1);
  assert.equal(update.connection.id, initial.connection.id);
  const current = receiver.read(JSON.stringify(update));
  assert.equal(current.messages.at(-1).entryId, entry.id);
  await first.cancel();
  const second = (await f.open()).body.getReader();
  t.after(() => second.cancel());
  const reopened = await readFrame(second);
  assert.equal(reopened.kind, 'snapshot');
  assert.deepEqual(reopened.messages, current.messages);
  assert.notEqual(reopened.connection.id, initial.connection.id);
  assert.equal(reopened.connection.frame, 0);
  assert.equal((await f.conversation.context(context)).entries.filter(item => item.id === entry.id).length, 1);
});

test('native reset removes prior row keys from the receiver window', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const before = await f.append('Fictional prior segment');
  const reader = (await f.open()).body.getReader();
  t.after(() => reader.cancel());
  const initial = await readFrame(reader);
  const receiver = createConversationTextReceiver(initial.source);
  assert.equal(receiver.read(JSON.stringify(initial)).messages[0].entryId, before.id);
  const next = readFrame(reader);
  await f.conversation.reset('Fictional new segment', context);
  const frame = await next;
  assert(['delta', 'snapshot'].includes(frame.kind));
  if (frame.kind === 'delta') assert.equal(frame.baseFrame, 0);
  assert.equal(receiver.read(JSON.stringify(frame)).messages.some(row => row.entryId === before.id), false);
});

test('missing authentication, version mismatch and non-read methods acquire no native watch', async t => {
  const f = await fixture(t);
  let acquisitions = 0;
  f.access.conversation = { ...f.conversation, watch: async () => { acquisitions++; throw new Error('must not open'); } };
  assert.equal((await f.handler(new Request('https://fixture.invalid/?version=2'))).status, 401);
  assert.equal((await f.open('https://fixture.invalid/?version=1')).status, 426);
  assert.equal((await f.open(undefined, { method: 'POST' })).status, 405);
  f.access.authorize = async () => false;
  assert.equal((await f.open()).status, 403);
  assert.equal(acquisitions, 0);
});

test('initial authorization is rechecked after native acquisition and denies all bytes', async t => {
  const f = await fixture(t, { authorize: async (_identity, phase) => phase !== 'initial' });
  await f.append('SECRET-initial');
  const response = await f.open();
  assert.equal(response.status, 403);
  assert.equal((await response.text()).includes('SECRET'), false);
  await f.conversation.configure({ instructions: 'Still alive' }, context);
});

test('delivery authorization is checked again for every native update', { timeout: 10000 }, async t => {
  let allowed = true;
  const f = await fixture(t, { authorize: async () => allowed });
  const reader = (await f.open()).body.getReader();
  await readFrame(reader);
  allowed = false;
  const next = reader.read();
  await f.append('SECRET-after-denial');
  assert.deepEqual(await next, { done: true, value: undefined });
  assert.equal((await f.conversation.context(context)).messages.at(-1).content, 'SECRET-after-denial');
});

test('idle revocation closes immediately and cancellation leaves independent native watches usable', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const independent = await f.conversation.watch(context);
  t.after(() => independent.stop());
  const observed = Promise.withResolvers();
  independent.start(async value => { if (value.entries.some(entry => entry.model?.some(message => message.content === 'Native remains usable'))) observed.resolve(); });
  const reader = (await f.open()).body.getReader();
  await readFrame(reader);
  const next = reader.read();
  f.revoked.abort();
  assert.deepEqual(await next, { done: true, value: undefined });
  await f.append('Native remains usable');
  await observed.promise;
});

test('revocation during asynchronous authorization prevents enqueuing the approved payload', { timeout: 10000 }, async t => {
  const entered = Promise.withResolvers(), proceed = Promise.withResolvers();
  const f = await fixture(t, { authorize: async (_identity, phase) => { if (phase === 'delivery') { entered.resolve(); await proceed.promise; } return true; } });
  await f.append('SECRET-race');
  const reader = (await f.open()).body.getReader();
  const next = reader.read();
  await entered.promise;
  f.revoked.abort();
  proceed.resolve();
  assert.deepEqual(await next, { done: true, value: undefined });
});

test('slow readers receive the latest bounded window without adapter update queues', { timeout: 10000 }, async t => {
  let deliveries = 0;
  const f = await fixture(t, { authorize: async (_identity, phase) => { if (phase === 'delivery') deliveries++; return true; } });
  const reader = (await f.open()).body.getReader();
  t.after(() => reader.cancel());
  const initial = await readFrame(reader);
  const receiver = createConversationTextReceiver(initial.source);
  receiver.read(JSON.stringify(initial));
  for (let i = 0; i < 20; i++) await f.append(`Fictional ${i}`);
  await delay(10);
  assert.equal(deliveries, 1);
  const frame = await readFrame(reader);
  assert(['delta', 'snapshot'].includes(frame.kind));
  const current = receiver.read(JSON.stringify(frame));
  assert.equal(current.messages.length, 20);
  assert.equal(current.messages.at(-1).content[0].text, 'Fictional 19');
  assert.equal(current.connection.frame, 1);
  assert.equal(deliveries, 2);
});

test('identity changes require a new revoked binding and do not retarget the old projection', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const old = (await f.open()).body.getReader();
  const before = await readFrame(old);
  f.revoked.abort();
  f.access.scopeId = 'another-project';
  f.access.principalId = 'bob';
  const newRevocation = new AbortController();
  f.access.revoked = newRevocation.signal;
  const fresh = (await f.open()).body.getReader();
  t.after(() => fresh.cancel());
  const after = await readFrame(fresh);
  assert.equal(before.source.principalId, 'alice');
  assert.equal(after.source.principalId, 'bob');
  assert.equal(after.source.scopeId, 'another-project');
  assert.notEqual(before.connection.id, after.connection.id);
  assert.equal((await old.read()).done, true);
});

test('native closure and host errors close observation without leaking error detail or asserting task termination', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  f.access.authorize = async () => { throw new Error('SECRET-policy'); };
  const unavailable = await f.open();
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.text()).includes('SECRET'), false);
  f.access.authorize = async () => true;
  const reader = (await f.open()).body.getReader();
  await readFrame(reader);
  const next = reader.read();
  await f.harness.close(context);
  assert.deepEqual(await next, { done: true, value: undefined });
});

test('JavaScript policy results require explicit true instead of truthy strings or promises', async t => {
  for (const phase of ['open', 'initial', 'delivery']) {
    const f = await fixture(t, { authorize: async (_identity, current) => current === phase ? 'denied' : true });
    await f.append('SECRET-misconfigured-policy');
    const response = await f.open();
    assert.equal(response.status, phase === 'delivery' ? 200 : 403);
    assert.equal((await response.text()).includes('SECRET'), false);
  }
  const f = await fixture(t, { allowEntry: async () => false });
  await f.append('SECRET-async-policy');
  const reader = (await f.open()).body.getReader();
  t.after(() => reader.cancel());
  assert.deepEqual((await readFrame(reader)).messages, []);
});

test('inherited entry permission uses original native conversation identity', async t => {
  const f = await fixture(t);
  const original = await f.append('SECRET-inherited');
  const fork = await f.conversation.fork(original.id, { ownership: { kind: 'ownerless' } }, context);
  const own = await fork.commit(tx => tx.appendEntry(UserEntry, fork.id, { model: [{ role: 'user', content: 'Fork content', timestamp: 1 }] }), context);
  f.access.conversation = fork;
  const origins = [];
  f.access.allowEntry = (identity, entry) => { origins.push(entry.conversationId); return identity.conversationId === entry.conversationId; };
  const reader = (await f.open()).body.getReader();
  t.after(() => reader.cancel());
  const projected = await readFrame(reader);
  const receiver = createConversationTextReceiver(projected.source);
  receiver.read(JSON.stringify(projected));
  assert(origins.includes(f.conversation.id));
  assert.deepEqual(projected.messages.map(message => message.entryId), [own.id]);
  assert.equal(projected.messages[0].conversationId, fork.id);
  assert.equal(JSON.stringify(projected).includes('SECRET'), false);
  const next = readFrame(reader);
  const later = await fork.commit(tx => tx.appendEntry(UserEntry, fork.id, { model: [{ role: 'user', content: 'Later fork text', timestamp: 2 }] }), context);
  const frame = await next;
  assert(['delta', 'snapshot'].includes(frame.kind));
  const current = receiver.read(JSON.stringify(frame));
  assert.deepEqual(current.messages.map(message => message.entryId), [own.id, later.id]);
  assert.equal(JSON.stringify(current).includes('SECRET'), false);
});

test('authenticated policy callbacks keep their access object receiver', async t => {
  const f = await fixture(t);
  const entry = await f.append('Receiver-authorized text');
  f.access.granted = true;
  f.access.allowed = new Set([entry.id]);
  f.access.authorize = async function () { return this.granted; };
  f.access.allowEntry = function (_identity, candidate) { return this.allowed.has(candidate.id); };
  const response = await f.open();
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  t.after(() => reader.cancel());
  assert.deepEqual((await readFrame(reader)).messages.map(row => row.entryId), [entry.id]);
});
