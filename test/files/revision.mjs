import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { connectRevisionProvider, RevisionError } from '@hachej/boring-files/revision';
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';

const access = { principalId: 'fictional-person', scopeId: 'fictional-scope', initiatorId: 'fictional-person' };
const encoder = new TextEncoder();
function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-revision-'));
  const db = openNodeConnection(join(directory, 'files.sqlite'));
  const fs = openSqliteFileSystem({ connection: db, workspace: 'fictional', cwd: '/workspace' });
  const provider = createWorkspaceProvider({ fs, journal: createWorkspaceJournal(db), identity: { providerId: 'files', instanceId: 'fictional', incarnation: fs.incarnation, viewId: 'published' }, ...options });
  t.after(() => { db.close(); rmSync(directory, { force: true, recursive: true }); });
  let released = 0, resolves = 0, current = provider, authorized = true;
  const handler = createRevisionHandler({ resolve: async () => { resolves++; return authorized ? { provider: current, access, release: () => { released++; } } : null; } });
  return { provider, fs, db, directory, handler, released: () => released, resolves: () => resolves, select: value => { current = value; }, deny: () => { authorized = false; } };
}
const connect = handler => connectRevisionProvider({ endpoint: 'https://fictional.invalid/files', fetch: handler });
function create(client, path, bytes, id = path) {
  return { operationId: id, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: client.locate(path), expected: { kind: 'absent' }, bytes: typeof bytes === 'string' ? encoder.encode(bytes) : bytes, mediaType: 'application/octet-stream' }] };
}
async function seed(client, files) {
  for (const [path, bytes] of Object.entries(files)) assert.equal((await client.publish(create(client, path, bytes))).kind, 'committed');
}

test('revision binding lists and searches paginated native SQLite files with nested Git ignore rules', async t => {
  const f = fixture(t), client = await connect(f.handler);
  await seed(client, { '.git/info/exclude': 'excluded.md\nkeep.tmp\n', 'excluded.md': 'exclude', '.gitignore': '*.tmp\n!keep.tmp\nnotes/*.md\n!notes/keep.md\nignored/\n', 'a.md': 'a', 'b.md': 'b', 'keep.tmp': 'keep', 'drop.tmp': 'drop', 'notes/keep.md': 'keep', 'notes/hide.md': 'hidden', 'notes/.gitignore': '!local.md\n', 'notes/local.md': 'local', 'node_modules/a.js': 'dep', 'dist/a.js': 'build', '.git/config': 'internal', 'ignored/hidden.md': 'hidden' });
  const listed = [];
  let cursor;
  do { const page = await client.list({ limit: 2, ...(cursor ? { cursor } : {}) }); listed.push(...page.entries.map(entry => entry.path)); cursor = page.cursor; } while (cursor);
  assert.deepEqual(listed, ['.gitignore', 'a.md', 'b.md', 'keep.tmp', 'notes']);
  assert.deepEqual((await client.list({ directory: 'notes' })).entries.map(entry => entry.path), ['notes/.gitignore', 'notes/keep.md', 'notes/local.md']);
  assert.deepEqual((await client.list({ directory: 'ignored' })).entries, []);
  const first = await client.search({ query: '.md', limit: 2 });
  assert.deepEqual(first.entries.map(entry => entry.path), ['a.md', 'b.md']);
  assert.deepEqual((await client.search({ query: '.md', limit: 2, cursor: first.cursor })).entries.map(entry => entry.path), ['notes/keep.md', 'notes/local.md']);
  await assert.rejects(client.search({ query: 'other', cursor: first.cursor }), error => error instanceof RevisionError && error.kind === 'invalid');
  assert.equal(f.released(), f.resolves(), 'every request releases its borrowed workspace');
});

test('catalog overrides affect browsing only, while traversal overflow fails explicitly', async t => {
  const f = fixture(t, { catalog: { defaults: false, filter: entry => entry.path !== 'hidden.md' } }), client = await connect(f.handler);
  await seed(client, { '.gitignore': '*.tmp', 'visible.tmp': 'show', 'hidden.md': 'hidden', 'node_modules/package.json': '{}' });
  assert.ok((await client.search({ query: '' })).entries.some(entry => entry.path === 'visible.tmp'));
  assert.ok((await client.search({ query: '' })).entries.some(entry => entry.path === 'node_modules/package.json'));
  assert.equal((await client.search({ query: 'hidden' })).entries.length, 0);
  assert.equal((await client.read({ target: client.locate('hidden.md'), revision: { kind: 'latest' } })).kind, 'available', 'presentation filter is not authorization');
  const bounded = fixture(t, { catalog: { maxEntries: 1 } }), other = await connect(bounded.handler);
  await seed(other, { 'one': '1', 'two': '2' });
  await assert.rejects(other.search({ query: '' }), error => error.kind === 'unavailable');
});

test('binary upload uses publication, duplicate IDs, retained history and lost-ack reconciliation', async t => {
  const f = fixture(t); let lose = false;
  const client = await connect(async request => { const response = await f.handler(request); if (lose) { lose = false; throw new Error('fictional lost acknowledgement'); } return response; });
  const bytes = Uint8Array.from([0, 255, 128, 10]);
  const request = create(client, 'uploads/binary.bin', bytes, 'stable-upload');
  lose = true;
  assert.equal((await client.publish(request)).kind, 'unknown');
  const lookup = await client.lookup('stable-upload');
  assert.equal(lookup.kind, 'committed');
  assert.equal((await client.publish(request)).kind, 'committed');
  const saved = await client.read({ target: client.locate('uploads/binary.bin'), revision: { kind: 'latest' } });
  assert.equal(saved.kind, 'available'); assert.deepEqual(saved.snapshot.bytes, bytes);
  assert.equal((await client.publish(create(client, 'uploads/binary.bin', 'different', 'collision'))).kind, 'conflict');
  const replaced = await client.publish({ operationId: 'replace', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: saved.snapshot.ref, bytes: encoder.encode('next'), mediaType: 'text/plain' }] });
  assert.equal(replaced.kind, 'committed');
  assert.equal((await client.history('uploads/binary.bin')).length, 2);
  assert.deepEqual((await client.read({ target: client.locate('uploads/binary.bin'), revision: { kind: 'exact', value: saved.snapshot.ref.revision } })).snapshot.bytes, bytes);
});

test('stale workspace incarnation and authorization refuse publication before effects', async t => {
  const f = fixture(t), client = await connect(f.handler);
  f.select({ ...f.provider, identity: { ...f.provider.identity, incarnation: 'recreated' } });
  await assert.rejects(client.list({}), error => error.kind === 'denied');
  assert.equal((await client.publish(create(client, 'must-not-exist', 'no'))).kind, 'unknown');
  assert.equal((await f.provider.read({ target: client.locate('must-not-exist'), revision: { kind: 'latest' } }, access)).kind, 'missing');
  f.deny(); await assert.rejects(connect(f.handler), error => error.kind === 'denied');
  assert.equal(f.released(), f.resolves() - 1);
});

test('catalog validates paths and cancellation, and client refuses another workspace response', async t => {
  const f = fixture(t), client = await connect(f.handler);
  await assert.rejects(client.list({ directory: '../outside' }), error => error.kind === 'invalid');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(client.list({}, abort.signal), error => error.kind === 'aborted');
  let discovery = true;
  const tampered = await connect(async request => { const response = await f.handler(request); if (discovery) { discovery = false; return response; } const value = await response.json(); value.workspace.incarnation = 'other'; return Response.json(value); });
  await assert.rejects(tampered.list({}), error => error.kind === 'denied');
  const pending = await connectRevisionProvider({ endpoint: 'https://fictional.invalid/files', fetch: request => request.method === 'GET' ? f.handler(request) : new Promise(() => {}) });
  const stop = new AbortController(), waiting = pending.list({}, stop.signal); stop.abort();
  await assert.rejects(waiting, error => error.kind === 'aborted');
});

test('native catalog excludes symlinks and refuses outside .gitignore without reading it', async t => {
  const f = fixture(t), root = mkdtempSync(join(tmpdir(), 'boring-catalog-native-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  writeFileSync(join(root, 'visible.txt'), 'visible');
  symlinkSync(f.directory, join(root, 'outside'));
  symlinkSync(root, join(root, 'cycle'));
  const provider = createWorkspaceProvider({ fs: new NodeExecutionEnv({ cwd: root }), journal: createWorkspaceJournal(f.db), identity: { providerId: 'files', instanceId: 'native', incarnation: 'one', viewId: 'published' } });
  assert.deepEqual((await provider.catalog.search({ query: '' }, access)).entries.map(entry => entry.path), ['visible.txt']);
  writeFileSync(join(f.directory, 'ignore'), '*.txt'); symlinkSync(join(f.directory, 'ignore'), join(root, '.gitignore'));
  await assert.rejects(provider.catalog.search({ query: '' }, access), error => error.kind === 'denied');
});

test('concurrent upload and stale user edits cannot overwrite agent publication', async t => {
  const f = fixture(t), user = await connect(f.handler), agent = await connect(f.handler);
  const uploads = await Promise.all([user.publish(create(user, 'shared.md', 'user', 'user-create')), agent.publish(create(agent, 'shared.md', 'agent', 'agent-create'))]);
  assert.deepEqual(uploads.map(result => result.kind).sort(), ['committed', 'conflict']);
  const loaded = await user.read({ target: user.locate('shared.md'), revision: { kind: 'latest' } });
  const replacement = (operationId, text) => ({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: loaded.snapshot.ref, bytes: encoder.encode(text), mediaType: 'text/markdown' }] });
  assert.equal((await agent.publish(replacement('agent-edit', 'agent won'))).kind, 'committed');
  assert.equal((await user.publish(replacement('user-edit', 'old user buffer'))).kind, 'conflict');
  assert.equal(new TextDecoder().decode((await user.read({ target: user.locate('shared.md'), revision: { kind: 'latest' } })).snapshot.bytes), 'agent won');
});

test('revision handler rejects missing or cross-actor binding and releases failures', async t => {
  const f = fixture(t), client = await connect(f.handler);
  let captured;
  const capturing = await connect(request => { if (request.method === 'POST') captured = request.clone(); return f.handler(request); });
  await capturing.list({});
  const missing = new Request(captured.clone(), { headers: { 'content-type': 'application/json', 'x-boring-catalog': '1' } });
  assert.equal((await f.handler(missing)).status, 403);
  const headers = new Headers(captured.headers);
  const value = JSON.parse(decodeURIComponent(headers.get('x-boring-workspace'))); value.identity.principalId = 'other-person';
  headers.set('x-boring-workspace', encodeURIComponent(JSON.stringify(value)));
  assert.equal((await f.handler(new Request(captured, { headers }))).status, 409);
  f.select({ ...f.provider, catalog: { ...f.provider.catalog, list: async () => { throw new Error('fictional provider failure'); } } });
  await assert.rejects(client.list({}), error => error.kind === 'unavailable');
  assert.equal(f.released(), f.resolves());
});

test('catalog responses cannot be substituted between concurrent requests in one workspace', async t => {
  const f = fixture(t); let cached;
  const client = await connect(async request => {
    const response = await f.handler(request);
    if (request.method === 'GET') return response;
    if (cached) return Response.json(cached);
    cached = await response.json(); return Response.json(cached);
  });
  await client.list({});
  await assert.rejects(client.list({}), error => error.kind === 'denied');
});
