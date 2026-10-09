import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Harness, createRegistry, defineDoc, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { loadAgentDefinition } from '@hachej/boring-agent/definitions';
import { admitDocumentTool, createSaveNoteTool, documentToolResult } from '../fixtures/native-document.mjs';

const access = { scopeId: 'fictional-team', principalId: 'fictional-editor', initiatorId: 'fictional-author' };
const target = path => ({ resource: { providerId: 'definitions', path }, view: { kind: 'published' } });
const definition = instructions => ({ format: 'boring.agent', version: 1, instructions, tools: ['save_note'] });
const retainedDefinition = defineDoc({ kind: 'fixture.definition-binding', version: 1, scope: 'session', initial: () => ({ binding: null }) });

async function agentConfiguration(conversation) {
  const agent = await conversation.agent(context);
  return { ...agent, sections: agent.sections.map(section => section.key) };
}

async function publishDefinition(provider, operationId, value, previous) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const result = await provider.publication.publish({ operationId, atomicity: 'all-or-nothing', changes: [previous
    ? { kind: 'replace', target: previous, bytes, mediaType: 'application/json' }
    : { kind: 'create', target: target('agent.json'), expected: { kind: 'absent' }, bytes, mediaType: 'application/json' }],
  }, access);
  assert.equal(result.kind, 'committed');
  return result.receipt.changes[0].after;
}

async function fixture(t) {
  const root = fileURLToPath(new URL('../../.cache/definitions-native/', import.meta.url));
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'fixture-'));
  const provider = openSqliteWorkspaces({ filename: join(directory, 'resources.sqlite'), providerId: 'definitions', authorize: () => true });
  const tool = createSaveNoteTool({ target: target('output.md'), publisher: provider.publication,
    operationNamespace: 'fictional-definition', resolveAccess: () => access });
  const echo = defineTool({ name: 'fictional_echo', description: 'Return fictional text.', parameters: Type.Object({ text: Type.String() }),
    execute: async args => ({ content: [{ type: 'text', text: JSON.stringify({ kind: 'echo', text: args.text }) }] }) });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.definition-tools', tools: [tool, echo] }));
  const f = { directory, provider, tool, echo, registry };
  t.after(async () => { if (f.harness) await f.harness.close(context); provider.close(); rmSync(directory, { recursive: true, force: true }); });
  f.storage = await openNodeSqliteStorage(join(directory, 'native.sqlite'));
  f.harness = await Harness.open(f.storage, { registry, models: createModels() }, context);
  f.conversation = await f.harness.root(context, { agent: { instructions: 'Host original instructions' } });
  f.ref = await publishDefinition(provider, 'definition-a', definition('Use the fictional document capability.'));
  f.options = { reader: provider, ref: f.ref, access, implementationVersion: 'fictional-host-v1',
    resolveTool: name => name === tool.name ? { tool, implementationVersion: 'fictional-save-v1' } : undefined };
  return f;
}

test('loading has no native effects; explicit configure selects the real document tool without changing another conversation', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const other = await f.harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { instructions: 'Unrelated host instructions' } }, context);
  const before = await agentConfiguration(f.conversation), otherBefore = await agentConfiguration(other), registryBefore = f.registry.snapshot();
  const loaded = await loadAgentDefinition(f.options);
  assert.equal(loaded.change.tools[0], f.tool);
  assert.deepEqual(await agentConfiguration(f.conversation), before); assert.deepEqual(await agentConfiguration(other), otherBefore);
  assert.equal(f.registry.snapshot(), registryBefore);
  assert.deepEqual((await f.storage.scanTasks({}, 100, undefined, context)).items, []);
  assert.equal((await f.provider.read({ target: target('output.md'), revision: { kind: 'latest' } }, access)).kind, 'missing');

  await f.conversation.configure(loaded.change, context);
  const configured = await f.conversation.agent(context);
  assert.equal(configured.instructions, 'Use the fictional document capability.');
  assert.deepEqual(configured.tools.map(tool => tool.name), ['save_note']);
  assert.deepEqual(await agentConfiguration(other), otherBefore);
  const saved = await documentToolResult(f.harness, f.conversation, await admitDocumentTool(f.conversation,
    { text: 'Fictional configured publication', expected: { kind: 'absent' } }));
  assert.equal(saved.result.kind, 'committed');
  assert.deepEqual(await f.provider.reconciliation.lookup(saved.result.receipt.operationId, access), saved.result);
  const read = await f.provider.read({ target: target('output.md'), revision: { kind: 'latest' } }, access);
  assert.equal(read.kind, 'available'); assert.equal(new TextDecoder().decode(read.snapshot.bytes), 'Fictional configured publication');
  const echoed = await documentToolResult(f.harness, other, await admitDocumentTool(other, { text: 'Unrelated native tool still runs' }, 'fictional_echo'));
  assert.deepEqual(echoed.result, { kind: 'echo', text: 'Unrelated native tool still runs' });
  assert.deepEqual(await agentConfiguration(other), otherBefore);
});

test('a binding persisted in native storage reloads its exact revision after reopen and refuses revoked or changed implementations', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const loaded = await loadAgentDefinition(f.options);
  await f.conversation.configure(loaded.change, context);
  await f.conversation.commit(async tx => { (await tx.doc(retainedDefinition)).binding = loaded.binding; }, context);
  const newer = await publishDefinition(f.provider, 'definition-b', { ...definition('Later instructions must not replace the pinned revision.'), tools: [] }, f.ref);
  assert.notEqual(newer.revision, f.ref.revision);
  const conversationId = f.conversation.id;
  await f.harness.close(context);
  f.storage = await openNodeSqliteStorage(join(f.directory, 'native.sqlite'));
  f.harness = await Harness.open(f.storage, { registry: f.registry, models: createModels() }, context);
  f.conversation = await f.harness.conversation(conversationId, context);
  const persisted = (await f.harness.snapshot(retainedDefinition, context)).binding;
  assert.deepEqual(persisted, loaded.binding);
  const reloaded = await loadAgentDefinition({ ...f.options, ref: persisted.ref, expectedBinding: persisted });
  assert.deepEqual(reloaded.binding, persisted);
  assert.equal(reloaded.change.instructions, 'Use the fictional document capability.');
  const before = await agentConfiguration(f.conversation);
  for (const changed of [
    { resolveTool: () => undefined },
    { resolveTool: () => ({ tool: f.tool, implementationVersion: 'fictional-save-v2' }) },
    { implementationVersion: 'fictional-host-v2' },
  ]) await assert.rejects(loadAgentDefinition({ ...f.options, expectedBinding: persisted, ...changed }));
  assert.deepEqual(await agentConfiguration(f.conversation), before);
  assert.deepEqual((await f.storage.scanTasks({}, 100, undefined, context)).items, []);
  assert.equal((await f.provider.read({ target: target('output.md'), revision: { kind: 'latest' } }, access)).kind, 'missing');
  await f.conversation.configure(reloaded.change, context);
  const saved = await documentToolResult(f.harness, f.conversation, await admitDocumentTool(f.conversation,
    { text: 'Publication after native binding reopen', expected: { kind: 'absent' } }));
  assert.equal(saved.result.kind, 'committed');
  assert.equal(new TextDecoder().decode((await f.provider.read({ target: target('output.md'), revision: { kind: 'latest' } }, access)).snapshot.bytes), 'Publication after native binding reopen');
  assert.deepEqual((await f.harness.snapshot(retainedDefinition, context)).binding, persisted);
});

test('native same-name registry replacement changes later ToolTask execution despite an earlier loaded binding', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const loaded = await loadAgentDefinition(f.options);
  await f.conversation.configure(loaded.change, context);
  const first = await documentToolResult(f.harness, f.conversation, await admitDocumentTool(f.conversation,
    { text: 'Original native implementation', expected: { kind: 'absent' } }));
  assert.equal(first.result.kind, 'committed');
  assert.equal(first.result.receipt.changes[0].after.resource.path, 'output.md');
  const replacement = createSaveNoteTool({ target: target('replacement.md'), publisher: f.provider.publication,
    operationNamespace: 'fictional-replacement', resolveAccess: () => access });
  f.registry.install(defineExtension({ name: 'fixture.definition-tools', tools: [replacement, f.echo] }));
  assert.equal(loaded.change.tools[0], f.tool);
  assert.deepEqual(loaded.binding.tools, [{ name: 'save_note', implementationVersion: 'fictional-save-v1' }]);
  assert.equal((await f.conversation.agent(context)).tools[0], replacement);
  const second = await documentToolResult(f.harness, f.conversation, await admitDocumentTool(f.conversation,
    { text: 'Replacement native implementation', expected: { kind: 'absent' } }));
  assert.equal(second.result.kind, 'committed');
  assert.equal(second.result.receipt.changes[0].after.resource.path, 'replacement.md');
  assert.equal(new TextDecoder().decode((await f.provider.read({ target: target('output.md'), revision: { kind: 'latest' } }, access)).snapshot.bytes), 'Original native implementation');
  assert.equal(new TextDecoder().decode((await f.provider.read({ target: target('replacement.md'), revision: { kind: 'latest' } }, access)).snapshot.bytes), 'Replacement native implementation');
  await assert.rejects(loadAgentDefinition({ ...f.options, expectedBinding: loaded.binding,
    resolveTool: () => ({ tool: replacement, implementationVersion: 'fictional-save-v2' }) }));
});
