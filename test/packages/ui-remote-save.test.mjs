import assert from 'node:assert/strict';
import test from 'node:test';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { createResourceClient, createResourceHandler } from '@hachej/boring-files/remote';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';

const identity = { scopeId: 'fictional', principalId: 'fictional-editor', initiatorId: 'fictional-requester' };
const target = { resource: { providerId: 'documents', path: 'note.md' }, view: { kind: 'published' } };

test('a locally rejected oversized save permits a later smaller edit without reconciliation or dispatch', async t => {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });
  t.after(() => provider.close());
  const handler = createResourceHandler({ authenticate: async () => identity, reader: provider,
    publisher: provider.publication, lookup: provider.reconciliation });
  let calls = 0;
  const client = createResourceClient({ identity, endpoint: 'https://fictional.invalid/resources', publication: true,
    reconciliation: true, maxRequestBytes: 800, fetch: request => { calls++; return handler(request); } });
  const controller = createMarkdownController({ identity, source: { kind: 'new', target, text: 'x'.repeat(2000) },
    instanceId: 'fictional-editor', epoch: 'one', client });
  t.after(() => controller.dispose());
  const rejected = await controller.flush(controller.actions.selection());
  assert.equal(calls, 0);
  assert.equal(rejected.kind, 'unavailable');
  assert.equal(controller.getSnapshot().dirty, true);
  controller.actions.edit('Fictional short edit');
  const saved = await controller.flush(controller.actions.selection());
  assert.equal(saved.kind, 'saved'); assert.equal(calls, 1);
  const read = await provider.read({ target, revision: { kind: 'latest' } }, identity);
  assert.deepEqual(read.snapshot.bytes, new TextEncoder().encode('Fictional short edit'));
  assert.equal(controller.getSnapshot().dirty, false);
});


test('local digest failure leaves the fresh editor save retryable without calling its publisher', async t => {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });
  t.after(() => provider.close());
  let publications = 0;
  const client = { read: request => provider.read(request, identity), publish: request => {
    publications++; return provider.publication.publish(request, identity);
  } };
  const controller = createMarkdownController({ identity, source: { kind: 'new', target, text: 'Fictional draft' },
    instanceId: 'digest-editor', epoch: 'one', client });
  t.after(() => controller.dispose());
  const original = globalThis.crypto.subtle.digest;
  let result;
  try {
    globalThis.crypto.subtle.digest = async () => { throw new Error('Fictional local digest unavailable'); };
    result = await controller.flush(controller.actions.selection());
  } finally { globalThis.crypto.subtle.digest = original; }
  assert.equal(result.kind, 'unavailable'); assert.equal(publications, 0);
  controller.actions.edit('Fictional revised draft');
  const saved = await controller.flush(controller.actions.selection());
  assert.equal(saved.kind, 'saved'); assert.equal(publications, 1);
  assert.equal(controller.getSnapshot().text, 'Fictional revised draft');
});

test('a receiver-dependent publisher retains its client binding during exact flush', async t => {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });
  t.after(() => provider.close());
  const client = { provider, read: request => provider.read(request, identity), publish(request) {
    return this.provider.publication.publish(request, identity);
  } };
  const controller = createMarkdownController({ identity, source: { kind: 'new', target, text: 'Receiver-bound draft' },
    instanceId: 'bound-editor', epoch: 'one', client });
  t.after(() => controller.dispose());
  const saved = await controller.flush(controller.actions.selection());
  assert.equal(saved.kind, 'saved');
  assert.deepEqual((await client.read({ target, revision: { kind: 'latest' } })).snapshot.bytes, new TextEncoder().encode('Receiver-bound draft'));
});
