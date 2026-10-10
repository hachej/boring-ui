import '../files/revision.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteLockedError, openNodeConnection, sqlitePragmas, sqliteSettings } from '@hachej/boring-files/sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { openPiStorage } from '../../examples/shared/pi-storage.mjs';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { applyTextEdits, parseTextEdits } from '@hachej/boring-files/text';
import { publicationDigest } from '@hachej/boring-files/publication';
import { DatabaseSync } from 'node:sqlite';
import { createServer, request as httpRequest } from 'node:http';
import { readBody, sendWebResponse, webRequest } from '@hachej/boring-files/node-http';
import { createHash } from 'node:crypto';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { blobRevision, createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { sha1Portable } from '@hachej/boring-files/platform';
import { parsePublicationResult } from '@hachej/boring-files/publication';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';

const access = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const target = path => ({ resource: { providerId: 'documents', path }, view: { kind: 'published' } });
const create = (operationId, path, text) => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: target(path), expected: { kind: 'absent' }, bytes: encoder.encode(text), mediaType: 'text/markdown' }] });
const latest = path => ({ target: target(path), revision: { kind: 'latest' } });
const replace = (operationId, ref, text) => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: ref, bytes: encoder.encode(text), mediaType: 'text/markdown' }] });

/**
 * A host's SQLite database with one workspace per scope (`examples/shared/sqlite-workspaces.mjs`): each scope is a SQLite workspace
 * (`openSqliteFileSystem` + `createWorkspaceProvider`, the journal in the same database), and `authorize` is the host's policy at
 * the workspace boundary.
 */
function fixture(t, authorize = () => true) {
  const dir = mkdtempSync(join(tmpdir(), 'boring-documents-'));
  const options = { filename: join(dir, 'documents.sqlite'), providerId: 'documents', authorize };
  const provider = openSqliteWorkspaces(options);
  t.after(() => { provider.close(); rmSync(dir, { recursive: true, force: true }); });
  return { provider, options };
}

test('canonical publication digest has a stable version and operation IDs do not change the argument identity', async () => {
  const expected = 'boring-publication-v1:sha256:7877f2a80e184b1a2cec1f216341a87e451118ff8c8f9594d07635777c8d906a';
  assert.equal(await publicationDigest(create('first', 'notes.md', 'ABC')), expected);
  assert.equal(await publicationDigest({ ...create('second', 'notes.md', 'ABC'), preconditions: [] }), expected);
  assert.notEqual(await publicationDigest(create('first', 'notes.md', 'ABD')), expected);
});

test('a SQLite workspace keeps bytes, revisions and operation receipts across reopen', async t => {
  const { provider, options } = fixture(t);
  const request = create('new-document', 'notes.md', '# Fictional notes');
  const result = await provider.publication.publish(request, access);
  assert.equal(result.kind, 'committed');
  provider.close();
  const reopened = openSqliteWorkspaces(options);
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.reconciliation.lookup(request.operationId, access), result);
  const saved = await reopened.read(latest('notes.md'), access);
  assert.equal(saved.kind, 'available');
  assert.deepEqual(saved.snapshot.ref, result.receipt.changes[0].after);
  assert.equal(decoder.decode(saved.snapshot.bytes), '# Fictional notes');
  assert.equal(result.receipt.scopeId, access.scopeId);
  assert.equal(result.receipt.initiatorId, access.initiatorId);
});

test('identical retries preserve revision and receipt; changed arguments cannot reuse a committed ID', async t => {
  const { provider } = fixture(t);
  const request = create('once', 'notes.md', 'original');
  const first = await provider.publication.publish(request, access);
  const reordered = { changes: request.changes.map(item => ({ mediaType: item.mediaType, bytes: item.bytes, expected: item.expected, target: { view: item.target.view, resource: { path: 'notes.md', providerId: 'documents' } }, kind: item.kind })), atomicity: request.atomicity, operationId: request.operationId };
  assert.deepEqual(await provider.publication.publish(reordered, access), first);
  const changed = await provider.publication.publish(create('once', 'other.md', 'replacement'), access);
  assert.equal(changed.kind, 'conflict');
  assert.equal((await provider.read(latest('other.md'), access)).kind, 'missing');
  assert.equal(decoder.decode((await provider.read(latest('notes.md'), access)).snapshot.bytes), 'original');
});

test('stale writes and stale read dependencies refuse the whole batch', async t => {
  const { provider } = fixture(t);
  const first = await provider.publication.publish(create('create', 'notes.md', 'one'), access);
  const original = first.receipt.changes[0].after;
  const second = await provider.publication.publish(replace('edit', original, 'two'), access);
  const stale = replace('stale', original, 'lost human edit');
  stale.changes.push(create('irrelevant', 'other.md', 'must not commit').changes[0]);
  assert.equal((await provider.publication.publish(stale, access)).kind, 'conflict');
  assert.equal((await provider.read(latest('other.md'), access)).kind, 'missing');
  const dependent = create('dependent', 'summary.md', 'derived from one');
  dependent.preconditions = [{ kind: 'revision', target: original }];
  assert.equal((await provider.publication.publish(dependent, access)).kind, 'conflict');
  assert.equal((await provider.reconciliation.lookup('dependent', access)).kind, 'not-found');
  assert.deepEqual((await provider.read(latest('notes.md'), access)).snapshot.ref, second.receipt.changes[0].after);
  const old = await provider.read({ target: target('notes.md'), revision: { kind: 'exact', value: original.revision } }, access);
  assert.equal(decoder.decode(old.snapshot.bytes), 'one');
});

test('the host policy at the workspace boundary is checked for writes, read dependencies, reads and replayed receipts', async t => {
  let authorized = true;
  const { provider } = fixture(t, (action, selected, actor) => authorized && actor.principalId === 'editor' && selected.resource.path !== 'private.md');
  const request = create('authorized-once', 'notes.md', 'confidential fiction');
  assert.equal((await provider.publication.publish(request, { ...access, principalId: 'visitor' })).kind, 'denied');
  assert.equal((await provider.read(latest('notes.md'), access)).kind, 'missing');
  const saved = await provider.publication.publish(request, access);
  const dependency = create('no-read', 'summary.md', 'summary');
  dependency.preconditions = [{ kind: 'absent', target: target('private.md') }];
  assert.equal((await provider.publication.publish(dependency, access)).kind, 'denied');
  authorized = false;
  assert.equal((await provider.publication.publish(request, access)).kind, 'unknown');
  assert.equal((await provider.reconciliation.lookup(request.operationId, access)).kind, 'unknown');
  assert.equal((await provider.read(latest('notes.md'), access)).kind, 'denied');
  authorized = true;
  assert.deepEqual(await provider.reconciliation.lookup(request.operationId, access), saved);
});

test('scope, principal and initiator isolate operation identity and each scope is its own workspace', async t => {
  const { provider } = fixture(t);
  const request = create('same-id', 'notes.md', 'scope one');
  await provider.publication.publish(request, access);
  for (const field of ['scopeId', 'principalId', 'initiatorId']) {
    assert.equal((await provider.reconciliation.lookup('same-id', { ...access, [field]: 'different' })).kind, 'not-found');
  }
  const other = { ...access, scopeId: 'another-project' };
  assert.equal((await provider.read(latest('notes.md'), other)).kind, 'missing');
  assert.equal((await provider.publication.publish(create('same-id', 'notes.md', 'scope two'), other)).kind, 'committed');
  assert.equal(decoder.decode((await provider.read(latest('notes.md'), access)).snapshot.bytes), 'scope one');
});

test('cancellation during authorization refuses before commit', async t => {
  const cancellation = new AbortController();
  const { provider } = fixture(t, () => { cancellation.abort(); return true; });
  const outcome = await provider.publication.publish(create('abort', 'notes.md', 'must not save'), { ...access, signal: cancellation.signal });
  assert.equal(outcome.kind, 'denied');
  assert.equal((await provider.reconciliation.lookup('abort', access)).kind, 'not-found');
  assert.equal((await provider.read(latest('notes.md'), access)).kind, 'missing');
});

test('mutable input, policy callbacks and returned bytes cannot change captured publication', async t => {
  const request = create('capture', 'notes.md', 'ABC');
  const { provider } = fixture(t, (_action, selected, actor) => {
    request.changes[0].bytes.fill(0);
    selected.resource.path = 'redirected.md';
    actor.scopeId = 'redirected';
    return true;
  });
  assert.equal((await provider.publication.publish(request, access)).kind, 'committed');
  const read = await provider.read(latest('notes.md'), access);
  assert.equal(decoder.decode(read.snapshot.bytes), 'ABC');
  read.snapshot.bytes.fill(0);
  assert.equal(decoder.decode((await provider.read(latest('notes.md'), access)).snapshot.bytes), 'ABC');
  assert.equal((await provider.read(latest('redirected.md'), access)).kind, 'missing');
});

test('invalid paths, malformed requests, unsupported views and weak atomicity refuse before effects', async t => {
  const { provider } = fixture(t);
  for (const path of ['../notes', '/notes', 'a//b', 'a/./b', 'a\\b', '%2e%2e/notes', 'notes\uD800']) {
    await assert.rejects(provider.publication.publish(create('bad', path, 'bytes'), access), TypeError);
  }
  await assert.rejects(provider.publication.publish({ ...create('empty', 'notes.md', ''), changes: [] }, access), TypeError);
  const duplicate = create('duplicate', 'notes.md', '');
  duplicate.changes.push(duplicate.changes[0]);
  await assert.rejects(provider.publication.publish(duplicate, access), TypeError);
  const working = create('working', 'notes.md', '');
  working.changes[0].target.view = { kind: 'working', viewId: 'private' };
  assert.equal((await provider.publication.publish(working, access)).kind, 'unavailable');
  assert.equal((await provider.publication.publish({ ...create('partial', 'notes.md', ''), atomicity: 'per-change' }, access)).kind, 'unavailable');
  assert.equal((await provider.read(latest('notes.md'), access)).kind, 'missing');
});

test('two providers over one database honor create absence; history survives a file removed outside the provider', async t => {
  const { provider, options } = fixture(t);
  const other = openSqliteWorkspaces(options);
  t.after(() => other.close());
  const request = create('binary', 'image.bin', '');
  request.changes[0].bytes = Uint8Array.of(0, 255, 128, 1);
  request.changes[0].mediaType = 'application/octet-stream';
  const first = await provider.publication.publish(request, access);
  assert.equal((await other.publication.publish(create('collision', 'image.bin', 'oops'), access)).kind, 'conflict');
  const before = first.receipt.changes[0].after;
  // Files are deleted by the workspace's own tools (here its file system), never through publication.
  const connection = openNodeConnection(options.filename);
  t.after(() => connection.close());
  const fs = openSqliteFileSystem({ connection, workspace: access.scopeId, cwd: '/workspace' });
  assert.equal((await fs.remove('image.bin', {}, BACKGROUND_CONTEXT)).ok, true);
  assert.equal((await provider.read(latest('image.bin'), access)).kind, 'missing');
  const history = await provider.read({ target: target('image.bin'), revision: { kind: 'exact', value: before.revision } }, access);
  assert.deepEqual(history.snapshot.bytes, Uint8Array.of(0, 255, 128, 1));
  assert.equal(history.snapshot.mediaType, 'application/octet-stream');
  assert.equal((await provider.read({ target: target('image.bin'), revision: { kind: 'exact', value: 'unknown' } }, access)).kind, 'unavailable');
  assert.equal((await provider.publication.publish({ operationId: 'delete', atomicity: 'all-or-nothing', changes: [{ kind: 'delete', target: before }] }, access)).kind, 'unavailable');
});

test('capability limitations remain explicit and a closed database refuses', async t => {
  const { provider } = fixture(t);
  const capabilities = await provider.capabilities(target('notes.md'), access);
  assert.equal(capabilities.guarantees.revocationFencing, false);
  assert.equal(capabilities.guarantees.atomicMutationAndReceipt, true);
  assert.equal(capabilities.guarantees.atomicBatch, true);
  assert.deepEqual(capabilities.effective, ['read', 'create', 'replace', 'lookup']);
  provider.close();
  await assert.rejects(provider.read(latest('notes.md'), access), /closed/);
});

test('exact text edits are ordered, preserve whitespace and reject an ambiguous or incomplete batch', () => {
  assert.deepEqual(applyTextEdits('one\r\ntwo  ', [{ find: 'one', replace: 'three' }, { find: 'three', replace: 'four' }]), { kind: 'applied', text: 'four\r\ntwo  ' });
  assert.equal(applyTextEdits('aaa', [{ find: 'aa', replace: 'b' }]).kind, 'rejected');
  assert.equal(applyTextEdits('one', [{ find: 'one', replace: 'two' }, { find: 'missing', replace: 'three' }]).kind, 'rejected');
  assert.equal(applyTextEdits('one', [{ find: 'one', replace: '\ud800' }]).kind, 'rejected');
  for (const edits of [[], [{ find: '', replace: '' }], [{ find: 'a', replace: 4 }]]) assert.throws(() => parseTextEdits(edits), TypeError);
  const original = [{ find: 'a', replace: 'b' }];
  const captured = parseTextEdits(original); original[0].replace = 'c';
  assert.equal(captured[0].replace, 'b');
});

test('exact text transformation preserves a leading Unicode scalar and astral character', () => {
  const result = applyTextEdits('\uFEFF# Fictional \u{1F642}', [{ find: 'Fictional', replace: 'Updated' }]);
  assert.deepEqual(result, { kind: 'applied', text: '\uFEFF# Updated \u{1F642}' });
  assert.deepEqual(new TextEncoder().encode(result.text), new TextEncoder().encode('\uFEFF# Updated \u{1F642}'));
});

for (const action of ['read', 'lookup']) {
  test(`SQLite ${action} observes committed WAL data while another connection holds a writer reservation`, async t => {
    const { provider, options } = fixture(t);
    const saved = await provider.publication.publish(create('wal-seed', 'note.md', 'Committed fictional text'), access);
    assert.equal(saved.kind, 'committed');
    const writer = new DatabaseSync(options.filename);
    try {
      writer.exec("BEGIN IMMEDIATE; UPDATE boring_workspace_files SET bytes = x'00'; DELETE FROM boring_operations;");
      if (action === 'read') {
        const read = await provider.read(latest('note.md'), access);
        assert.equal(read.kind, 'available');
        assert.deepEqual(read.snapshot.ref, saved.receipt.changes[0].after);
        assert.deepEqual(read.snapshot.bytes, encoder.encode('Committed fictional text'));
      } else assert.deepEqual(await provider.reconciliation.lookup('wal-seed', access), saved);
    } finally { writer.exec('ROLLBACK'); writer.close(); }
    assert.deepEqual(await provider.reconciliation.lookup('wal-seed', access), saved);
  });
}

// ---- SQLite settings: one place for journal and locking modes (packages/files/src/sqlite-settings.ts) ------------------------------

const modesOf = connection => ({
  journal: connection.get('PRAGMA journal_mode').journal_mode, locking: connection.get('PRAGMA locking_mode').locking_mode,
  synchronous: connection.get('PRAGMA synchronous').synchronous, busy: connection.get('PRAGMA busy_timeout').timeout, temp: connection.get('PRAGMA temp_store').temp_store,
});

/** Opens `filename` from another Node process with `settings` and reads it: what a second host (or a second task) would do. */
function openFromAnotherProcess(filename, settings) {
  const script = `import { openNodeConnection } from '@hachej/boring-files/sqlite';
const started = Date.now();
try { const c = openNodeConnection(${JSON.stringify(filename)}, ${JSON.stringify(settings)}); const rows = c.get('SELECT count(*) AS n FROM fictional_notes').n; c.close(); console.log(JSON.stringify({ opened: true, rows })); }
catch (error) { console.log(JSON.stringify({ opened: false, name: error.name, code: error.code, message: error.message, cause: String(error.cause?.message), waitedMs: Date.now() - started })); }`;
  const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 30000 });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim());
}

test('SQLite settings: the default stays WAL on local disk; the network file system preset is a rollback journal held exclusively', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-sqlite-settings-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const local = openNodeConnection(join(directory, 'local.sqlite'));
  assert.deepEqual(modesOf(local), { journal: 'wal', locking: 'normal', synchronous: 2, busy: 5000, temp: 0 });
  local.close();
  assert.deepEqual(sqliteSettings.localDisk, { journalMode: 'wal', lockingMode: 'normal', busyTimeoutMs: 5000, synchronous: 'full', tempStore: 'default' });
  assert.deepEqual(sqliteSettings.networkFilesystem, { journalMode: 'delete', lockingMode: 'exclusive', busyTimeoutMs: 10000, synchronous: 'full', tempStore: 'memory' });
  assert.ok(Object.isFrozen(sqliteSettings.networkFilesystem));
  assert.deepEqual(sqlitePragmas(sqliteSettings.networkFilesystem), ['busy_timeout = 10000', 'locking_mode = EXCLUSIVE', 'journal_mode = DELETE', 'synchronous = FULL', 'temp_store = MEMORY'].map(setting => `PRAGMA ${setting}`));
  // A file that was WAL before moves to the rollback journal when the host switches to the preset.
  const efs = openNodeConnection(join(directory, 'local.sqlite'), sqliteSettings.networkFilesystem);
  assert.deepEqual(modesOf(efs), { journal: 'delete', locking: 'exclusive', synchronous: 2, busy: 10000, temp: 2 });
  efs.close();
  // Partial settings fill the rest from local disk.
  const partial = openNodeConnection(join(directory, 'partial.sqlite'), { journalMode: 'truncate', busyTimeoutMs: 250 });
  assert.deepEqual(modesOf(partial), { journal: 'truncate', locking: 'normal', synchronous: 2, busy: 250, temp: 0 });
  partial.close();
});

test('SQLite settings: a second process opening a file held under the preset gets SqliteLockedError after its busy timeout, and the file stays intact', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-sqlite-locked-'));
  const filename = join(directory, 'journal.sqlite');
  let owner = openNodeConnection(filename, sqliteSettings.networkFilesystem);
  t.after(() => { owner?.close(); rmSync(directory, { recursive: true, force: true }); });
  // The owner holds the file from the moment it opens, before its first write.
  assert.equal(openFromAnotherProcess(filename, { ...sqliteSettings.networkFilesystem, busyTimeoutMs: 100 }).name, 'SqliteLockedError');
  owner.transaction('write', () => {
    owner.exec('CREATE TABLE fictional_notes (text TEXT NOT NULL)');
    owner.run('INSERT INTO fictional_notes (text) VALUES (?)', 'Committed fictional note');
  });
  for (const settings of [{ ...sqliteSettings.networkFilesystem, busyTimeoutMs: 400 }, { busyTimeoutMs: 400 }]) {
    const second = openFromAnotherProcess(filename, settings);
    assert.equal(second.opened, false, `a second opener with ${JSON.stringify(settings)} must not open a held file`);
    assert.equal(second.name, 'SqliteLockedError');
    assert.equal(second.code, 'sqlite-locked');
    assert.match(second.message, /journal\.sqlite is locked by another connection/);
    assert.match(second.cause, /database is locked/);
    assert.ok(second.waitedMs >= 350, `waited ${second.waitedMs} ms, less than the busy timeout`);
  }
  // The owner keeps working; once it closes, another process opens the same rows.
  owner.run('INSERT INTO fictional_notes (text) VALUES (?)', 'Second fictional note');
  assert.equal(owner.get('PRAGMA integrity_check').integrity_check, 'ok');
  owner.close(); owner = undefined;
  assert.deepEqual(openFromAnotherProcess(filename, sqliteSettings.networkFilesystem), { opened: true, rows: 2 });
  assert.equal(existsSync(`${filename}-wal`), false);
  assert.equal(existsSync(`${filename}-journal`), false);
});

test('SQLite settings: unknown names and values outside the allow-list are refused before the file is opened', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-sqlite-invalid-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'never.sqlite');
  for (const [settings, message] of [
    [{ journalMode: 'wal; DROP TABLE boring_operations' }, /journalMode must be one of wal, delete, truncate, persist/],
    [{ journalMode: 'WAL' }, /journalMode must be one of/],
    [{ journalMode: 'off' }, /journalMode must be one of/],
    [{ lockingMode: 'shared' }, /lockingMode must be one of normal, exclusive/],
    [{ synchronous: 2 }, /synchronous must be one of off, normal, full, extra/],
    [{ tempStore: 'disk' }, /tempStore must be one of default, file, memory/],
    [{ busyTimeoutMs: -1 }, /busyTimeoutMs must be an integer from 0 to 600000/],
    [{ busyTimeoutMs: 1.5 }, /busyTimeoutMs/],
    [{ busyTimeoutMs: '5000' }, /busyTimeoutMs/],
    [{ cache_size: -2000 }, /Unknown SQLite setting "cache_size"/],
    [{ pragmas: { journal_mode: 'wal' } }, /Unknown SQLite setting "pragmas"/],
  ]) {
    assert.throws(() => openNodeConnection(filename, settings), error => error instanceof TypeError && message.test(error.message), JSON.stringify(settings));
    assert.throws(() => sqlitePragmas(settings), TypeError);
  }
  assert.throws(() => openNodeConnection(filename, null), TypeError);
  assert.equal(existsSync(filename), false);
});

test('SQLite settings: Pi\'s durable storage opened through its public adapter takes the same preset (examples/shared/pi-storage.mjs)', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-sqlite-pi-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'state', 'main.pi.sqlite');
  const storage = await openPiStorage(filename, { ...sqliteSettings.networkFilesystem, busyTimeoutMs: 200 });
  const harness = await Harness.open(storage, { registry: createRegistry(), models: createModels() }, BACKGROUND_CONTEXT);
  try {
    // Pi's harness holds the file: another connection cannot open it, under either locking mode.
    assert.throws(() => openNodeConnection(filename, { busyTimeoutMs: 100 }), SqliteLockedError);
    assert.equal(openFromAnotherProcess(filename, { busyTimeoutMs: 100 }).code, 'sqlite-locked');
  } finally { await harness.close(BACKGROUND_CONTEXT); }
  assert.equal(existsSync(`${filename}-wal`), false);
  const reopened = openNodeConnection(filename, sqliteSettings.networkFilesystem);
  t.after(() => reopened.close());
  assert.equal(reopened.get('PRAGMA journal_mode').journal_mode, 'delete');
  assert.ok(reopened.get("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").n > 0, 'Pi created its tables in the file');
  assert.equal(reopened.get('PRAGMA integrity_check').integrity_check, 'ok');
});

// ---- Workspace provider over a real virtual workspace --------------------------------------------------------------------------

const wsTarget = path => ({ resource: { providerId: 'fictional-workspace', path }, view: { kind: 'published' } });
const wsLatest = path => ({ target: wsTarget(path), revision: { kind: 'latest' } });
const wsCreate = (operationId, path, text) => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: wsTarget(path), expected: { kind: 'absent' }, bytes: encoder.encode(text), mediaType: 'text/markdown' }] });
const wsReplace = (operationId, ref, text) => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: ref, bytes: encoder.encode(text), mediaType: 'text/markdown' }] });
const revisionOf = text => blobRevision(encoder.encode(text));
const wsOperation = operation => ({ scope: JSON.stringify(['fictional-workspace', 'instance', 'view', access.scopeId]), principal: access.principalId, initiator: access.initiatorId, operation });

function connectionOf(db) {
  return {
    exec: sql => { db.exec(sql); },
    run: (sql, ...params) => { db.prepare(sql).run(...params); },
    get: (sql, ...params) => db.prepare(sql).get(...params),
    all: (sql, ...params) => db.prepare(sql).all(...params),
    transaction: (mode, work) => {
      db.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN');
      try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}

/** Wraps an environment so chosen methods are replaced; every other method keeps its receiver. */
const override = (fs, replacements) => new Proxy(fs, {
  get: (target, name) => {
    if (name in replacements) return replacements[name];
    const value = Reflect.get(target, name);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

/**
 * A workspace provider over one of two backends: `memory` (the in-memory just-bash workspace, single-file atomic rename) or `sqlite`
 * (`@hachej/boring-files/sqlite-filesystem`, the journal in the same database, just-bash over the same rows). `virtual` is the shell side.
 */
async function workspaceFixture(t, { files = {}, historyLimit, wrap = fs => fs, incarnation = 'incarnation-one', backend = 'memory' } = {}) {
  const sqlite = backend === 'sqlite' ? openNodeConnection(':memory:') : undefined;
  const store = sqlite && openSqliteFileSystem({ connection: sqlite, workspace: 'fictional', cwd: '/repo' });
  const virtual = createVirtualWorkspace({ providerId: 'fictional-workspace', ...(store ? { fs: store } : { files }) });
  await virtual.filesystem.mkdir('/repo', { recursive: true });
  if (store) for (const [path, text] of Object.entries(files)) { await virtual.filesystem.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true }); await virtual.filesystem.writeFile(path, text); }
  const lease = await virtual.acquire({ operationId: 'workspace', input: { cwd: '/repo' } }, BACKGROUND_CONTEXT);
  const db = sqlite ? undefined : new DatabaseSync(':memory:');
  t.after(() => { db?.close(); sqlite?.close?.(); virtual.dispose(); });
  const journal = createWorkspaceJournal(sqlite ?? connectionOf(db), historyLimit === undefined ? {} : { historyLimit });
  const identity = { providerId: 'fictional-workspace', instanceId: 'instance', incarnation, viewId: 'view' };
  const provider = createWorkspaceProvider({ identity, fs: wrap(store ?? lease.environment), journal });
  const text = async path => decoder.decode((await provider.read(wsLatest(path), access)).snapshot.bytes);
  const publish = request => provider.publication.publish(request, access);
  const names = async () => (await lease.environment.listDir('.', BACKGROUND_CONTEXT)).value.map(item => item.name);
  return { virtual, lease, db, sqlite, store, journal, identity, provider, text, publish, names };
}
/** The same provider semantics on both backends. */
const onBoth = (name, run) => { for (const backend of ['memory', 'sqlite']) test(`${name} (${backend})`, t => run(t, backend)); };

test('revisions are Git blob ids and the portable SHA-1 matches the platform one', async () => {
  assert.equal(await blobRevision(new Uint8Array()), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  assert.equal(await blobRevision(encoder.encode('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
  const bytes = Uint8Array.from({ length: 1000 }, (_, index) => (index * 31) % 256);
  assert.equal(Buffer.from(sha1Portable(bytes)).toString('hex'), createHash('sha1').update(bytes).digest('hex'));
});

test('a workspace provider needs the host identity', async t => {
  const { lease, journal } = await workspaceFixture(t);
  for (const identity of [undefined, {}, { providerId: 'fictional-workspace', instanceId: 'instance', viewId: 'view' }]) {
    assert.throws(() => createWorkspaceProvider({ identity, fs: lease.environment, journal }), TypeError);
  }
});

onBoth('workspace conditional writes create, replace and look up by operation id', async (t, backend) => {
  const { provider, publish, text, virtual, names } = await workspaceFixture(t, { backend, backend });
  const created = await publish(wsCreate('create', 'docs/notes.md', 'one'));
  assert.equal(created.kind, 'committed');
  const first = created.receipt.changes[0].after;
  assert.equal(first.revision, await revisionOf('one'));
  assert.equal(await virtual.filesystem.readFile('/repo/docs/notes.md'), 'one');
  const replaced = await publish(wsReplace('replace', first, 'two'));
  assert.equal(replaced.kind, 'committed');
  assert.deepEqual(replaced.receipt.changes[0].before, first);
  assert.equal(replaced.receipt.changes[0].after.revision, await revisionOf('two'));
  assert.equal(await text('docs/notes.md'), 'two');
  assert.deepEqual(await provider.reconciliation.lookup('replace', access), replaced);
  assert.deepEqual(await publish(wsReplace('replace', first, 'two')), replaced);
  assert.equal((await provider.reconciliation.lookup('replace', { ...access, scopeId: 'other' })).kind, 'not-found');
  assert.equal((await publish(wsReplace('replace', first, 'different'))).kind, 'conflict');
  assert.deepEqual(await names(), ['docs']);
  assert.deepEqual((await virtual.filesystem.readdir('/repo/docs')), ['notes.md']);
});

onBoth('a stale expected revision, including a shell write, is refused and nothing is written', async (t, backend) => {
  const { provider, publish, text, virtual } = await workspaceFixture(t, { backend, files: { '/repo/notes.md': 'one' } });
  const base = (await provider.read(wsLatest('notes.md'), access)).snapshot.ref;
  await virtual.createBash({ cwd: '/repo' }).exec('printf shell > notes.md');
  const refused = await publish(wsReplace('stale', base, 'editor text'));
  assert.equal(refused.kind, 'conflict');
  assert.deepEqual(refused.current.map(item => item.revision), [await revisionOf('shell')]);
  assert.equal(await text('notes.md'), 'shell');
  assert.equal((await provider.reconciliation.lookup('stale', access)).kind, 'not-found');
  assert.equal((await publish(wsCreate('exists', 'notes.md', 'oops'))).kind, 'conflict');
  assert.equal(await text('notes.md'), 'shell');
});

onBoth('a publication precondition on another file is checked before any effect', async (t, backend) => {
  const { publish, provider, text } = await workspaceFixture(t, { backend, files: { '/repo/source.md': 'v1' } });
  const source = (await provider.read(wsLatest('source.md'), access)).snapshot.ref;
  const request = wsCreate('derived', 'summary.md', 'from v1');
  request.preconditions = [{ kind: 'revision', target: { ...source, revision: await revisionOf('v0') } }];
  const refused = await publish(request);
  assert.equal(refused.kind, 'conflict');
  assert.equal((await provider.read(wsLatest('summary.md'), access)).kind, 'missing');
  request.preconditions = [{ kind: 'revision', target: source }];
  assert.equal((await publish({ ...request, operationId: 'derived-fresh' })).kind, 'committed');
  assert.equal(await text('summary.md'), 'from v1');
});

test('SQLite backend: a multi-file batch commits its files, their history and the receipt in one transaction; one stale target refuses all of it', async t => {
  const { publish, provider, text, virtual, sqlite, store } = await workspaceFixture(t, { backend: 'sqlite', files: { '/repo/notes.md': 'one' } });
  const capabilities = await provider.capabilities(wsTarget('notes.md'), access);
  assert.equal(capabilities.guarantees.atomicBatch, true);
  assert.equal(capabilities.guarantees.atomicMutationAndReceipt, true, 'the journal shares the database');
  const base = (await provider.read(wsLatest('notes.md'), access)).snapshot.ref;
  const batch = wsReplace('batch', base, 'two');
  batch.changes.push(wsCreate('ignored', 'docs/summary.md', 'summary').changes[0]);
  const committed = await publish(batch);
  assert.equal(committed.kind, 'committed');
  assert.deepEqual(committed.receipt.changes.map(change => [change.kind, (change.after ?? change.before).resource.path]), [['replace', 'notes.md'], ['create', 'docs/summary.md']]);
  assert.equal(await text('notes.md'), 'two');
  assert.equal(await virtual.filesystem.readFile('/repo/docs/summary.md'), 'summary', 'the shell sees the same rows');
  assert.deepEqual(provider.history('notes.md'), [await revisionOf('two'), await revisionOf('one')]);
  assert.deepEqual(await provider.reconciliation.lookup('batch', access), committed);
  assert.equal(sqlite.get('SELECT count(*) AS n FROM boring_intents').n, 0);

  // notes.md moved on (a shell write): the whole batch is refused, summary.md keeps its bytes and nothing new is created.
  await virtual.createBash({ cwd: '/repo' }).exec('printf shell > notes.md');
  const stale = wsReplace('stale-batch', committed.receipt.changes[0].after, 'three');
  stale.changes.push(wsReplace('ignored', committed.receipt.changes[1].after, 'summary two').changes[0], wsCreate('ignored', 'new.md', 'new').changes[0]);
  const refused = await publish(stale);
  assert.equal(refused.kind, 'conflict');
  assert.deepEqual(refused.current.map(item => item.revision), [await revisionOf('shell')]);
  assert.equal(await text('docs/summary.md'), 'summary');
  assert.equal((await provider.read(wsLatest('new.md'), access)).kind, 'missing');
  assert.equal((await provider.reconciliation.lookup('stale-batch', access)).kind, 'not-found');
  assert.ok(store.incarnation, 'the incarnation belongs to the database rows');
});

test('SQLite backend: a shell write between the provider\'s check and its transaction is a conflict, never lost', async t => {
  const { publish, provider, text, virtual, store } = await workspaceFixture(t, { backend: 'sqlite', files: { '/repo/notes.md': 'one' } });
  const base = (await provider.read(wsLatest('notes.md'), access)).snapshot.ref;
  // The provider checks the target's revision, then asks whether the path is a link: the shell writes in between.
  const fileInfo = store.fileInfo;
  store.fileInfo = async (...args) => { store.fileInfo = fileInfo; await virtual.filesystem.writeFile('/repo/notes.md', 'shell'); return fileInfo(...args); };
  const refused = await publish(wsReplace('raced', base, 'editor'));
  assert.equal(refused.kind, 'conflict');
  assert.deepEqual(refused.current.map(item => item.revision), [await revisionOf('shell')]);
  assert.equal(await text('notes.md'), 'shell', 'the shell write is kept');
  assert.equal((await provider.reconciliation.lookup('raced', access)).kind, 'not-found');
});

test('SQLite backend: files, directories and renames as Pi\'s FileSystem sees them, and rows that outlive the connection', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-sqlite-files-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const ctx = BACKGROUND_CONTEXT;
  let connection = openNodeConnection(join(directory, 'workspace.sqlite'));
  let fs = openSqliteFileSystem({ connection, workspace: 'fictional', cwd: '/repo' });
  const incarnation = fs.incarnation;
  // Like Pi's NodeExecutionEnv (what Pi's write tool relies on), a write creates missing parent directories.
  assert.equal((await fs.writeFile('missing/notes.md', 'x', ctx)).ok, true);
  assert.equal((await fs.listDir('.', ctx)).value.find(entry => entry.name === 'missing')?.kind, 'directory');
  assert.equal((await fs.remove('missing', { recursive: true }, ctx)).ok, true);
  assert.equal((await fs.createDir('docs/deep', { recursive: true }, ctx)).ok, true);
  assert.equal((await fs.writeFile('docs/deep/a.md', 'alpha', ctx)).ok, true);
  assert.equal((await fs.writeFile('docs/deep/a.md/b', 'x', ctx)).error.code, 'not_directory');
  assert.equal((await fs.readTextFile('docs', ctx)).error.code, 'is_directory');
  assert.equal((await fs.remove('docs', {}, ctx)).error.code, 'invalid');
  assert.equal((await fs.renameFile('docs', 'moved', ctx)).ok, true, 'a directory moves with everything below it');
  assert.equal((await fs.readTextFile('/repo/moved/deep/a.md', ctx)).value, 'alpha');
  assert.deepEqual((await fs.listDir('moved', ctx)).value.map(entry => [entry.name, entry.kind]), [['deep', 'directory']]);
  assert.equal((await fs.appendFile('moved/deep/a.md', ' beta', ctx)).ok, true);
  assert.equal((await fs.truncateFile('moved/deep/a.md', 5, ctx)).ok, true);
  assert.equal((await fs.canonicalPath('moved/../moved/deep/a.md', ctx)).value, '/repo/moved/deep/a.md');
  const other = openSqliteFileSystem({ connection, workspace: 'other', cwd: '/repo' });
  assert.notEqual(other.incarnation, incarnation, 'each workspace has its own rows and incarnation');
  assert.equal((await other.exists('moved', ctx)).value, false);
  connection.close();
  connection = openNodeConnection(join(directory, 'workspace.sqlite'));
  fs = openSqliteFileSystem({ connection, workspace: 'fictional', cwd: '/repo' });
  t.after(() => connection.close());
  assert.equal(fs.incarnation, incarnation, 'reopening keeps the incarnation');
  assert.equal((await fs.readTextFile('moved/deep/a.md', ctx)).value, 'alpha');
  assert.equal((await fs.remove('moved', { recursive: true }, ctx)).ok, true);
  assert.deepEqual((await fs.listDir('.', ctx)).value, []);
});

test('a multi-file batch is rejected before any effect', async t => {
  const { publish, provider, names } = await workspaceFixture(t);
  const batch = wsCreate('batch', 'one.md', '1');
  batch.changes.push(wsCreate('ignored', 'two.md', '2').changes[0]);
  assert.equal((await publish(batch)).kind, 'unavailable');
  for (const path of ['one.md', 'two.md']) assert.equal((await provider.read(wsLatest(path), access)).kind, 'missing');
  assert.equal((await provider.reconciliation.lookup('batch', access)).kind, 'not-found');
  assert.equal((await publish({ ...wsCreate('weak', 'one.md', '1'), atomicity: 'per-change' })).kind, 'unavailable');
  assert.deepEqual(await names(), []);
});

onBoth('saving unchanged bytes keeps the revision and is an acknowledged change', async (t, backend) => {
  const { publish, provider, journal, names } = await workspaceFixture(t, { backend, files: { '/repo/notes.md': 'same' } });
  const base = (await provider.read(wsLatest('notes.md'), access)).snapshot.ref;
  const saved = await publish(wsReplace('noop', base, 'same'));
  assert.equal(saved.kind, 'committed');
  assert.equal(saved.receipt.changes[0].before.revision, saved.receipt.changes[0].after.revision);
  assert.deepEqual(parsePublicationResult(JSON.parse(JSON.stringify(saved))), saved);
  assert.deepEqual(provider.history('notes.md'), []);
  assert.deepEqual(await names(), ['notes.md']);
  assert.notEqual(journal.operation(wsOperation('noop')), undefined);
});

onBoth('two concurrent saves from the same revision: the queue lets one commit and refuses the other', async (t, backend) => {
  const { publish, provider, text } = await workspaceFixture(t, { backend, files: { '/repo/notes.md': 'base' } });
  const base = (await provider.read(wsLatest('notes.md'), access)).snapshot.ref;
  const [left, right] = await Promise.all([publish(wsReplace('left', base, 'left')), publish(wsReplace('right', base, 'right'))]);
  assert.deepEqual([left.kind, right.kind].sort(), ['committed', 'conflict']);
  assert.equal(await text('notes.md'), left.kind === 'committed' ? 'left' : 'right');
});

test('an interrupted write reads unknown, is never replayed and leaves the file uncorrupted', async t => {
  let interrupt = true;
  const wrap = fs => override(fs, { renameFile: async (...args) => {
    if (interrupt) throw new Error('process stopped between the intent and the rename');
    return fs.renameFile(...args);
  } });
  const { publish, provider, text, journal } = await workspaceFixture(t, { files: { '/repo/notes.md': 'original' }, wrap });
  const base = (await provider.read(wsLatest('notes.md'), access)).snapshot.ref;
  const request = wsReplace('interrupted', base, 'new text');
  assert.equal((await publish(request)).kind, 'unknown');
  assert.equal(await text('notes.md'), 'original');
  interrupt = false;
  assert.equal((await provider.reconciliation.lookup('interrupted', access)).kind, 'unknown');
  assert.equal((await publish(request)).kind, 'unknown');
  assert.equal(await text('notes.md'), 'original');
  assert.equal(journal.operation(wsOperation('interrupted')), undefined);
  assert.equal((await publish(wsReplace('fresh', base, 'new text'))).kind, 'committed');
  assert.equal(await text('notes.md'), 'new text');
});

test('a backend that cannot rename refuses the write and leaves no temporary file', async t => {
  const wrap = fs => override(fs, { renameFile: async () => ({ ok: false, error: Object.assign(new Error('rename is not supported'), { code: 'not_supported' }) }) });
  const { publish, provider, names } = await workspaceFixture(t, { files: { '/repo/notes.md': 'original' }, wrap });
  const base = (await provider.read(wsLatest('notes.md'), access)).snapshot.ref;
  assert.equal((await publish(wsReplace('no-rename', base, 'new'))).kind, 'unavailable');
  assert.equal((await provider.reconciliation.lookup('no-rename', access)).kind, 'not-found');
  assert.deepEqual(await names(), ['notes.md']);
});

onBoth('a receipt from an earlier incarnation of the workspace reads unknown', async (t, backend) => {
  const first = await workspaceFixture(t, { backend, backend });
  assert.equal((await first.publish(wsCreate('old', 'notes.md', 'one'))).kind, 'committed');
  const second = createWorkspaceProvider({ identity: { ...first.identity, incarnation: 'incarnation-two' }, fs: first.lease.environment, journal: first.journal });
  assert.equal((await second.reconciliation.lookup('old', access)).kind, 'unknown');
  assert.equal((await first.provider.reconciliation.lookup('old', access)).kind, 'committed');
});

onBoth('history keeps the last versions of a file and refuses the rest', async (t, backend) => {
  const { publish, provider } = await workspaceFixture(t, { backend, historyLimit: 20 });
  let ref = (await publish(wsCreate('v0', 'notes.md', 'version 0'))).receipt.changes[0].after;
  const refs = [ref];
  for (let index = 1; index <= 24; index++) {
    ref = (await publish(wsReplace(`v${index}`, ref, `version ${index}`))).receipt.changes[0].after;
    refs.push(ref);
  }
  assert.deepEqual(provider.history('notes.md'), refs.slice(-20).map(item => item.revision).reverse());
  const exact = revision => provider.read({ target: wsTarget('notes.md'), revision: { kind: 'exact', value: revision } }, access);
  assert.equal(decoder.decode((await exact(refs[5].revision)).snapshot.bytes), 'version 5');
  assert.equal((await exact(refs[4].revision)).kind, 'unavailable');
  assert.equal((await exact(refs[0].revision)).kind, 'unavailable');
  assert.equal((await provider.reconciliation.lookup('v0', access)).kind, 'committed');
});

onBoth('provider writes emit change events and polling finds a shell write', async (t, backend) => {
  const { publish, provider, virtual } = await workspaceFixture(t, { backend, files: { '/repo/notes.md': 'one', '/repo/other.md': 'x' } });
  const events = [];
  const stop = provider.onChange(change => events.push(change));
  assert.deepEqual(await provider.poll(['notes.md', 'other.md']), []);
  const base = (await provider.read(wsLatest('notes.md'), access)).snapshot.ref;
  await publish(wsReplace('edit', base, 'two'));
  assert.deepEqual(events, [{ path: 'notes.md', revision: await revisionOf('two'), source: 'publish' }]);
  await virtual.createBash({ cwd: '/repo' }).exec('printf three > notes.md; rm other.md');
  const found = await provider.poll(['notes.md', 'other.md']);
  assert.deepEqual(found, [{ path: 'notes.md', revision: await revisionOf('three'), source: 'poll' }, { path: 'other.md', revision: null, source: 'poll' }]);
  assert.deepEqual(await provider.poll(['notes.md', 'other.md']), []);
  stop();
  await publish(wsCreate('quiet', 'quiet.md', 'q'));
  assert.equal(events.length, 3);
});

// ---- Containment: no symbolic link takes the provider outside the workspace root ---------------------------------------------------

function diskFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-containment-'));
  const root = join(directory, 'workspace'), outside = join(directory, 'outside');
  mkdirSync(root); mkdirSync(outside);
  writeFileSync(join(outside, 'secret.md'), 'outside secret');
  writeFileSync(join(root, 'inside.md'), 'inside text');
  mkdirSync(join(root, 'real'));
  writeFileSync(join(root, 'real', 'doc.md'), 'real doc');
  const db = new DatabaseSync(':memory:');
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  const identity = { providerId: 'fictional-workspace', instanceId: 'disk', incarnation: 'one', viewId: 'view' };
  const provider = createWorkspaceProvider({ identity, fs: new NodeExecutionEnv({ cwd: root }), journal: createWorkspaceJournal(connectionOf(db)) });
  return { provider, root, outside, publish: request => provider.publication.publish(request, access) };
}

test('a link to a path outside the root is never read, written through or polled', async t => {
  const { provider, publish, root, outside } = diskFixture(t);
  symlinkSync(join(outside, 'secret.md'), join(root, 'escape.md'));
  symlinkSync(join(outside, 'missing.md'), join(root, 'dangling.md'));
  assert.equal((await provider.read(wsLatest('escape.md'), access)).kind, 'denied');
  assert.equal((await provider.read(wsLatest('dangling.md'), access)).kind, 'denied');
  const forged = { ...wsTarget('escape.md'), revision: await revisionOf('outside secret') };
  assert.equal((await publish(wsReplace('through-link', forged, 'overwritten'))).kind, 'denied');
  assert.equal((await publish(wsCreate('onto-dangling', 'dangling.md', 'created'))).kind, 'denied');
  assert.equal(readFileSync(join(outside, 'secret.md'), 'utf8'), 'outside secret');
  assert.throws(() => readFileSync(join(outside, 'missing.md')), /ENOENT/);
  assert.equal((await provider.reconciliation.lookup('through-link', access)).kind, 'not-found');
  assert.deepEqual(await provider.poll(['escape.md']), []);
});

test('a link inside the root to a file may be read but is never written through', async t => {
  const { provider, publish, root } = diskFixture(t);
  symlinkSync(join(root, 'inside.md'), join(root, 'alias.md'));
  const read = await provider.read(wsLatest('alias.md'), access);
  assert.equal(decoder.decode(read.snapshot.bytes), 'inside text');
  assert.equal((await publish(wsReplace('through-alias', read.snapshot.ref, 'changed'))).kind, 'denied');
  assert.equal(readFileSync(join(root, 'inside.md'), 'utf8'), 'inside text');
  assert.equal(readFileSync(join(root, 'alias.md'), 'utf8'), 'inside text');
});

test('a symlinked parent directory is followed only while it stays inside the root', async t => {
  const { provider, publish, root, outside } = diskFixture(t);
  symlinkSync(outside, join(root, 'away'));
  symlinkSync(join(root, 'real'), join(root, 'near'));
  assert.equal((await provider.read(wsLatest('away/secret.md'), access)).kind, 'denied');
  assert.equal((await publish(wsCreate('into-outside', 'away/new.md', 'must not land'))).kind, 'denied');
  assert.equal((await publish(wsCreate('into-new-outside', 'away/deeper/new.md', 'must not land'))).kind, 'denied');
  assert.throws(() => readFileSync(join(outside, 'new.md')), /ENOENT/);
  assert.throws(() => readFileSync(join(outside, 'deeper', 'new.md')), /ENOENT/);
  assert.equal((await publish(wsCreate('into-alias', 'near/new.md', 'inside'))).kind, 'committed');
  assert.equal(readFileSync(join(root, 'real', 'new.md'), 'utf8'), 'inside');
  assert.equal(decoder.decode((await provider.read(wsLatest('near/doc.md'), access)).snapshot.bytes), 'real doc');
});

test('the provider\'s temporary names are never resources', async t => {
  const { provider, publish, root } = diskFixture(t);
  const name = '.boring-00000000-0000-4000-8000-000000000000.tmp';
  writeFileSync(join(root, name), 'leftover');
  writeFileSync(join(root, '.boring-mine.tmp'), 'user file');
  assert.equal((await provider.read(wsLatest(name), access)).kind, 'missing');
  assert.equal((await publish(wsCreate('reserved', name, 'x'))).kind, 'unavailable');
  assert.deepEqual(await provider.poll([name]), []);
  assert.equal(readFileSync(join(root, '.boring-mine.tmp'), 'utf8'), 'user file');
});

test('node-http bridges Node requests and streams web responses with backpressure, flushed headers and disconnect', async t => {
  let pulls = 0, cancelled = false, sent;
  const server = createServer(async (incoming, outgoing) => {
    if (incoming.url === '/echo') {
      const request = await webRequest(incoming, 'http://fixture.invalid/echo', { maxBytes: 8 });
      if (!request) return void outgoing.writeHead(413).end();
      const headers = new Headers({ 'content-type': 'text/plain' });
      headers.append('set-cookie', 'a=1'); headers.append('set-cookie', 'b=2');
      return void sendWebResponse(new Response(await request.text(), { headers }), outgoing);
    }
    // An endless body: without backpressure it would be pulled as fast as memory allows while the client reads nothing.
    const chunk = new Uint8Array(64 * 1024);
    const body = new ReadableStream({ pull: controller => { pulls++; controller.enqueue(chunk); }, cancel: () => { cancelled = true; } }, { highWaterMark: 0 });
    sent = sendWebResponse(new Response(body), outgoing);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { port } = server.address();
  const call = (path, body) => new Promise((resolve, reject) => {
    httpRequest({ port, host: '127.0.0.1', path, method: body ? 'POST' : 'GET' }, resolve).on('error', reject).end(body);
  });
  const refused = await call('/echo', 'fictional');
  assert.equal(refused.statusCode, 413, 'a body over the cap is refused');
  refused.resume();
  const small = await call('/echo', 'short');
  assert.deepEqual(small.headers['set-cookie'], ['a=1', 'b=2'], 'each set-cookie value is kept');
  assert.equal(new TextDecoder().decode(await readBody(small)), 'short');
  const endless = await call('/stream');
  assert.equal(endless.statusCode, 200, 'headers arrive before the body ends');
  endless.pause();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(pulls < 200, `a client that reads nothing stops the producer (pulled ${pulls} chunks)`);
  endless.destroy();
  await sent;
  assert.equal(cancelled, true, 'a disconnect cancels the web body');
});
