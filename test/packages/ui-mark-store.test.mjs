import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkStore } from '@hachej/boring-ui-kit/mark-store';
import { captureMarkdownQuote } from '@hachej/boring-ui-kit/markdown-quote';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';

const identity = { scopeId: 'fictional', principalId: 'reader', initiatorId: 'reader' };
const locator = { resource: { providerId: 'docs', path: 'chapter.md' }, view: { kind: 'published' } };
const sidecar = { ...locator, resource: { ...locator.resource, path: 'chapter.md.marks.json' } };
const bytes = text => new TextEncoder().encode(text);
const text = snapshot => new TextDecoder().decode(snapshot.bytes);
const mark = (id = 'mark-1') => ({ id, anchor: captureMarkdownQuote('A fictional kite.', { start: 2, end: 11 }).anchor, colour: 'accent', note: '', author: 'reader', time: '2026-10-10T10:00:00Z' });
async function fixture(t) {
  const files = openSqliteWorkspaces({ filename: ':memory:', providerId: 'docs', authorize: () => true });
  t.after(() => files.close());
  const client = { read: r => files.read(r, identity), publish: r => files.publication.publish(r, identity), lookup: id => files.reconciliation.lookup(id, identity) };
  await client.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: locator, expected: { kind: 'absent' }, bytes: bytes('A fictional kite.'), mediaType: 'text/markdown' }] });
  const open = async (override = client) => { const s = await createMarkStore({ client: override, identity }, locator); t.after(() => s.dispose()); return s; };
  return { client, open };
}
test('kit marks add/edit/remove in one adjacent file using workspace receipts, never document text', async t => {
  const { client, open } = await fixture(t); const s = await open();
  assert.deepEqual(s.getSnapshot().marks, []);
  assert.equal((await client.read({ target: sidecar, revision: { kind: 'latest' } })).kind, 'missing', 'opening does not create a sidecar');
  const input = mark(); const result = await s.add(input);
  assert.equal(result.kind, 'saved'); assert.equal(result.receipt.changes[0].after.resource.path, sidecar.resource.path);
  input.note = 'changed after capture'; assert.equal(s.getSnapshot().marks[0].note, '');
  assert.equal((await s.edit('mark-1', { note: 'A fictional comment.', colour: 'primary' })).kind, 'saved');
  const reopened = await open(); assert.equal(reopened.getSnapshot().marks[0].note, 'A fictional comment.');
  const stored = await client.read({ target: sidecar, revision: { kind: 'latest' } });
  assert.equal(JSON.parse(text(stored.snapshot)).format, 'document.marks@1');
  assert.equal(text((await client.read({ target: locator, revision: { kind: 'latest' } })).snapshot), 'A fictional kite.');
  assert.equal((await s.remove('mark-1')).kind, 'saved'); assert.deepEqual((await open()).getSnapshot().marks, []);
});
test('two tabs refuse both absent-create and stale revision writes instead of merging or overwriting', async t => {
  const { open } = await fixture(t); const a = await open(), b = await open();
  assert.equal((await a.add(mark('a'))).kind, 'saved');
  assert.equal((await b.add(mark('b'))).kind, 'conflict');
  assert.equal(b.getSnapshot().marks[0].id, 'b', 'refused local change remains visible');
  assert.equal((await b.remove('b')).kind, 'unavailable');
  await b.reload(); assert.equal(b.getSnapshot().marks[0].id, 'a');
  assert.equal((await a.edit('a', { note: 'first tab' })).kind, 'saved');
  assert.equal((await b.edit('a', { note: 'stale tab' })).kind, 'conflict');
  assert.equal((await open()).getSnapshot().marks[0].note, 'first tab');
});
test('lost acknowledgement keeps original operation and only lookup recovers it', async t => {
  const { client, open } = await fixture(t); let publishes = 0;
  const s = await open({ ...client, publish: async r => { publishes++; await client.publish(r); throw Error('lost'); } });
  const result = await s.add(mark()); assert.equal(result.kind, 'unknown');
  assert.equal((await s.add(mark('other'))).kind, 'unavailable');
  await assert.rejects(() => s.reload(), /Reconcile/);
  assert.equal((await s.reconcile()).kind, 'saved'); assert.equal(publishes, 1);
  assert.equal(s.getSnapshot().marks.length, 1);
});
test('store refuses malformed sidecars without replacing bytes', async t => {
  const { client, open } = await fixture(t);
  await client.publish({ operationId: 'invalid', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: sidecar, expected: { kind: 'absent' }, bytes: bytes('{"format":"document.marks@99","marks":[]}'), mediaType: 'application/json' }] });
  await assert.rejects(() => open(), /Unsupported marks file/);
  assert.match(text((await client.read({ target: sidecar, revision: { kind: 'latest' } })).snapshot), /marks@99/);
});
test('store captures receipt identity before its initial asynchronous read', async t => {
  const { client } = await fixture(t);
  let release;
  const resource = { identity: { ...identity }, client: { ...client, read: async request => { await new Promise(r => { release = r; }); return client.read(request); } } };
  const opening = createMarkStore(resource, locator);
  resource.identity.principalId = 'changed-after-read-start';
  release();
  const store = await opening; t.after(() => store.dispose());
  assert.equal((await store.add(mark())).kind, 'saved', 'acknowledgement uses the captured actor');
});
test('reentrant subscribers cannot replace a mutation before its conditional save is selected', async t => {
  const { open } = await fixture(t); const store = await open(); let nested;
  const stop = store.subscribe(() => { if (!nested && store.getSnapshot().marks.length && store.getSnapshot().save.kind === 'idle') nested = store.remove('mark-1'); });
  assert.equal((await store.add(mark())).kind, 'saved');
  stop(); assert.equal((await nested).kind, 'unavailable');
  assert.equal((await open()).getSnapshot().marks[0].id, 'mark-1');
});
test('store snapshots are immutable and disposed operations cannot write', async t => {
  const { open } = await fixture(t); const s = await open(); await s.add(mark());
  assert.throws(() => { s.getSnapshot().marks[0].note = 'mutated'; }, TypeError);
  s.dispose(); assert.equal((await s.remove('mark-1')).kind, 'unavailable');
});
