// A conversation store written by pi-durable 1.4.0 (SQLite schema 2) opens on the pi-durable the kit now runs on, with the same messages, and takes a new one.
// The fixture is fictional (one scripted turn: "Note", a `remember` tool call, "Noted."). Source: the Factory's `platform/pi-durable-1.5.2` branch,
// services/host/agents/test/fixtures/store-1.4.0.json, dumped from a database 1.4.0 wrote (schema statements and every row, blobs as hex).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const dump = JSON.parse(readFileSync(new URL('../fixtures/store-1.4.0.json', import.meta.url), 'utf8'));
const decode = value => value !== null && typeof value === 'object' && '$blob' in value ? Buffer.from(value.$blob, 'hex') : value;
const text = message => typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text).join('');

function writeStore(path) {
  const db = new DatabaseSync(path);
  for (const statement of dump.schema) db.exec(statement);
  for (const [table, rows] of Object.entries(dump.rows)) for (const row of rows) {
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO "${table}" (${columns.map(name => `"${name}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...columns.map(name => decode(row[name])));
  }
  db.close();
}

async function open(t, fake) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-store-1.4-'));
  const path = join(directory, 'store.sqlite');
  writeStore(path);
  const storage = await openNodeSqliteStorage(path);
  const harness = await Harness.open(storage, { registry: createRegistry(), models: fake.models }, context);
  t.after(async () => { await harness.close(context); rmSync(directory, { recursive: true, force: true }); });
  return harness;
}

test('a store written by pi-durable 1.4.0 opens with the same messages and takes a new one', async t => {
  const fake = createFakeChatModel();
  const harness = await open(t, fake);
  const conversation = await harness.conversation(dump.rows.conversations[0].id, context);
  assert.ok(conversation, 'the stored conversation is found');
  const stored = (await conversation.entries({ order: 'ascending' }, 100, undefined, context)).items;
  const messages = stored.flatMap(entry => entry.model ?? []);
  assert.deepEqual(messages.filter(message => message.role === 'user').map(text), ['Note']);
  assert.equal(text(messages.filter(message => message.role === 'assistant').at(-1)), 'Noted.');
  assert.ok(messages.some(message => message.role === 'assistant' && Array.isArray(message.content) && message.content.some(part => part.type === 'toolCall' && part.name === 'remember')), 'the tool call is kept');
  const watch = await conversation.watch(context);
  t.after(() => watch.stop());
  assert.deepEqual(watch.value.entries.map(entry => entry.id), stored.map(entry => entry.id), 'the view holds the stored entries');

  await conversation.configure({ model: fake.model }, context).catch(() => undefined);
  const submission = await conversation.submit({ type: 'input', content: 'Another fictional note' }, context);
  const call = await fake.nextCall();
  call.respond('Noted again.');
  assert.equal((await submission.wait(context)).status, 'done');
  const after = (await conversation.entries({ order: 'ascending' }, 100, undefined, context)).items.flatMap(entry => entry.model ?? []);
  assert.deepEqual(after.filter(message => message.role === 'user').map(text), ['Note', 'Another fictional note']);
  assert.equal(text(after.at(-1)), 'Noted again.');
});

test('an empty store opens to a first conversation', async t => {
  const fake = createFakeChatModel();
  const directory = mkdtempSync(join(tmpdir(), 'boring-store-empty-'));
  const storage = await openNodeSqliteStorage(join(directory, 'store.sqlite'));
  const harness = await Harness.open(storage, { registry: createRegistry(), models: fake.models }, context);
  t.after(async () => { await harness.close(context); rmSync(directory, { recursive: true, force: true }); });
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  const submission = await conversation.submit({ type: 'input', content: 'A first fictional note' }, context);
  const call = await fake.nextCall();
  call.respond('Noted.');
  assert.equal((await submission.wait(context)).status, 'done');
  const messages = (await conversation.entries({ order: 'ascending' }, 100, undefined, context)).items.flatMap(entry => entry.model ?? []);
  assert.deepEqual(messages.filter(message => message.role === 'user').map(text), ['A first fictional note']);
});
