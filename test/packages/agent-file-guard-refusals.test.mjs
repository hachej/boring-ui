import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { ONE_PATH, confinedEnv, createFileGuard } from '@hachej/boring-agent/file-guard';
import { withWorkspace, workspaceFor } from '@hachej/boring-agent/workspaces';
import { fileURLToPath } from 'node:url';
import { FileError, err, ok } from '@earendil-works/pi-durable/env';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { admitDocumentTool, toolResultText } from '../fixtures/native-document.mjs';

const access = { principalId: 'editor', initiatorId: 'alice', scopeId: 'fictional-project' };

async function fixture(t, { guard } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-guard-refusals-'));
  const workspace = join(directory, 'workspace');
  const elsewhere = join(directory, 'elsewhere');
  mkdirSync(workspace); mkdirSync(elsewhere);
  const env = new NodeExecutionEnv({ cwd: workspace });
  const journal = createWorkspaceJournal(openNodeConnection(join(directory, 'journal.sqlite')));
  const files = createWorkspaceProvider({ identity: { providerId: 'guarded', instanceId: 'one', incarnation: 'one', viewId: 'published' }, fs: env, journal });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.files', tools: [createReadTool(), createWriteTool(), createEditTool()] }));
  registry.install(guard ? guard({ files, workspace }) : createFileGuard({ workspace: { files, root: workspace }, resolveAccess: () => access }));
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'session.sqlite')), { registry, models: createModels(), env: () => env }, context);
  t.after(async () => { await harness.close(context); rmSync(directory, { recursive: true, force: true }); });
  const conversation = await harness.root(context);
  const run = async (name, args) => toolResultText(harness, conversation, await admitDocumentTool(conversation, args, name));
  return { workspace, elsewhere, directory, files, run };
}

test('read is refused when the workspace cannot be resolved (it never falls through to Pi\'s read)', async t => {
  const f = await fixture(t, { guard: () => createFileGuard({ resolveAccess: () => access }) });
  writeFileSync(join(f.workspace, 'a.md'), 'secret\n');
  for (const name of ['read', 'write']) {
    const result = await f.run(name, name === 'read' ? { path: 'a.md' } : { path: 'b.md', content: 'x' });
    assert.equal(result.isError, true, name);
    assert.match(result.text, /^Refused:/, name);
    assert.doesNotMatch(result.text, /secret/);
  }
  assert.equal(existsSync(join(f.workspace, 'b.md')), false);
});

test('read is refused when the provider refuses access', async t => {
  const f = await fixture(t, { guard: ({ files, workspace }) => {
    const denying = Object.create(files, { read: { value: async () => ({ kind: 'denied', reason: 'no access for this principal' }) } });
    return createFileGuard({ workspace: { files: denying, root: workspace }, resolveAccess: () => access });
  } });
  writeFileSync(join(f.workspace, 'a.md'), 'secret\n');
  const result = await f.run('read', { path: 'a.md' });
  assert.equal(result.isError, true);
  assert.match(result.text, /^Refused: a\.md cannot be read here/);
  assert.doesNotMatch(result.text, /secret/);
});

test('a symlink inside the workspace that points outside is refused for read, write and edit', async t => {
  const f = await fixture(t);
  writeFileSync(join(f.elsewhere, 'target.md'), 'outside\n');
  symlinkSync(join(f.elsewhere, 'target.md'), join(f.workspace, 'link.md'));
  symlinkSync(f.elsewhere, join(f.workspace, 'linkdir'));
  const attempts = [
    ['read', { path: 'link.md' }],
    ['write', { path: 'link.md', content: 'pwned' }],
    ['edit', { path: 'link.md', edits: [{ oldText: 'outside', newText: 'pwned' }] }],
    ['write', { path: 'linkdir/new.md', content: 'pwned' }],
    ['write', { path: 'linkdir/target.md', content: 'pwned' }],
  ];
  for (const [name, args] of attempts) {
    const result = await f.run(name, args);
    assert.equal(result.isError, true, `${name} ${args.path}`);
    assert.match(result.text, /outside the workspace/, `${name} ${args.path}`);
  }
  assert.equal(readFileSync(join(f.elsewhere, 'target.md'), 'utf8'), 'outside\n');
  assert.equal(existsSync(join(f.elsewhere, 'new.md')), false);
});

test('a dangling symlink inserted after the provider reported the path missing is refused for write and creates nothing outside', async t => {
  let planted = false, outside;
  const f = await fixture(t, { guard: ({ files, workspace }) => {
    // The link appears between the provider's check and the native write: only the env's own check can still stop it.
    const racing = Object.create(files, { read: { value: async (...args) => {
      const result = await files.read(...args);
      if (!planted) { planted = true; symlinkSync(outside, join(workspace, 'new.md')); }
      return result;
    } } });
    return createFileGuard({ workspace: { files: racing, root: workspace }, resolveAccess: () => access });
  } });
  outside = join(f.elsewhere, 'new.md');
  const result = await f.run('write', { path: 'new.md', content: 'pwned' });
  assert.equal(planted, true, 'the link was planted after the provider answered');
  assert.equal(result.isError, true);
  assert.match(result.text, /outside the workspace/);
  assert.equal(existsSync(join(f.elsewhere, 'new.md')), false);
});

test('a lost answer about a missing path\'s link is refused: the underlying write never runs', async () => {
  const lost = err(new FileError('unknown', 'reply lost'));
  const missing = err(new FileError('not_found', 'missing'));
  let writes = 0;
  const env = {
    canonicalPath: async path => path === '/ws' ? ok('/ws') : missing,
    fileInfo: async () => lost,
    writeFile: async () => { writes++; return ok(undefined); },
  };
  const result = await confinedEnv(env, '/ws').writeFile('/ws/new.md', 'x', context);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'permission_denied');
  assert.equal(writes, 0);
});

test('a symlink that stays inside the workspace and a new file under a real directory are still allowed', async t => {
  const f = await fixture(t);
  mkdirSync(join(f.workspace, 'docs'));
  const created = await f.run('write', { path: 'docs/new.md', content: 'hello\n' });
  assert.equal(created.isError, false, created.text);
  assert.equal(readFileSync(join(f.workspace, 'docs/new.md'), 'utf8'), 'hello\n');
});

test('a missing spelling is refused before Pi\'s read can fall back to another one (NFC name, NFD symlink to outside)', async t => {
  const f = await fixture(t);
  writeFileSync(join(f.elsewhere, 'secret.md'), 'OUTSIDE SECRET\n');
  symlinkSync(f.elsewhere, join(f.workspace, 'café'.normalize('NFD')));
  const nfc = 'café/secret.md'.normalize('NFC');
  for (const [name, args] of [['read', { path: nfc }], ['edit', { path: nfc, edits: [{ oldText: 'OUTSIDE', newText: 'pwned' }] }]]) {
    const result = await f.run(name, args);
    assert.equal(result.isError, true, name);
    assert.match(result.text, /^Refused:/, name);
    assert.doesNotMatch(result.text, /OUTSIDE SECRET/, name);
  }
  assert.equal(readFileSync(join(f.elsewhere, 'secret.md'), 'utf8'), 'OUTSIDE SECRET\n');
});

test('Pi\'s other read fallbacks (curly apostrophe, narrow space before AM/PM) cannot reach a file the provider did not observe', async t => {
  const f = await fixture(t);
  writeFileSync(join(f.elsewhere, 'a.md'), 'OUTSIDE A\n');
  writeFileSync(join(f.elsewhere, 'b.md'), 'OUTSIDE B\n');
  symlinkSync(join(f.elsewhere, 'a.md'), join(f.workspace, 'it’s.md'));
  symlinkSync(join(f.elsewhere, 'b.md'), join(f.workspace, 'Shot 9.41 AM.md'));
  for (const path of ['it\'s.md', 'Shot 9.41 AM.md']) {
    const result = await f.run('read', { path });
    assert.equal(result.isError, true, path);
    assert.doesNotMatch(result.text, /OUTSIDE/, path);
  }
});

test('confinedEnv covers every Pi FileSystem method that takes a path, so a Pi upgrade cannot add an unchecked one silently', async () => {
  // The method list comes from Pi's own typings; each name must be a function of a real NodeExecutionEnv.
  const typings = readFileSync(fileURLToPath(new URL('../../node_modules/@earendil-works/pi-durable/dist/env/index.d.ts', import.meta.url)), 'utf8');
  const fileSystem = typings.slice(typings.indexOf('export interface FileSystem {'), typings.indexOf('export interface ShellSpillOptions'));
  // Every declared method, whatever its parameters are called: a new one must be covered or exempted by name.
  const methods = [...fileSystem.matchAll(/^ {4}(\w+)\(/gm)].map(match => match[1]);
  const env = new NodeExecutionEnv({ cwd: process.cwd() });
  for (const name of methods) assert.equal(typeof env[name], 'function', name);
  const covered = new Set([...ONE_PATH, 'renameFile', 'exists']);
  // None of these opens a path: `absolutePath` and `joinPath` only compute strings, `createTempDir` and `createTempFile` make fresh names in the
  // env's own temp area, `cleanup` closes what the env opened, and `watch` is never called by Pi's read, write or edit.
  const exempt = new Set(['absolutePath', 'joinPath', 'createTempDir', 'createTempFile', 'cleanup', 'watch']);
  assert.ok(methods.length >= 20, `found ${methods.length} methods`);
  assert.deepEqual(methods.filter(name => !covered.has(name) && !exempt.has(name)), []);
});

test('a binding attached to a decorated env is found on it, and a binding attached to the env it decorates is found through the decoration', async () => {
  const raw = new NodeExecutionEnv({ cwd: tmpdir() });
  const binding = { files: { providerId: 'fictional' }, root: '/ws' };
  const call = env => ({ env, conversationId: 'c', agent: async () => ({}) });
  const view = confinedEnv(raw, '/ws');
  withWorkspace(view, binding);
  const own = await workspaceFor(undefined, call(view), context);
  assert.equal(own.binding?.files.providerId, 'fictional', JSON.stringify(own));
  const viaOption = await workspaceFor({ ...binding, env: view }, call(view), context);
  assert.equal(viaOption.binding?.env, view, JSON.stringify(viaOption));
  const other = new NodeExecutionEnv({ cwd: tmpdir() });
  withWorkspace(other, binding);
  const through = await workspaceFor(undefined, call(confinedEnv(other, '/ws')), context);
  assert.equal(through.binding?.env, other, JSON.stringify(through));
});
