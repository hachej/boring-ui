import assert from 'node:assert/strict';
import test from 'node:test';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { createExperienceDocumentController } from '@hachej/boring-ui-kit/experience/document';

const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
const cell = { ref: 'fictional/notes', kind: 'fictional/document', version: 1 };
const target = path => ({ resource: { providerId: 'layouts', path }, view: { kind: 'published' } });
const select = path => ({ target: target(path), revision: { kind: 'latest' } });
const encode = text => new TextEncoder().encode(text);
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const layout = (name = 'initial', source = 'fixed') => ({
  format: 'boring.experience', version: 1, name, source,
  kinds: { 'boring/stack': 1, 'boring/cell': 1, 'fictional/document': 1 },
  root: 'page', elements: {
    page: { type: 'boring/stack', props: {}, children: ['notes'] },
    notes: { type: 'boring/cell', props: { ref: cell.ref }, children: [] },
  },
});
const text = value => JSON.stringify(value) + '\n';

async function fixture(t, initial = layout(), options = {}) {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'layouts', authorize: options.authorize ?? (() => true) });
  t.after(() => provider.close());
  const client = {
    read: request => provider.read(request, identity),
    publish: request => provider.publication.publish(request, identity),
    lookup: operationId => provider.reconciliation.lookup(operationId, identity),
  };
  let source;
  if (initial === null) source = { kind: 'new', target: target('experience/page.json') };
  else if (options.newDraft) source = { kind: 'new', target: target('experience/page.json'), descriptor: initial };
  else {
    assert.equal((await client.publish({ operationId: 'seed-layout', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: target('experience/page.json'), expected: { kind: 'absent' }, bytes: encode(text(initial)), mediaType: options.mediaType ?? 'application/json' }] })).kind, 'committed');
    source = { kind: 'saved', snapshot: (await client.read(select('experience/page.json'))).snapshot };
  }
  const make = extra => createExperienceDocumentController({ identity, instanceId: 'layout-viewer', epoch: 'page', source, client,
    cells: [cell], canView: () => true, ...extra });
  return { provider, client, source, make };
}

test('new derived draft is local until exact Keep creates a fixed revision and receipt', async t => {
  const { client, make } = await fixture(t, layout('derived-page', 'derived'), { newDraft: true });
  let publications = 0;
  const controller = make({ client: { ...client, publish: request => { publications++; return client.publish(request); } } });
  t.after(() => controller.dispose());
  assert.equal(controller.getSnapshot().base.kind, 'absent');
  assert.equal(controller.getSnapshot().descriptor.source, 'fixed');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(publications, 0);
  assert.equal((await client.read(select('experience/page.json'))).kind, 'missing');
  const selected = controller.actions.selection();
  const result = await controller.flush(selected);
  assert.equal(result.kind, 'saved');
  assert.deepEqual(result.selection, selected);
  assert.equal(result.receipt.changes[0].kind, 'create');
  assert.equal(result.receipt.changes[0].before, null);
  assert.deepEqual(await client.lookup(result.receipt.operationId), { kind: 'committed', receipt: result.receipt });
  const saved = await client.read(select('experience/page.json'));
  assert.equal(saved.kind, 'available');
  assert.equal(saved.snapshot.mediaType, 'application/json');
  assert.equal(JSON.parse(decode(saved.snapshot.bytes)).source, 'fixed');
  assert.deepEqual(saved.snapshot.ref, result.ref);
  assert.equal(controller.getSnapshot().dirty, false);
  assert.equal(publications, 1);
});

test('an offer does not change the selected layout or publish; adoption and Keep are separate', async t => {
  const { client, make } = await fixture(t);
  let publications = 0;
  const controller = make({ client: { ...client, publish: request => { publications++; return client.publish(request); } } });
  t.after(() => controller.dispose());
  const before = controller.getSnapshot(), selected = controller.actions.selection();
  const proposed = layout('proposed-page', 'derived');
  const offer = controller.actions.propose(selected, proposed);
  assert.equal(offer.kind, 'proposed');
  proposed.name = 'mutated-after-offer';
  assert.equal(controller.getSnapshot().descriptor.name, 'initial');
  assert.equal(controller.getSnapshot().text, before.text);
  assert.equal(controller.getSnapshot().bufferVersion, before.bufferVersion);
  assert.equal(controller.getSnapshot().proposal.descriptor.name, 'proposed-page');
  assert.equal(publications, 0);
  assert.throws(() => { controller.getSnapshot().proposal.descriptor.name = 'tampered'; }, TypeError);
  const adopted = controller.actions.adopt(offer.proposalId);
  assert.equal(adopted.kind, 'applied');
  assert.equal(adopted.value.target.subject.bufferVersion, selected.target.subject.bufferVersion + 1);
  assert.equal(controller.getSnapshot().descriptor.name, 'proposed-page');
  assert.equal(controller.getSnapshot().descriptor.source, 'fixed');
  assert.equal(controller.getSnapshot().proposal, null);
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(publications, 0);
  assert.equal((await controller.flush(selected)).kind, 'conflict');
  const saved = await controller.flush(adopted.value);
  assert.equal(saved.kind, 'saved');
  assert.equal(JSON.parse(decode((await client.read(select('experience/page.json'))).snapshot.bytes)).name, 'proposed-page');
  assert.equal(publications, 1);
});

test('stale and cross-instance offers refuse without writing or changing the current draft', async t => {
  const { client, make } = await fixture(t);
  const controller = make(); t.after(() => controller.dispose());
  const other = make({ instanceId: 'other-viewer' }); t.after(() => other.dispose());
  assert.equal(controller.actions.propose(other.actions.selection(), layout('wrong-owner')).kind, 'stale');
  const changedScope = structuredClone(controller.actions.selection()); changedScope.target.subject.scopeId = 'other-scope';
  assert.equal(controller.actions.propose(changedScope, layout('wrong-scope')).kind, 'stale');
  const oldSelection = controller.actions.selection();
  const old = controller.actions.propose(oldSelection, layout('older', 'derived'));
  const newer = controller.actions.propose(controller.actions.selection(), layout('newer', 'derived'));
  assert.equal(controller.actions.adopt(old.proposalId).kind, 'stale');
  controller.actions.reject(old.proposalId);
  assert.equal(controller.getSnapshot().proposal.id, newer.proposalId);
  const adopted = controller.actions.adopt(newer.proposalId);
  assert.equal(adopted.kind, 'applied');
  assert.equal(controller.actions.propose(oldSelection, layout('stale')).kind, 'stale');
  assert.equal(controller.getSnapshot().descriptor.name, 'newer');
  assert.equal(decode((await client.read(select('experience/page.json'))).snapshot.bytes), text(layout()));
});

test('saved sources require fixed strict UTF-8 JSON and a new empty document cannot Keep', async t => {
  const { source, make } = await fixture(t);
  for (const snapshot of [
    { ...source.snapshot, mediaType: 'text/plain' },
    { ...source.snapshot, bytes: Uint8Array.of(0xff) },
    { ...source.snapshot, bytes: encode(text(layout('derived-saved', 'derived'))) },
    { ...source.snapshot, bytes: encode('{"format":"boring.experience","version":1,"name":"broken"}') },
  ]) assert.throws(() => make({ source: { kind: 'saved', snapshot } }));
  const empty = await fixture(t, null);
  const controller = empty.make(); t.after(() => controller.dispose());
  assert.equal(controller.getSnapshot().descriptor, null);
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'denied');
  assert.equal((await empty.client.read(select('experience/page.json'))).kind, 'missing');
});

test('read-only and disposed controllers cannot offer, adopt or Keep and retain borrowed access', async t => {
  const { client, make } = await fixture(t);
  const controller = make({ readOnly: true });
  assert.equal(controller.actions.propose(controller.actions.selection(), layout('later')).kind, 'denied');
  assert.equal(controller.actions.adopt('unknown').kind, 'denied');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'denied');
  controller.dispose();
  assert.equal(controller.getSnapshot().lifecycle, 'disposed');
  assert.equal(controller.actions.propose(controller.actions.selection(), layout('later')).kind, 'unavailable');
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unavailable');
  assert.equal((await client.read(select('experience/page.json'))).kind, 'available');
});

test('lost acknowledgement reconciles one original operation despite revoked draft visibility', async t => {
  const { client, make } = await fixture(t);
  let publications = 0, visible = true;
  const controller = make({ canView: () => visible, client: { ...client, publish: async request => {
    publications++; await client.publish(request); throw new Error('Fictional reply loss');
  } } }); t.after(() => controller.dispose());
  const offer = controller.actions.propose(controller.actions.selection(), layout('kept', 'derived'));
  const adopted = controller.actions.adopt(offer.proposalId);
  const unknown = await controller.flush(adopted.value);
  assert.equal(unknown.kind, 'unknown');
  visible = false;
  assert.equal((await controller.flush(adopted.value)).operationId, unknown.operationId);
  const recovered = await controller.actions.reconcile();
  assert.equal(recovered.kind, 'saved');
  assert.equal(recovered.receipt.operationId, unknown.operationId);
  assert.equal(publications, 1);
  assert.equal(JSON.parse(decode((await client.read(select('experience/page.json'))).snapshot.bytes)).name, 'kept');
});

test('late acknowledgement retains a newer adopted draft and its offered successor', async t => {
  const { client, make } = await fixture(t);
  const committed = Promise.withResolvers(), release = Promise.withResolvers();
  const controller = make({ client: { ...client, publish: async request => {
    const result = await client.publish(request); committed.resolve(); await release.promise; return result;
  } } }); t.after(() => controller.dispose());
  const first = controller.actions.propose(controller.actions.selection(), layout('first', 'derived'));
  const selected = controller.actions.adopt(first.proposalId).value;
  const pending = controller.flush(selected);
  await committed.promise;
  const second = controller.actions.propose(controller.actions.selection(), layout('second', 'derived'));
  assert.equal(controller.actions.adopt(second.proposalId).kind, 'applied');
  const third = controller.actions.propose(controller.actions.selection(), layout('third', 'derived'));
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unknown');
  release.resolve();
  assert.equal((await pending).kind, 'saved');
  assert.equal(controller.getSnapshot().descriptor.name, 'second');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(controller.getSnapshot().proposal.id, third.proposalId);
  assert.equal(JSON.parse(decode((await client.read(select('experience/page.json'))).snapshot.bytes)).name, 'first');
});

test('current visibility and provider denial refuse Keep without forging a receipt', async t => {
  let authorized = true;
  const { client, make } = await fixture(t, layout(), { authorize: action => authorized });
  let visible = true;
  const controller = make({ canView: () => visible }); t.after(() => controller.dispose());
  const offer = controller.actions.propose(controller.actions.selection(), layout('restricted', 'derived'));
  visible = false;
  assert.equal(controller.actions.adopt(offer.proposalId).kind, 'denied');
  assert.equal(controller.getSnapshot().descriptor.name, 'initial');
  const allowed = make({ instanceId: 'denied-viewer' });
  t.after(() => allowed.dispose());
  const chosen = allowed.actions.adopt(allowed.actions.propose(allowed.actions.selection(), layout('local', 'derived')).proposalId);
  authorized = false;
  assert.equal((await allowed.flush(chosen.value)).kind, 'denied');
  assert.equal(allowed.getSnapshot().dirty, true);
  authorized = true;
  assert.equal(JSON.parse(decode((await client.read(select('experience/page.json'))).snapshot.bytes)).name, 'initial');
});

test('reentrant validation and listeners cannot silently adopt stale work', async t => {
  const { client, make } = await fixture(t);
  let controller, callback = () => true;
  controller = make({ canView: ref => callback(ref) }); t.after(() => controller.dispose());
  const old = controller.actions.selection();
  callback = () => { controller.dispose(); return true; };
  assert.equal(controller.actions.propose(old, layout('raced', 'derived')).kind, 'stale');
  assert.equal(JSON.parse(decode((await client.read(select('experience/page.json'))).snapshot.bytes)).name, 'initial');

  const second = make({ instanceId: 'listener-viewer' }); t.after(() => second.dispose());
  const offer = second.actions.propose(second.actions.selection(), layout('adopted', 'derived'));
  let listenerOffer, entered = false;
  const unsubscribe = second.subscribe(() => {
    if (second.getSnapshot().descriptor?.name === 'adopted' && !entered) {
      entered = true;
      listenerOffer = second.actions.propose(second.actions.selection(), layout('later', 'derived'));
    }
  });
  const adopted = second.actions.adopt(offer.proposalId);
  unsubscribe();
  assert.equal(adopted.kind, 'applied');
  assert.equal(listenerOffer.kind, 'proposed');
  assert.equal(second.getSnapshot().proposal.id, listenerOffer.proposalId);
  assert.equal((await second.flush(adopted.value)).kind, 'saved');
  assert.equal(JSON.parse(decode((await client.read(select('experience/page.json'))).snapshot.bytes)).name, 'adopted');
});

test('a validation callback during refresh cannot replace a newly adopted local layout', async t => {
  const { client, make } = await fixture(t);
  let controller, reenter = false;
  controller = make({ canView: () => {
    if (reenter) {
      reenter = false;
      const adopted = controller.actions.adopt(controller.getSnapshot().proposal.id);
      assert.equal(adopted.kind, 'applied');
    }
    return true;
  } });
  t.after(() => controller.dispose());
  const offered = controller.actions.propose(controller.actions.selection(), layout('local-draft', 'derived'));
  assert.equal(offered.kind, 'proposed');
  const current = (await client.read(select('experience/page.json'))).snapshot.ref;
  const remote = await client.publish({ operationId: 'remote-layout', atomicity: 'all-or-nothing', changes: [
    { kind: 'replace', target: current, bytes: encode(text(layout('remote-change'))), mediaType: 'application/json' },
  ] });
  assert.equal(remote.kind, 'committed');
  reenter = true;
  assert.equal((await controller.actions.refresh()).kind, 'available');
  assert.equal(controller.getSnapshot().descriptor.name, 'local-draft');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(controller.getSnapshot().proposal, null);
  assert.equal(JSON.parse(decode((await client.read(select('experience/page.json'))).snapshot.bytes)).name, 'remote-change');
});

test('nested adoption during decode returns the actual second buffer selection', async t => {
  const { client, make } = await fixture(t);
  let controller, armed = false, calls = 0, nested;
  controller = make({ canView: () => {
    if (armed && ++calls === 2) {
      armed = false;
      const offered = controller.actions.propose(controller.actions.selection(), layout('nested-B', 'derived'));
      assert.equal(offered.kind, 'proposed');
      nested = controller.actions.adopt(offered.proposalId);
    }
    return true;
  } });
  t.after(() => controller.dispose());
  const first = controller.actions.propose(controller.actions.selection(), layout('outer-A', 'derived'));
  armed = true;
  const outer = controller.actions.adopt(first.proposalId);
  assert.equal(outer.kind, 'applied');
  assert.equal(nested.kind, 'applied');
  assert.equal(controller.getSnapshot().descriptor.name, 'nested-B');
  assert.equal(controller.getSnapshot().bufferVersion, 2);
  assert.deepEqual(nested.value, controller.actions.selection());
  assert.equal((await controller.flush(nested.value)).kind, 'saved');
  assert.equal(JSON.parse(decode((await client.read(select('experience/page.json'))).snapshot.bytes)).name, 'nested-B');
});

test('nested flush uncertainty wins over a later visibility refusal in the outer preflight', async t => {
  const { client, make } = await fixture(t);
  let controller, armed = false, inner, publications = 0;
  controller = make({ canView: () => {
    if (armed) {
      armed = false;
      inner = controller.flush(controller.actions.selection());
      throw new Error('Fictional access callback changed after publication began');
    }
    return true;
  }, client: { ...client, publish: async request => {
    publications++;
    await client.publish(request);
    throw new Error('Fictional acknowledgement lost');
  } } });
  t.after(() => controller.dispose());
  const offered = controller.actions.propose(controller.actions.selection(), layout('captured', 'derived'));
  const selected = controller.actions.adopt(offered.proposalId).value;
  armed = true;
  const outer = controller.flush(selected);
  const [innerResult, outerResult] = await Promise.all([inner, outer]);
  assert.equal(innerResult.kind, 'unknown');
  assert.equal(outerResult.kind, 'unknown');
  assert.equal(outerResult.operationId, innerResult.operationId);
  assert.equal(publications, 1);
  assert.equal(JSON.parse(decode((await client.read(select('experience/page.json'))).snapshot.bytes)).name, 'captured');
  assert.equal((await controller.actions.reconcile()).kind, 'saved');
});

test('same-revision refresh recovers a descriptor after visibility becomes available', async t => {
  const { make } = await fixture(t);
  let checks = 0, visible = false;
  const controller = make({ canView: () => ++checks === 1 || visible });
  t.after(() => controller.dispose());
  assert.equal(controller.getSnapshot().descriptor, null);
  assert.match(controller.getSnapshot().problem, /unavailable/i);
  const original = controller.getSnapshot();
  visible = true;
  assert.equal((await controller.actions.refresh()).kind, 'available');
  assert.equal(controller.getSnapshot().descriptor.name, 'initial');
  assert.equal(controller.getSnapshot().problem, null);
  assert.equal(controller.getSnapshot().text, original.text);
  assert.deepEqual(controller.getSnapshot().base, original.base);
});

test('Keep invoked during decoding validates the selected core layout rather than the previous display', async t => {
  const { client, make } = await fixture(t);
  const restricted = { ...cell, ref: 'fictional/restricted' };
  let controller, armed = false, checks = 0, revoked = false, nested, publications = 0;
  controller = make({ cells: [cell, restricted], canView: ref => {
    if (armed && ref === restricted.ref && ++checks === 2) {
      armed = false;
      revoked = true;
      nested = controller.flush(controller.actions.selection());
    }
    return ref !== restricted.ref || !revoked;
  }, client: { ...client, publish: request => { publications++; return client.publish(request); } } });
  t.after(() => controller.dispose());
  const candidate = layout('restricted-draft', 'derived');
  candidate.elements.notes.props.ref = restricted.ref;
  const offered = controller.actions.propose(controller.actions.selection(), candidate);
  armed = true;
  assert.equal(controller.actions.adopt(offered.proposalId).kind, 'applied');
  assert.equal((await nested).kind, 'denied');
  assert.equal(publications, 0);
  assert.equal(controller.getSnapshot().dirty, true);
  assert.equal(JSON.parse(decode((await client.read(select('experience/page.json'))).snapshot.bytes)).name, 'initial');
});
