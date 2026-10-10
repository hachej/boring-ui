import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createEditTool, createReadTool, createWriteTool } from '@earendil-works/pi-durable/tools';
import { createFileGuard } from '@hachej/boring-agent/file-guard';
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
