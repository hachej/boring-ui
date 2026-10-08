import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('headless canvas proposals over native stores and SQLite publication', async t => {
  const window = new Window(), previous = new Map();
  for (const name of ['window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : typeof window[name] === 'function' ? window[name].bind(window) : window[name] });
  }
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const { createTLStore } = await import('@tldraw/editor');
  const { DocumentRecordType, PageRecordType, TLDOCUMENT_ID, createShapeId } = await import('@tldraw/tlschema');
  const { createCanvasController } = await import('@hachej/boring-ui-kit/canvas');
  const { parseCanvasEdits } = await import('@hachej/boring-ui-kit/canvas-document');
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
    if (nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = nodeEnv;
  });
  const target = { resource: { providerId: 'canvas-proposals', path: 'fictional.canvas' }, view: { kind: 'published' } };
  const identity = { scopeId: 'fictional', principalId: 'viewer', initiatorId: 'alice' };
  const pageId = PageRecordType.createId('fictional'), shapeId = createShapeId('group');
  async function fixture(t, { saved = true, readOnly = false, publish } = {}) {
    const store = createTLStore();
    store.put([DocumentRecordType.create({ id: TLDOCUMENT_ID, name: 'Fictional canvas' }), PageRecordType.create({ id: pageId, name: 'One', index: 'a1' }),
      store.schema.types.shape.create({ id: shapeId, type: 'group', parentId: pageId, index: 'a1', props: {} })]);
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: target.resource.providerId, authorize: () => true });
    const client = { read: request => provider.read(request, identity), publish: request => provider.publication.publish(request, identity), lookup: operationId => provider.reconciliation.lookup(operationId, identity) };
    let source = { kind: 'new', target };
    if (saved) {
      const seed = createCanvasController({ store, client, identity, source, instanceId: 'seed', epoch: 'one' });
      assert.equal((await seed.flush(seed.actions.selection())).kind, 'saved'); seed.dispose();
      source = { kind: 'saved', snapshot: (await client.read({ target, revision: { kind: 'latest' } })).snapshot };
    }
    let writes = 0;
    const controller = createCanvasController({ store, client: { ...client, publish: request => { writes++; return publish ? publish(request, client) : client.publish(request); } }, identity, source, readOnly,
      instanceId: 'canvas', epoch: 'one' });
    t.after(() => { controller.dispose(); store.dispose(); provider.close(); });
    const move = x => store.put([{ ...store.get(shapeId), x }]);
    const edits = x => [{ kind: 'update', record: { ...store.get(shapeId), x } }];
    const propose = (x, base = controller.actions.selection()) => {
      const result = controller.actions.propose(base, edits(x), 'Move the fictional group');
      assert.equal(result.kind, 'proposed', JSON.stringify(result));
      return result.proposalId;
    };
    const published = async () => {
      const read = await client.read({ target, revision: { kind: 'latest' } });
      assert.equal(read.kind, 'available'); return JSON.parse(new TextDecoder().decode(read.snapshot.bytes));
    };
    return { store, controller, client, move, edits, propose, published, get writes() { return writes; } };
  }
  const deadline = () => ({ expiresAt: Date.now() + 10000 });

  await t.test('dirty proposal is immutable and publishes only after exact acceptance', async t => {
    const f = await fixture(t); f.move(5);
    const base = f.controller.actions.selection(), edits = f.edits(10);
    const result = f.controller.actions.propose(base, edits, 'Fictional move');
    assert.equal(result.kind, 'proposed');
    edits[0].record.x = 77;
    const proposal = f.controller.getSnapshot().proposals[0];
    assert.equal(proposal.before.store[shapeId].x, 5);
    assert.equal(proposal.after.store[shapeId].x, 10);
    assert.equal(proposal.edits[0].record.x, 10);
    assert.ok(Object.isFrozen(proposal.after.store[shapeId]));
    assert.equal(f.store.get(shapeId).x, 5); assert.equal(f.writes, 0);
    const saved = await f.controller.actions.accept(proposal.id);
    assert.deepEqual(f.store.getStoreSnapshot('document'), proposal.after);
    assert.equal(saved.kind, 'saved');
    assert.equal(saved.selection.target.subject.bufferVersion, f.controller.getSnapshot().bufferVersion);
    assert.equal(f.store.get(shapeId).x, 10);
    assert.equal((await f.published()).store[shapeId].x, 10);
    assert.equal(f.controller.getSnapshot().dirty, false);
    assert.equal(f.controller.getSnapshot().proposals[0].adopted, true);
    assert.equal(f.writes, 1);
    assert.equal((await f.controller.actions.accept(proposal.id)).kind, 'conflict');
  });

  await t.test('new documents and no-op edits use the actual adopted buffer version', async t => {
    const f = await fixture(t, { saved: false });
    const base = f.controller.actions.selection(), id = f.propose(0);
    const saved = await f.controller.actions.accept(id);
    assert.equal(saved.kind, 'saved');
    assert.equal(saved.selection.target.subject.bufferVersion, base.target.subject.bufferVersion);
    assert.equal(f.controller.getSnapshot().dirty, false);
    assert.equal((await f.published()).store[shapeId].x, 0);
  });

  await t.test('intervening edits and all target identity fields refuse adoption without changing the draft', async t => {
    const f = await fixture(t), base = f.controller.actions.selection(), id = f.propose(10);
    for (const change of [x => { x.target.instanceId += '-other'; }, x => { x.target.epoch += '-other'; }, x => { x.target.subject.scopeId += '-other'; },
      x => { x.target.subject.bufferVersion++; }, x => { x.target.subject.base.target.resource.path += '.other'; },
      x => { x.target.subject.base.target.revision += '-other'; }, x => { x.target.subject.base.target.resource.providerId += '-other'; },
      x => { x.target.subject.base.target.view = { kind: 'working', viewId: 'other' }; }]) {
      const wrong = structuredClone(base); change(wrong);
      assert.equal(f.controller.actions.propose(wrong, f.edits(15)).kind, 'stale');
    }
    f.move(50);
    assert.equal((await f.controller.actions.accept(id)).kind, 'conflict');
    assert.equal(f.store.get(shapeId).x, 50); assert.equal(f.writes, 0);
    assert.equal(f.controller.getSnapshot().proposals.length, 1);
  });

  await t.test('reject, readonly and disposed controllers never adopt or publish', async t => {
    const f = await fixture(t), id = f.propose(10);
    f.controller.actions.reject(id);
    assert.equal(f.controller.getSnapshot().proposals.length, 0);
    assert.equal((await f.controller.actions.accept(id)).kind, 'conflict');
    const readonly = await fixture(t, { readOnly: true });
    assert.equal(readonly.controller.actions.propose(readonly.controller.actions.selection(), readonly.edits(20)).kind, 'denied');
    assert.equal((await readonly.controller.actions.accept('absent')).kind, 'denied');
    const base = f.controller.actions.selection(); f.controller.dispose();
    assert.equal(f.controller.actions.propose(base, f.edits(20)).kind, 'unavailable');
    assert.equal((await f.controller.actions.accept(id)).kind, 'unavailable');
    assert.equal(f.writes + readonly.writes, 0);
    f.move(88); assert.equal(f.store.get(shapeId).x, 88);
  });

  await t.test('reentrant subscriber edits during adoption remain drafts and are never published', async t => {
    const f = await fixture(t), id = f.propose(10);
    let nested;
    const remove = f.controller.subscribe(() => {
      if (f.store.get(shapeId).x !== 10) return;
      nested = f.controller.actions.accept(id);
      f.move(99);
    });
    const result = await f.controller.actions.accept(id); remove();
    assert.equal(result.kind, 'conflict');
    assert.equal((await nested).kind, 'unavailable');
    assert.equal(f.store.get(shapeId).x, 99);
    assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal((await f.published()).store[shapeId].x, 0); assert.equal(f.writes, 0);
  });

  await t.test('native document observers can change adoption synchronously and prevent publication', async t => {
    const f = await fixture(t), id = f.propose(10);
    let observed = false;
    const remove = f.store.listen(() => {
      if (!observed && f.store.get(shapeId).x === 10) { observed = true; f.move(99); }
    }, { scope: 'document', source: 'all' });
    const result = await f.controller.actions.accept(id); remove();
    assert.equal(observed, true, 'actual native store listener must observe adoption');
    assert.equal(result.kind, 'conflict');
    assert.equal((await f.published()).store[shapeId].x, 0);
    assert.equal(f.store.get(shapeId).x, 99); assert.equal(f.controller.getSnapshot().document.store[shapeId].x, 99);
    assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal(f.writes, 0);
  });

  await t.test('multiple reentrant versions ending at the exact candidate flush their actual selection', async t => {
    const f = await fixture(t), base = f.controller.actions.selection(), id = f.propose(10);
    let edited = false;
    const remove = f.controller.subscribe(() => {
      if (edited || f.store.get(shapeId).x !== 10) return;
      edited = true; f.move(99); f.move(10);
    });
    const result = await f.controller.actions.accept(id); remove();
    assert.equal(result.kind, 'saved');
    assert.ok(result.selection.target.subject.bufferVersion > base.target.subject.bufferVersion + 1);
    assert.equal(result.selection.target.subject.bufferVersion, f.controller.getSnapshot().bufferVersion);
    assert.equal((await f.published()).store[shapeId].x, 10);
  });

  await t.test('disposal during adoption leaves the borrowed store alive and causes no publication', async t => {
    const f = await fixture(t), id = f.propose(10);
    f.controller.subscribe(() => { if (f.controller.getSnapshot().proposals[0].adopted) f.controller.dispose(); });
    assert.equal((await f.controller.actions.accept(id)).kind, 'unavailable');
    assert.equal(f.writes, 0); f.move(90); assert.equal(f.store.get(shapeId).x, 90);
  });

  await t.test('pending acceptance and late acknowledgement retain newer native edits', async t => {
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const f = await fixture(t, { publish: async (request, client) => { entered.resolve(); await release.promise; return client.publish(request); } });
    const id = f.propose(10), saving = f.controller.actions.accept(id); await Promise.race([entered.promise, saving.then(result => { throw new Error(`Save never dispatched: ${JSON.stringify(result)}`); })]);
    f.move(50); const next = f.propose(60);
    assert.equal((await f.controller.actions.accept(next)).kind, 'unknown');
    assert.equal(f.store.get(shapeId).x, 50);
    release.resolve(); const result = await saving;
    assert.equal(result.kind, 'saved');
    assert.equal((await f.published()).store[shapeId].x, 10);
    assert.equal(f.store.get(shapeId).x, 50); assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal((await f.controller.actions.accept(next)).kind, 'conflict'); assert.equal(f.writes, 1);
  });

  await t.test('denied publication keeps the adopted candidate dirty without reapplying its proposal', async t => {
    const f = await fixture(t, { publish: async () => ({ kind: 'denied', reason: 'Fictional policy' }) });
    const id = f.propose(10);
    assert.equal((await f.controller.actions.accept(id)).kind, 'denied');
    assert.equal(f.store.get(shapeId).x, 10); assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal((await f.controller.actions.accept(id)).kind, 'conflict'); assert.equal(f.writes, 1);
    assert.equal((await f.published()).store[shapeId].x, 0);
  });

  await t.test('unknown acceptance reconciles exact committed bytes and abandon preserves an uncommitted draft', async t => {
    const committed = await fixture(t, { publish: async (request, client) => { await client.publish(request); throw new Error('Lost acknowledgement'); } });
    assert.equal((await committed.controller.actions.accept(committed.propose(10))).kind, 'unknown');
    committed.move(40);
    assert.equal((await committed.controller.actions.accept(committed.propose(50))).kind, 'unknown');
    assert.equal((await committed.controller.actions.reconcile()).kind, 'saved');
    assert.equal(committed.store.get(shapeId).x, 40); assert.equal(committed.writes, 1);
    const uncommitted = await fixture(t, { publish: async () => { throw new Error('Lost connection'); } });
    assert.equal((await uncommitted.controller.actions.accept(uncommitted.propose(10))).kind, 'unknown');
    assert.equal((await uncommitted.controller.actions.abandon()).kind, 'available');
    assert.equal(uncommitted.store.get(shapeId).x, 10); assert.equal(uncommitted.writes, 1);
    assert.equal(uncommitted.controller.getSnapshot().dirty, true);
  });

  await t.test('reentrant edit parsing refuses a stale proposal before retaining it', async t => {
    const f = await fixture(t), base = f.controller.actions.selection(), wanted = f.edits(10)[0].record;
    const edits = [{ kind: 'update', get record() { f.move(50); return wanted; } }];
    assert.equal(f.controller.actions.propose(base, edits).kind, 'stale');
    assert.equal(f.controller.getSnapshot().proposals.length, 0);
    assert.equal(f.store.get(shapeId).x, 50); assert.equal(f.writes, 0);
  });

  await t.test('no-op adoption notification cannot publish a reentrant human edit', async t => {
    const f = await fixture(t), id = f.propose(0);
    let edited = false;
    const remove = f.controller.subscribe(() => {
      if (!edited && f.controller.getSnapshot().proposals[0].adopted) { edited = true; f.move(70); }
    });
    assert.equal((await f.controller.actions.accept(id)).kind, 'conflict'); remove();
    assert.equal(f.store.get(shapeId).x, 70); assert.equal(f.writes, 0);
  });

  await t.test('ordinary headless commands inspect exact dirty state and validate proposals, expiry and cancellation', async t => {
    const f = await fixture(t); f.move(5);
    const target = f.controller.actions.selection().target;
    const inspected = await f.controller.tools.inspect.invoke(target, deadline());
    assert.equal(inspected.kind, 'applied'); assert.equal(inspected.value.dirty, true);
    assert.equal(inspected.value.document.store[shapeId].x, 5); assert.ok(Object.isFrozen(inspected.value.document));
    const input = { ...deadline(), edits: f.edits(10), summary: 'Fictional proposal' };
    assert.equal((await f.controller.tools.propose.invoke(target, input, AbortSignal.abort())).kind, 'denied');
    assert.equal((await f.controller.tools.propose.invoke(target, { ...input, expiresAt: 0 })).kind, 'stale');
    assert.equal(f.controller.getSnapshot().proposals.length, 0);
    const result = await f.controller.tools.propose.invoke(target, input);
    assert.equal(result.kind, 'proposed'); assert.equal(f.writes, 0); assert.equal(f.store.get(shapeId).x, 5);
    f.move(7);
    assert.equal((await f.controller.tools.inspect.invoke(target, deadline())).kind, 'stale');
    assert.throws(() => f.controller.tools.propose.input.parse({ ...input, edits: [{ kind: 'remove', id: 'page:fictional' }] }));
    assert.throws(() => parseCanvasEdits([{ kind: 'update', record: { ...f.store.get(shapeId), x: 'bad' } }], f.store.schema));
    assert.throws(() => parseCanvasEdits([{ kind: 'remove', id: shapeId }, { kind: 'remove', id: shapeId }], f.store.schema));
  });
});
