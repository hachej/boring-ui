import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent, jsonSchemaTool } from '@hachej/boring-agent/agents';
import { createAuditExtension } from '@hachej/boring-agent/audit';

// Calls each tool once, then answers.
function scriptedModels(calls) {
  const faux = fauxProvider({ provider: 'fictional-faux', models: [{ id: 'm' }] });
  faux.setResponses([...calls.map((call, index) => fauxAssistantMessage([fauxToolCall(call.name, call.arguments, { id: `call-${index}` })], { stopReason: 'toolUse' })), fauxAssistantMessage([fauxText('Done.')])]);
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}
const tools = [
  jsonSchemaTool({ name: 'save_meal', description: 'Saves.', parameters: { type: 'object', properties: { secret: { type: 'string' } } }, execute: async () => ({ output: [{ type: 'text', text: 'saved fictional-secret' }] }) }),
  jsonSchemaTool({ name: 'broken', description: 'Fails.', parameters: { type: 'object', properties: {} }, execute: async () => ({ output: [{ type: 'text', text: 'no' }], isError: true }) }),
];
async function run(audit) {
  const agent = defineAgent({ id: 'audited', model: { provider: 'fictional-faux', modelId: 'm' }, tools, extensions: [audit] });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: scriptedModels([{ name: 'save_meal', arguments: { secret: 'fictional-secret' } }, { name: 'broken', arguments: {} }]) }, context);
  const conversation = await agent.createConversation(harness, context);
  await (await conversation.submit({ type: 'input', content: 'go' }, context)).wait(context);
  return { harness, conversation };
}

test('every finished tool call reaches the sink with who acted; values only through redact', async () => {
  const records = [];
  const { conversation } = await run(createAuditExtension({ sink: record => { records.push(record); }, user: 'fictional-person', redact: value => typeof value === 'string' ? value.replaceAll('fictional-secret', '[hidden]') : { keys: Object.keys(value) } }));
  assert.deepEqual(records.map(record => [record.tool, record.user, record.isError]), [['save_meal', 'fictional-person', false], ['broken', 'fictional-person', true]]);
  assert.deepEqual(records[0].arguments, { keys: ['secret'] });
  assert.equal(records[0].output, 'saved [hidden]');
  assert.equal(records[0].conversationId, Number(conversation.id));
  assert.notEqual(records[0].id, records[1].id);
  assert.doesNotMatch(JSON.stringify(records), /fictional-secret/);
});

test('without redact no value is recorded; a redact that throws drops the values and keeps the record', async () => {
  const bare = [];
  await run(createAuditExtension({ sink: record => { bare.push(record); }, user: conversationId => `person-${conversationId}` }));
  assert.equal(bare.length, 2);
  assert.ok(!('arguments' in bare[0]) && !('output' in bare[0]));
  assert.match(bare[0].user, /^person-/);
  const thrown = [];
  await run(createAuditExtension({ sink: record => { thrown.push(record); }, user: 'p', redact: () => { throw new Error('fictional'); } }));
  assert.equal(thrown[0].redactionFailed, true);
  assert.doesNotMatch(JSON.stringify(thrown), /fictional-secret/);
});

const hex = /^[0-9a-f]{64}$/;

test('every record has durationMs >= 0 and a stable argumentsSha256 that differs for different arguments, with or without redact, even when redact throws', async () => {
  const first = [], second = [], bare = [], thrown = [];
  await run(createAuditExtension({ sink: record => { first.push(record); }, user: 'p', redact: value => value }));
  await run(createAuditExtension({ sink: record => { second.push(record); }, user: 'p' }));
  await run(createAuditExtension({ sink: record => { bare.push(record); }, user: 'p' }));
  await run(createAuditExtension({ sink: record => { thrown.push(record); }, user: 'p', redact: () => { throw new Error('fictional'); } }));
  for (const record of [...first, ...second, ...thrown]) { assert.match(record.argumentsSha256, hex); assert.ok(record.durationMs >= 0 && Number.isFinite(record.durationMs)); }
  assert.equal(first[0].argumentsSha256, second[0].argumentsSha256, 'same arguments, same digest, with or without redact');
  assert.equal(first[0].argumentsSha256, thrown[0].argumentsSha256, 'present when redact throws');
  assert.notEqual(first[0].argumentsSha256, first[1].argumentsSha256);
  assert.equal(thrown[0].redactionFailed, true);
  assert.equal(first[0].argumentsSha256, createHash('sha256').update('{"secret":"fictional-secret"}').digest('hex'));
  assert.doesNotMatch(JSON.stringify(bare), /fictional-secret/, 'without redact no raw value, only the digest');
});

test('resourceId comes from the resource option; a throwing or non-string resource drops it and never fails the tool or the record', async () => {
  const named = [], thrown = [];
  await run(createAuditExtension({ sink: record => { named.push(record); }, user: 'p', resource: call => call.name === 'save_meal' ? `meals/${call.arguments.secret.length}` : undefined }));
  assert.equal(named[0].resourceId, 'meals/16');
  assert.ok(!('resourceId' in named[1]));
  const { conversation } = await run(createAuditExtension({ sink: record => { thrown.push(record); }, user: 'p', resource: () => { throw new Error('fictional'); } }));
  assert.equal(thrown.length, 2);
  assert.ok(!('resourceId' in thrown[0]));
  const entries = (await conversation.entries({}, 50, undefined, context)).items;
  assert.ok(entries.some(entry => entry.model?.some(message => message.role === 'toolResult' && message.toolName === 'save_meal' && !message.isError)));
});

test('reason carries the redacted error text only for a failed call and only with redact', async () => {
  const kept = [], bare = [];
  await run(createAuditExtension({ sink: record => { kept.push(record); }, user: 'p', redact: value => typeof value === 'string' ? value.toUpperCase() : value }));
  assert.ok(!('reason' in kept[0]), 'a success has no reason');
  assert.equal(kept[1].reason, 'NO');
  await run(createAuditExtension({ sink: record => { bare.push(record); }, user: 'p' }));
  assert.ok(!('reason' in bare[1]), 'without redact the error text stays out');
});

test('a failing sink never fails the tool', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const { conversation } = await run(createAuditExtension({ sink: async () => { throw new Error('fictional store down'); }, user: 'p' }));
  const entries = (await conversation.entries({}, 50, undefined, context)).items;
  assert.ok(entries.some(entry => entry.model?.some(message => message.role === 'toolResult' && message.toolName === 'save_meal' && !message.isError)), 'the tool result stays a success');
  assert.equal(logged.mock.callCount(), 2);
  assert.doesNotMatch(logged.mock.calls[0].arguments[0], /fictional store down/, 'the log carries no error text');
});
