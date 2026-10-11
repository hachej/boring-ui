import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { durableObjectSqliteConnection } from '@hachej/boring-files/sqlite-durable-object';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';

const LIMIT = 1_900_000;
const identity = { providerId: 'fictional', instanceId: 'workspace', incarnation: 'one', viewId: 'view' };
const access = { principalId: 'person', initiatorId: 'person', scopeId: 'fictional' };
const locate = path => ({ resource: { providerId: identity.providerId, path }, view: { kind: 'published' } });
const bytes = size => new Uint8Array(size).fill(97);
const create = (operationId, changes) => ({
  operationId, atomicity: 'all-or-nothing',
  changes: changes.map(([path, size]) => ({ kind: 'create', target: locate(path), expected: { kind: 'absent' }, bytes: bytes(size), mediaType: 'application/octet-stream' })),
});

// Minimal Durable Object storage: the same shape `durableObjectSqliteConnection` declares, over an in-memory node:sqlite database.
class FakeDurableObjectStorage {
  #db = new DatabaseSync(':memory:');
  sql = {
    exec: (query, ...bindings) => {
      const values = bindings.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      let rows = [];
      if (values.length > 0) rows = this.#db.prepare(query).all(...values);
      else if (this.#db.prepare(query).columns().length > 0) rows = this.#db.prepare(query).all();
      else this.#db.exec(query);
      const converted = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value])));
      return { toArray: () => converted };
    },
  };
  transactionSync(work) {
    if (this.#db.isTransaction) return work();
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.#db.exec('COMMIT'); return result; } catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  close() { this.#db.close(); }
}

function sqliteProvider(connection, options = {}) {
  const fs = openSqliteFileSystem({ connection, workspace: 'files', cwd: '/workspace', ...options.fs });
  const journal = createWorkspaceJournal(connection);
  return { fs, provider: createWorkspaceProvider({ identity: { ...identity, incarnation: fs.incarnation }, fs, journal, ...options.provider }) };
}

test('SQLite file system: a write at the default limit is stored and one byte more fails with EFBIG and no row', async t => {
  const connection = openNodeConnection(join(mkdtempSync(join(tmpdir(), 'size-limit-')), 'files.sqlite'));
  t.after(() => connection.close());
  const { fs } = sqliteProvider(connection);
  assert.equal((await fs.writeFile('/workspace/fits.bin', bytes(LIMIT), {})).ok, true);
  const over = await fs.writeFile('/workspace/too-big.bin', bytes(LIMIT + 1), {});
  assert.equal(over.ok, false);
  assert.equal(over.error.code, 'invalid');
  assert.match(over.error.message, /^EFBIG: file_too_large: /);
  assert.equal((await fs.exists('/workspace/too-big.bin', {})).value, false);
});

test('SQLite file system: an append or truncate that grows a file past the limit fails and leaves it unchanged', async t => {
  const connection = openNodeConnection(join(mkdtempSync(join(tmpdir(), 'size-limit-')), 'files.sqlite'));
  t.after(() => connection.close());
  const { fs } = sqliteProvider(connection, { fs: { maxFileBytes: 10 } });
  await fs.writeFile('/workspace/a.txt', 'abcdef', {});
  const appended = await fs.appendFile('/workspace/a.txt', 'ghijkl', {});
  assert.equal(appended.ok, false);
  assert.match(appended.error.message, /^EFBIG/);
  assert.equal((await fs.readTextFile('/workspace/a.txt', {})).value, 'abcdef');
});

test('SQLite provider: a publication above the limit is refused before any effect, and a batch with one oversized file writes nothing', async t => {
  const connection = openNodeConnection(join(mkdtempSync(join(tmpdir(), 'size-limit-')), 'files.sqlite'));
  t.after(() => connection.close());
  const { fs, provider } = sqliteProvider(connection);
  const single = await provider.publication.publish(create('too-big', [['big.bin', LIMIT + 1]]), access);
  assert.equal(single.kind, 'unavailable');
  assert.match(single.reason, /file_too_large/);
  assert.equal((await provider.reconciliation.lookup('too-big', access)).kind, 'not-found');
  assert.equal((await fs.exists('/workspace/big.bin', {})).value, false);

  const batch = await provider.publication.publish(create('batch', [['small.md', 10], ['big.bin', LIMIT + 1]]), access);
  assert.equal(batch.kind, 'unavailable');
  assert.equal((await fs.exists('/workspace/small.md', {})).value, false);

  const fits = await provider.publication.publish(create('fits', [['ok.bin', LIMIT]]), access);
  assert.equal(fits.kind, 'committed');
});

test('Durable Object provider: the same default limit applies through the Durable Object connection', async t => {
  const storage = new FakeDurableObjectStorage();
  t.after(() => storage.close());
  const { fs, provider } = sqliteProvider(durableObjectSqliteConnection(storage));
  const refused = await provider.publication.publish(create('do-too-big', [['big.bin', LIMIT + 1]]), access);
  assert.equal(refused.kind, 'unavailable');
  assert.match(refused.reason, /file_too_large/);
  assert.equal((await fs.exists('/workspace/big.bin', {})).value, false);
  assert.equal((await provider.publication.publish(create('do-fits', [['ok.bin', LIMIT]]), access)).kind, 'committed');
});

test('disk provider: no default limit, and an explicit maxFileBytes refuses an oversized replacement and leaves the file as it was', async t => {
  const root = mkdtempSync(join(tmpdir(), 'size-limit-disk-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const connection = openNodeConnection(join(root, 'journal.sqlite'));
  t.after(() => connection.close());
  const journal = createWorkspaceJournal(connection);
  const unlimited = createWorkspaceProvider({ identity, fs: new NodeExecutionEnv({ cwd: root }), journal });
  assert.equal((await unlimited.publication.publish(create('disk-big', [['big.bin', LIMIT + 1]]), access)).kind, 'committed');

  const limited = createWorkspaceProvider({ identity: { ...identity, instanceId: 'limited' }, fs: new NodeExecutionEnv({ cwd: root }), journal, maxFileBytes: 10 });
  const refused = await limited.publication.publish(create('disk-limited', [['small.txt', 11]]), access);
  assert.equal(refused.kind, 'unavailable');
  assert.match(refused.reason, /file_too_large/);
  assert.equal(existsSync(join(root, 'small.txt')), false);
  assert.equal(readFileSync(join(root, 'big.bin')).length, LIMIT + 1);
});
