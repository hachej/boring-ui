import assert from 'node:assert/strict';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openSqliteWorkspaces } from './shared/sqlite-workspaces.mjs';
import { loadAgentDefinition } from '@hachej/boring-agent/definitions';
import { admitDocumentTool, createSaveNoteTool, documentToolResult } from '../test/fixtures/native-document.mjs';

const access = { scopeId: 'fictional-demo', principalId: 'fictional-editor', initiatorId: 'fictional-requester' };
const target = path => ({ resource: { providerId: 'definitions-demo', path }, view: { kind: 'published' } });
const resources = openSqliteWorkspaces({ filename: ':memory:', providerId: 'definitions-demo', authorize: () => true });
const tool = createSaveNoteTool({ target: target('note.md'), publisher: resources.publication,
  operationNamespace: 'fictional-definition-demo', resolveAccess: () => access });
const registry = createRegistry();
registry.install(defineExtension({ name: 'fictional-definition-demo', tools: [tool] }));
const harness = await Harness.open(await openNodeSqliteStorage(':memory:'), { registry, models: createModels() }, context);
try {
  const definition = { format: 'boring.agent', version: 1, instructions: 'Save the fictional note.', tools: [tool.name] };
  const created = await resources.publication.publish({ operationId: 'create-definition', atomicity: 'all-or-nothing', changes: [
    { kind: 'create', target: target('agent.json'), expected: { kind: 'absent' },
      bytes: new TextEncoder().encode(JSON.stringify(definition)), mediaType: 'application/json' },
  ] }, access);
  assert.equal(created.kind, 'committed');
  const options = { reader: resources, ref: created.receipt.changes[0].after, access, implementationVersion: 'fictional-host-v1',
    resolveTool: name => name === tool.name ? { tool, implementationVersion: 'fictional-save-v1' } : undefined };
  const loaded = await loadAgentDefinition(options);
  const conversation = await harness.root(context);
  await conversation.configure(loaded.change, context);
  const saved = await documentToolResult(harness, conversation, await admitDocumentTool(conversation,
    { text: '# Fictional definition demo\n', expected: { kind: 'absent' } }));
  assert.equal(saved.result.kind, 'committed');
  const read = await resources.read({ target: target('note.md'), revision: { kind: 'latest' } }, access);
  assert.equal(read.kind, 'available');
  assert.equal(new TextDecoder().decode(read.snapshot.bytes), '# Fictional definition demo\n');
  assert.deepEqual((await loadAgentDefinition({ ...options, expectedBinding: loaded.binding })).binding, loaded.binding);
  await assert.rejects(loadAgentDefinition({ ...options, expectedBinding: loaded.binding, resolveTool: () => undefined }));
  console.log(JSON.stringify({ binding: loaded.binding, publication: saved.result.receipt }, null, 2));
  console.log('Exact JSON definition configured a native tool and published a fictional note. Revoked reload refused.');
} finally { await harness.close(context); resources.close(); }
