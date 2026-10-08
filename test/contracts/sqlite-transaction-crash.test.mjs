import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';

const child = (directory, ...args) => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const worker = spawn(process.execPath, [fileURLToPath(new URL('../fixtures/sqlite-transaction-crash-child.mjs', import.meta.url)), directory, ...args], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  const terminal = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', (code, signal) => resolve({ code, signal })); });
  terminal.catch(() => {});
  return { worker, terminal };
};

test('SQLite workspace: SIGKILL inside the transaction of a multi-file batch leaves no file changed, the save reads unknown and the draft commits as a new save', { timeout: 15000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-sqlite-workspace-'));
  const { worker, terminal } = child(directory, 'sqlite-workspace');
  t.after(async () => { worker.kill('SIGKILL'); await terminal.catch(() => {}); rmSync(directory, { recursive: true, force: true }); });
  await Promise.race([
    terminal.then(value => { throw new Error(`Exited before the kill: ${JSON.stringify(value)}`); }),
    (async () => { const until = Date.now() + 10000; while (!existsSync(join(directory, 'staged.json'))) { if (Date.now() > until) throw new Error('Staged marker timeout'); await delay(10); } })(),
  ]);
  // Inside the transaction the first file already held the new bytes; the intent was committed before it, the receipt not yet.
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'staged.json'), 'utf8')), { notes: 'replacement text', intents: 1, receipts: 1 });
  worker.kill('SIGKILL');
  assert.deepEqual(await terminal, { code: null, signal: 'SIGKILL' });

  const connection = openNodeConnection(join(directory, 'workspace.sqlite'));
  try {
    const fs = openSqliteFileSystem({ connection, workspace: 'fictional', cwd: '/workspace' });
    const files = createWorkspaceProvider({ identity: { providerId: 'workspace', instanceId: 'fictional', incarnation: fs.incarnation, viewId: 'published' }, fs, journal: createWorkspaceJournal(connection) });
    const access = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'reviewer' };
    const target = path => ({ resource: { providerId: 'workspace', path }, view: { kind: 'published' } });
    const read = await files.read({ target: target('notes.md'), revision: { kind: 'latest' } }, access);
    assert.equal(new TextDecoder().decode(read.snapshot.bytes), 'original text', 'the first file of the batch rolled back');
    assert.equal((await files.read({ target: target('summary.md'), revision: { kind: 'latest' } }, access)).kind, 'missing', 'the second was never written');
    assert.equal((await files.reconciliation.lookup('interrupted-batch', access)).kind, 'unknown', 'an intent without a completion is unknown, never committed');
    const draft = [
      { kind: 'replace', target: read.snapshot.ref, bytes: new TextEncoder().encode('replacement text'), mediaType: 'text/markdown' },
      { kind: 'create', target: target('summary.md'), expected: { kind: 'absent' }, bytes: new TextEncoder().encode('summary text'), mediaType: 'text/markdown' },
    ];
    assert.equal((await files.publication.publish({ operationId: 'interrupted-batch', atomicity: 'all-or-nothing', changes: draft }, access)).kind, 'unknown', 'never replayed automatically');
    assert.equal(new TextDecoder().decode((await files.read({ target: target('notes.md'), revision: { kind: 'latest' } }, access)).snapshot.bytes), 'original text');
    // "Abandon reconciliation and refresh, keeping my draft": the same bytes saved as a new operation commit, both files together.
    const saved = await files.publication.publish({ operationId: 'draft-kept', atomicity: 'all-or-nothing', changes: draft }, access);
    assert.equal(saved.kind, 'committed');
    assert.deepEqual(saved.receipt.changes.map(change => change.kind), ['replace', 'create']);
    for (const [path, text] of [['notes.md', 'replacement text'], ['summary.md', 'summary text']]) assert.equal(new TextDecoder().decode((await files.read({ target: target(path), revision: { kind: 'latest' } }, access)).snapshot.bytes), text);
    assert.equal((await files.reconciliation.lookup('draft-kept', access)).kind, 'committed');
  } finally { connection.close?.(); }
});

test('SIGKILL between the journal intent and the rename leaves the file whole and the save unknown', { timeout: 15000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-workspace-intent-'));
  mkdirSync(join(directory, 'workspace'));
  writeFileSync(join(directory, 'workspace', 'notes.md'), 'original text');
  writeFileSync(join(directory, 'workspace', '.boring-mine.tmp'), 'a user file that only resembles a temporary name');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../fixtures/sqlite-transaction-crash-child.mjs', import.meta.url)), directory, 'workspace'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  const terminal = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  terminal.catch(() => {});
  const db = new DatabaseSync(join(directory, 'journal.sqlite'));
  t.after(async () => { child.kill('SIGKILL'); await terminal.catch(() => {}); db.close(); rmSync(directory, { recursive: true, force: true }); });
  await Promise.race([
    terminal.then(value => { throw new Error(`Exited before the kill: ${JSON.stringify(value)}`); }),
    (async () => { const until = Date.now() + 10000; while (!existsSync(join(directory, 'intent.json'))) { if (Date.now() > until) throw new Error('Intent marker timeout'); await delay(10); } })(),
  ]);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'intent.json'), 'utf8')), { intents: 1, receipts: 0 });
  child.kill('SIGKILL');
  assert.deepEqual(await terminal, { code: null, signal: 'SIGKILL' });
  assert.equal(readFileSync(join(directory, 'workspace', 'notes.md'), 'utf8'), 'original text');

  const connection = {
    exec: sql => { db.exec(sql); }, run: (sql, ...params) => { db.prepare(sql).run(...params); },
    get: (sql, ...params) => db.prepare(sql).get(...params), all: (sql, ...params) => db.prepare(sql).all(...params),
    transaction: (kind, work) => { db.exec(kind === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN'); try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
  };
  const identity = { providerId: 'documents', instanceId: 'disk', incarnation: 'workspace-one', viewId: 'published' };
  const provider = createWorkspaceProvider({ identity, fs: new NodeExecutionEnv({ cwd: join(directory, 'workspace') }), journal: createWorkspaceJournal(connection) });
  const access = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'reviewer' };
  assert.ok(readdirSync(join(directory, 'workspace')).some(name => /^\.boring-[0-9a-f-]{36}\.tmp$/.test(name)), 'the killed process left its temporary file');
  const lookup = await provider.reconciliation.lookup('interrupted-save', access);
  assert.equal(lookup.kind, 'unknown');
  const target = { resource: { providerId: 'documents', path: 'notes.md' }, view: { kind: 'published' } };
  const read = await provider.read({ target, revision: { kind: 'latest' } }, access);
  assert.equal(new TextDecoder().decode(read.snapshot.bytes), 'original text');
  const retry = await provider.publication.publish({ operationId: 'interrupted-save', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: read.snapshot.ref, bytes: new TextEncoder().encode('replacement text'), mediaType: 'text/markdown' }] }, access);
  assert.equal(retry.kind, 'unknown');
  assert.equal(readFileSync(join(directory, 'workspace', 'notes.md'), 'utf8'), 'original text');
  assert.deepEqual(readdirSync(join(directory, 'workspace')).sort(), ['.boring-mine.tmp', 'notes.md']);
});
