import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { openRedactionFixture, redactionActor } from '../../examples/redaction/app.mjs';

const gate = () => Promise.withResolvers();
const encode = value => new TextEncoder().encode(value);
const decode = bytes => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
const actor = redactionActor();
const access = identity => ({ scopeId: identity.scopeId, principalId: identity.principalId, initiatorId: identity.initiatorId });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'boring-redaction-'));
  const app = await openRedactionFixture({ directory, ...options });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const provider = app.local.provider;
  const locations = app.paths('A');
  const seeded = await provider.publication.publish({ operationId: 'fictional-inputs', atomicity: 'all-or-nothing',
    changes: [
      { kind: 'create', target: locations.source, expected: { kind: 'absent' }, bytes: encode('Original fictional source'), mediaType: 'text/markdown' },
      { kind: 'create', target: locations.config, expected: { kind: 'absent' },
        bytes: encode(JSON.stringify({ format: 'fictional.redaction', version: 1, prefix: '# Fictional' })), mediaType: 'application/json' },
    ] }, access(actor));
  assert.equal(seeded.kind, 'committed');
  const count = async () => {
    const storage = await openNodeSqliteStorage(join(directory, 'native.sqlite'));
    try {
      let total = 0, cursor;
      do {
        const page = await storage.scanTasks({}, 100, cursor, context);
        total += page.items.length; cursor = page.next;
      } while (cursor !== undefined);
      return total;
    } finally { await storage.close(context); }
  };
  const capture = async (subject, requestId, identity = actor) => {
    const result = await app.capture(subject, requestId, identity);
    assert.equal(result.kind, 'captured'); return result.request;
  };
  const read = (target, identity = actor) => provider.read({ target, revision: { kind: 'latest' } }, access(identity));
  return { app, provider, capture, read, count, seeded };
}

test('one provider batch reserves the request and generation guard before native producer and delivery', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const request = await f.capture('A', 'first');
  const admitted = await f.app.admit(request, actor);
  assert.equal(admitted.kind, 'admitted');
  assert.equal(admitted.ref.subject, 'A'); assert.equal(admitted.ref.requestId, 'first');
  assert.equal(admitted.ref.instanceId, f.app.instanceId);
  assert.equal(typeof admitted.ref.generationId, 'string'); assert.ok(admitted.ref.generationId.length > 0);
  assert.notEqual(admitted.ref.producer, admitted.ref.delivery);
  const reservation = await f.provider.read({ target: admitted.ref.reservation,
    revision: { kind: 'exact', value: admitted.ref.reservation.revision } }, access(actor));
  const guard = await f.provider.read({ target: admitted.ref.guard,
    revision: { kind: 'exact', value: admitted.ref.guard.revision } }, access(actor));
  assert.equal(reservation.kind, 'available'); assert.equal(guard.kind, 'available');
  assert.match(decode(reservation.snapshot.bytes), /first/);
  assert.match(decode(guard.snapshot.bytes), new RegExp(admitted.ref.generationId));
  const batch = await f.provider.reconciliation.lookup(JSON.stringify([
    'fictional.redaction.reserve.v1', f.app.instanceId, 'A', 'first',
  ]), access(actor));
  assert.equal(batch.kind, 'committed');
  assert.equal(batch.receipt.changes.length, 2);
  assert.deepEqual(batch.receipt.changes.map(change => change.after), [admitted.ref.reservation, admitted.ref.guard]);
  const tasks = await f.app.local.harness.getTask(admitted.ref.delivery, context);
  assert.equal(tasks.id, admitted.ref.delivery);
  await f.app.local.harness.waitForTask(admitted.ref.delivery, context);
  const output = await f.read(f.app.paths('A').output);
  assert.equal(output.kind, 'available');
  assert.equal(decode(output.snapshot.bytes), '# Fictional A\nOriginal fictional source');
  assert.equal(await f.count(), 2);
});

test('same request retains generation and native pair; actor, body and config changes cannot advance its guard', { timeout: 20000 }, async t => {
  const f = await fixture(t), selected = await f.capture('A', 'stable');
  const original = await f.app.admit(selected, actor);
  assert.equal(original.kind, 'admitted');
  assert.deepEqual(await f.app.admit(selected, actor), original);
  const beforeGuard = await f.read(f.app.paths('A').generation);
  assert.equal(beforeGuard.kind, 'available');
  const secondActor = redactionActor({ principalId: 'fictional-editor-2', initiatorId: 'fictional-human-2' });
  assert.equal((await f.app.admit(selected, secondActor)).kind, 'conflict');
  assert.equal((await f.app.admit(selected, redactionActor({ initiatorId: 'fictional-human-2' }))).kind, 'conflict');
  const sourceChange = await f.provider.publication.publish({ operationId: 'new-source', atomicity: 'all-or-nothing',
    changes: [{ kind: 'replace', target: selected.source, bytes: encode('A changed fictional source'), mediaType: 'text/markdown' }] }, access(actor));
  assert.equal(sourceChange.kind, 'committed');
  const changedBody = await f.capture('A', 'stable');
  assert.equal((await f.app.admit(changedBody, actor)).kind, 'conflict');
  const configChange = await f.provider.publication.publish({ operationId: 'new-config', atomicity: 'all-or-nothing',
    changes: [{ kind: 'replace', target: selected.config,
      bytes: encode(JSON.stringify({ format: 'fictional.redaction', version: 1, prefix: '# Fictional' })), mediaType: 'application/json' }] }, access(actor));
  assert.equal(configChange.kind, 'committed');
  const changedConfig = await f.capture('A', 'stable');
  assert.equal((await f.app.admit(changedConfig, actor)).kind, 'conflict');
  assert.deepEqual((await f.read(f.app.paths('A').generation)).snapshot.ref, beforeGuard.snapshot.ref);
  assert.equal(await f.count(), 2);
});

test('concurrent starts with one selected guard have one winner and no substitute reservation', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const left = await f.capture('A', 'left'), right = await f.capture('A', 'right');
  const results = await Promise.all([f.app.admit(left, actor), f.app.admit(right, actor)]);
  assert.equal(results.filter(result => result.kind === 'admitted').length, 1);
  const winner = results.find(result => result.kind === 'admitted');
  assert.equal((await f.app.admit(winner.ref.requestId === 'left' ? left : right, actor)).ref.generationId, winner.ref.generationId);
  assert.equal((await f.app.admit(winner.ref.requestId === 'left' ? right : left, actor)).kind, 'conflict');
  assert.equal(await f.count(), 2);
});

test('A, B and C complete in another order without sibling guard conflicts', { timeout: 20000 }, async t => {
  const entered = { A: gate(), B: gate(), C: gate() }, release = { A: gate(), B: gate(), C: gate() };
  const f = await fixture(t, { beforeProduce: async input => {
    entered[input.request.subject].resolve(); await release[input.request.subject].promise;
  } });
  const references = {};
  for (const subject of ['A', 'B', 'C']) {
    const admitted = await f.app.admit(await f.capture(subject, `subject-${subject.toLowerCase()}`), actor);
    assert.equal(admitted.kind, 'admitted'); references[subject] = admitted.ref;
  }
  await Promise.all(Object.values(entered).map(value => value.promise));
  for (const subject of ['C', 'A', 'B']) {
    release[subject].resolve();
    const done = await f.app.local.harness.waitForTask(references[subject].delivery, context);
    assert.equal(done.state.outcome.status, 'completed');
    const saved = await f.read(f.app.paths(subject).output);
    assert.equal(saved.kind, 'available');
    assert.equal(decode(saved.snapshot.bytes), `# Fictional ${subject}\nOriginal fictional source`);
  }
  assert.equal(await f.count(), 6);
});

test('an edit arriving while the producer runs blocks delivery but remains readable', { timeout: 20000 }, async t => {
  const entered = gate(), release = gate();
  const f = await fixture(t, { beforeProduce: async () => { entered.resolve(); await release.promise; } });
  const selected = await f.capture('B', 'human-edit');
  const admitted = await f.app.admit(selected, actor);
  assert.equal(admitted.kind, 'admitted'); await entered.promise;
  const edit = await f.provider.publication.publish({ operationId: 'human-edit', atomicity: 'all-or-nothing',
    changes: [{ kind: 'create', target: f.app.paths('B').edit, expected: { kind: 'absent' },
      bytes: encode('Doctor correction'), mediaType: 'text/markdown' }] }, access(actor));
  assert.equal(edit.kind, 'committed');
  release.resolve();
  const delivery = await f.app.local.harness.waitForTask(admitted.ref.delivery, context);
  assert.equal(delivery.state.outcome.status, 'completed');
  assert.equal(delivery.state.outcome.result.kind, 'conflict');
  assert.equal((await f.read(f.app.paths('B').output)).kind, 'missing');
  assert.equal(decode((await f.read(f.app.paths('B').edit)).snapshot.bytes), 'Doctor correction');
});

test('admission captures mutable request fields and policy revocation prevents new native work', { timeout: 20000 }, async t => {
  let permitted = true;
  const f = await fixture(t, { policy: () => permitted });
  const selected = await f.capture('A', 'mutable');
  const revoked = await f.capture('B', 'revoked');
  const offered = structuredClone(selected), original = structuredClone(selected);
  const pending = f.app.admit(offered, actor);
  offered.source.revision = 'changed-by-caller';
  const admitted = await pending;
  assert.equal(admitted.kind, 'admitted');
  const reservation = await f.provider.read({ target: admitted.ref.reservation,
    revision: { kind: 'exact', value: admitted.ref.reservation.revision } }, access(actor));
  assert.equal(reservation.kind, 'available');
  assert.match(decode(reservation.snapshot.bytes), new RegExp(original.source.revision));
  permitted = false;
  const taskCount = await f.count();
  assert.equal((await f.app.admit(revoked, actor)).kind, 'denied');
  assert.equal(await f.count(), taskCount);
  assert.equal((await f.read(f.app.paths('B').output)).kind, 'denied');
});

test('revoking admission during the input read prevents reservation and native tasks', { timeout: 20000 }, async t => {
  let armed = false, canAdmit = true;
  const f = await fixture(t, { policy: (_actor, action) => {
    if (action === 'read' && armed) { armed = false; canAdmit = false; }
    return action !== 'admit' || canAdmit;
  } });
  const selected = await f.capture('C', 'read-revoked');
  armed = true;
  const outcome = await f.app.admit(selected, actor);
  assert.equal(outcome.kind, 'denied');
  assert.equal((await f.read(f.app.paths('C').generation)).kind, 'missing');
  assert.equal(await f.count(), 0);
});

test('concurrent identical requests adopt one original generation and native pair', { timeout: 20000 }, async t => {
  const f = await fixture(t), request = await f.capture('A', 'same-request');
  const outcomes = await Promise.all(Array.from({ length: 4 }, () => f.app.admit(request, actor)));
  assert.equal(outcomes[0].kind, 'admitted');
  for (const result of outcomes) assert.deepEqual(result, outcomes[0]);
  assert.equal(await f.count(), 2);
});

test('concurrent actors cannot share a request ID and advance the same generation twice', { timeout: 20000 }, async t => {
  const f = await fixture(t), request = await f.capture('B', 'same-request');
  const other = redactionActor({ principalId: 'fictional-editor-2', initiatorId: 'fictional-human-2' });
  const outcomes = await Promise.all([f.app.admit(request, actor), f.app.admit(request, other)]);
  assert.deepEqual(outcomes.map(result => result.kind).sort(), ['admitted', 'conflict']);
  const winner = outcomes.find(result => result.kind === 'admitted');
  assert.deepEqual((await f.read(f.app.paths('B').generation)).snapshot.ref, winner.ref.guard);
  const delivered = await f.app.local.harness.waitForTask(winner.ref.delivery, context);
  assert.equal(delivered.state.outcome.result.receipt.principalId, winner.ref.actor.principalId);
  assert.equal(delivered.state.outcome.result.receipt.initiatorId, winner.ref.actor.initiatorId);
  assert.equal(await f.count(), 2);
});

test('read revocation after reservation commit reports partial admission without protected references', { timeout: 20000 }, async t => {
  let readable = true, receipt;
  const f = await fixture(t, { policy: (_actor, action) => action !== 'read' || readable,
    afterReservationCommit: async result => { receipt = result; readable = false; } });
  const request = await f.capture('C', 'commit-then-revoke');
  assert.deepEqual(await f.app.admit(request, actor), { kind: 'reserved' });
  assert.equal(receipt.kind, 'committed');
  assert.equal(await f.count(), 0);
  readable = true;
  assert.deepEqual((await f.read(f.app.paths('C').generation)).snapshot.ref, receipt.receipt.changes[1].after);
  assert.deepEqual(await f.provider.reconciliation.lookup(receipt.receipt.operationId, actor), receipt);
  const recovered = await f.app.admit(request, actor);
  assert.equal(recovered.kind, 'admitted');
  assert.deepEqual(recovered.ref.guard, receipt.receipt.changes[1].after);
});

test('read revocation after native admission hides references and retry retains the original pair', { timeout: 20000 }, async t => {
  let readable = true, original;
  const f = await fixture(t, { policy: (_actor, action) => action !== 'read' || readable,
    afterAdmission: async ref => { original ??= ref; readable = false; } });
  const request = await f.capture('A', 'admit-then-revoke');
  assert.deepEqual(await f.app.admit(request, actor), { kind: 'unknown' });
  assert.equal(await f.count(), 2);
  readable = true;
  assert.deepEqual(await f.app.admit(request, actor), { kind: 'unknown' });
  assert.equal(await f.count(), 2);
  readable = true;
  assert.deepEqual((await f.read(f.app.paths('A').generation)).snapshot.ref, original.guard);
});

test('capture rechecks read permission after its awaited resource reads', { timeout: 20000 }, async t => {
  let readable = true, armed = false;
  const f = await fixture(t, { policy: (_actor, action, target) => {
    if (armed && action === 'read' && target?.resource.path.endsWith('/A/output.md')) {
      armed = false;
      queueMicrotask(() => { readable = false; });
    }
    return action !== 'read' || readable;
  } });
  armed = true;
  assert.deepEqual(await f.app.capture('A', 'capture-revoked', actor), { kind: 'denied' });
  assert.equal(await f.count(), 0);
});
