// The delegate tool through the native Harness on a scripted (faux) model: the child conversation is owned by the tool task, has
// only the child agent's tools, survives a crash mid-call without a second child or a second turn, and only its final text
// reaches the parent.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, UserEntry, createRegistry, defineTool } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { Type } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createDelegateTool, defineAgent } from '@hachej/boring-agent/agents';
import { createApprovalExtension } from '@hachej/boring-agent/approval';

const lastToolResult = transcript => [...transcript.messages].reverse().find(message => message.role === 'toolResult');
const resultText = message => message.content.filter(part => part.type === 'text').map(part => part.text).join('');

/**
 * Parent model: delegates once, then repeats what the delegate returned. Child model: looks the fact up with its only tool, then
 * answers. `stallChild` holds the child's first request until the request is aborted (the harness closing: a crash mid-call).
 */
function scriptedModels({ stallChild = false } = {}) {
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
    return result
      ? fauxAssistantMessage([fauxText(`The capital is ${resultText(result)}.`)])
      : fauxAssistantMessage([fauxToolCall('lookup', { topic: 'capital' }, { id: 'lookup-1' })], { stopReason: 'toolUse' });
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

function agents() {
  const researcher = defineAgent({ id: 'researcher', model: { provider: 'fictional-faux', modelId: 'child' }, instructions: 'Answer briefly.', tools: [lookup] });
  const lead = defineAgent({ id: 'lead', model: { provider: 'fictional-faux', modelId: 'parent' }, instructions: 'Delegate research.', tools: [parentOnly], delegates: [{ agent: researcher }] });
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
