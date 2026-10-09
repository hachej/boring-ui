import assert from 'node:assert/strict';
import test from 'node:test';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { publicationDigest } from '@hachej/boring-files/publication';

const target = { resource: { providerId: 'documents', path: 'notes.md' }, view: { kind: 'published' } };
const access = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
const text = bytes => new TextDecoder().decode(bytes);

for (const invalid of [
  { bytes: new Uint8Array([0xff]), mediaType: 'text/markdown' },
  { bytes: new TextEncoder().encode('not a Markdown resource'), mediaType: 'application/json' },
]) {
  test(`Markdown refresh rejects invalid remote content (${invalid.mediaType}) without advancing its base`, async t => {
    const { controller, client, source } = await fixture(t);
    const before = controller.getSnapshot();
    assert.equal((await client.publish({ operationId: 'invalid-remote', atomicity: 'all-or-nothing', changes: [
      { kind: 'replace', target: source.snapshot.ref, ...invalid },
    ] })).kind, 'committed');
    assert.equal((await controller.actions.refresh()).kind, 'unavailable');
    assert.equal(controller.getSnapshot(), before);
    assert.equal(before.text, 'original');
  });
}

async function fixture(t, initial = 'original') {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });
  t.after(() => provider.close());
  const client = {
    read: request => provider.read(request, access),
    publish: request => provider.publication.publish(request, access),
    lookup: operationId => provider.reconciliation.lookup(operationId, access),
  };
  if (initial !== undefined) await client.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(initial), mediaType: 'text/markdown' }] });
  const read = await client.read({ target, revision: { kind: 'latest' } });
  const source = read.kind === 'available' ? { kind: 'saved', snapshot: read.snapshot } : { kind: 'new', target };
  const controller = createMarkdownController({ identity: access, source, client, instanceId: 'notes-editor', epoch: 'page-one' });
  t.after(() => controller.dispose());
  return { provider, client, source, controller };
}

test('Markdown opening preserves a leading U+FEFF scalar and astral source text', async t => {
  const original = '\uFEFF# Fictional \u{1F680}\r\n';
  const { controller, source, client } = await fixture(t, original);
  assert.equal(controller.getSnapshot().text.codePointAt(0), 0xfeff);
  assert.equal(controller.getSnapshot().text, original);
  assert.equal(controller.getSnapshot().dirty, false);
  assert.deepEqual(controller.getSnapshot().base.target, source.snapshot.ref);
  assert.deepEqual((await client.read({ target, revision: { kind: 'exact', value: source.snapshot.ref.revision } })).snapshot.bytes, new TextEncoder().encode(original));
});

for (const kind of ['create', 'replace']) {
  test(`Markdown exact ${kind} flush preserves leading U+FEFF and astral UTF-8 bytes`, async t => {
    const f = await fixture(t);
    const destination = kind === 'create' ? { ...target, resource: { ...target.resource, path: 'unicode.md' } } : target;
    const controller = kind === 'create' ? createMarkdownController({ identity: access, source: { kind: 'new', target: destination },
      client: f.client, instanceId: 'unicode-editor', epoch: 'unicode-page' }) : f.controller;
    t.after(() => controller.dispose());
    const draft = '\uFEFF# Fictional \u{1F680}\r\n';
    controller.actions.edit(draft);
    const selection = controller.actions.selection();
    const result = await controller.flush(selection);
    assert.equal(result.kind, 'saved', JSON.stringify(result));
    assert.deepEqual(result.selection, selection);
    assert.equal(result.receipt.changes[0].kind, kind);
    assert.deepEqual(result.receipt.changes[0].before, kind === 'create' ? null : f.source.snapshot.ref);
    const read = await f.client.read({ target: destination, revision: { kind: 'latest' } });
    assert.equal(read.kind, 'available'); assert.deepEqual(read.snapshot.bytes, new TextEncoder().encode(draft));
    assert.deepEqual(result.ref, read.snapshot.ref); assert.deepEqual(controller.getSnapshot().base.target, result.ref);
    assert.equal(controller.getSnapshot().text, draft); assert.equal(controller.getSnapshot().dirty, false);
    if (kind === 'replace') {
      assert.notEqual(result.ref.revision, f.source.snapshot.ref.revision);
      const previous = await f.client.read({ target, revision: { kind: 'exact', value: f.source.snapshot.ref.revision } });
      assert.deepEqual(previous.snapshot.bytes, f.source.snapshot.bytes);
    }
  });
}

test('Markdown controller is inert on creation and publishes cached immutable snapshots after changes', async t => {
  const { client, source } = await fixture(t);
  let writes = 0;
  const controller = createMarkdownController({ identity: access, source, instanceId: 'editor', epoch: 'page', client: { ...client, publish: request => { writes++; return client.publish(request); } } });
  const initial = controller.getSnapshot();
  assert.equal(controller.getSnapshot(), initial);
  assert.equal(initial.dirty, false);
  assert.equal(writes, 0);
  const notifications = [];
  const unsubscribe = controller.subscribe(() => notifications.push(controller.getSnapshot()));
  controller.actions.edit('human draft');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0], controller.getSnapshot());
  assert.equal(initial.text, 'original');
  assert.throws(() => { initial.base.target.resource.path = 'other.md'; }, TypeError);
  unsubscribe();
  controller.actions.edit('another edit');
  assert.equal(notifications.length, 1);
  assert.equal(writes, 0);
  controller.dispose();
});

test('flush acknowledges the selected text and resulting provider revision', async t => {
  const { controller, client } = await fixture(t);
  controller.actions.edit('exact selected text');
  const selection = controller.actions.selection();
  const result = await controller.flush(selection);
  assert.equal(result.kind, 'saved');
  assert.deepEqual(result.selection, selection);
  const saved = await client.read({ target, revision: { kind: 'latest' } });
  assert.deepEqual(result.ref, saved.snapshot.ref);
  assert.deepEqual(result.receipt.changes[0].after, result.ref);
  assert.equal(text(saved.snapshot.bytes), 'exact selected text');
  assert.equal(controller.getSnapshot().dirty, false);
});

test('new documents publish with explicit absence and return their first real revision', async t => {
  const { client } = await fixture(t);
  const newTarget = { ...target, resource: { ...target.resource, path: 'new.md' } };
  const controller = createMarkdownController({ identity: access, source: { kind: 'new', target: newTarget, text: 'new text' }, client, instanceId: 'new-editor', epoch: 'page' });
  t.after(() => controller.dispose());
  assert.equal(controller.getSnapshot().base.kind, 'absent');
  const result = await controller.flush(controller.actions.selection());
  assert.equal(result.kind, 'saved');
  assert.equal(result.receipt.changes[0].kind, 'create');
  assert.equal(result.receipt.changes[0].before, null);
  assert.equal(controller.getSnapshot().base.target.revision, result.ref.revision);
  assert.equal(controller.getSnapshot().dirty, false);
});

test('late acknowledgement updates the saved base while preserving later unsaved text', async t => {
  const { client, source } = await fixture(t);
  const committed = Promise.withResolvers(), release = Promise.withResolvers();
  const controller = createMarkdownController({ identity: access, source, client: { ...client, publish: async request => { const result = await client.publish(request); committed.resolve(); await release.promise; return result; } }, instanceId: 'editor', epoch: 'page' });
  t.after(() => controller.dispose());
  controller.actions.edit('selected');
  const selected = controller.actions.selection();
  const pending = controller.flush(selected);
  await committed.promise;
  controller.actions.edit('newer unsaved human text');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unknown');
  release.resolve();
  const result = await pending;
  assert.equal(result.kind, 'saved');
  assert.deepEqual(result.selection, selected);
  assert.equal(controller.getSnapshot().text, 'newer unsaved human text');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(text((await client.read({ target, revision: { kind: 'latest' } })).snapshot.bytes), 'selected');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'saved');
  assert.equal(controller.getSnapshot().dirty, false);
});

test('stale and cross-instance flush selections produce no writes', async t => {
  const { controller, client } = await fixture(t);
  const stale = controller.actions.selection();
  controller.actions.edit('draft');
  assert.equal((await controller.flush(stale)).kind, 'conflict');
  const wrongPage = structuredClone(controller.actions.selection()); wrongPage.target.epoch = 'previous-page';
  assert.equal((await controller.flush(wrongPage)).kind, 'conflict');
  assert.equal(text((await client.read({ target, revision: { kind: 'latest' } })).snapshot.bytes), 'original');
  assert.equal(controller.getSnapshot().text, 'draft');
});

test('external saves conflict with dirty buffers and require deliberate discard', async t => {
  const { controller, client, source } = await fixture(t);
  const other = createMarkdownController({ identity: access, source, client, instanceId: 'other', epoch: 'page' });
  t.after(() => other.dispose());
  controller.actions.edit('human local draft');
  other.actions.edit('external published text');
  assert.equal((await other.flush(other.actions.selection())).kind, 'saved');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'conflict');
  await controller.actions.refresh();
  assert.equal(controller.getSnapshot().text, 'human local draft');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(controller.getSnapshot().remote.kind, 'revision');
  await controller.actions.discardToRemote();
  assert.equal(controller.getSnapshot().text, 'external published text');
  assert.equal(controller.getSnapshot().dirty, false);
  controller.actions.edit('discard this too');
  await controller.actions.discardToRemote();
  assert.equal(controller.getSnapshot().text, 'external published text');
});

test('lost acknowledgement is reconciled without another publication or loss of later edits', async t => {
  const { client, source } = await fixture(t);
  let publishes = 0;
  const controller = createMarkdownController({ identity: access, source, client: { ...client, publish: async request => { publishes++; await client.publish(request); throw new Error('fictional transport lost acknowledgement'); } }, instanceId: 'editor', epoch: 'page' });
  t.after(() => controller.dispose());
  controller.actions.edit('committed text');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unknown');
  controller.actions.edit('next draft');
  const recovered = await controller.actions.reconcile();
  assert.equal(recovered.kind, 'saved');
  assert.equal(controller.getSnapshot().text, 'next draft');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(publishes, 1);
});

test('missing receipts and forged acknowledgements never clean the buffer or trigger blind retries', async t => {
  const { client, source } = await fixture(t);
  let publishes = 0;
  const controller = createMarkdownController({ identity: access, source, client: {
    ...client, publish: async request => { publishes++; const result = await client.publish(request); return { ...result, receipt: { ...result.receipt, argumentDigest: 'wrong-digest' } }; },
    lookup: async () => ({ kind: 'not-found' }),
  }, instanceId: 'editor', epoch: 'page' });
  t.after(() => controller.dispose());
  controller.actions.edit('draft');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unknown');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal((await controller.actions.reconcile()).kind, 'unknown');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unknown');
  assert.equal(publishes, 1);
});

test('a save that changes nothing is acknowledged with equal before and after revisions', async t => {
  const { client, source } = await fixture(t);
  const ref = source.snapshot.ref;
  const controller = createMarkdownController({ identity: access, source, instanceId: 'editor', epoch: 'page', client: {
    ...client,
    publish: async request => ({ kind: 'committed', receipt: { operationId: request.operationId, argumentDigest: await publicationDigest(request), ...access, evidenceRef: 'fictional-evidence', changes: [{ kind: 'replace', before: ref, after: ref }] } }),
  } });
  t.after(() => controller.dispose());
  controller.actions.edit('original', true);
  const result = await controller.flush(controller.actions.selection());
  assert.equal(result.kind, 'saved');
  assert.equal(result.ref.revision, ref.revision);
  assert.equal(controller.getSnapshot().dirty, false);
});

test('abandoning an unconfirmed save refreshes, keeps the draft and never reports or replays the save', async t => {
  const { client, source } = await fixture(t);
  let publishes = 0;
  const controller = createMarkdownController({ identity: access, source, instanceId: 'editor', epoch: 'page', client: {
    ...client,
    publish: async request => { publishes++; await client.publish(request); throw new Error('fictional transport lost acknowledgement'); },
    lookup: async () => ({ kind: 'not-found' }),
  } });
  t.after(() => controller.dispose());
  assert.equal((await controller.actions.abandon()).kind, 'unavailable');
  controller.actions.edit('my draft');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unknown');
  assert.equal(controller.getSnapshot().save.result.kind, 'unknown');
  assert.equal((await controller.actions.abandon()).kind, 'available');
  const state = controller.getSnapshot();
  assert.equal(state.save.kind, 'idle');
  assert.equal(state.text, 'my draft');
  assert.equal(state.dirty, true);
  assert.equal(state.remote?.kind, 'revision');
  assert.notEqual(state.remote.target.revision, source.snapshot.ref.revision);
  assert.equal(publishes, 1);
});

test('disposing during save cannot transfer acknowledgement to another viewer or close its provider', async t => {
  const { client, source } = await fixture(t);
  const committed = Promise.withResolvers(), release = Promise.withResolvers();
  const old = createMarkdownController({ identity: access, source, client: { ...client, publish: async request => { const result = await client.publish(request); committed.resolve(); await release.promise; return result; } }, instanceId: 'shared-slot', epoch: 'old-page' });
  old.actions.edit('old selected draft');
  const pending = old.flush(old.actions.selection());
  await committed.promise;
  old.dispose();
  const frozenDisposed = old.getSnapshot();
  const next = createMarkdownController({ identity: access, source, client, instanceId: 'shared-slot', epoch: 'new-page' });
  t.after(() => next.dispose());
  next.actions.edit('new page draft');
  release.resolve();
  const result = await pending;
  assert.equal(result.kind, 'saved');
  assert.equal(result.selection.target.epoch, 'old-page');
  assert.equal(old.getSnapshot(), frozenDisposed);
  assert.equal(next.getSnapshot().text, 'new page draft');
  assert.equal(next.getSnapshot().dirty, true);
  assert.equal((await client.read({ target, revision: { kind: 'latest' } })).kind, 'available');
});

test('edits made during a requested discard are preserved', async t => {
  const { client, source } = await fixture(t);
  const reading = Promise.withResolvers(), release = Promise.withResolvers();
  const controller = createMarkdownController({ identity: access, source, client: { ...client, read: async request => { const result = await client.read(request); reading.resolve(); await release.promise; return result; } }, instanceId: 'editor', epoch: 'page' });
  t.after(() => controller.dispose());
  controller.actions.edit('discard requested');
  const pending = controller.actions.discardToRemote();
  await reading.promise;
  controller.actions.edit('typed after discard');
  release.resolve();
  await pending;
  assert.equal(controller.getSnapshot().text, 'typed after discard');
  assert.equal(controller.getSnapshot().dirty, true);
});

for (const corruption of ['null', 'invented-save', 'numeric-identifiers']) test(`malformed provider output remains dirty and reconcilable: ${corruption}`, async t => {
  const { client, source } = await fixture(t);
  let calls = 0;
  const controller = createMarkdownController({ identity: access, source, instanceId: 'editor', epoch: 'page', client: {
    ...client,
    publish: async request => {
      calls++;
      const committed = await client.publish(request);
      if (corruption === 'null') return null;
      if (corruption === 'invented-save') return { kind: 'saved', receipt: {}, selection: {}, ref: { ...target, revision: 'invented' } };
      committed.receipt.changes[0].after.revision = 123;
      committed.receipt.principalId = 1;
      return committed;
    },
  } });
  t.after(() => controller.dispose());
  controller.actions.edit('exact draft');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unknown');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal((await controller.actions.reconcile()).kind, 'saved');
  assert.equal(controller.getSnapshot().dirty, false);
  assert.equal(calls, 1);
});

test('invalid Unicode cannot be acknowledged as different persisted text', async t => {
  const { controller, client } = await fixture(t);
  controller.actions.edit('\ud800');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'denied');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(controller.getSnapshot().text, '\ud800');
  assert.equal(text((await client.read({ target, revision: { kind: 'latest' } })).snapshot.bytes), 'original');
});

test('a throwing observer cannot alter the publication outcome', async t => {
  const { client, source } = await fixture(t);
  const errors = [];
  const controller = createMarkdownController({ identity: access, source, client, instanceId: 'editor', epoch: 'page', onListenerError: error => errors.push(error) });
  t.after(() => controller.dispose());
  const unsubscribe = controller.subscribe(() => { throw new Error('observer failed'); });
  controller.actions.edit('selected');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'saved');
  assert.equal(controller.getSnapshot().dirty, false);
  assert.ok(errors.length > 0);
  unsubscribe();
});

test('a receipt for another scope cannot acknowledge this new-document editor', async t => {
  const { provider } = await fixture(t);
  const other = { ...access, scopeId: 'other-project' };
  const controller = createMarkdownController({ identity: access,
    source: { kind: 'new', target, text: 'draft for intended scope' }, instanceId: 'editor', epoch: 'page',
    client: { read: request => provider.read(request, other), publish: request => provider.publication.publish(request, other) },
  });
  t.after(() => controller.dispose());
  const selection = controller.actions.selection();
  assert.equal(selection.target.subject.scopeId, access.scopeId);
  assert.equal((await controller.flush(selection)).kind, 'unknown');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(controller.getSnapshot().base.kind, 'absent');
});

test('Markdown proposals retain immutable exact bases, preserve dirty human text and create no effect before acceptance', async t => {
  const { controller, provider } = await fixture(t, 'one');
  controller.actions.edit('one human');
  const base = controller.actions.selection();
  const edits = [{ find: 'one', replace: 'two' }];
  const proposed = controller.actions.propose(base, edits, 'Fictional proposal');
  assert.equal(proposed.kind, 'proposed');
  edits[0].replace = 'redirected';
  const proposal = controller.getSnapshot().proposals[0];
  assert(Object.isFrozen(proposal.edits[0]));
  assert.deepEqual(proposal.base, base);
  assert.equal(proposal.before, 'one human');
  assert.equal(proposal.after, 'two human');
  assert.equal(controller.getSnapshot().text, 'one human');
  assert.equal(text((await provider.read({ target, revision: { kind: 'latest' } }, access)).snapshot.bytes), 'one');
  const saved = await controller.actions.accept(proposed.proposalId);
  assert.equal(saved.kind, 'saved');
  assert.equal(text((await provider.read({ target, revision: { kind: 'latest' } }, access)).snapshot.bytes), 'two human');
  assert.equal(controller.getSnapshot().proposals[0].adopted, true);
  assert.equal((await controller.actions.accept(proposed.proposalId)).kind, 'conflict');
});

test('changed buffer versions and saved revisions invalidate proposals without implicit rebasing', async t => {
  const { controller } = await fixture(t);
  const proposed = controller.actions.propose(controller.actions.selection(), [{ find: 'original', replace: 'proposed' }]);
  controller.actions.edit('original edited'); controller.actions.edit('original');
  assert.equal((await controller.actions.accept(proposed.proposalId)).kind, 'conflict');
  // Revisions name the bytes, so the save must change them for the saved revision to move.
  controller.actions.edit('original saved');
  const second = controller.actions.propose(controller.actions.selection(), [{ find: 'original', replace: 'proposed' }]);
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'saved');
  assert.equal((await controller.actions.accept(second.proposalId)).kind, 'conflict');
  controller.actions.reject(proposed.proposalId);
  assert.deepEqual(controller.getSnapshot().proposals.map(value => value.id), [second.proposalId]);
});

test('target-bound commands reject expired, different scope/view/instance/epoch/version and disposed targets', async t => {
  const { controller } = await fixture(t);
  const base = controller.actions.selection();
  const expiresAt = Date.now() + 10000;
  const inspected = await controller.tools.inspect.invoke(base.target, { expiresAt });
  assert.equal(inspected.kind, 'applied');
  assert.deepEqual(inspected.value, { selection: base, text: 'original', dirty: false });
  const variants = [
    { ...base.target, instanceId: 'other' }, { ...base.target, epoch: 'other' },
    { ...base.target, subject: { ...base.target.subject, scopeId: 'other' } },
    { ...base.target, subject: { ...base.target.subject, bufferVersion: 100 } },
    { ...base.target, subject: { ...base.target.subject, base: { ...base.target.subject.base, target: { ...base.target.subject.base.target, view: { kind: 'working', viewId: 'other' } } } } },
  ];
  for (const target of variants) {
    assert.equal((await controller.tools.inspect.invoke(target, { expiresAt })).kind, 'stale');
    assert.equal((await controller.tools.propose.invoke(target, { expiresAt, edits: [{ find: 'original', replace: 'changed' }], summary: '' })).kind, 'stale');
  }
  assert.equal((await controller.tools.inspect.invoke(base.target, { expiresAt: 0 })).kind, 'stale');
  assert.equal((await controller.tools.propose.invoke(base.target, { expiresAt: 0, edits: [{ find: 'original', replace: 'changed' }], summary: '' })).kind, 'stale');
  controller.dispose();
  assert.equal((await controller.tools.inspect.invoke(base.target, { expiresAt })).kind, 'unavailable');
  assert.equal(controller.getSnapshot().proposals.length, 0);
});

test('proposal acceptance preserves typing during publication and never flushes a reentrant listener edit', async t => {
  const { client, source } = await fixture(t);
  const started = Promise.withResolvers(), finish = Promise.withResolvers();
  const controller = createMarkdownController({ identity: access, source, instanceId: 'p', epoch: 'e', client: { ...client, publish: async request => {
    const result = await client.publish(request); started.resolve(); await finish.promise; return result;
  } } });
  const proposed = controller.actions.propose(controller.actions.selection(), [{ find: 'original', replace: 'proposed' }]);
  const saved = controller.actions.accept(proposed.proposalId);
  await started.promise;
  controller.actions.edit('later typing'); finish.resolve();
  assert.equal((await saved).kind, 'saved');
  assert.equal(controller.getSnapshot().text, 'later typing');
  assert.equal(controller.getSnapshot().dirty, true);
  const latest = (await client.read({ target, revision: { kind: 'latest' } })).snapshot;
  let writes = 0;
  const reentrant = createMarkdownController({ identity: access, source: { kind: 'saved', snapshot: latest }, instanceId: 'r', epoch: 'e', client: { ...client, publish: request => { writes++; return client.publish(request); } } });
  const next = reentrant.actions.propose(reentrant.actions.selection(), [{ find: 'proposed', replace: 'adopted' }]);
  reentrant.subscribe(() => { if (reentrant.getSnapshot().text === 'adopted') reentrant.actions.edit('listener typing'); });
  assert.equal((await reentrant.actions.accept(next.proposalId)).kind, 'conflict');
  assert.equal(writes, 0);
  assert.equal(reentrant.getSnapshot().text, 'listener typing');
  controller.dispose(); reentrant.dispose();
});

test('unknown publication blocks repeated acceptance until reconciliation, with no duplicate effect', async t => {
  const { client, source } = await fixture(t);
  let writes = 0;
  const controller = createMarkdownController({ identity: access, source, instanceId: 'u', epoch: 'e', client: { ...client, publish: async request => { writes++; await client.publish(request); throw new Error('lost acknowledgement'); } } });
  const proposed = controller.actions.propose(controller.actions.selection(), [{ find: 'original', replace: 'accepted' }]);
  assert.equal((await controller.actions.accept(proposed.proposalId)).kind, 'unknown');
  assert.equal((await controller.actions.accept(proposed.proposalId)).kind, 'unknown');
  assert.equal(writes, 1);
  assert.equal((await controller.actions.reconcile()).kind, 'saved');
  assert.equal((await controller.actions.accept(proposed.proposalId)).kind, 'conflict');
  assert.equal(writes, 1);
  controller.dispose();
});

test('read-only Markdown refuses edits, proposals and publication despite a writable injected client', async t => {
  const { client, source } = await fixture(t);
  let writes = 0;
  const controller = createMarkdownController({ identity: access, source, instanceId: 'readonly', epoch: 'e', readOnly: true, client: { ...client, publish: request => { writes++; return client.publish(request); } } });
  assert.throws(() => controller.actions.edit('changed'), /read-only/);
  assert.equal(controller.actions.propose(controller.actions.selection(), [{ find: 'original', replace: 'changed' }]).kind, 'denied');
  assert.equal((await controller.actions.accept('missing')).kind, 'denied');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'denied');
  assert.equal(writes, 0);
  controller.dispose();
});

await import('../ui/file-tree.mjs');
await import('../ui/revision-workspace.mjs');
