import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createApprovalExtension } from '@hachej/boring-agent/approval';
import { createSandboxExtension, simulatedCalls, SANDBOX_DETAILS } from '@hachej/boring-agent/sandbox';
import { createScriptedModel } from '@hachej/boring-testing/model';

// Fictional tools that record what really ran. A sandboxed call must leave `ran` untouched.
function tools(ran) {
  const note = name => defineTool({ name, description: `Fictional ${name}.`, parameters: Type.Object({ note: Type.String() }),
    execute: async args => { ran.push(`${name}:${args.note}`); return { content: [{ type: 'text', text: `${name} ran` }] }; } });
  return {
    write: note('write_note'),
    read: defineTool({ name: 'read_note', description: 'Fictional read.', parameters: Type.Object({}),
      execute: async () => { ran.push('read_note'); return { content: [{ type: 'text', text: 'read ran' }] }; } }),
    safe: defineTool({ name: 'safe_note', description: 'Fictional safe.', parameters: Type.Object({}),
      execute: async () => { ran.push('safe_note'); return { content: [{ type: 'text', text: 'safe ran' }] }; } }),
    undeclared: defineTool({ name: 'undeclared_note', description: 'Fictional undeclared.', parameters: Type.Object({}),
      execute: async () => { ran.push('undeclared_note'); return { content: [{ type: 'text', text: 'undeclared ran' }] }; } }),
    throws: defineTool({ name: 'throws_note', description: 'Fictional failure.', parameters: Type.Object({}),
      execute: async () => { throw new Error('fictional failure'); } }),
  };
}

const flags = {
  write_note: { mutates: true },
  read_note: { mutates: false },
  safe_note: { sandboxSafe: true },
  throws_note: { mutates: false },
};

/** One conversation whose agent carries `extensions`. The script asks the named tools in order, then answers. */
async function open(t, { extensions = [], scriptTools }) {
  const ran = [];
  const fictional = tools(ran);
  const scripted = createScriptedModel({ script: {
    'run the fictional tools': [{ tools: scriptTools.map(name => ({ name, args: { note: 'fictional' } })) }, 'Done.'],
    'run the unnamed tool': [{ tools: [{ name: 'late_write', args: { note: 'late' } }] }, 'Done.'],
  } });
  const late = defineTool({ name: 'late_write', description: 'Fictional late write.', parameters: Type.Object({ note: Type.String() }),
    execute: async args => { ran.push(`late_write:${args.note}`); return { content: [{ type: 'text', text: 'late ran' }] }; } });
  const agent = defineAgent({ id: 'sandboxed', model: scripted.model, tools: [fictional.write, fictional.read, fictional.safe, fictional.undeclared, fictional.throws, late], extensions, instructions: 'Fictional agent.' });
  const registry = createRegistry();
  agent.install(registry);
  for (const extension of extensions) registry.install(extension);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: scripted.models }, context);
  t.after(() => harness.close(context).catch(() => {}));
  const conversation = await agent.createConversation(harness, context);
  const say = async text => (await (await conversation.submit({ type: 'input', content: text }, context)).wait(context)).status;
  const results = async () => (await conversation.watch(context)).value.entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'toolResult');
  return { ran, say, results, scripted };
}

test('a flagged mutating call never runs: the model gets the acknowledgement and the call is read back', async t => {
  const sandbox = createSandboxExtension({ tools: ['write_note'], flags });
  const { ran, say, results, scripted } = await open(t, { extensions: [sandbox], scriptTools: ['write_note'] });
  assert.equal(await say('run the fictional tools'), 'done');
  assert.deepEqual(ran, [], 'the write was recorded, not executed');
  const [result] = await results();
  assert.match(result.content[0].text, /Simulated: write_note was recorded and not run/);
  const [recorded] = simulatedCalls(await results());
  assert.deepEqual([recorded.toolName, recorded.arguments], ['write_note', { note: 'fictional' }]);
  assert.equal(result.details[SANDBOX_DETAILS].simulated, true);
  assert.deepEqual(scripted.misses, []);
});

test('declared read-only and sandbox-safe tools run for real; an undeclared tool is recorded', async t => {
  const sandbox = createSandboxExtension({ tools: ['read_note', 'safe_note', 'undeclared_note'], flags });
  const { ran, say } = await open(t, { extensions: [sandbox], scriptTools: ['read_note', 'safe_note', 'undeclared_note'] });
  assert.equal(await say('run the fictional tools'), 'done');
  assert.deepEqual(ran, ['read_note', 'safe_note'], 'mutates:false and sandboxSafe run; undeclared does not');
});

test('a tool the sandbox does not name at install is blocked, even when the run offers it', async t => {
  const sandbox = createSandboxExtension({ tools: ['write_note'], flags });
  const { ran, say, results } = await open(t, { extensions: [sandbox], scriptTools: [] });
  assert.equal(await say('run the unnamed tool'), 'done');
  assert.deepEqual(ran, [], 'late_write is offered by the run but was not named at install, so it did not run');
  const blocked = (await results()).find(message => message.toolName === 'late_write');
  assert.equal(blocked?.isError, true);
  assert.match(blocked.content[0].text, /not covered by the sandbox/);
});

test('a throwing declared-safe tool is a failed call, not a crashed run', async t => {
  const sandbox = createSandboxExtension({ tools: ['throws_note'], flags });
  const { say, results } = await open(t, { extensions: [sandbox], scriptTools: ['throws_note'] });
  assert.equal(await say('run the fictional tools'), 'done');
  const [failed] = (await results()).filter(message => message.toolName === 'throws_note');
  assert.equal(failed?.isError, true);
});

test('without the extension selected nothing changes: the write runs', async t => {
  const { ran, say } = await open(t, { extensions: [], scriptTools: ['write_note'] });
  assert.equal(await say('run the fictional tools'), 'done');
  assert.deepEqual(ran, ['write_note:fictional']);
});

test('a sandbox installed after an approval gate wraps outermost: no question is asked inside a sandbox', async t => {
  const approvals = createApprovalExtension({ tools: { write_note: true } });
  const sandbox = createSandboxExtension({ tools: ['write_note'], flags });
  const { ran, say, results } = await open(t, { extensions: [approvals, sandbox], scriptTools: ['write_note'] });
  assert.equal(await say('run the fictional tools'), 'done', 'the run settles without a person answering');
  assert.deepEqual(ran, []);
  assert.deepEqual(simulatedCalls(await results()).map(call => call.toolName), ['write_note']);
});
