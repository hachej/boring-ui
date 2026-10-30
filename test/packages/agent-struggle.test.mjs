// D-553: an app's agent reports its own failures with no app code, through the native Harness on a scripted model.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry, defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { setStruggleSink } from '@hachej/boring-agent/struggle';

const SECRET = 'fictional-private-words';
const ok = defineTool({ name: 'lookup', description: 'Looks up.', parameters: Type.Object({ topic: Type.String() }), replay: 'safe', execute: async () => ({ output: [{ type: 'text', text: 'Glimmerton' }] }) });
const broken = defineTool({ name: 'save_meal', description: 'Saves.', parameters: Type.Object({}), replay: 'safe', execute: async () => ({ output: [{ type: 'text', text: `Not done: ${SECRET}` }], isError: true }) });

/** `script` is one reply per model request: a function of the transcript, or a message. After it runs out the model says « Done. ». */
async function open(t, script = [], spec = {}) {
  const faux = fauxProvider({ provider: 'fictional-faux', models: [{ id: 'm' }] });
  faux.setResponses([...script, ...Array.from({ length: 20 }, () => fauxAssistantMessage([fauxText('Done.')]))]);
  const models = createModels(); models.setProvider(faux.provider);
  // No sink, no extension, no tool named by the app: what a template app's agent gets.
  const agent = defineAgent({ id: 'coach', model: { provider: 'fictional-faux', modelId: 'm' }, instructions: 'Help.', tools: [ok, broken], ...spec });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  t.after(() => harness.close(context));
  const conversation = await agent.createConversation(harness, context);
  let turn = 0;
  return { agent, conversation, say: async text => (await conversation.submit({ type: 'input', requestId: `r${++turn}`, content: text }, context)).wait(context) };
}
function capture(t) {
  const events = [];
  setStruggleSink(event => { events.push(event); });
  t.after(() => setStruggleSink(undefined));
  return events;
}
const call = (name, args = {}, id = name) => fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: 'toolUse' });
const kinds = events => events.map(event => event.kind);

test('a failing tool, with no app code: one tool_error with a stable fingerprint and no content', async t => {
  const events = capture(t);
  const { say } = await open(t, [call('save_meal', {}, 'a'), fauxAssistantMessage([fauxText('Sorry.')]), call('save_meal', {}, 'b')]);
  await say(`Save it ${SECRET}`);
  assert.deepEqual(kinds(events), ['tool_error']);
  assert.equal(events[0].event, 'agent.struggle');
  assert.equal(events[0].tool, 'save_meal');
  assert.equal(events[0].agent, 'coach');
  await say('And the other one please');
  assert.deepEqual(kinds(events), ['tool_error', 'tool_error']);
  assert.equal(events[0].fingerprint, events[1].fingerprint, 'one fingerprint, so one task');
  assert.doesNotMatch(JSON.stringify(events), new RegExp(SECRET));
});

test('the agent gets report_bug by default; emails and long numbers are scrubbed', async t => {
  const events = capture(t);
  const { say, agent } = await open(t, [call(`report_bug`, { summary: 'Cannot save for ana@fictional.invalid 0612345678', tried: 'save_meal twice', tool: 'save_meal', req_id: 'req-1' })]);
  assert.ok(agent.extensions.some(extension => extension.tools?.some(tool => tool.name === 'report_bug')));
  await say('Save it');
  assert.deepEqual(kinds(events), ['report_bug']);
  assert.equal(events[0].summary, 'Cannot save for [email] [number]');
  assert.equal(events[0].tool, 'save_meal');
  assert.equal(events[0].req_id, 'req-1');
});

test('tool_retry: the same call 3 times, once; three different calls are normal work', async t => {
  const events = capture(t);
  const same = await open(t, [call('lookup', { topic: 'a' }, '1'), call('lookup', { topic: 'a' }, '2'), call('lookup', { topic: 'a' }, '3'), call('lookup', { topic: 'a' }, '4')]);
  await same.say('Find it');
  assert.deepEqual(kinds(events), ['tool_retry']);
  assert.equal(events[0].tool, 'lookup');
  events.length = 0;
  const different = await open(t, [call('lookup', { topic: 'a' }, '1'), call('lookup', { topic: 'b' }, '2'), call('lookup', { topic: 'c' }, '3')]);
  await different.say('Find them');
  assert.deepEqual(kinds(events), []);
});

test('tool_retry: a tool failing 3 times', async t => {
  const events = capture(t);
  const { say } = await open(t, [call('save_meal', {}, '1'), call('save_meal', { a: 1 }, '2'), call('save_meal', { a: 2 }, '3')]);
  await say('Save it');
  assert.deepEqual(kinds(events), ['tool_error', 'tool_error', 'tool_error', 'tool_retry']);
});

test('correction and rephrase, content-free; a bare « non » answering a question does not count', async t => {
  const events = capture(t);
  const { say } = await open(t, [fauxAssistantMessage([fauxText('Voilà.')]), fauxAssistantMessage([fauxText('Voulez-vous continuer ?')])]);
  await say('Ajoute un yaourt grec au déjeuner');
  await say('Non');
  assert.deepEqual(kinds(events), ['correction'], 'after a statement, « non » is a correction');
  events.length = 0;
  await say('Merci');
  await say("c'est faux, le déjeuner est mauvais");
  assert.deepEqual(kinds(events), ['correction']);
  events.length = 0;
  await say('Ajoute un yaourt grec au dîner');
  await say('Ajoute un yaourt grec au dîner stp');
  assert.deepEqual(kinds(events), ['rephrase']);
  assert.doesNotMatch(JSON.stringify(events), /yaourt|déjeuner|faux/);
});

test('struggle: false selects nothing; a sink that throws never fails the run', async t => {
  const events = capture(t);
  const off = await open(t, [call('save_meal')], { struggle: false });
  assert.ok(!off.agent.extensions.some(extension => extension.tools?.some(tool => tool.name === 'report_bug')));
  await off.say('Save it');
  assert.deepEqual(events, []);
  setStruggleSink(() => { throw new Error('fictional host down'); });
  const on = await open(t, [call('save_meal')]);
  assert.equal((await on.say('Save it')).status, 'done');
});

test('an app that has its own report_bug keeps it', async t => {
  const own = defineTool({ name: 'report_bug', description: 'The app\'s own.', parameters: Type.Object({}), replay: 'safe', execute: async () => ({ output: [{ type: 'text', text: 'own' }] }) });
  const { agent } = await open(t, [], { tools: [ok, broken, own] });
  assert.equal(agent.extensions.flatMap(extension => extension.tools ?? []).filter(tool => tool.name === 'report_bug').length, 1);
});
