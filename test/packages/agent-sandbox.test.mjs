import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, ToolResultEntry, createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createReadTool } from '@earendil-works/pi-durable/tools';
import { createModels } from '@earendil-works/pi-ai/models';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createConvertingRead } from '@hachej/boring-agent/file-convert';
import { admitDocumentTool } from '../fixtures/native-document.mjs';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createApprovalExtension } from '@hachej/boring-agent/approval';
import { assertSandboxLast, createSandboxExtension, simulatedCalls, SANDBOX_DETAILS } from '@hachej/boring-agent/sandbox';
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

/** A Harness over a real workspace with Pi's read, then the given extensions in install order (later wraps apply last). */
async function readingWorkspace(t, extensionsInOrder) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-sandbox-convert-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'workspace');
  mkdirSync(workspace);
  writeFileSync(join(workspace, 'doc.pdf'), '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n');
  const env = new NodeExecutionEnv({ cwd: workspace });
  const journal = createWorkspaceJournal(openNodeConnection(join(directory, 'journal.sqlite')));
  const files = createWorkspaceProvider({ identity: { providerId: 'files', instanceId: 'one', incarnation: 'one', viewId: 'published' }, fs: env, journal });
  const access = { principalId: 'editor', initiatorId: 'alice', scopeId: 'fictional-project' };
  const converted = [];
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.files', tools: [createReadTool()] }));
  for (const extension of extensionsInOrder({ files, workspace, access, converted })) registry.install(extension);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models: createModels(), env: () => env }, context);
  t.after(() => harness.close(context).catch(() => {}));
  const conversation = await harness.root(context);
  const terminal = await harness.waitForTask(await admitDocumentTool(conversation, { path: 'doc.pdf' }, 'read'), context);
  const entryId = terminal.state.outcome.result?.entryId;
  assert.notEqual(entryId, undefined, JSON.stringify(terminal.state.outcome));
  const message = (await conversation.commit(tx => tx.entry(ToolResultEntry, entryId), context)).model[0];
  return { message, text: message.content.map(part => part.text ?? '').join(''), converted };
}

test('a setup check refuses a converting read selected after the sandbox, and names the composition limit', async () => {
  const sandbox = createSandboxExtension({ tools: ['read'] });
  const converting = createConvertingRead({ convert: async () => ({ text: 'unused' }) });
  assert.throws(() => assertSandboxLast([sandbox, converting], sandbox), /must be the last wrap of each recorded tool/);
  assert.doesNotThrow(() => assertSandboxLast([converting, sandbox], sandbox));
});

test('a sandbox selected last records a PDF read through a converting read and never converts it', async t => {
  const { message, text, converted } = await readingWorkspace(t, ({ files, workspace, access, converted }) => [
    createConvertingRead({ workspace: { files, root: workspace, access }, convert: async () => { converted.push('pdf'); return { text: 'converted' }; } }),
    createSandboxExtension({ tools: ['read'] }),
  ]);
  assert.equal(message.isError, false, text);
  assert.match(text, /Simulated: read was recorded and not run/);
  assert.deepEqual(converted, [], 'the sandbox recorded the read; the converter never ran');
});

test('a tool added mid-run by addTools is offered to the next round and refused by the sandbox, never executed', async t => {
  const ran = [];
  const discover = defineTool({ name: 'discover_note', description: 'Fictional discovery.', parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: 'text', text: 'discovered' }], control: { addTools: ['late_write'] } }) });
  const late = defineTool({ name: 'late_write', description: 'Fictional late write.', parameters: Type.Object({ note: Type.String() }),
    execute: async args => { ran.push(`late_write:${args.note}`); return { content: [{ type: 'text', text: 'late ran' }] }; } });
  const offered = [];
  const scripted = createScriptedModel({ script: { 'discover, then write late': [
    { tools: [{ name: 'discover_note', args: {} }] },
    ctx => { offered.push(ctx.tools); return { tools: [{ name: 'late_write', args: { note: 'late' } }] }; },
    'Done.',
  ] } });
  const agent = defineAgent({ id: 'discovering', model: scripted.model, tools: [discover, late], extensions: [createSandboxExtension({ tools: ['discover_note'], flags: { discover_note: { sandboxSafe: true } } })], instructions: 'Fictional agent.' });
  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: scripted.models }, context);
  t.after(() => harness.close(context).catch(() => {}));
  const conversation = await agent.createConversation(harness, context);
  // Offered at the start: the discovery tool only. addTools must add late_write later in the run.
  await conversation.configure({ tools: [discover] }, context);
  const submission = await conversation.submit({ type: 'input', content: 'discover, then write late' }, context);
  assert.equal((await submission.wait(context)).status, 'done');
  assert.equal(offered[0].includes('late_write'), true, 'addTools made late_write offered to the next round');
  assert.deepEqual(ran, [], 'the late write was refused and never executed');
  const [refused] = (await conversation.watch(context)).value.entries.flatMap(entry => entry.model ?? [])
    .filter(message => message.role === 'toolResult' && message.toolName === 'late_write');
  assert.equal(refused?.isError, true);
  assert.match(refused.content[0].text, /not covered by the sandbox/);
  assert.deepEqual(scripted.misses, []);
});
