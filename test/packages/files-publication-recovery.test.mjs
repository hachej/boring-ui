import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { FileError } from '@earendil-works/pi-durable/env';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';

const identity = { providerId: 'fictional', instanceId: 'workspace', incarnation: 'one', viewId: 'view' };
const access = { principalId: 'person', initiatorId: 'person', scopeId: 'fictional' };
const target = { resource: { providerId: identity.providerId, path: 'note.md' }, view: { kind: 'published' } };
const bytes = text => new TextEncoder().encode(text);
const replacement = ref => ({
  operationId: 'save-note', atomicity: 'all-or-nothing',
  changes: [{ kind: 'replace', target: ref, bytes: bytes('NEW'), mediaType: 'text/markdown' }],
});
const current = provider => provider.read({ target, revision: { kind: 'latest' } }, access);

function diskFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'boring-publication-recovery-'));
  writeFileSync(join(root, 'note.md'), 'OLD');
  const fs = new NodeExecutionEnv({ cwd: root });
  const database = join(root, 'journal.sqlite');
  let connection = openNodeConnection(database);
  const openProvider = () => createWorkspaceProvider({ identity, fs, journal: createWorkspaceJournal(connection) });
  t.after(() => { connection.close(); rmSync(root, { recursive: true, force: true }); });
  return {
    root, fs, provider: openProvider(),
    reopen: () => { connection.close(); connection = openNodeConnection(database); return openProvider(); },
  };
}

for (const failure of ['unknown', 'aborted', 'throw']) {
  test(`a committed disk rename with ${failure} acknowledgement retains uncertainty across reopen and retry`, async t => {
    const fixture = diskFixture(t);
    const rename = fixture.fs.renameFile.bind(fixture.fs);
    let renames = 0;
    fixture.fs.renameFile = async (...args) => {
      renames++;
      const result = await rename(...args);
      assert.equal(result.ok, true);
      if (failure === 'throw') throw new Error('The rename acknowledgement was lost');
      return { ok: false, error: new FileError(failure, 'The rename acknowledgement was lost') };
    };
    const before = await current(fixture.provider);
    assert.equal(before.kind, 'available');
    const request = replacement(before.snapshot.ref);
    const result = await fixture.provider.publication.publish(request, access);
    assert.equal(readFileSync(join(fixture.root, 'note.md'), 'utf8'), 'NEW');
    assert.equal(result.kind, 'unknown');
    assert.equal(result.operationId, request.operationId);

    const reopened = fixture.reopen();
    assert.equal((await reopened.reconciliation.lookup(request.operationId, access)).kind, 'unknown');
    writeFileSync(join(fixture.root, 'note.md'), 'OLD');
    assert.equal((await reopened.publication.publish(request, access)).kind, 'unknown');
    assert.equal(renames, 1, 'the original operation must not be dispatched again after a later edit restores its base');
    assert.equal(readFileSync(join(fixture.root, 'note.md'), 'utf8'), 'OLD');
  });
}

test('a definite disk rename refusal clears the intent and permits a safe retry', async t => {
  const fixture = diskFixture(t);
  const rename = fixture.fs.renameFile.bind(fixture.fs);
  fixture.fs.renameFile = async () => ({ ok: false, error: new FileError('permission_denied', 'Rename refused') });
  const request = replacement((await current(fixture.provider)).snapshot.ref);
  assert.equal((await fixture.provider.publication.publish(request, access)).kind, 'unavailable');
  assert.equal((await fixture.provider.reconciliation.lookup(request.operationId, access)).kind, 'not-found');
  assert.equal(readFileSync(join(fixture.root, 'note.md'), 'utf8'), 'OLD');
  assert.equal(readdirSync(fixture.root).some(name => name.startsWith('.boring-')), false);
  fixture.fs.renameFile = rename;
  assert.equal((await fixture.provider.publication.publish(request, access)).kind, 'committed');
  assert.equal(readFileSync(join(fixture.root, 'note.md'), 'utf8'), 'NEW');
});

async function sqliteFixture(t) {
  const connection = openNodeConnection(':memory:');
  t.after(() => connection.close());
  const fs = openSqliteFileSystem({ connection, workspace: 'fictional', cwd: '/repo' });
  assert.equal((await fs.writeFile('/repo/note.md', 'OLD', BACKGROUND_CONTEXT)).ok, true);
  const provider = createWorkspaceProvider({ identity, fs, journal: createWorkspaceJournal(connection) });
  const request = replacement((await current(provider)).snapshot.ref);
  return { fs, provider, request };
}

test('SQLite cancellation after the final metadata read refuses before any publication effect', async t => {
  const { fs, provider, request } = await sqliteFixture(t);
  const controller = new AbortController();
  const fileInfo = fs.fileInfo.bind(fs);
  let metadataReads = 0;
  fs.fileInfo = async (...args) => {
    const result = await fileInfo(...args);
    assert.equal(result.ok, true);
    if (++metadataReads === 2) controller.abort();
    return result;
  };
  const changes = [];
  provider.onChange(change => changes.push(change));
  const result = await provider.publication.publish(request, { ...access, signal: controller.signal });
  assert.equal(controller.signal.aborted, true);
  assert.equal(result.kind, 'unavailable');
  assert.equal((await fs.readTextFile('/repo/note.md', BACKGROUND_CONTEXT)).value, 'OLD');
  assert.equal((await provider.reconciliation.lookup(request.operationId, access)).kind, 'not-found');
  assert.deepEqual(changes, []);
  assert.deepEqual(provider.history('note.md'), []);

  fs.fileInfo = fileInfo;
  assert.equal((await provider.publication.publish(request, access)).kind, 'committed');
  assert.equal((await fs.readTextFile('/repo/note.md', BACKGROUND_CONTEXT)).value, 'NEW');
});

test('SQLite cancellation after commit preserves the committed receipt and does not replay', async t => {
  const { fs, provider, request } = await sqliteFixture(t);
  const controller = new AbortController();
  provider.onChange(() => controller.abort());
  const result = await provider.publication.publish(request, { ...access, signal: controller.signal });
  assert.equal(controller.signal.aborted, true);
  assert.equal(result.kind, 'committed');
  assert.deepEqual(await provider.reconciliation.lookup(request.operationId, access), result);
  assert.equal((await fs.writeFile('/repo/note.md', 'LATER EDIT', BACKGROUND_CONTEXT)).ok, true);
  assert.deepEqual(await provider.publication.publish(request, access), result);
  assert.equal((await fs.readTextFile('/repo/note.md', BACKGROUND_CONTEXT)).value, 'LATER EDIT');
});
