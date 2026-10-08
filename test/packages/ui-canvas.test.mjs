import assert from 'node:assert/strict';
import test from 'node:test';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { Window } from 'happy-dom';

test('native canvas publication with a DOM scheduler (not browser qualification)', async t => {
const window = new Window();
const globals = new Map();
for (const name of ['window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : typeof window[name] === 'function' ? window[name].bind(window) : window[name] });
}
t.after(async () => {
  await window.happyDOM.close();
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

// The SDK's supported test mode avoids its browser user-sync BroadcastChannel in Node.
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const { createTLStore } = await import('@tldraw/editor');
const { createCanvasController, canvasMediaType } = await import('@hachej/boring-ui-kit/canvas');
const { CameraRecordType, DocumentRecordType, InstancePageStateRecordType, PageRecordType, TLDOCUMENT_ID, createShapeId, createTLSchema, defaultBindingSchemas, UserRecordType } = await import('@tldraw/tlschema');
if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = originalNodeEnv;

const target = { resource: { providerId: 'canvas-documents', path: 'fictional.canvas' }, view: { kind: 'published' } };
const identity = { scopeId: 'fictional-project', principalId: 'canvas-editor', initiatorId: 'alice' };
const shapeId = createShapeId('fictional-group');
const pageId = PageRecordType.createId('fictional-page');

function makeStore(t) {
  const store = createTLStore();
  store.put([
    DocumentRecordType.create({ id: TLDOCUMENT_ID, name: 'Fictional canvas' }),
    PageRecordType.create({ id: pageId, name: 'One', index: 'a1' }),
    store.schema.types.shape.create({ id: shapeId, type: 'group', parentId: pageId, index: 'a1', props: {} }),
  ]);
  t.after(() => store.dispose());
  return store;
}

function move(store, x) {
  store.put([{ ...store.get(shapeId), x }]);
}

function loadMovedDocument(store, x) {
  const document = structuredClone(store.getStoreSnapshot('document'));
  document.store[shapeId].x = x;
  store.loadStoreSnapshot(document);
}

function resources(t) {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: target.resource.providerId, authorize: () => true });
  t.after(() => provider.close());
  return {
    read: request => provider.read(request, identity),
    publish: request => provider.publication.publish(request, identity),
    lookup: operationId => provider.reconciliation.lookup(operationId, identity),
  };
}

function controllerFor(t, store, client, source, options = {}) {
  const controller = createCanvasController({ store, client, source, identity, instanceId: 'fictional-canvas', epoch: 'first-page', ...options });
  t.after(() => controller.dispose());
  return controller;
}

async function fixture(t, { saved = true } = {}) {
  const store = makeStore(t), client = resources(t);
  let source = { kind: 'new', target };
  if (saved) {
    const seed = controllerFor(t, store, client, source);
    assert.equal((await seed.flush(seed.actions.selection())).kind, 'saved');
    seed.dispose();
    source = { kind: 'saved', snapshot: (await client.read({ target, revision: { kind: 'latest' } })).snapshot };
  }
  const controller = controllerFor(t, store, client, source);
  return { store, client, source, controller };
}

async function savedDocument(client) {
  const read = await client.read({ target, revision: { kind: 'latest' } });
  assert.equal(read.kind, 'available');
  assert.equal(read.snapshot.mediaType, canvasMediaType);
  return { document: JSON.parse(new TextDecoder().decode(read.snapshot.bytes)), snapshot: read.snapshot };
}

await t.test('canvas creation and session edits never publish or dirty a saved document', async t => {
  const { store, client, source, controller: previous } = await fixture(t);
  previous.dispose();
  let writes = 0;
  const controller = controllerFor(t, store, { ...client, publish: request => { writes++; return client.publish(request); } }, source);
  const initial = controller.getSnapshot();
  assert.equal(controller.getSnapshot(), initial);
  assert.equal(initial.dirty, false);
  assert.equal(writes, 0);
  const camera = CameraRecordType.create({ id: CameraRecordType.createId('fictional-page') });
  const selection = InstancePageStateRecordType.create({ pageId, selectedShapeIds: [shapeId] });
  store.put([camera, selection]);
  store.put([{ ...camera, x: 42, y: 93, z: 2 }, { ...selection, selectedShapeIds: [] }]);
  assert.equal(controller.getSnapshot(), initial);
  assert.equal(writes, 0);
  assert.deepEqual(Object.values(initial.document.store).map(record => record.typeName).sort(), ['document', 'page', 'shape']);
  assert.equal((await savedDocument(client)).snapshot.ref.revision, source.snapshot.ref.revision);
});

await t.test('native document edits synchronously create immutable snapshots and exact save receipts', async t => {
  const { controller, store, client } = await fixture(t);
  const initial = controller.getSnapshot();
  const notifications = [];
  const unsubscribe = controller.subscribe(() => notifications.push(controller.getSnapshot()));
  move(store, 120);
  const changed = controller.getSnapshot();
  assert.equal(changed.document.store[shapeId].x, 120);
  assert.equal(changed.dirty, true);
  assert.ok(changed.bufferVersion > initial.bufferVersion);
  assert.equal(notifications.at(-1), changed);
  assert.equal(initial.document.store[shapeId].x, 0);
  assert.throws(() => { changed.document.store[shapeId].x = 999; }, TypeError);
  const selection = controller.actions.selection();
  const result = await controller.flush(selection);
  assert.equal(result.kind, 'saved');
  assert.deepEqual(result.selection, selection);
  const saved = await savedDocument(client);
  assert.deepEqual(result.ref, saved.snapshot.ref);
  assert.deepEqual(result.receipt.changes[0].after, saved.snapshot.ref);
  assert.equal(saved.document.store[shapeId].x, 120);
  assert.equal(controller.getSnapshot().dirty, false);
  unsubscribe();
});

await t.test('new canvas saves create-if-absent and native document snapshots roundtrip', async t => {
  const { controller, store, client } = await fixture(t, { saved: false });
  assert.equal((await client.read({ target, revision: { kind: 'latest' } })).kind, 'missing');
  assert.equal(controller.getSnapshot().base.kind, 'absent');
  move(store, 81);
  const expected = store.getStoreSnapshot('document');
  const result = await controller.flush(controller.actions.selection());
  assert.equal(result.kind, 'saved');
  assert.equal(result.receipt.changes[0].kind, 'create');
  assert.equal(result.receipt.changes[0].before, null);
  const saved = await savedDocument(client);
  const reopenedStore = createTLStore();
  t.after(() => reopenedStore.dispose());
  const reopened = controllerFor(t, reopenedStore, client, { kind: 'saved', snapshot: saved.snapshot });
  assert.deepEqual(reopened.getSnapshot().document, expected);
  assert.equal(reopened.getSnapshot().dirty, false);
});

await t.test('stale and cross-instance canvas selections refuse publication', async t => {
  const { controller, store, client } = await fixture(t);
  const stale = controller.actions.selection();
  move(store, 101);
  assert.equal((await controller.flush(stale)).kind, 'conflict');
  const foreign = structuredClone(controller.actions.selection());
  foreign.target.epoch = 'another-mount';
  assert.equal((await controller.flush(foreign)).kind, 'conflict');
  assert.equal((await savedDocument(client)).document.store[shapeId].x, 0);
  assert.equal(controller.getSnapshot().document.store[shapeId].x, 101);
});

await t.test('external canvas revision conflicts preserve dirty shapes until explicit discard', async t => {
  const { controller, store, client, source } = await fixture(t);
  const remoteStore = makeStore(t);
  const remote = controllerFor(t, remoteStore, client, source, { instanceId: 'remote-canvas' });
  move(store, 11);
  move(remoteStore, 22);
  assert.equal((await remote.flush(remote.actions.selection())).kind, 'saved');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'conflict');
  await controller.actions.refresh();
  assert.equal(store.get(shapeId).x, 11);
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(controller.getSnapshot().remote.kind, 'revision');
  await controller.actions.discardToRemote();
  assert.equal(store.get(shapeId).x, 22);
  assert.equal(controller.getSnapshot().document.store[shapeId].x, 22);
  assert.equal(controller.getSnapshot().dirty, false);
});

await t.test('late canvas acknowledgement preserves a newer local shape edit', async t => {
  const { client, source } = await fixture(t);
  const store = makeStore(t);
  const committed = Promise.withResolvers(), release = Promise.withResolvers();
  const controller = controllerFor(t, store, { ...client, publish: async request => {
    const result = await client.publish(request);
    committed.resolve();
    await release.promise;
    return result;
  } }, source);
  move(store, 33);
  const selection = controller.actions.selection();
  const pending = controller.flush(selection);
  await committed.promise;
  move(store, 44);
  release.resolve();
  const result = await pending;
  assert.equal(result.kind, 'saved');
  assert.deepEqual(result.selection, selection);
  assert.equal((await savedDocument(client)).document.store[shapeId].x, 33);
  assert.equal(controller.getSnapshot().document.store[shapeId].x, 44);
  assert.equal(controller.getSnapshot().dirty, true);
});

await t.test('lost canvas acknowledgement reconciles one publication while retaining newer shapes', async t => {
  const { client, source } = await fixture(t);
  const store = makeStore(t);
  let writes = 0;
  const controller = controllerFor(t, store, { ...client, publish: async request => {
    writes++;
    await client.publish(request);
    throw new Error('Fictional lost acknowledgement');
  } }, source);
  move(store, 55);
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unknown');
  move(store, 66);
  assert.equal((await controller.actions.reconcile()).kind, 'saved');
  assert.equal(writes, 1);
  assert.equal((await savedDocument(client)).document.store[shapeId].x, 55);
  assert.equal(store.get(shapeId).x, 66);
  assert.equal(controller.getSnapshot().dirty, true);
});

await t.test('explicit discard cannot overwrite shapes edited while the remote read is pending', async t => {
  const { client, source } = await fixture(t);
  const store = makeStore(t);
  const reading = Promise.withResolvers(), release = Promise.withResolvers();
  const controller = controllerFor(t, store, { ...client, read: async request => {
    const result = await client.read(request);
    reading.resolve();
    await release.promise;
    return result;
  } }, source);
  move(store, 70);
  const pending = controller.actions.discardToRemote();
  await reading.promise;
  move(store, 71);
  release.resolve();
  await pending;
  assert.equal(store.get(shapeId).x, 71);
  assert.equal(controller.getSnapshot().dirty, true);
});

await t.test('canvas source validation rejects malformed bytes, media, schema and records before loading', async t => {
  const { client, source } = await fixture(t);
  const valid = JSON.parse(new TextDecoder().decode(source.snapshot.bytes));
  const invalidShape = structuredClone(valid);
  invalidShape.store[shapeId].x = 'not a coordinate';
  const wrongSchema = structuredClone(valid);
  wrongSchema.schema.sequences['com.tldraw.shape']++;
  const session = structuredClone(valid);
  const camera = CameraRecordType.create({ id: CameraRecordType.createId('remote') });
  session.store[camera.id] = camera;
  const asset = structuredClone(valid);
  asset.store['asset:remote'] = { id: 'asset:remote', typeName: 'asset', type: 'image', meta: {}, props: { name: 'Fictional image', src: 'https://example.invalid/private.png', w: 20, h: 20, mimeType: 'image/png', isAnimated: false } };
  const encode = value => new TextEncoder().encode(JSON.stringify(value));
  const candidates = [
    { bytes: new Uint8Array([0xff]) },
    { bytes: new TextEncoder().encode('{') },
    { mediaType: 'text/plain' },
    ...[invalidShape, wrongSchema, session, asset].map(value => ({ bytes: encode(value) })),
  ];
  for (const invalid of candidates) {
    const store = makeStore(t);
    move(store, 999);
    const before = structuredClone(store.getStoreSnapshot('all'));
    assert.throws(() => createCanvasController({ store, client, identity, source: { kind: 'saved', snapshot: { ...source.snapshot, ...invalid } }, instanceId: 'reject', epoch: 'first-page' }));
    assert.deepEqual(store.getStoreSnapshot('all'), before);
  }
});

await t.test('read-only canvas refuses publication without blocking a shared native writer', async t => {
  const { client, source } = await fixture(t);
  const store = makeStore(t);
  const reader = controllerFor(t, store, client, source, { readOnly: true });
  const writer = controllerFor(t, store, client, source, { instanceId: 'shared-writer' });
  move(store, 999);
  assert.equal(store.get(shapeId).x, 999);
  assert.equal(reader.getSnapshot().document.store[shapeId].x, 999);
  assert.equal(reader.getSnapshot().dirty, true);
  store.put([CameraRecordType.create({ id: CameraRecordType.createId('readonly'), x: 42 })]);
  assert.equal((await reader.flush(reader.actions.selection())).kind, 'denied');
  assert.equal((await savedDocument(client)).document.store[shapeId].x, 0);
  assert.equal((await writer.flush(writer.actions.selection())).kind, 'saved');
  assert.equal((await savedDocument(client)).document.store[shapeId].x, 999);
  reader.dispose();
  move(store, 1000);
  assert.equal(writer.getSnapshot().document.store[shapeId].x, 1000);
  assert.equal((await writer.flush(writer.actions.selection())).kind, 'saved');
});

await t.test('unsupported host-owned assets remain in the native store but cannot be published', async t => {
  const { controller, store, client } = await fixture(t);
  const selection = controller.actions.selection();
  const asset = store.schema.types.asset.create({ id: 'asset:local', type: 'image', props: { name: 'Fictional image', src: 'https://example.invalid/private.png', w: 20, h: 20, mimeType: 'image/png', isAnimated: false } });
  store.put([asset]);
  assert.equal(store.get(asset.id), asset);
  assert.match(controller.getSnapshot().problem, /asset adapter/);
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal((await controller.flush(selection)).kind, 'denied');
  assert.equal((await savedDocument(client)).document.store[asset.id], undefined);
  store.remove([asset.id]);
  assert.equal(controller.getSnapshot().problem, null);
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'saved');
});

await t.test('late acknowledgement detects raw native snapshot loads and retains the newer document', async t => {
  const { client, source } = await fixture(t);
  const store = makeStore(t);
  const committed = Promise.withResolvers(), release = Promise.withResolvers();
  const controller = controllerFor(t, store, { ...client, publish: async request => {
    const result = await client.publish(request);
    committed.resolve();
    await release.promise;
    return result;
  } }, source);
  move(store, 110);
  const selection = controller.actions.selection();
  const pending = controller.flush(selection);
  await committed.promise;
  loadMovedDocument(store, 111);
  release.resolve();
  const result = await pending;
  assert.equal(result.kind, 'saved');
  assert.deepEqual(result.selection, selection);
  assert.equal((await savedDocument(client)).document.store[shapeId].x, 110);
  assert.equal(store.get(shapeId).x, 111);
  assert.equal(controller.getSnapshot().document.store[shapeId].x, 111);
  assert.equal(controller.getSnapshot().dirty, true);
});

await t.test('a raw native snapshot load during remote refresh protects the newly loaded draft', async t => {
  const { client, source } = await fixture(t);
  const store = makeStore(t);
  const reading = Promise.withResolvers(), release = Promise.withResolvers();
  const controller = controllerFor(t, store, { ...client, read: async request => {
    const result = await client.read(request);
    reading.resolve();
    await release.promise;
    return result;
  } }, source);
  const pending = controller.actions.discardToRemote();
  await reading.promise;
  loadMovedDocument(store, 121);
  release.resolve();
  await pending;
  assert.equal(store.get(shapeId).x, 121);
  assert.equal(controller.getSnapshot().document.store[shapeId].x, 121);
  assert.equal(controller.getSnapshot().dirty, true);
});

await t.test('raw native snapshot loads eventually notify subscribers without invoking controller actions', async t => {
  const { controller, store } = await fixture(t);
  const initial = controller.getSnapshot();
  const notified = Promise.withResolvers();
  const timeout = setTimeout(() => notified.reject(new Error('Native document listener did not notify')), 2000);
  const unsubscribe = controller.subscribe(() => {
    const state = controller.getSnapshot();
    if (state.document.store[shapeId].x === 131 && state.dirty) notified.resolve(state);
  });
  t.after(() => { clearTimeout(timeout); unsubscribe(); });
  loadMovedDocument(store, 131);
  const changed = await notified.promise;
  clearTimeout(timeout);
  assert.equal(changed.document.store[shapeId].x, 131);
  assert.equal(changed.dirty, true);
  assert.ok(changed.bufferVersion > initial.bufferVersion);
  assert.equal(initial.document.store[shapeId].x, 0);
});

await t.test('malformed remote documents cannot replace the current canvas during refresh', async t => {
  const { controller, store, client, source } = await fixture(t);
  const initial = structuredClone(store.getStoreSnapshot('document'));
  const result = await client.publish({ operationId: 'fictional-invalid-remote', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: source.snapshot.ref, bytes: new TextEncoder().encode('{'), mediaType: canvasMediaType }] });
  assert.equal(result.kind, 'committed');
  assert.equal((await controller.actions.refresh()).kind, 'unavailable');
  assert.deepEqual(store.getStoreSnapshot('document'), initial);
  assert.deepEqual(controller.getSnapshot().document, initial);
  assert.equal(controller.getSnapshot().base.target.revision, source.snapshot.ref.revision);
});

await t.test('disposing a canvas removes its listeners and leaves the borrowed store usable', async t => {
  const { controller, store } = await fixture(t);
  let notifications = 0;
  controller.subscribe(() => notifications++);
  controller.dispose();
  const disposed = controller.getSnapshot();
  const count = notifications;
  assert.equal(disposed.lifecycle, 'disposed');
  move(store, 88);
  assert.equal(store.get(shapeId).x, 88);
  assert.equal(controller.getSnapshot(), disposed);
  assert.equal(notifications, count);
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unavailable');
});

await t.test('custom bindings are refused even when the borrowed native schema validates them', async t => {
  const schema = createTLSchema({ bindings: { ...defaultBindingSchemas, fictional: { props: {} } } });
  const store = createTLStore({ schema });
  t.after(() => store.dispose());
  store.put([
    DocumentRecordType.create({ id: TLDOCUMENT_ID, name: 'Fictional custom binding' }),
    PageRecordType.create({ id: pageId, name: 'One', index: 'a1' }),
    schema.types.shape.create({ id: shapeId, type: 'group', parentId: pageId, index: 'a1', props: {} }),
    schema.types.binding.create({ id: 'binding:fictional', type: 'fictional', fromId: shapeId, toId: shapeId, props: {} }),
  ]);
  const before = structuredClone(store.getStoreSnapshot('document'));
  assert.throws(() => createCanvasController({ store, client: resources(t), source: { kind: 'new', target }, identity, instanceId: 'custom', epoch: 'one' }), /Unsupported canvas binding/);
  assert.deepEqual(store.getStoreSnapshot('document'), before);
});

await t.test('mounting a second saved viewer cannot overwrite an existing shared draft', async t => {
  const { store, controller, client, source } = await fixture(t);
  move(store, 175);
  const draft = controller.getSnapshot();
  assert.equal(draft.dirty, true);
  assert.throws(() => createCanvasController({ store, client, source, identity, instanceId: 'later-reader', epoch: 'two', readOnly: true }), /differs from the saved source/);
  assert.equal(store.get(shapeId).x, 175);
  assert.equal(controller.getSnapshot(), draft);
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'saved');
  assert.equal((await savedDocument(client)).document.store[shapeId].x, 175);
});

await t.test('native document author records persist without granting access or permitting image URLs', async t => {
  const { store, controller, client } = await fixture(t);
  const author = UserRecordType.create({ id: UserRecordType.createId('fictional-author'), name: 'Fictional author', color: '#123456' });
  store.put([author]);
  assert.equal(controller.getSnapshot().problem, null);
  const result = await controller.flush(controller.actions.selection());
  assert.equal(result.kind, 'saved');
  assert.equal(result.receipt.principalId, identity.principalId);
  assert.deepEqual((await savedDocument(client)).document.store[author.id], author);
  const selected = controller.actions.selection();
  store.put([{ ...author, imageUrl: 'https://fictional.invalid/avatar.png' }]);
  assert.match(controller.getSnapshot().problem, /author images/);
  assert.equal((await controller.flush(selected)).kind, 'denied');
  const saved = await savedDocument(client);
  assert.equal(saved.document.store[author.id].imageUrl, '');
  const invalid = structuredClone(saved.document);
  invalid.store[author.id].imageUrl = 'https://fictional.invalid/avatar.png';
  const empty = createTLStore();
  t.after(() => empty.dispose());
  assert.throws(() => createCanvasController({ store: empty, client, source: { kind: 'saved', snapshot: { ...saved.snapshot, bytes: new TextEncoder().encode(JSON.stringify(invalid)) } }, identity, instanceId: 'author-reader', epoch: 'one' }), /author images/);
  assert.equal(Object.keys(empty.getStoreSnapshot('document').store).length, 0);
});

await t.test('invalid remote parent graph preserves the local document and publication base', async t => {
  const { store, controller, client } = await fixture(t);
  const saved = await savedDocument(client), before = controller.getSnapshot();
  const invalid = structuredClone(saved.document);
  invalid.store[shapeId].parentId = PageRecordType.createId('missing');
  const remote = await client.publish({ operationId: 'fictional-invalid-parent', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: saved.snapshot.ref,
    bytes: new TextEncoder().encode(JSON.stringify(invalid)), mediaType: 'application/vnd.tldraw+json' }] });
  assert.equal(remote.kind, 'committed');
  assert.equal((await controller.actions.refresh()).kind, 'unavailable');
  assert.deepEqual(controller.getSnapshot().base, before.base);
  assert.deepEqual(store.getStoreSnapshot('document'), before.document);
  const empty = createTLStore();
  t.after(() => empty.dispose());
  assert.throws(() => createCanvasController({ store: empty, client, source: { kind: 'saved', snapshot: { ...saved.snapshot, bytes: new TextEncoder().encode(JSON.stringify(invalid)) } },
    identity, instanceId: 'invalid-parent', epoch: 'one' }), /parent/);
  assert.equal(Object.keys(empty.getStoreSnapshot('document').store).length, 0);
});

await t.test('local invalid parent graph refuses publication and becomes saveable after repair', async t => {
  const { store, controller, client } = await fixture(t);
  const selected = controller.actions.selection(), saved = await savedDocument(client);
  const original = store.get(shapeId);
  let publications = 0;
  const publish = client.publish;
  client.publish = request => { publications++; return publish(request); };
  store.put([{ ...original, parentId: PageRecordType.createId('missing') }]);
  const invalidSelection = { target: { ...selected.target, subject: { ...selected.target.subject, bufferVersion: controller.getSnapshot().bufferVersion } } };
  assert.equal((await controller.flush(invalidSelection)).kind, 'denied');
  assert.match(controller.getSnapshot().problem, /parent/);
  assert.equal(publications, 0);
  assert.equal((await savedDocument(client)).snapshot.ref.revision, saved.snapshot.ref.revision);
  store.put([{ ...original, x: 70 }]);
  assert.equal(controller.getSnapshot().problem, null);
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'saved');
  assert.equal(publications, 1);
  assert.equal((await savedDocument(client)).document.store[shapeId].x, 70);
});

await t.test('local document-record deletion cannot be hidden by native scratch normalization', async t => {
  const { store, controller, client } = await fixture(t);
  const selected = controller.actions.selection(), before = await savedDocument(client);
  store.remove([TLDOCUMENT_ID]);
  const invalidSelection = { target: { ...selected.target, subject: { ...selected.target.subject, bufferVersion: controller.getSnapshot().bufferVersion } } };
  assert.equal((await controller.flush(invalidSelection)).kind, 'denied');
  assert.match(controller.getSnapshot().problem, /document record/);
  assert.equal((await savedDocument(client)).snapshot.ref.revision, before.snapshot.ref.revision);
});

});
