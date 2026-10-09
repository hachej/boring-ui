import assert from 'node:assert/strict';
import test from 'node:test';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { createHtmlController } from '@hachej/boring-ui-kit/html';

const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
const target = path => ({ resource: { providerId: 'documents', path }, view: { kind: 'published' } });
const selected = path => ({ target: target(path), revision: { kind: 'latest' } });
const bytes = text => new TextEncoder().encode(text);
const text = value => new TextDecoder('utf-8', { fatal: true }).decode(value);
const create = (operationId, path, value, mediaType = 'text/html') => ({ operationId, atomicity: 'all-or-nothing', changes: [
  { kind: 'create', target: target(path), expected: { kind: 'absent' }, bytes: typeof value === 'string' ? bytes(value) : value, mediaType },
] });
const replace = (operationId, ref, value, mediaType = 'text/html') => ({ operationId, atomicity: 'all-or-nothing', changes: [
  { kind: 'replace', target: ref, bytes: typeof value === 'string' ? bytes(value) : value, mediaType },
] });

async function fixture(t, initial = '<h1>Fictional original</h1>') {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });
  t.after(() => provider.close());
  const client = {
    read: request => provider.read(request, identity),
    publish: request => provider.publication.publish(request, identity),
    lookup: operationId => provider.reconciliation.lookup(operationId, identity),
  };
  let source;
  if (initial === null) source = { kind: 'new', target: target('page.html'), text: '<p>New fictional page  </p>\n' };
  else {
    assert.equal((await client.publish(create('seed', 'page.html', initial))).kind, 'committed');
    source = { kind: 'saved', snapshot: (await client.read(selected('page.html'))).snapshot };
  }
  const controller = createHtmlController({ identity, source, client, instanceId: 'html-editor', epoch: 'page-one' });
  t.after(() => controller.dispose());
  return { provider, client, source, controller };
}

test('HTML opening preserves a leading U+FEFF scalar and astral source text', async t => {
  const original = '\uFEFF<p>Fictional \u{1F680}</p>\r\n';
  const { controller, source, client } = await fixture(t, original);
  assert.equal(controller.getSnapshot().text.codePointAt(0), 0xfeff);
  assert.equal(controller.getSnapshot().text, original);
  assert.equal(controller.getSnapshot().dirty, false);
  assert.deepEqual(controller.getSnapshot().base.target, source.snapshot.ref);
  assert.deepEqual((await client.read({ target: target('page.html'), revision: { kind: 'exact', value: source.snapshot.ref.revision } })).snapshot.bytes, bytes(original));
});

for (const kind of ['create', 'replace']) {
  test(`HTML exact ${kind} flush preserves leading U+FEFF and astral UTF-8 bytes`, async t => {
    const { controller, client, source } = await fixture(t, kind === 'create' ? null : '<p>Original</p>');
    const draft = '\uFEFF<p>Fictional \u{1F680}</p>\r\n';
    controller.actions.edit(draft);
    const selection = controller.actions.selection();
    const result = await controller.flush(selection);
    assert.equal(result.kind, 'saved', JSON.stringify(result));
    assert.deepEqual(result.selection, selection);
    assert.equal(result.receipt.changes[0].kind, kind);
    assert.deepEqual(result.receipt.changes[0].before, kind === 'create' ? null : source.snapshot.ref);
    const read = await client.read(selected('page.html'));
    assert.equal(read.kind, 'available'); assert.deepEqual(read.snapshot.bytes, bytes(draft));
    assert.deepEqual(result.ref, read.snapshot.ref); assert.deepEqual(controller.getSnapshot().base.target, result.ref);
    assert.equal(controller.getSnapshot().text, draft); assert.equal(controller.getSnapshot().dirty, false);
    if (kind === 'replace') {
      assert.notEqual(result.ref.revision, source.snapshot.ref.revision);
      const previous = await client.read({ target: target('page.html'), revision: { kind: 'exact', value: source.snapshot.ref.revision } });
      assert.deepEqual(previous.snapshot.bytes, source.snapshot.bytes);
    }
  });
}

test('HTML controller borrows its client and preserves exact source without an initialization write', async t => {
  const original = '<!doctype html>\r\n<p title="literal">  two spaces  </p>\n';
  const { client, source } = await fixture(t, original);
  let writes = 0;
  const controller = createHtmlController({ identity, source, client: { ...client, publish: request => { writes++; return client.publish(request); } }, instanceId: 'second-editor', epoch: 'page-two' });
  t.after(() => controller.dispose());
  const first = controller.getSnapshot();
  assert.equal(controller.getSnapshot(), first);
  assert.equal(first.text, original);
  assert.equal(first.dirty, false);
  assert.equal(first.bufferVersion, 0);
  assert.equal(controller.tools, undefined);
  assert.equal(writes, 0);
  assert.equal(text((await client.read(selected('page.html'))).snapshot.bytes), original);
  let notifications = 0;
  const unsubscribe = controller.subscribe(() => { notifications++; });
  controller.actions.edit(original + '<p>Changed</p>');
  assert.equal(notifications, 1);
  assert.equal(first.text, original);
  assert.equal(writes, 0);
  unsubscribe();
  controller.actions.edit(original);
  assert.equal(notifications, 1);
  controller.dispose();
  assert.equal((await client.read(selected('page.html'))).kind, 'available');
});

test('exact selected HTML flush uses text/html and agrees with the retained SQLite receipt', async t => {
  const { controller, client } = await fixture(t);
  const draft = '<!doctype html>\r\n<section>  human text  </section>\n';
  controller.actions.edit(draft);
  const selection = controller.actions.selection();
  const saved = await controller.flush(selection);
  assert.equal(saved.kind, 'saved');
  assert.deepEqual(saved.selection, selection);
  const read = await client.read(selected('page.html'));
  assert.equal(read.kind, 'available');
  assert.equal(read.snapshot.mediaType, 'text/html');
  assert.equal(text(read.snapshot.bytes), draft);
  assert.deepEqual(read.snapshot.ref, saved.ref);
  assert.deepEqual(await client.lookup(saved.receipt.operationId), { kind: 'committed', receipt: saved.receipt });
  assert.equal(controller.getSnapshot().dirty, false);
});

test('a new HTML document publishes once against absence with its exact initial source', async t => {
  const { client, source } = await fixture(t, null);
  let writes = 0;
  const controller = createHtmlController({ identity, source, client: { ...client, publish: request => { writes++; return client.publish(request); } }, instanceId: 'new-editor', epoch: 'page' });
  t.after(() => controller.dispose());
  assert.equal(controller.getSnapshot().base.kind, 'absent');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(writes, 0);
  assert.equal((await client.read(selected('page.html'))).kind, 'missing');
  const result = await controller.flush(controller.actions.selection());
  assert.equal(result.kind, 'saved');
  assert.equal(result.receipt.changes[0].kind, 'create');
  assert.equal(result.receipt.changes[0].before, null);
  assert.equal(text((await client.read(selected('page.html'))).snapshot.bytes), source.text);
  assert.equal(writes, 1);
  assert.equal(controller.getSnapshot().dirty, false);
});

test('wrong source media type and invalid UTF-8 are refused without reinterpretation', async t => {
  const { client, source, controller } = await fixture(t);
  for (const snapshot of [
    { ...source.snapshot, mediaType: 'text/plain' },
    { ...source.snapshot, bytes: Uint8Array.of(0xff) },
  ]) {
    assert.throws(() => createHtmlController({ identity, source: { kind: 'saved', snapshot }, client, instanceId: 'invalid-editor', epoch: 'page' }), TypeError);
  }
  const initial = controller.getSnapshot();
  for (const [operationId, value, mediaType] of [
    ['wrong-media', '<p>Not HTML media</p>', 'text/plain'],
    ['invalid-utf8', Uint8Array.of(0xff), 'text/html'],
  ]) {
    const current = (await client.read(selected('page.html'))).snapshot.ref;
    assert.equal((await client.publish(replace(operationId, current, value, mediaType))).kind, 'committed');
    assert.equal((await controller.actions.refresh()).kind, 'unavailable');
    assert.equal(controller.getSnapshot(), initial);
  }
});

test('stale and cross-instance selections refuse before publication and keep the local draft', async t => {
  const { controller, client } = await fixture(t);
  let writes = 0;
  const other = createHtmlController({ identity, source: { kind: 'saved', snapshot: (await client.read(selected('page.html'))).snapshot },
    client: { ...client, publish: request => { writes++; return client.publish(request); } }, instanceId: 'another-editor', epoch: 'another-page' });
  t.after(() => other.dispose());
  const stale = other.actions.selection();
  other.actions.edit('<p>Local draft</p>');
  assert.equal((await other.flush(stale)).kind, 'conflict');
  assert.equal((await other.flush(controller.actions.selection())).kind, 'conflict');
  const changedScope = structuredClone(other.actions.selection()); changedScope.target.subject.scopeId = 'other-project';
  assert.equal((await other.flush(changedScope)).kind, 'conflict');
  assert.equal(writes, 0);
  assert.equal(other.getSnapshot().text, '<p>Local draft</p>');
  assert.equal(text((await client.read(selected('page.html'))).snapshot.bytes), '<h1>Fictional original</h1>');
});

test('a stale publication preserves a dirty HTML draft until explicit discard', async t => {
  const { controller, client, source } = await fixture(t);
  const other = createHtmlController({ identity, source, client, instanceId: 'other-writer', epoch: 'page' });
  t.after(() => other.dispose());
  controller.actions.edit('<p>Local human draft</p>');
  other.actions.edit('<p>Remote published edit</p>');
  assert.equal((await other.flush(other.actions.selection())).kind, 'saved');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'conflict');
  assert.equal((await controller.actions.refresh()).kind, 'available');
  assert.equal(controller.getSnapshot().text, '<p>Local human draft</p>');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(controller.getSnapshot().remote.kind, 'revision');
  assert.equal((await controller.actions.discardToRemote()).kind, 'available');
  assert.equal(controller.getSnapshot().text, '<p>Remote published edit</p>');
  assert.equal(controller.getSnapshot().dirty, false);
});

test('a late save acknowledgement advances the base while keeping later typing dirty', async t => {
  const { client, source } = await fixture(t);
  const committed = Promise.withResolvers(), release = Promise.withResolvers();
  const controller = createHtmlController({ identity, source, instanceId: 'late-editor', epoch: 'page', client: {
    ...client, publish: async request => { const result = await client.publish(request); committed.resolve(); await release.promise; return result; },
  } });
  t.after(() => controller.dispose());
  controller.actions.edit('<p>Selected HTML</p>');
  const selection = controller.actions.selection();
  const pending = controller.flush(selection);
  await committed.promise;
  controller.actions.edit('<p>Newer human HTML</p>');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unknown');
  release.resolve();
  const result = await pending;
  assert.equal(result.kind, 'saved');
  assert.deepEqual(result.selection, selection);
  assert.equal(controller.getSnapshot().text, '<p>Newer human HTML</p>');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(text((await client.read(selected('page.html'))).snapshot.bytes), '<p>Selected HTML</p>');
});

test('lost acknowledgement reconciles the original operation without replaying later HTML edits', async t => {
  const { client, source } = await fixture(t);
  let publications = 0;
  const controller = createHtmlController({ identity, source, instanceId: 'reconcile-editor', epoch: 'page', client: {
    ...client, publish: async request => { publications++; await client.publish(request); throw new Error('Fictional response loss'); },
  } });
  t.after(() => controller.dispose());
  controller.actions.edit('<p>Committed HTML</p>');
  const unknown = await controller.flush(controller.actions.selection());
  assert.equal(unknown.kind, 'unknown');
  controller.actions.edit('<p>Later HTML draft</p>');
  const recovered = await controller.actions.reconcile();
  assert.equal(recovered.kind, 'saved');
  assert.equal(recovered.receipt.operationId, unknown.operationId);
  assert.equal(controller.getSnapshot().text, '<p>Later HTML draft</p>');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(publications, 1);
  assert.equal(text((await client.read(selected('page.html'))).snapshot.bytes), '<p>Committed HTML</p>');
});

test('read-only and disposed HTML controllers cannot edit or save and do not close borrowed resources', async t => {
  const { client, source } = await fixture(t);
  let writes = 0;
  const controller = createHtmlController({ identity, source, readOnly: true, client: { ...client, publish: request => { writes++; return client.publish(request); } }, instanceId: 'readonly', epoch: 'page' });
  assert.equal(controller.getSnapshot().readOnly, true);
  assert.throws(() => controller.actions.edit('<p>Forbidden</p>'), /read-only/i);
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'denied');
  assert.equal(writes, 0);
  controller.dispose();
  assert.equal(controller.getSnapshot().lifecycle, 'disposed');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unavailable');
  assert.equal((await client.read(selected('page.html'))).kind, 'available');
});

test('an edit during a delayed discard stays local and is never replaced by old HTML', async t => {
  const { client, source } = await fixture(t);
  const reading = Promise.withResolvers(), release = Promise.withResolvers();
  const controller = createHtmlController({ identity, source, instanceId: 'discard-editor', epoch: 'page', client: {
    ...client, read: async request => { const result = await client.read(request); reading.resolve(); await release.promise; return result; },
  } });
  t.after(() => controller.dispose());
  controller.actions.edit('<p>Before discard</p>');
  const pending = controller.actions.discardToRemote();
  await reading.promise;
  controller.actions.edit('<p>After discard</p>');
  release.resolve();
  await pending;
  assert.equal(controller.getSnapshot().text, '<p>After discard</p>');
  assert.equal(controller.getSnapshot().dirty, true);
});
