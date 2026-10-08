import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry, defineExtension, ToolResultEntry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createGitRepository } from '@hachej/boring-files/git';
import { createGitTool } from '@hachej/boring-agent/git';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { createVirtualGitFs, installVirtualGitCommand } from '@hachej/boring-execution/virtual-git';
import { admitDocumentTool, documentToolResult } from '../fixtures/native-document.mjs';

test('actual native Git ToolTasks and Bash use the same authorized repository', { timeout: 15000 }, async t => {
  let authorized = true;
  const workspace = createVirtualWorkspace({ providerId: 'fictional-git', files: { '/repo/note': 'first' } });
  const repo = createGitRepository({ fs: createVirtualGitFs(workspace.filesystem), directory: '/repo', author: { name: 'Fictional', email: 'fixture@example.invalid' }, authorize: () => authorized });
  const tool = createGitTool(repo); assert.equal(tool.replay, 'unsafe');
  const registry = createRegistry(); registry.install(defineExtension({ name: 'fixture.git', tools: [tool] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(async () => { await harness.close(context); workspace.dispose(); });
  const conversation = await harness.root(context);
  const shell = workspace.createBash({ cwd: '/repo' });
  installVirtualGitCommand({ bash: shell, repository: repo });
  for (const args of [{ operation: 'init' }, { operation: 'add', path: 'note' }, { operation: 'commit', message: 'native commit' }]) {
    const output = await documentToolResult(harness, conversation, await admitDocumentTool(conversation, args, 'working_git'));
    assert.equal(output.result.operation, args.operation);
  }
  assert.equal(JSON.parse((await shell.exec('git log')).stdout)[0].commit.message, 'native commit\n');
  assert.equal((await shell.exec('printf second > note; git add note; git commit -m shell')).exitCode, 0);
  const history = await documentToolResult(harness, conversation, await admitDocumentTool(conversation, { operation: 'log' }, 'working_git'));
  assert.equal(history.result.value.length, 2);
  const diff = await documentToolResult(harness, conversation, await admitDocumentTool(conversation, { operation: 'diff', before: { kind: 'tree', ref: history.result.value[1].oid }, after: { kind: 'worktree' } }, 'working_git'));
  assert.deepEqual(diff.result.value.map(change => change.path), ['note']);
  authorized = false;
  assert.notEqual((await shell.exec('git status')).exitCode, 0);
  const denied = await harness.waitForTask(await admitDocumentTool(conversation, { operation: 'remove', path: 'note' }, 'working_git'), context);
  assert.equal(denied.state.outcome.status, 'failed');
  const entry = await conversation.commit(tx => tx.entry(ToolResultEntry, denied.state.outcome.result.entryId), context);
  assert.equal(entry.model[0].isError, true);
  assert.match(JSON.stringify(entry.model), /authorization denied/);
  authorized = true; assert.equal((await repo.status())[0][3], 1);
  const other = createVirtualWorkspace({ providerId: 'other', files: { '/repo/note': 'unrelated' } }); t.after(() => other.dispose());
  assert.throws(() => installVirtualGitCommand({ bash: other.createBash({ cwd: '/repo' }), repository: repo }), /bound filesystem/);
  assert.equal((await shell.exec('cd /; git init')).exitCode, 126);
});
