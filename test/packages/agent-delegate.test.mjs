// The delegate tool through the native Harness on a scripted (faux) model: the child conversation is owned by the tool task, has
// only the child agent's tools, survives a crash mid-call without a second child or a second turn, and only its final text
// reaches the parent.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, LiveDoc, MemoryStorage, UserEntry, createRegistry, defineDoc, defineTool } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { Type } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import * as agentsEntry from '@hachej/boring-agent/agents';
import { createDelegateTool, defineAgent } from '@hachej/boring-agent/agents';
import { createApprovalExtension } from '@hachej/boring-agent/approval';

const lastToolResult = transcript => [...transcript.messages].reverse().find(message => message.role === 'toolResult');
const resultText = message => message.content.filter(part => part.type === 'text').map(part => part.text).join('');

/**
 * Parent model: delegates once, then repeats what the delegate returned. Child model: looks the fact up with its only tool, then
 * answers. `stallChild` holds the child's first request until the request is aborted (the harness closing: a crash mid-call).
 */
function scriptedModels({ stallChild = false, childLookups = 1, childError } = {}) {
  const calls = { parent: 0, child: 0, stalled: 0 };
  const faux = fauxProvider({ provider: 'fictional-faux', models: [{ id: 'parent' }, { id: 'child' }] });
  const respond = (transcript, options, _state, model) => {
    const result = lastToolResult(transcript);
    if (model.id === 'parent') {
      calls.parent++;
      return result
        ? fauxAssistantMessage([fauxText(`Parent heard: ${resultText(result)}`)])
        : fauxAssistantMessage([fauxToolCall('delegate', { task: 'What is the capital of Fictionland?' }, { id: 'delegate-1' })], { stopReason: 'toolUse' });
    }
    calls.child++;
    if (stallChild && calls.stalled === 0) {
      calls.stalled++;
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new Error('aborted'));
        if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    if (childError) return fauxAssistantMessage([], { stopReason: 'error', errorMessage: childError });
    const done = transcript.messages.filter(message => message.role === 'toolResult').length;
    return done >= childLookups
      ? fauxAssistantMessage([fauxText(`The capital is ${resultText(result)}.`)])
      : fauxAssistantMessage([fauxToolCall('lookup', { topic: 'capital' }, { id: `lookup-${done + 1}` })], { stopReason: 'toolUse' });
  };
  faux.setResponses(Array.from({ length: 20 }, () => respond));
  const models = createModels();
  models.setProvider(faux.provider);
  return { models, calls };
}

const looked = [];
const lookup = defineTool({
  name: 'lookup', description: 'Look up a fictional fact.', parameters: Type.Object({ topic: Type.String() }), replay: 'safe',
  execute: async () => { looked.push('lookup'); return { output: [{ type: 'text', text: 'Glimmerton' }] }; },
});
const parentOnly = defineTool({
  name: 'parent_only', description: 'A tool only the parent has.', parameters: Type.Object({}), replay: 'safe',
  execute: async () => ({ output: [{ type: 'text', text: 'never offered to the child' }] }),
});

function agents({ childTools = [lookup], onChild } = {}) {
  const researcher = defineAgent({ id: 'researcher', struggle: false, model: { provider: 'fictional-faux', modelId: 'child' }, instructions: 'Answer briefly.', tools: childTools });
  const lead = defineAgent({ id: 'lead', struggle: false, model: { provider: 'fictional-faux', modelId: 'parent' }, instructions: 'Delegate research.', tools: [parentOnly], delegates: [{ agent: researcher, ...(onChild ? { onChild } : {}) }] });
  const registry = createRegistry();
  lead.install(registry); // installs the researcher's extensions too
  return { lead, registry };
}

async function owned(conversation) {
  const page = await conversation.commit(tx => tx.scanConversations({}, 50), context);
  return page.items.filter(record => record.owner !== undefined);
}
const userInputs = (conversation, id) => conversation.commit(async tx => (await tx.scanEntries({ conversationId: id }, 50)).items.filter(entry => UserEntry.is(entry)), context);
const finalText = async conversation => {
  const messages = (await conversation.context(context)).messages.filter(message => message.role === 'assistant');
  return messages.at(-1)?.content.filter(part => part.type === 'text').map(part => part.text).join('');
};

test('delegate runs a task-owned child conversation with only its own tools and returns only its final text', async t => {
  const { models, calls } = scriptedModels();
  const { lead, registry } = agents();
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  const submission = await conversation.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context);
  assert.equal((await submission.wait(context)).status, 'done');

  assert.equal(await finalText(conversation), 'Parent heard: The capital is Glimmerton.');
  const children = await owned(conversation);
  assert.equal(children.length, 1, 'one child conversation');
  const child = await harness.conversation(children[0].id, context);
  const tools = (await child.agent(context)).tools.map(tool => tool.name);
  assert.deepEqual(tools, ['lookup'], 'the child is offered only the child agent\'s tools');
  assert.ok((await conversation.agent(context)).tools.some(tool => tool.name === 'delegate'));
  assert.equal(children[0].owner.conversationId, conversation.id);
  assert.equal((await harness.getTask(children[0].owner.taskId, context)).kind, 'pi.tool', 'the child is owned by the delegate tool task');
  const toolResult = (await conversation.context(context)).messages.find(message => message.role === 'toolResult');
  assert.equal(resultText(toolResult), 'The capital is Glimmerton.', 'only the child\'s final text, not its tool traffic');
  assert.deepEqual(calls, { parent: 2, child: 2, stalled: 0 });
});

test('a crash mid-delegate reattaches to the same child on reopen: no second child, no second turn', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-delegate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'native.sqlite');

  const first = scriptedModels({ stallChild: true });
  let { lead, registry } = agents();
  let harness = await Harness.open(await openNodeSqliteStorage(file), { registry, models: first.models }, context);
  const conversation = await lead.createConversation(harness, context);
  await conversation.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context);
  const deadline = Date.now() + 8000;
  while (first.calls.stalled === 0) { assert.ok(Date.now() < deadline, 'the child request starts'); await new Promise(resolve => setTimeout(resolve, 10)); }
  const before = await owned(conversation);
  assert.equal(before.length, 1);
  await harness.close(context); // the tool call is interrupted while the child's model request is in flight

  const second = scriptedModels();
  ({ lead, registry } = agents());
  harness = await Harness.open(await openNodeSqliteStorage(file), { registry, models: second.models }, context);
  t.after(() => harness.close(context));
  const again = await harness.conversation(conversation.id, context);
  harness.resume();
  const settled = await (await again.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context)).wait(context);
  assert.equal(settled.status, 'done', 'the same request id returns the original submission, now answered');
  assert.equal(await finalText(again), 'Parent heard: The capital is Glimmerton.');

  const after = await owned(again);
  assert.deepEqual(after.map(record => record.id), before.map(record => record.id), 'the rerun reattached to the child it created');
  assert.equal((await userInputs(again, after[0].id)).length, 1, 'the child received the task once');
  assert.equal(second.calls.parent, 1, 'the parent model was not asked to delegate again');
});

test('a delegated child inherits the parent\'s approval extension: it cannot run what the parent\'s gate refuses (D-248)', async t => {
  looked.length = 0;
  const { models } = scriptedModels();
  const { lead, registry } = agents();
  const approvals = createApprovalExtension({ tools: {}, unlisted: 'deny', allow: ['delegate'] });
  registry.install(approvals);
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  await conversation.configure({ extensions: { add: [approvals] } }, context);
  assert.equal((await (await conversation.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context)).wait(context)).status, 'done');
  const [childRecord] = await owned(conversation);
  const child = await harness.conversation(childRecord.id, context);
  assert.ok((await child.agent(context)).extensions.some(extension => extension === approvals), 'the child selects the parent\'s approval extension');
  assert.deepEqual(looked, [], 'the child\'s lookup was blocked by the inherited gate');
});

// A host-owned identity document (fictional): who the conversation acts for, which workspace it binds and what it may do.
const Identity = defineDoc({
  kind: 'test.delegate.identity', checkpointWhen: () => false, version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ user: '', workspace: '', permissions: [] }),
});
const copyIdentity = async (parent, child, tx) => {
  const from = await tx.doc(Identity, parent), to = await tx.doc(Identity, child);
  to.user = from.user; to.workspace = from.workspace; to.permissions = [...from.permissions];
};
async function setIdentity(harness, id) {
  await harness.commit(async tx => {
    const doc = await tx.doc(Identity, id);
    doc.user = 'ada@fictional.test'; doc.workspace = 'ws-fictional-1'; doc.permissions = ['files:read'];
  }, context);
}

test('onChild runs in the commit that creates the child: what it writes is there for the child\'s first turn (D-254)', async t => {
  const seen = [], hooked = [];
  const whoami = defineTool({
    name: 'lookup', description: 'Look up a fictional fact.', parameters: Type.Object({ topic: Type.String() }), replay: 'safe',
    execute: async (_args, api, ctx) => { seen.push(await api.snapshot(Identity, api.conversationId, ctx)); return { output: [{ type: 'text', text: 'Glimmerton' }] }; },
  });
  const { models } = scriptedModels();
  const { lead, registry } = agents({ childTools: [whoami], onChild: async (parent, child, tx) => { hooked.push([parent, child]); await copyIdentity(parent, child, tx); } });
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  await setIdentity(harness, conversation.id);
  assert.equal((await (await conversation.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context)).wait(context)).status, 'done');

  const [childRecord] = await owned(conversation);
  assert.deepEqual(hooked, [[conversation.id, childRecord.id]], 'onChild ran once, with the parent and the new child');
  assert.deepEqual(seen, [{ user: 'ada@fictional.test', workspace: 'ws-fictional-1', permissions: ['files:read'] }], 'the child\'s first turn sees the parent\'s identity');
  assert.equal(await finalText(conversation), 'Parent heard: The capital is Glimmerton.');
});

test('a throwing onChild aborts the creating commit: no child conversation is left behind (D-254)', async t => {
  const { models, calls } = scriptedModels();
  const { lead, registry } = agents({ onChild: () => { throw new Error('no identity for this child'); } });
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  assert.equal((await (await conversation.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context)).wait(context)).status, 'done');

  assert.deepEqual(await owned(conversation), [], 'no child conversation exists');
  assert.equal(calls.child, 0, 'the child model was never asked');
  const toolResult = (await conversation.context(context)).messages.find(message => message.role === 'toolResult');
  assert.equal(toolResult.isError, true, 'the delegate call failed');
  assert.match(resultText(toolResult), /no identity for this child/);
});

// D-255: the sub-agent card's data. While the child runs, the delegate call's running details (its `pi.live` tool slot) carry a
// `DelegateDetails` with status `running` and the child's counts so far; the result's details carry the finished value.
const DELEGATE_DETAILS_KIND = 'boring.delegate';
const delegateResult = async conversation => (await conversation.context(context)).messages.find(message => message.role === 'toolResult' && message.toolName === 'delegate');
/** Every distinct running details value the parent's delegate slot showed while `run` ran (polling the parent's `pi.live`). */
async function watchSlot(harness, conversationId, run) {
  const seen = [];
  let done = false;
  const poll = (async () => {
    while (!done) {
      const slot = (await harness.snapshot(LiveDoc, conversationId, context))?.tools?.find(item => item.name === 'delegate');
      const json = slot?.details === undefined ? undefined : JSON.stringify(slot.details);
      if (json !== undefined && json !== seen.at(-1)) seen.push(json);
      await new Promise(resolve => setTimeout(resolve, 2));
    }
  })();
  try { return [await run(), seen.map(json => JSON.parse(json))]; } finally { done = true; await poll; }
}
const slowLookup = defineTool({
  name: 'lookup', description: 'Look up a fictional fact.', parameters: Type.Object({ topic: Type.String() }), replay: 'safe',
  execute: async () => { await new Promise(resolve => setTimeout(resolve, 250)); return { output: [{ type: 'text', text: 'Glimmerton' }] }; },
});

test('delegate publishes live DelegateDetails while the child runs and finishes with done, duration, tool calls and tokens (D-255)', async t => {
  const { models } = scriptedModels({ childLookups: 2 });
  const { lead, registry } = agents({ childTools: [slowLookup] });
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  const [settled, live] = await watchSlot(harness, conversation.id, async () => (await conversation.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context)).wait(context));
  assert.equal(settled.status, 'done');
  const [childRecord] = await owned(conversation);

  const running = live.filter(details => details.status === 'running');
  assert.ok(running.length >= 2, `live details were published while the child ran: ${JSON.stringify(live)}`);
  for (const details of running) {
    assert.equal(details.kind, DELEGATE_DETAILS_KIND);
    assert.equal(details.conversationId, childRecord.id, 'the live details name the child conversation');
  }
  const calls = running.map(details => details.toolCalls);
  assert.deepEqual(calls, [...calls].sort((a, b) => a - b), 'tool calls only grow');
  assert.ok(calls.includes(1) && calls.includes(2), `the count rose with each of the child's tool calls: ${calls}`);

  const final = (await delegateResult(conversation)).details;
  assert.equal(agentsEntry.DELEGATE_DETAILS_KIND, DELEGATE_DETAILS_KIND, 'the kind is exported');
  assert.equal(final.kind, DELEGATE_DETAILS_KIND);
  assert.equal(final.version, 1);
  assert.equal(final.agent, 'researcher');
  assert.equal(final.conversationId, childRecord.id);
  assert.equal(final.status, 'done');
  assert.ok(final.durationMs > 0, 'a duration');
  assert.ok(final.startedAt <= Date.now() && final.startedAt === running[0].startedAt, 'one start time, live and final');
  assert.equal(final.toolCalls, 2, 'both of the child\'s tool calls');
  assert.ok(final.tokens.input > 0 && final.tokens.output > 0, `the child's tokens: ${JSON.stringify(final.tokens)}`);
  assert.equal(final.error, undefined);
  assert.equal(await finalText(conversation), 'Parent heard: The capital is Glimmerton.', 'the model still gets only the child\'s final text');
});

test('a failing child ends the delegate call with status failed and the error text (D-255)', async t => {
  const { models } = scriptedModels({ childError: 'Fictional provider refused the request' });
  const { lead, registry } = agents();
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  assert.equal((await (await conversation.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context)).wait(context)).status, 'done');

  const result = await delegateResult(conversation);
  assert.equal(result.isError, true, 'the delegate call failed');
  const [childRecord] = await owned(conversation);
  assert.equal(result.details.kind, DELEGATE_DETAILS_KIND);
  assert.equal(result.details.status, 'failed');
  assert.equal(result.details.conversationId, childRecord.id);
  assert.match(result.details.error, /Fictional provider refused the request/);
  assert.match(resultText(result), /Fictional provider refused the request/, 'the model sees why');
});

test('a stopped delegate call keeps the child in its result details: Pi writes the aborted result from the last running value (D-255)', async t => {
  const { models, calls } = scriptedModels({ stallChild: true });
  const { lead, registry } = agents();
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  const submission = await conversation.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context);
  const deadline = Date.now() + 8000;
  while (calls.stalled === 0) { assert.ok(Date.now() < deadline, 'the child request starts'); await new Promise(resolve => setTimeout(resolve, 10)); }
  await conversation.abort(context);
  await submission.wait(context).catch(() => undefined);
  const result = await delegateResult(conversation);
  assert.equal(result.isError, true, 'Pi wrote the aborted result');
  const [childRecord] = await owned(conversation);
  assert.equal(result.details.kind, DELEGATE_DETAILS_KIND);
  assert.equal(result.details.conversationId, childRecord.id, 'a card can still link the child');
  assert.equal(result.details.status, 'running', 'the last running value: a settled error result with running details reads as cancelled');
});
