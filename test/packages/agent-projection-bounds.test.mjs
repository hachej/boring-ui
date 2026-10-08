import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry, defineEntry, UserEntry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createConversationProjectionHandler, createConversationTextReceiver, CONVERSATION_PROJECTION_LIMITS as limits } from '@hachej/boring-agent/projection';

const encoder = new TextEncoder();
const encoded = value => encoder.encode(JSON.stringify(value)).byteLength;
const key = row => ({ conversationId: row.conversationId, entryId: row.entryId, messageIndex: row.messageIndex });
const user = content => ({ role: 'user', content, timestamp: 1 });
const privateEntry = defineEntry('fixture.private');

async function fixture(t, overrides = {}) {
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: createModels() }, context);
  const conversation = await harness.root(context);
  const revoked = new AbortController();
  const identity = { runtimeId: 'fictional-runtime', scopeId: 'fictional-team', principalId: 'fictional-reader', conversationId: conversation.id };
  const handler = createConversationProjectionHandler({ authenticate: async () => ({ ...identity, conversation, context, revoked: revoked.signal,
    authorize: async () => true, allowEntry: (_identity, entry) => entry.kind !== privateEntry.kind, ...overrides }) });
  const readers = [];
  t.after(async () => { revoked.abort(); for (const reader of readers) await reader.cancel(); await harness.close(context); });
  const open = async () => {
    const response = await handler(new Request('https://fictional.invalid/conversation?version=2'));
    assert.equal(response.status, 200);
    const reader = response.body.getReader(); readers.push(reader); return reader;
  };
  const append = content => conversation.commit(tx => tx.appendEntry(UserEntry, conversation.id, { model: [user(content)] }), context);
  return { harness, conversation, identity, open, append };
}

async function frame(reader) {
  const result = await reader.read();
  assert.equal(result.done, false);
  assert.ok(result.value.byteLength <= limits.maxFrameBytes);
  const line = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.value);
  assert.equal(line.at(-1), '\n');
  return { line, value: JSON.parse(line), bytes: result.value.byteLength };
}

function bounded(messages) {
  assert.ok(messages.length <= limits.maxMessages);
  assert.ok(encoded(messages) <= limits.maxWindowBytes);
  for (const row of messages) assert.ok(encoded(row) <= limits.maxMessageBytes);
}

test('projection exports the v2 row and encoded-byte limits', () => {
  assert.deepEqual(limits, { maxMessages: 200, maxMessageBytes: 32768, maxWindowBytes: 196608, maxFrameBytes: 262144 });
});

test('10,000 native entries produce only the newest 200 permitted messages in a bounded initial frame', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const entries = await f.conversation.commit(async tx => {
    const ids = [];
    for (let i = 0; i < 10000; i++) ids.push((await tx.appendEntry(UserEntry, f.conversation.id, { model: [user(`Fictional message ${i}`)] })).id);
    return ids;
  }, context);
  const initial = await frame(await f.open());
  t.diagnostic(JSON.stringify({ fixture: '10000-native-entries', bytes: initial.bytes, rows: initial.value.messages.length }));
  assert.equal(initial.value.kind, 'snapshot'); assert.equal(initial.value.connection.frame, 0);
  assert.equal(initial.value.window.truncated, true); bounded(initial.value.messages);
  assert.equal(initial.value.messages.length, 200);
  assert.deepEqual(initial.value.messages.map(row => row.entryId), entries.slice(-200));
  assert.equal(initial.value.messages[0].content[0].text, 'Fictional message 9800');
  assert.equal(initial.value.messages.at(-1).content[0].text, 'Fictional message 9999');
  assert.deepEqual(createConversationTextReceiver(f.identity).read(initial.line).messages, initial.value.messages);
});

test('one native entry with many messages obeys the row limit and retains original message indices', async t => {
  const f = await fixture(t);
  const entry = await f.conversation.commit(tx => tx.appendEntry(UserEntry, f.conversation.id,
    { model: Array.from({ length: 250 }, (_, i) => user(`Fictional part ${i}`)) }), context);
  const initial = (await frame(await f.open())).value;
  bounded(initial.messages); assert.equal(initial.messages.length, 200); assert.equal(initial.window.truncated, true);
  assert.deepEqual(initial.messages.map(row => row.messageIndex), Array.from({ length: 200 }, (_, i) => i + 50));
  assert.ok(initial.messages.every(row => row.entryId === entry.id && row.conversationId === f.conversation.id));
});

test('clipping counts JSON escaping bytes and preserves leading FEFF and complete astral scalars', async t => {
  const f = await fixture(t);
  const source = '\uFEFF\u{1F680}' + '"\\\n\u0000\u{1F680}'.repeat(10000);
  await f.append(source);
  const initial = await frame(await f.open());
  bounded(initial.value.messages); assert.equal(initial.value.messages.length, 1);
  const row = initial.value.messages[0], visible = row.content[0].text;
  assert.equal(row.clipped, true); assert.ok(visible.length < source.length);
  assert.equal(visible.codePointAt(0), 0xfeff); assert.equal(visible.codePointAt(1), 0x1f680);
  assert.equal(visible.isWellFormed(), true); assert.ok(source.startsWith(visible));
  assert.equal(initial.bytes, encoder.encode(initial.line).byteLength);
  assert.deepEqual(createConversationTextReceiver(f.identity).read(initial.line).messages, initial.value.messages);
});

test('aggregate encoded window bytes bound several individually permitted native messages', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 12; i++) await f.append(`${i}:` + 'x'.repeat(24000));
  const initial = (await frame(await f.open())).value;
  bounded(initial.messages); assert.equal(initial.window.truncated, true);
  assert.equal(initial.messages.length, 8); assert.ok(initial.messages.every(row => row.clipped === false));
  assert.ok(initial.messages[0].content[0].text.startsWith('4:'));
  assert.ok(initial.messages.at(-1).content[0].text.startsWith('11:'));
});

test('configuration and denied entries emit no frames; the next real append carries only changed text', { timeout: 10000 }, async t => {
  let witness;
  const f = await fixture(t, { authorize: async (_identity, phase) => { if (phase === 'delivery') witness?.resolve(); return true; } });
  const original = await f.append('Fictional retained content '.repeat(300));
  const reader = await f.open(), initial = await frame(reader);
  const pending = frame(reader);
  witness = Promise.withResolvers();
  await f.conversation.configure({ instructions: 'SECRET-configuration' }, context);
  await witness.promise;
  witness = Promise.withResolvers();
  await f.conversation.commit(tx => tx.appendEntry(privateEntry, f.conversation.id, { model: [user('SECRET-private-entry')] }), context);
  await witness.promise;
  const appended = await f.append('Fictional new text');
  const update = await pending;
  t.diagnostic(JSON.stringify({ fixture: 'configuration-and-denied-no-ops-then-append', initialBytes: initial.bytes, updateBytes: update.bytes, frame: update.value.connection.frame }));
  assert.equal(update.value.kind, 'delta'); assert.equal(update.value.baseFrame, 0); assert.equal(update.value.connection.frame, 1);
  assert.deepEqual(update.value.upsert.map(row => row.entryId), [appended.id]);
  assert.deepEqual(update.value.order.map(row => row.entryId), [original.id, appended.id]);
  assert.equal(update.value.window.truncated, false); assert.equal(update.line.includes('SECRET'), false);
  assert.equal(update.line.includes('Fictional retained content'), false); assert.ok(update.bytes < initial.bytes / 2);
  const receiver = createConversationTextReceiver(f.identity); receiver.read(initial.line);
  assert.deepEqual(receiver.read(update.line).messages.map(row => row.entryId), [original.id, appended.id]);
});

test('current entry policy removes a previously delivered row without counting denied rows as omitted history', async t => {
  let hidden;
  const f = await fixture(t, { allowEntry: (_identity, entry) => entry.id !== hidden && entry.kind !== privateEntry.kind });
  await f.conversation.commit(async tx => {
    for (let i = 0; i < 250; i++) await tx.appendEntry(privateEntry, f.conversation.id, { model: [user(`SECRET-older-${i}`)] });
  }, context);
  const first = await f.append('First retained '.repeat(200)), second = await f.append('Second retained '.repeat(200));
  const reader = await f.open(), initial = await frame(reader);
  assert.equal(initial.value.window.truncated, false); assert.equal(initial.value.messages.length, 2);
  hidden = first.id;
  const pending = frame(reader);
  await f.conversation.configure({ instructions: 'Recheck current entry policy' }, context);
  const update = await pending;
  assert.equal(update.value.kind, 'delta'); assert.deepEqual(update.value.upsert, []);
  assert.deepEqual(update.value.order.map(row => row.entryId), [second.id]); assert.equal(update.value.window.truncated, false);
  const receiver = createConversationTextReceiver(f.identity); receiver.read(initial.line);
  assert.deepEqual(receiver.read(update.line).messages.map(row => row.entryId), [second.id]);
});

const identity = { runtimeId: 'fictional-runtime', scopeId: 'fictional-team', principalId: 'fictional-reader', conversationId: 1 };
const connectionId = '11111111-1111-4111-8111-111111111111';
const row = (entryId, text = `Fictional ${entryId}`) => ({ conversationId: 1, entryId, messageIndex: 0, role: 'user', content: [{ blockIndex: 0, text }], clipped: false });
const envelope = frame => ({ schema: 'boring.conversation-text', version: 2, nativeVersion: 'pi-durable@1.0.1', source: { ...identity },
  connection: { id: connectionId, frame, observedAt: '2026-10-03T00:00:00.000Z' }, window: { truncated: false } });
const snapshot = (messages = [row(2)], frame = 0) => ({ ...envelope(frame), kind: 'snapshot', messages });
const delta = (upsert, order, frame = 1) => ({ ...envelope(frame), kind: 'delta', baseFrame: frame - 1, upsert, order });
const line = value => JSON.stringify(value) + '\n';

test('receiver applies ordered upserts, removals and snapshot fallback as detached bounded snapshots', () => {
  const receiver = createConversationTextReceiver(identity);
  const initial = receiver.read(line(snapshot([row(2), row(3)])));
  initial.messages[1].content[0].text = 'Mutated caller result'; initial.source.scopeId = 'Mutated scope'; initial.connection.frame = 50;
  const updated = receiver.read(line(delta([row(4), row(3, 'Updated third')], [key(row(3)), key(row(4))])));
  assert.equal(updated.kind, 'snapshot'); assert.equal(updated.connection.frame, 1);
  assert.deepEqual(updated.messages, [row(3, 'Updated third'), row(4)]); assert.deepEqual(updated.source, identity);
  updated.messages.length = 0;
  const unchanged = receiver.read(line(delta([], [key(row(3)), key(row(4))], 2)));
  assert.deepEqual(unchanged.messages, [row(3, 'Updated third'), row(4)]);
  assert.deepEqual(receiver.read(line(snapshot([row(5)], 3))).messages, [row(5)]);
});

test('receiver reset and reconnection require a fresh initial snapshot and never reuse a lost delta base', () => {
  const receiver = createConversationTextReceiver(identity);
  receiver.read(line(snapshot()));
  assert.throws(() => receiver.read(line(delta([row(3)], [key(row(2)), key(row(3))], 2))), Error);
  assert.throws(() => receiver.read(line(delta([], [key(row(2))]))), Error);
  const fresh = snapshot([row(8)]); fresh.connection.id = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(receiver.read(line(fresh)).messages, [row(8)]);
  assert.throws(() => receiver.read(line(snapshot())), Error);
  receiver.read(line(fresh)); receiver.reset();
  assert.deepEqual(receiver.read(line(snapshot())).messages, [row(2)]);
  receiver.reset(); assert.throws(() => receiver.read(line(delta([], []))), Error);
});

const invalidFrames = [
  ['wrong schema', value => { value.schema = 'SECRET-wrong-schema'; }],
  ['wrong wire version', value => { value.version = 1; }],
  ['wrong native version', value => { value.nativeVersion = 'pi-durable@999'; }],
  ['extra top-level field', value => { value.secret = 'SECRET-field'; }],
  ['wrong source scope', value => { value.source.scopeId = 'SECRET-other-team'; }],
  ['wrong source conversation', value => { value.source.conversationId = 9; }],
  ['invalid entry identity', value => { value.messages[0].entryId = '2'; }],
  ['negative message index', value => { value.messages[0].messageIndex = -1; }],
  ['duplicate row identity', value => { value.messages.push(structuredClone(value.messages[0])); }],
  ['non-text role', value => { value.messages[0].role = 'toolResult'; }],
  ['empty content', value => { value.messages[0].content = []; }],
  ['extra content field', value => { value.messages[0].content[0].secret = 'SECRET-content'; }],
  ['missing clipping indicator', value => { delete value.messages[0].clipped; }],
  ['row count overflow', value => { value.messages = Array.from({ length: 201 }, (_, i) => row(i + 2)); }],
  ['encoded message overflow', value => { value.messages[0].content[0].text = '\u0000'.repeat(6000); }],
  ['encoded window overflow', value => { value.messages = Array.from({ length: 9 }, (_, i) => row(i + 2, 'x'.repeat(24000))); }],
  ['encoded frame overflow', value => { value.messages[0].content[0].text = 'x'.repeat(262144); }],
];

for (const [name, invalidate] of invalidFrames) {
  test(`receiver rejects ${name} and clears its previous connection state`, () => {
    const receiver = createConversationTextReceiver(identity);
    receiver.read(line(snapshot()));
    const invalid = snapshot([row(3)], 1); invalidate(invalid);
    assert.throws(() => receiver.read(line(invalid)), error => error instanceof Error && !error.message.includes('SECRET'));
    assert.throws(() => receiver.read(line(delta([], [key(row(2))]))), Error);
    assert.deepEqual(receiver.read(line(snapshot())).messages, [row(2)]);
  });
}

test('receiver validates delta membership atomically and accepts empty text as distinct from absent content', () => {
  const receiver = createConversationTextReceiver(identity);
  for (const invalid of [
    delta([row(3)], [key(row(2)), key(row(9))]),
    delta([row(3), row(3)], [key(row(3))]),
    delta([], [key(row(2)), key(row(2))]),
    { ...delta([], [key(row(2))]), baseFrame: 3 },
  ]) {
    receiver.read(line(snapshot()));
    assert.throws(() => receiver.read(line(invalid)), Error);
    assert.throws(() => receiver.read(line(delta([], [key(row(2))]))), Error);
  }
  assert.deepEqual(receiver.read(line(snapshot([row(2, '')]))).messages, [row(2, '')]);
  assert.throws(() => receiver.read(line(snapshot()) + line(snapshot())), Error);
  assert.throws(() => receiver.read('{SECRET-malformed'), error => error instanceof Error && !error.message.includes('SECRET'));
  assert.deepEqual(receiver.read(JSON.stringify(snapshot())).messages, [row(2)]);
});

test('new native head text survives truncation and keeps native presentation order', async t => {
  const f = await fixture(t);
  const entries = await f.conversation.commit(async tx => {
    const retained = [];
    for (let i = 0; i < 220; i++) retained.push(await tx.appendEntry(UserEntry, f.conversation.id, { model: [user(`Fictional older ${i}`)] }));
    return retained;
  }, context);
  const head = await f.conversation.commit(tx => tx.appendEntry(UserEntry, f.conversation.id,
    { head: entries[0].id, model: [user('Fictional newest head')] }), context);
  const view = await f.conversation.context(context);
  assert.equal(view.entries[0].id, head.id);
  const initial = (await frame(await f.open())).value;
  assert.equal(initial.messages.length, 200);
  assert.deepEqual(initial.messages.map(row => row.entryId), [head.id, ...entries.slice(-199).map(entry => entry.id)]);
  assert.equal(initial.window.truncated, true);
  const later = await f.conversation.commit(async tx => {
    const ids = [];
    for (let i = 0; i < 205; i++) ids.push((await tx.appendEntry(UserEntry, f.conversation.id, { model: [user(`Fictional after head ${i}`)] })).id);
    return ids;
  }, context);
  const newest = (await frame(await f.open())).value;
  assert.deepEqual(newest.messages.map(row => row.entryId), later.slice(-200));
  assert.equal(newest.window.truncated, true);
});
