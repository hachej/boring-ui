import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { durableObjectSqliteConnection } from '@hachej/boring-files/sqlite-durable-object';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { connectRevisionProvider, RevisionError } from '@hachej/boring-files/revision';
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';

// A Durable Object's `ctx.storage` has the shape `durableObjectSqliteConnection` declares: `sql.exec(query, ...bindings)` returns
// a cursor with `toArray()` (blobs come back as ArrayBuffers) and `transactionSync(work)` commits or rolls back one callback.
// The fake runs the same SQL on an in-memory `node:sqlite` database, so the production adapter and the provider run unchanged.
class FakeDurableObjectStorage {
  #db = new DatabaseSync(':memory:');
  sql = {
    exec: (query, ...bindings) => {
      // Like the runtime: several statements are allowed without bindings; with bindings there is one statement.
      // Blobs are ArrayBuffers on the runtime's side and Uint8Arrays in node:sqlite.
      // node:sqlite binds a view over a zero-length ArrayBuffer as NULL; a copy binds as an empty BLOB.
      const values = bindings.map(value => value instanceof ArrayBuffer ? new Uint8Array(value).slice() : value);
      let rows = [];
      // A statement without result columns runs with run(), not all().
      if (values.length > 0) {
        const statement = this.#db.prepare(query);
        if (statement.columns().length > 0) rows = statement.all(...values); else statement.run(...values);
      } else if (this.#db.prepare(query).columns().length > 0) rows = this.#db.prepare(query).all();
      else this.#db.exec(query);
      // A zero-length BLOB reads back as null (the runtime returns no bytes for it), not as an empty buffer.
      const converted = rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? (value.byteLength === 0 ? null : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)) : value])));
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

const encoder = new TextEncoder(), decoder = new TextDecoder();
const access = scopeId => ({ principalId: `${scopeId}-person`, scopeId, initiatorId: `${scopeId}-person` });

/** One Durable Object: one database, one workspace provider per scope (scope = workspace id), the journal in the same database. */
function durableObject(t, scopes = ['alpha', 'beta']) {
  const storage = new FakeDurableObjectStorage();
  t.after(() => storage.close());
  const connection = durableObjectSqliteConnection(storage);
  const journal = createWorkspaceJournal(connection);
  const providers = new Map(scopes.map(scopeId => {
    const fs = openSqliteFileSystem({ connection, workspace: scopeId, cwd: '/workspace' });
    return [scopeId, createWorkspaceProvider({ identity: { providerId: 'files', instanceId: scopeId, incarnation: fs.incarnation, viewId: 'published' }, fs, journal })];
  }));
  // The host resolves the scope from its authenticated session, as in the README example.
  const handler = createRevisionHandler({ resolve: async request => {
    const scopeId = new URL(request.url).searchParams.get('scope');
    const provider = providers.get(scopeId);
    return provider ? { provider, access: access(scopeId) } : null;
  } });
  const connect = scopeId => connectRevisionProvider({ endpoint: `https://fictional.invalid/files?scope=${scopeId}`, fetch: handler });
  return { connect, providers, storage };
}

function create(client, path, text, operationId = `create-${path}`) {
  return { operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: client.locate(path), expected: { kind: 'absent' }, bytes: encoder.encode(text), mediaType: 'text/markdown' }] };
}

test('a Durable Object binds the Library through the SQLite workspace: list, search and history with savedAt', async t => {
  const { connect } = durableObject(t);
  const alpha = await connect('alpha');
  assert.equal((await alpha.publish(create(alpha, 'docs/guide/intro.md', 'one'))).kind, 'committed');
  assert.equal((await alpha.publish(create(alpha, 'docs/readme.md', 'two'))).kind, 'committed');
  assert.equal((await alpha.publish(create(alpha, 'top.md', 'three'))).kind, 'committed');

  // Root: the synthesized directory first, then the file; nested directories are synthesized from deeper paths.
  assert.deepEqual((await alpha.list({})).entries.map(entry => [entry.path, entry.kind]), [['docs', 'directory'], ['top.md', 'file']]);
  const docs = await alpha.list({ directory: 'docs' });
  assert.deepEqual(docs.entries.map(entry => [entry.path, entry.kind, entry.size]), [['docs/guide', 'directory', 0], ['docs/readme.md', 'file', 3]]);

  // Search is a case-insensitive substring of the whole path, across directories.
  assert.deepEqual((await alpha.search({ query: 'GUIDE/intro' })).entries.map(entry => entry.path), ['docs/guide/intro.md']);
  assert.deepEqual((await alpha.search({ query: '.md', limit: 2 })).entries.map(entry => entry.path), ['docs/guide/intro.md', 'docs/readme.md']);

  // A save then a second save of the same path: history is newest first and carries each save time.
  const before = Date.now();
  const loaded = await alpha.read({ target: alpha.locate('top.md'), revision: { kind: 'latest' } });
  const replaced = await alpha.publish({ operationId: 'edit-top', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: loaded.snapshot.ref, bytes: encoder.encode('four'), mediaType: 'text/markdown' }] });
  assert.equal(replaced.kind, 'committed');
  const history = await alpha.history('top.md');
  assert.equal(history.length, 2);
  const latest = await alpha.read({ target: alpha.locate('top.md'), revision: { kind: 'latest' } });
  assert.equal(history[0].revision, latest.snapshot.ref.revision, 'the newest save is the current revision');
  assert.equal(history[1].revision, loaded.snapshot.ref.revision, 'the older save is listed second');
  for (const revision of history) {
    assert.equal(typeof revision.savedAt, 'number');
    assert.ok(revision.savedAt >= before - 1000 && revision.savedAt <= Date.now() + 1000, 'savedAt is a millisecond timestamp');
  }
  assert.ok(history[0].savedAt >= history[1].savedAt, 'newest first');
});

test('a Durable Object round-trips an empty file and its history when zero-length BLOBs read back as null', async t => {
  const { connect } = durableObject(t);
  const alpha = await connect('alpha');
  assert.equal((await alpha.publish(create(alpha, 'empty.md', ''))).kind, 'committed');
  const created = await alpha.read({ target: alpha.locate('empty.md'), revision: { kind: 'latest' } });
  assert.equal(created.kind, 'available');
  assert.deepEqual(created.snapshot.bytes, new Uint8Array());
  assert.equal((await alpha.list({})).entries.find(entry => entry.path === 'empty.md')?.size, 0);

  const replaced = await alpha.publish({ operationId: 'fill-empty', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: created.snapshot.ref, bytes: encoder.encode('filled'), mediaType: 'text/markdown' }] });
  assert.equal(replaced.kind, 'committed');
  const history = await alpha.history('empty.md');
  assert.equal(history.length, 2);
  const older = await alpha.read({ target: alpha.locate('empty.md'), revision: { kind: 'exact', value: history[1].revision } });
  assert.equal(older.kind, 'available');
  assert.deepEqual(older.snapshot.bytes, new Uint8Array(), 'the saved empty version reads back as empty');
});

test('Durable Object rename/delete commit bytes, history and receipt together and roll back a failed receipt', async t => {
  const { connect, storage } = durableObject(t);
  const alpha = await connect('alpha'), beta = await connect('beta');
  const saved = await alpha.publish(create(alpha, 'old.md', 'retained', 'rename-seed'));
  assert.equal(saved.kind, 'committed');
  const revision = saved.receipt.changes[0].after.revision;
  const read = path => alpha.read({ target: alpha.locate(path), revision: { kind: 'latest' } });
  const move = { from: alpha.locate('old.md'), to: alpha.locate('new.md'), expectedRevision: revision, operationId: 'durable-move' };
  const exec = storage.sql.exec;
  let fail = true;
  storage.sql.exec = (query, ...bindings) => {
    if (fail && query.startsWith('INSERT INTO boring_operations')) { fail = false; throw new Error('Fictional receipt failure'); }
    return exec(query, ...bindings);
  };
  assert.equal((await alpha.rename(move)).kind, 'unavailable');
  assert.equal((await read('old.md')).kind, 'available');
  assert.equal((await read('new.md')).kind, 'missing');
  assert.deepEqual(await alpha.history('new.md'), []);
  assert.equal((await alpha.lookup(move.operationId)).kind, 'not-found');
  const moved = await alpha.rename(move);
  assert.equal(moved.kind, 'committed');
  assert.deepEqual(await alpha.rename(move), moved);
  assert.deepEqual(await alpha.lookup(move.operationId), moved);
  assert.equal((await read('old.md')).kind, 'missing');
  assert.equal((await read('new.md')).snapshot.ref.revision, revision);
  assert.equal((await alpha.history('old.md'))[0].source, 'rename');
  const deletion = { path: alpha.locate('new.md'), expectedRevision: revision, operationId: 'durable-delete' };
  fail = true;
  assert.equal((await alpha.delete(deletion)).kind, 'unavailable');
  assert.equal((await read('new.md')).kind, 'available');
  assert.equal((await alpha.history('new.md'))[0].source, 'rename');
  assert.equal((await alpha.lookup(deletion.operationId)).kind, 'not-found');
  const deleted = await alpha.delete(deletion);
  assert.equal(deleted.kind, 'committed');
  assert.deepEqual(await alpha.delete(deletion), deleted);
  assert.deepEqual(await alpha.lookup(deletion.operationId), deleted);
  assert.equal((await read('new.md')).kind, 'missing');
  assert.equal((await alpha.history('new.md'))[0].source, 'delete');
  assert.equal(decoder.decode((await alpha.read({ target: alpha.locate('new.md'), revision: { kind: 'exact', value: revision } })).snapshot.bytes), 'retained');
  assert.equal((await beta.lookup(move.operationId)).kind, 'not-found');
  assert.equal((await beta.rename({ ...move, operationId: 'beta-move' })).kind, 'conflict');
  assert.deepEqual(await beta.history('new.md'), []);
});

test('scope isolation: one scope never lists, searches or reads another scope through the same database', async t => {
  const { connect } = durableObject(t);
  const alpha = await connect('alpha'), beta = await connect('beta');
  assert.equal((await alpha.publish(create(alpha, 'secret/alpha-plan.md', 'alpha'))).kind, 'committed');
  assert.equal((await beta.publish(create(beta, 'beta-notes.md', 'beta'))).kind, 'committed');

  assert.deepEqual((await alpha.list({})).entries.map(entry => entry.path), ['secret']);
  assert.deepEqual((await beta.list({})).entries.map(entry => entry.path), ['beta-notes.md']);
  assert.deepEqual((await alpha.search({ query: 'notes' })).entries, []);
  assert.deepEqual((await beta.search({ query: 'plan' })).entries, []);
  assert.equal((await beta.read({ target: beta.locate('secret/alpha-plan.md'), revision: { kind: 'latest' } })).kind, 'missing');
  assert.deepEqual(await beta.history('secret/alpha-plan.md'), []);
  // A path that exists only in another scope is also unknown to the caller that asks for it by name.
  await assert.rejects(alpha.list({ directory: '../beta' }), error => error instanceof RevisionError && error.kind === 'invalid');
});
