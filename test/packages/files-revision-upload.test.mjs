// Filename search and binary upload through `createRevisionHandler` (@hachej/boring-files/revision-handler), the one route a host serves for
// a workspace: the same resolve and access as reads, a conditional write with a receipt, bytes kept exactly, and an explicit size limit
// the server enforces (the typed `file_too_large` refusal) and advertises to `connectRevisionProvider`. Fictional files only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { connectRevisionProvider } from '@hachej/boring-files/revision';
import { createResourceClient } from '@hachej/boring-files/remote';
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';

const access = { principalId: 'fictional-person', scopeId: 'fictional-scope', initiatorId: 'fictional-person' };
const endpoint = 'https://fictional.invalid/api/resources';

/** A SQLite workspace behind the revision handler; `resolved` counts the host's resolve calls (every request goes through it). */
function fixture(t, handlerOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-revision-upload-'));
  const db = openNodeConnection(join(directory, 'files.sqlite'));
  const fs = openSqliteFileSystem({ connection: db, workspace: 'fictional', cwd: '/workspace', maxFileBytes: 16_000_000 });
  const provider = createWorkspaceProvider({ fs, journal: createWorkspaceJournal(db), identity: { providerId: 'files', instanceId: 'fictional', incarnation: fs.incarnation, viewId: 'published' } });
  const seen = { resolved: 0 };
  const handler = createRevisionHandler({ ...handlerOptions, resolve: async () => { seen.resolved++; return { provider, access, release() {} }; } });
  t.after(() => { db.close(); rmSync(directory, { force: true, recursive: true }); });
  return { handler, provider, seen };
}
/** Every byte value, repeated to `size`: a NUL, invalid UTF-8 and 0xff all survive or the test fails. */
const binary = size => Uint8Array.from({ length: size }, (_, index) => (index * 7 + 3) % 256);
const create = (client, path, bytes, operationId) => client.publish({ operationId, atomicity: 'all-or-nothing',
  changes: [{ kind: 'create', target: client.locate ? client.locate(path) : { resource: { providerId: 'files', path }, view: { kind: 'published' } }, expected: { kind: 'absent' }, bytes, mediaType: 'application/octet-stream' }] });

test('a binary upload over the default limit commits through the handler when the host raises maxFileBytes, and search finds it', async t => {
  const { handler, seen } = fixture(t, { maxFileBytes: 6_000_000 });
  const client = await connectRevisionProvider({ endpoint, fetch: handler });
  const bytes = binary(5_000_000);
  const result = await create(client, 'uploads/scan-fictional.bin', bytes, 'upload-large-1');
  assert.equal(result.kind, 'committed', JSON.stringify(result.kind === 'committed' ? {} : result));
  assert.equal(result.receipt.operationId, 'upload-large-1');
  const looked = await client.lookup('upload-large-1');
  assert.equal(looked.kind, 'committed', 'the upload has a receipt the client can look up');
  const read = await client.read({ target: client.locate('uploads/scan-fictional.bin'), revision: { kind: 'latest' } });
  assert.equal(read.kind, 'available');
  assert.deepEqual(read.snapshot.bytes, bytes, 'every byte comes back unchanged');
  const found = await client.search({ query: 'scan-fict', limit: 8 });
  assert.deepEqual(found.entries.map(entry => [entry.path, entry.kind, entry.size]), [['uploads/scan-fictional.bin', 'file', 5_000_000]]);
  assert.equal(client.maxFileBytes, 6_000_000, 'the binding advertises the host limit');
  assert.ok(seen.resolved >= 5, 'binding, write, lookup, read and search all went through the host resolve');
});

test('a file over maxFileBytes gets the typed file_too_large refusal before the provider writes, and an oversized request a definite 413', async t => {
  const { handler, provider } = fixture(t, { maxFileBytes: 1024 });
  const discovery = await handler(new Request(endpoint));
  assert.equal((await discovery.json()).limits?.maxFileBytes, 1024, 'the binding names the limit');

  // A resource call as any client sends it (no binding header): the server refuses the file whatever the client's own limit.
  const statuses = [];
  const counting = async request => { const response = await handler(request); statuses.push(response.status); return response; };
  const plain = createResourceClient({ endpoint, identity: access, publication: true, reconciliation: true, fetch: counting, maxRequestBytes: 10_000_000 });
  const refused = await create(plain, 'uploads/too-big.bin', binary(2048), 'upload-too-big-1');
  assert.deepEqual(statuses, [200]);
  assert.deepEqual({ ...refused, reason: undefined }, { kind: 'file_too_large', path: 'uploads/too-big.bin', size: 2048, limit: 1024, reason: undefined });
  assert.match(refused.reason, /1024-byte limit/);
  const absent = await provider.read({ target: { resource: { providerId: 'files', path: 'uploads/too-big.bin' }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, access);
  assert.equal(absent.kind, 'missing', 'nothing was written');
  assert.equal((await plain.lookup('upload-too-big-1')).kind, 'not-found', 'a refused file leaves no receipt');

  // At the limit the same write commits, and its replay keeps the committed result.
  assert.equal((await create(plain, 'uploads/fits.bin', binary(1024), 'upload-fits-1')).kind, 'committed');

  // The bound client sends it and gets the same typed refusal; it exposes the limit so a UI can refuse earlier.
  const client = await connectRevisionProvider({ endpoint, fetch: counting });
  assert.equal(client.maxFileBytes, 1024);
  const bound = await create(client, 'uploads/too-big-2.bin', binary(1025), 'upload-too-big-2');
  assert.equal(bound.kind, 'file_too_large');
  assert.equal(bound.limit, 1024);

  // A request larger than the transport carries (4 MiB here) is answered 413, which the client reports as a definite refusal.
  statuses.length = 0;
  const huge = await create(plain, 'uploads/huge.bin', binary(5_000_000), 'upload-huge-1');
  assert.deepEqual(statuses, [413]);
  assert.equal(huge.kind, 'unavailable', 'a 413 is a definite refusal, not an unconfirmed upload');
  assert.match(huge.reason, /too large/i);
});

test('a replay of a committed write keeps its result after the host lowers maxFileBytes', async t => {
  const first = fixture(t, { maxFileBytes: 4096 });
  const plain = createResourceClient({ endpoint, identity: access, publication: true, reconciliation: true, fetch: first.handler });
  assert.equal((await create(plain, 'uploads/kept.bin', binary(2048), 'upload-kept-1')).kind, 'committed');
  const lowered = createRevisionHandler({ maxFileBytes: 1024, resolve: async () => ({ provider: first.provider, access, release() {} }) });
  const again = createResourceClient({ endpoint, identity: access, publication: true, reconciliation: true, fetch: lowered });
  const replay = await create(again, 'uploads/kept.bin', binary(2048), 'upload-kept-1');
  assert.equal(replay.kind, 'committed', 'the journal answers the replay, not the new limit');
});

test('maxFileBytes must be a positive byte count that fits the transport', () => {
  const resolve = async () => null;
  for (const maxFileBytes of [0, -1, 1.5, 60_000_000]) assert.throws(() => createRevisionHandler({ resolve, maxFileBytes }), RangeError);
});
