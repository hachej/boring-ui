import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import { createModels } from '@earendil-works/pi-ai/models';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createWorkspaceCache, workspaceOfEnv } from '@hachej/boring-agent/workspaces';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { admitDocumentTool, toolResultText } from '../fixtures/native-document.mjs';

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'boring-cwd-'));
  mkdirSync(join(root, 'nested'));
  writeFileSync(join(root, 'notes.txt'), 'ROOT');
  writeFileSync(join(root, 'nested/notes.txt'), 'NESTED');
  const db = openNodeConnection(':memory:');
  const env = new NodeExecutionEnv({ cwd: root });
  const files = createWorkspaceProvider({ identity: { providerId: 'fictional', instanceId: 'one', incarnation: 'one', viewId: 'one' }, fs: env, journal: createWorkspaceJournal(db) });
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, env, files, access: { principalId: 'agent', initiatorId: 'person', scopeId: 'fictional' } };
}

test('one cached workspace preserves concurrent native cwd selection and guarded writes', async t => {
  const base = workspace(t);
  const facades = [];
  const cache = createWorkspaceCache({ idleMs: Infinity, key: () => 'one', open: () => base,
    atCwd: (_workspace, cwd) => { const env = new NodeExecutionEnv({ cwd }); facades.push(env); return env; } });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fictional.files', tools: [createReadTool(), createWriteTool()] }));
  registry.install(createFileGuard());
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels(), env: cache.env }, context);
  t.after(async () => { await harness.close(context); await cache.close(); });
  const a = await harness.root(context);
  const b = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
  await a.configure({ cwd: base.root }, context);
  await b.configure({ cwd: join(base.root, 'nested') }, context);
  const run = async (conversation, name, args) => toolResultText(harness, conversation, await admitDocumentTool(conversation, args, name));
  const results = await Promise.all([run(a, 'read', { path: 'notes.txt' }), run(b, 'read', { path: 'notes.txt' })]);
  assert.deepEqual(results.map(item => item.text), ['ROOT', 'NESTED']);
  const written = await run(b, 'write', { path: 'notes.txt', content: 'CHANGED' });
  assert.equal(written.isError, false, written.text);
  assert.equal((await base.env.readTextFile('notes.txt', context)).value, 'ROOT');
  assert.equal((await base.env.readTextFile('nested/notes.txt', context)).value, 'CHANGED');
  const target = { conversationId: b.id, cwd: join(base.root, 'nested'), read: harness };
  const env = await cache.env(target, context);
  const binding = await cache.workspace(target, context);
  assert.equal(binding.env, env);
  assert.equal(workspaceOfEnv(env).files, base.files);
  assert.equal(binding.root, base.root);
  assert.equal(facades.length, 1);
  assert.equal(base.env.cwd, base.root);
});

test('cache refuses an unsupported cwd instead of using the workspace root', async t => {
  const base = workspace(t);
  const cache = createWorkspaceCache({ idleMs: Infinity, key: () => 'one', open: () => base });
  t.after(() => cache.close());
  await assert.rejects(cache.env({ conversationId: 1, cwd: join(base.root, 'nested'), read: {} }, context), /cwd|working directory/i);
});

test('idle sweep rechecks use after an asynchronous busy check', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const base = workspace(t);
  let closed = 0;
  const entered = Promise.withResolvers(), busy = Promise.withResolvers();
  const cache = createWorkspaceCache({ idleMs: 100, key: () => 'one', open: () => ({ ...base, close: () => { closed++; } }),
    busy: () => { entered.resolve(); return busy.promise; } });
  t.after(() => cache.close());
  const target = { conversationId: 1, read: {} };
  await cache.env(target, context);
  t.mock.timers.tick(100);
  await entered.promise;
  await cache.env(target, context);
  busy.resolve(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 0);
  assert.deepEqual(cache.keys(), ['one']);
});

test('workspace close joins pending cwd acquisition and refuses its late delivery', async t => {
  const base = workspace(t);
  const started = Promise.withResolvers(), proceed = Promise.withResolvers();
  let closed = false, createdAfterClose;
  const cache = createWorkspaceCache({ idleMs: Infinity, key: () => 'one', open: () => ({ ...base, close: () => { closed = true; } }),
    atCwd: async (_workspace, cwd) => {
      started.resolve(); await proceed.promise;
      createdAfterClose = closed;
      return new NodeExecutionEnv({ cwd });
    } });
  const pending = cache.env({ conversationId: 1, cwd: join(base.root, 'nested'), read: {} }, context);
  await started.promise;
  const rejected = assert.rejects(pending, /closed|released/i);
  const closing = cache.close();
  proceed.resolve();
  await Promise.all([rejected, closing]);
  assert.equal(createdAfterClose, false);
  assert.equal(closed, true);
});
