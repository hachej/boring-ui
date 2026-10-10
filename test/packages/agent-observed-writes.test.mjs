// Ruling 2 (2026-10-10): a Pi write or edit through the file guard is observed (history with source agent, a change event),
// never receipted (no publication journal row).
import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { blobRevision, createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { admitDocumentTool, toolResultText } from '../fixtures/native-document.mjs';

const access = { principalId: 'agent', initiatorId: 'agent', scopeId: 'fictional-project' };
const encoder = new TextEncoder();
const revisionOf = text => blobRevision(encoder.encode(text));

test('the file guard records Pi write and edit: history with source agent and the replaced bytes, an agent change event, no receipt', { timeout: 30000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-observed-writes-'));
  const workspace = join(directory, 'workspace');
  mkdirSync(workspace);
  const env = new NodeExecutionEnv({ cwd: workspace });
  const db = openNodeConnection(join(directory, 'journal.sqlite'));
  const files = createWorkspaceProvider({ identity: { providerId: 'guarded', instanceId: 'one', incarnation: 'one', viewId: 'published' }, fs: env, journal: createWorkspaceJournal(db) });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.files', tools: [createReadTool(), createWriteTool(), createEditTool()] }));
  registry.install(createFileGuard({ workspace: { files, root: workspace }, resolveAccess: () => access }));
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models: createModels(), env: () => env }, context);
  t.after(async () => { await harness.close(context); db.close(); rmSync(directory, { recursive: true, force: true }); });
  const conversation = await harness.root(context);
  const run = async (name, args) => toolResultText(harness, conversation, await admitDocumentTool(conversation, args, name));
  const receipts = () => Number(db.get('SELECT (SELECT count(*) FROM boring_operations) + (SELECT count(*) FROM boring_intents) AS count').count);
  const history = path => files.saves(path).map(save => [save.revision, save.source]);
  const start = files.changeHead();

  // write: the created file is in history as an agent revision.
  assert.equal((await run('write', { path: 'a.md', content: 'one\n' })).isError, false);
  assert.deepEqual(history('a.md'), [[await revisionOf('one\n'), 'agent']]);
  // edit after the write: the replaced revision is already retained, the new one is added.
  assert.equal((await run('edit', { path: 'a.md', edits: [{ oldText: 'one', newText: 'two' }] })).isError, false);
  assert.deepEqual(history('a.md'), [[await revisionOf('two\n'), 'agent'], [await revisionOf('one\n'), 'agent']]);
  // edit of a file the agent did not write: its bytes before the edit (the pre-image) are kept, readable by revision.
  writeFileSync(join(workspace, 'seed.md'), 'written by a person\n');
  assert.equal((await run('read', { path: 'seed.md' })).isError, false);
  assert.equal((await run('edit', { path: 'seed.md', edits: [{ oldText: 'a person', newText: 'the agent' }] })).isError, false);
  const pre = await revisionOf('written by a person\n'), post = await revisionOf('written by the agent\n');
  assert.deepEqual(history('seed.md'), [[post, 'agent'], [pre, 'observed']]);
  const preimage = await files.read({ target: { resource: { providerId: 'guarded', path: 'seed.md' }, view: { kind: 'published' } }, revision: { kind: 'exact', value: pre } }, access);
  assert.equal(new TextDecoder().decode(preimage.snapshot.bytes), 'written by a person\n');
  // A refused write records nothing.
  writeFileSync(join(workspace, 'seed.md'), 'changed behind the agent\n');
  assert.equal((await run('write', { path: 'seed.md', content: 'x' })).isError, true);
  assert.equal(history('seed.md').length, 2);
  // Never receipted.
  assert.equal(receipts(), 0);
  // The feed has one agent event per successful write or edit, with the conversation.
  const abort = new AbortController();
  const agent = [];
  for await (const event of files.changes({ since: start, signal: abort.signal }, access)) {
    if (event.kind === 'change' && event.source === 'agent') agent.push(event);
    if (agent.length === 3) break;
  }
  abort.abort();
  assert.deepEqual(agent.map(event => [event.path, event.revision, event.conversationId]), [
    ['a.md', await revisionOf('one\n'), String(conversation.id)],
    ['a.md', await revisionOf('two\n'), String(conversation.id)],
    ['seed.md', post, String(conversation.id)],
  ]);
});
