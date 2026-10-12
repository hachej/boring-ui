import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { parsePublicationResult } from '@hachej/boring-files/publication';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { durableObjectSqliteConnection } from '@hachej/boring-files/sqlite-durable-object';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';

const LIMIT = 1_900_000;
const identity = { providerId: 'fictional', instanceId: 'workspace', incarnation: 'one', viewId: 'view' };
const access = { principalId: 'person', initiatorId: 'person', scopeId: 'fictional' };
const locate = path => ({ resource: { providerId: identity.providerId, path }, view: { kind: 'published' } });
const bytes = size => new Uint8Array(size).fill(97);
const context = {};
const create = (operationId, changes) => ({
  operationId, atomicity: 'all-or-nothing',
  changes: changes.map(([path, size]) => ({ kind: 'create', target: locate(path), expected: { kind: 'absent' }, bytes: bytes(size), mediaType: 'application/octet-stream' })),
});
const replace = (operationId, path, revision, size) => ({
  operationId, atomicity: 'all-or-nothing',
  changes: [{ kind: 'replace', target: { resource: { providerId: identity.providerId, path }, view: { kind: 'published' }, revision }, bytes: bytes(size), mediaType: 'application/octet-stream' }],
});
const tempDatabase = () => openNodeConnection(join(mkdtempSync(join(tmpdir(), 'size-limit-')), 'files.sqlite'));

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

/** A SQLite workspace over `connection`: the file system (its own limit unless `fs.maxFileBytes`) and a provider (`provider.maxFileBytes` when given). */
function sqliteWorkspace(connection, { fs: fsOptions = {}, provider: providerOptions = {} } = {}) {
  const fs = openSqliteFileSystem({ connection, workspace: 'files', cwd: '/workspace', ...fsOptions });
  const journal = createWorkspaceJournal(connection);
  return { fs, provider: createWorkspaceProvider({ identity: { ...identity, incarnation: fs.incarnation }, fs, journal, ...providerOptions }) };
}

test('SQLite file system: a write at the default limit is stored and one byte more fails with EFBIG and no row', async t => {
  const connection = tempDatabase();
  t.after(() => connection.close());
  const { fs } = sqliteWorkspace(connection);
  assert.equal((await fs.writeFile('/workspace/fits.bin', bytes(LIMIT), context)).ok, true);
  const over = await fs.writeFile('/workspace/too-big.bin', bytes(LIMIT + 1), context);
  assert.equal(over.ok, false);
  assert.equal(over.error.code, 'invalid');
  assert.match(over.error.message, /^EFBIG: file_too_large: /);
  assert.equal((await fs.exists('/workspace/too-big.bin', context)).value, false);
});

test('SQLite file system: multibyte UTF-8 counts bytes, not characters, at the boundary', async t => {
  const connection = tempDatabase();
  t.after(() => connection.close());
  const { fs } = sqliteWorkspace(connection, { fs: { maxFileBytes: 10 } });
  // Five two-byte characters are exactly 10 bytes: accepted. Six characters with one more ASCII byte are 11 bytes: refused.
  assert.equal((await fs.writeFile('/workspace/accents.txt', 'é'.repeat(5), context)).ok, true);
  const over = await fs.writeFile('/workspace/accents.txt', 'é'.repeat(5) + 'a', context);
  assert.equal(over.ok, false);
  assert.equal((await fs.readTextFile('/workspace/accents.txt', context)).value, 'é'.repeat(5));
});

test('SQLite file system: append and truncate past the limit fail before allocating, and an unchanged file stays as it was', async t => {
  const connection = tempDatabase();
  t.after(() => connection.close());
  const { fs } = sqliteWorkspace(connection, { fs: { maxFileBytes: 10 } });
  await fs.writeFile('/workspace/a.txt', 'abcdef', context);
  const appended = await fs.appendFile('/workspace/a.txt', 'ghijkl', context);
  assert.equal(appended.ok, false);
  assert.match(appended.error.message, /^EFBIG/);
  // A huge size is a size refusal, not an allocation failure (RangeError) mapped to `unknown`.
  const huge = await fs.truncateFile('/workspace/a.txt', Number.MAX_SAFE_INTEGER, context);
  assert.equal(huge.ok, false);
  assert.equal(huge.error.code, 'invalid');
  assert.match(huge.error.message, /^EFBIG: file_too_large/);
  assert.equal((await fs.readTextFile('/workspace/a.txt', context)).value, 'abcdef');
  // A real truncate that shrinks the file is allowed.
  assert.equal((await fs.truncateFile('/workspace/a.txt', 3, context)).ok, true);
  assert.equal((await fs.readTextFile('/workspace/a.txt', context)).value, 'abc');
});

test('SQLite file system: renaming a file over the limit onto another file is refused and the destination is kept', async t => {
  const connection = tempDatabase();
  t.after(() => connection.close());
  const { fs } = sqliteWorkspace(connection, { fs: { maxFileBytes: LIMIT } });
  await fs.writeFile('/workspace/big.bin', bytes(LIMIT), context);
  await fs.writeFile('/workspace/target.txt', 'keep', context);
  // The same rows, opened again with a lower limit: the moved file is now over it.
  const lower = sqliteWorkspace(connection, { provider: { maxFileBytes: 10 } }).fs;
  const refused = await lower.renameFile('/workspace/big.bin', '/workspace/target.txt', context);
  assert.equal(refused.ok, false);
  assert.match(refused.error.message, /^EFBIG/);
  assert.equal((await lower.readTextFile('/workspace/target.txt', context)).value, 'keep');
});

test('SQLite file system: renaming a directory with an oversized file below it is refused', async t => {
  const connection = tempDatabase();
  t.after(() => connection.close());
  const { fs } = sqliteWorkspace(connection, { fs: { maxFileBytes: LIMIT } });
  await fs.createDir('/workspace/dir', {}, context);
  await fs.writeFile('/workspace/dir/big.bin', bytes(LIMIT), context);
  const lower = sqliteWorkspace(connection, { provider: { maxFileBytes: 10 } }).fs;
  const refused = await lower.renameFile('/workspace/dir', '/workspace/moved', context);
  assert.equal(refused.ok, false);
  assert.equal((await lower.exists('/workspace/dir/big.bin', context)).value, true);
});

test('SQLite provider: a publication above the limit returns the typed refusal, with no intent or receipt and no bytes', async t => {
  const connection = tempDatabase();
  t.after(() => connection.close());
  const { fs, provider } = sqliteWorkspace(connection);
  const single = await provider.publication.publish(create('too-big', [['big.bin', LIMIT + 1]]), access);
  assert.equal(single.kind, 'file_too_large');
  assert.equal(single.path, 'big.bin');
  assert.equal(single.size, LIMIT + 1);
  assert.equal(single.limit, LIMIT);
  assert.match(single.reason, /file_too_large/);
  assert.equal((await provider.reconciliation.lookup('too-big', access)).kind, 'not-found');
  assert.equal((await fs.exists('/workspace/big.bin', context)).value, false);

  const batch = await provider.publication.publish(create('batch', [['small.md', 10], ['big.bin', LIMIT + 1]]), access);
  assert.equal(batch.kind, 'file_too_large');
  assert.equal((await fs.exists('/workspace/small.md', context)).value, false);
  assert.equal((await provider.publication.publish(create('fits', [['ok.bin', LIMIT]]), access)).kind, 'committed');
});

test('SQLite provider: replacing a file with bytes over the limit is refused and the current bytes stay', async t => {
  const connection = tempDatabase();
  t.after(() => connection.close());
  const { fs, provider } = sqliteWorkspace(connection, { provider: { maxFileBytes: 10 } });
  const created = await provider.publication.publish(create('create-note', [['note.txt', 5]]), access);
  assert.equal(created.kind, 'committed');
  const revision = created.receipt.changes[0].after.revision;
  const refused = await provider.publication.publish(replace('replace-note', 'note.txt', revision, 11), access);
  assert.equal(refused.kind, 'file_too_large');
  assert.equal((await fs.readTextFile('/workspace/note.txt', context)).value, 'aaaaa');
  assert.equal((await provider.publication.publish(replace('replace-fits', 'note.txt', revision, 10), access)).kind, 'committed');
});

test('SQLite provider: a committed publication replayed after the limit was lowered keeps its committed result', async t => {
  const connection = tempDatabase();
  t.after(() => connection.close());
  const first = sqliteWorkspace(connection, { provider: { maxFileBytes: 20 } });
  const request = create('lost-ack', [['note.md', 15]]);
  assert.equal((await first.provider.publication.publish(request, access)).kind, 'committed');
  // The workspace is reopened with a lower limit; the retry of the same operation reports the recorded outcome, not a refusal.
  const reopened = sqliteWorkspace(connection, { provider: { maxFileBytes: 10 } });
  const replay = await reopened.provider.publication.publish(request, access);
  assert.equal(replay.kind, 'committed');
  assert.equal((await reopened.provider.reconciliation.lookup('lost-ack', access)).kind, 'committed');
});

test('one limit: a provider limit of 10 also refuses a native write of 11 bytes, and a provider limit above 1.9 MB raises both', async t => {
  const connection = tempDatabase();
  t.after(() => connection.close());
  const small = sqliteWorkspace(connection, { provider: { maxFileBytes: 10 } });
  assert.equal((await small.fs.writeFile('/workspace/ten.txt', bytes(10), context)).ok, true);
  const native = await small.fs.writeFile('/workspace/eleven.txt', bytes(11), context);
  assert.equal(native.ok, false);
  assert.match(native.error.message, /^EFBIG/);
  assert.equal((await small.provider.publication.publish(create('eleven', [['eleven.bin', 11]]), access)).kind, 'file_too_large');

  const large = sqliteWorkspace(connection, { provider: { maxFileBytes: 3 * LIMIT } });
  const twoMegabytes = 2_500_000;
  assert.equal((await large.fs.writeFile('/workspace/large.bin', bytes(twoMegabytes), context)).ok, true);
  assert.equal((await large.provider.publication.publish(create('large', [['large-published.bin', twoMegabytes]]), access)).kind, 'committed');
});

test('the typed refusal round-trips through the publication parser, and a refusal without its fields is rejected', () => {
  const refusal = { kind: 'file_too_large', path: 'big.bin', size: 11, limit: 10, reason: 'EFBIG: file_too_large' };
  assert.deepEqual(parsePublicationResult(refusal), refusal);
  assert.throws(() => parsePublicationResult({ kind: 'file_too_large', path: 'big.bin', limit: 10, reason: 'x' }), TypeError);
});

test('Durable Object provider: the same default limit applies through the Durable Object connection', async t => {
  const storage = new FakeDurableObjectStorage();
  t.after(() => storage.close());
  const { fs, provider } = sqliteWorkspace(durableObjectSqliteConnection(storage));
  const refused = await provider.publication.publish(create('do-too-big', [['big.bin', LIMIT + 1]]), access);
  assert.equal(refused.kind, 'file_too_large');
  assert.equal((await fs.exists('/workspace/big.bin', context)).value, false);
  assert.equal((await provider.publication.publish(create('do-fits', [['ok.bin', LIMIT]]), access)).kind, 'committed');
});

test('disk provider: no default limit, and an explicit maxFileBytes refuses an oversized publication and leaves the file as it was', async t => {
  const root = mkdtempSync(join(tmpdir(), 'size-limit-disk-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const connection = openNodeConnection(join(root, 'journal.sqlite'));
  t.after(() => connection.close());
  const journal = createWorkspaceJournal(connection);
  const unlimited = createWorkspaceProvider({ identity, fs: new NodeExecutionEnv({ cwd: root }), journal });
  assert.equal((await unlimited.publication.publish(create('disk-big', [['big.bin', LIMIT + 1]]), access)).kind, 'committed');

  const limited = createWorkspaceProvider({ identity: { ...identity, instanceId: 'limited' }, fs: new NodeExecutionEnv({ cwd: root }), journal, maxFileBytes: 10 });
  const refused = await limited.publication.publish(create('disk-limited', [['small.txt', 11]]), access);
  assert.equal(refused.kind, 'file_too_large');
  assert.equal(existsSync(join(root, 'small.txt')), false);
  assert.equal(readFileSync(join(root, 'big.bin')).length, LIMIT + 1);
});
