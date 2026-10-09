import assert from 'node:assert/strict';
import test from 'node:test';
import { createTextBuffer } from '@hachej/boring-ui-kit/text-buffer';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

const identity = { scopeId: 'fictional', principalId: 'editor', initiatorId: 'person' };
const target = { resource: { providerId: 'tasks', path: 'tasks.json' }, view: { kind: 'published' } };
const mediaType = 'application/vnd.fictional.tasks+json';
const initial = '{"items":[{"id":"one","completed":false}]}';
const readText = snapshot => {
  assert.equal(snapshot.mediaType, mediaType);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(snapshot.bytes);
  JSON.parse(text);
  return text;
};

test('public custom text buffer creates only on exact flush and preserves a newer draft after late acknowledgement', async t => {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'tasks' });
  t.after(() => provider.close());
  let release, committed, writes = 0;
  const dispatched = new Promise(resolve => { committed = resolve; });
  const client = {
    read: request => provider.read(request, identity),
    lookup: operationId => provider.reconciliation.lookup(operationId, identity),
    publish: async request => {
      writes++;
      const result = await provider.publication.publish(request, identity);
      committed();
      await new Promise(resolve => { release = resolve; });
      return result;
    },
  };
  const buffer = createTextBuffer({ identity, instanceId: 'custom', epoch: 'one', client, mediaType, readText,
    source: { kind: 'new', target, text: initial } });
  t.after(() => buffer.dispose());
  assert.equal(writes, 0);
  const selection = buffer.selection();
  const saving = buffer.flush(selection);
  await dispatched;
  buffer.edit(initial.replace('false', 'true'));
  release();
  const result = await saving;
  assert.equal(result.kind, 'saved');
  assert.deepEqual(result.selection, selection);
  assert.equal(buffer.getSnapshot().dirty, true);
  assert.match(buffer.getSnapshot().text, /true/);
  assert.equal((await buffer.flush(selection)).kind, 'conflict');
  assert.equal(writes, 1);
  const saved = await client.read({ target, revision: { kind: 'latest' } });
  assert.equal(saved.kind, 'available');
  assert.equal(readText(saved.snapshot), initial);
  buffer.dispose();
  assert.equal((await client.read({ target, revision: { kind: 'latest' } })).kind, 'available');
});

test('public custom text buffer validates remote documents and keeps read-only publication unavailable', async t => {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'tasks' });
  t.after(() => provider.close());
  const seeded = await provider.publication.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [
    { kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(initial), mediaType },
  ] }, identity);
  assert.equal(seeded.kind, 'committed');
  const client = { read: request => provider.read(request, identity), publish: request => provider.publication.publish(request, identity) };
  const source = await client.read({ target, revision: { kind: 'latest' } });
  const buffer = createTextBuffer({ identity, instanceId: 'custom', epoch: 'one', client, mediaType, readText,
    readOnly: true, source: { kind: 'saved', snapshot: source.snapshot } });
  t.after(() => buffer.dispose());
  assert.throws(() => buffer.edit('changed'), /read-only/);
  assert.equal((await buffer.flush(buffer.selection())).kind, 'denied');
  const changed = await provider.publication.publish({ operationId: 'malformed', atomicity: 'all-or-nothing', changes: [
    { kind: 'replace', target: source.snapshot.ref, bytes: new TextEncoder().encode('{'), mediaType },
  ] }, identity);
  assert.equal(changed.kind, 'committed');
  assert.equal((await buffer.refresh(false)).kind, 'unavailable');
  assert.equal(buffer.getSnapshot().text, initial);
});

for (const effect of ['edit', 'dispose']) test(`refresh preserves ${effect} performed by the replacement callback`, async t => {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'tasks' });
  t.after(() => provider.close());
  const client = { read: request => provider.read(request, identity), publish: request => provider.publication.publish(request, identity) };
  await client.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [
    { kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(initial), mediaType },
  ] });
  const source = await client.read({ target, revision: { kind: 'latest' } });
  let buffer;
  buffer = createTextBuffer({ identity, instanceId: 'custom', epoch: 'one', client, mediaType, readText,
    source: { kind: 'saved', snapshot: source.snapshot }, replaceText: () => {
      if (effect === 'edit') buffer.edit('{"items":[{"id":"newer","completed":false}]}');
      else buffer.dispose();
    } });
  t.after(() => buffer.dispose());
  await client.publish({ operationId: 'remote', atomicity: 'all-or-nothing', changes: [
    { kind: 'replace', target: source.snapshot.ref, bytes: new TextEncoder().encode(initial.replace('false', 'true')), mediaType },
  ] });
  await buffer.refresh(false);
  assert.equal(buffer.getSnapshot().base.target.revision, source.snapshot.ref.revision);
  if (effect === 'edit') {
    assert.match(buffer.getSnapshot().text, /newer/);
    assert.equal(buffer.getSnapshot().dirty, true);
  } else {
    assert.equal(buffer.getSnapshot().lifecycle, 'disposed');
    assert.equal(buffer.getSnapshot().text, initial);
  }
});
