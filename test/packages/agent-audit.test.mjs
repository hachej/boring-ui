import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { defineAgent, jsonSchemaTool } from '@hachej/boring-agent/agents';
import { createAuditExtension } from '@hachej/boring-agent/audit';

const context = {};
const MODEL = { id: 'scripted', name: 'Scripted', provider: 'scripted', api: 'scripted-api', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 1000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
// Calls each tool once, then answers.
function scriptedModels(calls) {
  let turn = 0;
  const stream = () => {
    const events = createAssistantMessageEventStream();
    const call = calls[turn++];
    const message = { role: 'assistant', content: call ? [{ type: 'toolCall', id: `call-${turn}`, name: call.name, arguments: call.arguments }] : [{ type: 'text', text: 'Done.' }], api: MODEL.api, provider: MODEL.provider, model: MODEL.id, usage, stopReason: call ? 'toolUse' : 'stop', timestamp: 1 };
    setTimeout(() => { events.push({ type: 'start', partial: message }); events.push({ type: 'done', reason: message.stopReason, message }); events.end(message); }, 1);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: MODEL.provider, models: [MODEL], auth: { apiKey: { name: 'keyless', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return models;
}
const tools = [
  jsonSchemaTool({ name: 'save_meal', description: 'Saves.', parameters: { type: 'object', properties: { secret: { type: 'string' } } }, execute: async () => ({ output: [{ type: 'text', text: 'saved fictional-secret' }] }) }),
  jsonSchemaTool({ name: 'broken', description: 'Fails.', parameters: { type: 'object', properties: {} }, execute: async () => ({ output: [{ type: 'text', text: 'no' }], isError: true }) }),
];
async function run(audit) {
  const agent = defineAgent({ id: 'audited', model: { provider: MODEL.provider, modelId: MODEL.id }, tools, extensions: [audit] });
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

test('a failing sink never fails the tool', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const { conversation } = await run(createAuditExtension({ sink: async () => { throw new Error('fictional store down'); }, user: 'p' }));
  const entries = (await conversation.entries({}, 50, undefined, context)).items;
  assert.ok(entries.some(entry => entry.model?.some(message => message.role === 'toolResult' && message.toolName === 'save_meal' && !message.isError)), 'the tool result stays a success');
  assert.equal(logged.mock.callCount(), 2);
  assert.doesNotMatch(logged.mock.calls[0].arguments[0], /fictional store down/, 'the log carries no error text');
});
