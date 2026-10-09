import assert from 'node:assert/strict';
import test from 'node:test';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { createExperienceDocumentController } from '@hachej/boring-ui-kit/experience/document';

const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
const cells = ['before', 'after', 'old', 'new'].map(name => ({ ref: `fictional/${name}`, kind: 'fictional/document', version: 1 }));
const encode = text => new TextEncoder().encode(text), decode = bytes => new TextDecoder().decode(bytes);
const prefix = '{\n  "\\u0066ormat" : "boring.experience", "version" : 1,\n  "name":"fictional-page", "source" : "fixed",\n  "kinds" : {"boring/stack":1,"boring/row":1,"boring/generated":1,"boring/cell":1,"fictional/document":1},\n  "elements" : {\n';
const beforeMember = '    "before" : { "type":"boring/cell", "props":{"ref":"fictional/before"}, "children":[] }';
const afterMember = '    "after" : {"props":{"ref":"fictional/after"}, "children":[], "type":"boring/cell"}';
const pageMember = '    "page" : {"type":"boring/stack", "props":{}, "children":["before", "region", "after"]}';
const suffix = '\n  },\n  "root" : "page", "title" : "Fictional \\u004cayout"\n}\n';
const source = prefix + [beforeMember,
  '    "region" : {"type":"boring/generated","props":{"region":"review","candidates":["fictional/old","fictional/new"],"maxElements":8,"minWidth":180,"regenerate":["request","phase"]},"children":["old"]}',
  '    "old" : {"type":"boring/cell","props":{"ref":"fictional/old"},"children":[]}', afterMember, pageMember].join(',\n') + suffix;
function replacement(descriptor, ref = 'fictional/new') {
  const next = structuredClone(descriptor), pending = [...next.elements.region.children];
  while (pending.length) {
    const id = pending.pop(); pending.push(...next.elements[id].children); delete next.elements[id];
  }
  next.elements.region.children = ['arrangement'];
  next.elements.arrangement = { type: 'boring/row', props: {}, children: ['chosen'] };
  next.elements.chosen = { type: 'boring/cell', props: { ref }, children: [] };
  return next;
}
async function fixture(t, { publish, readOnly = false, sourceText = source, canView = () => true } = {}) {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-regions', authorize: () => true });
  const target = { resource: { providerId: provider.providerId, path: 'page.json' }, view: { kind: 'published' } };
  const client = { read: request => provider.read(request, identity), publish: request => provider.publication.publish(request, identity), lookup: id => provider.reconciliation.lookup(id, identity) };
  assert.equal((await client.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: encode(sourceText), mediaType: 'application/json' }] })).kind, 'committed');
  const saved = () => client.read({ target, revision: { kind: 'latest' } });
  const initial = await saved(); assert.equal(initial.kind, 'available'); let writes = 0;
  const controller = createExperienceDocumentController({ identity, instanceId: 'region-document', epoch: 'page', cells, canView, readOnly,
    source: { kind: 'saved', snapshot: initial.snapshot }, client: { ...client, publish: request => {
      writes++; return publish ? publish(request, () => client.publish(request)) : client.publish(request);
    } },
  });
  t.after(() => { controller.dispose(); provider.close(); });
  const begin = () => {
    const result = controller.actions.beginRegion(controller.actions.selection(), 'review', 'request');
    assert.equal(result.kind, 'applied'); return result.value;
  };
  const adopt = (ref = 'fictional/new') => {
    const request = begin(), offered = controller.actions.proposeRegion(request, replacement(controller.getSnapshot().descriptor, ref));
    assert.equal(offered.kind, 'proposed');
    const adopted = controller.actions.adopt(offered.proposalId); assert.equal(adopted.kind, 'applied'); return adopted.value;
  };
  return { controller, client, saved, begin, adopt, initial: initial.snapshot, writes: () => writes };
}

test('region adoption preserves fixed JSON spelling and Pin publishes only the captured region draft', async t => {
  const f = await fixture(t), original = f.controller.getSnapshot(), base = f.controller.actions.selection();
  const request = f.begin(); assert.equal(request.region, 'review'); assert.equal(request.trigger, 'request'); assert.deepEqual(request.base, base);
  const offered = f.controller.actions.proposeRegion(request, replacement(original.descriptor)); assert.equal(offered.kind, 'proposed');
  assert.equal(f.controller.getSnapshot().text, source); assert.equal(f.controller.getSnapshot().bufferVersion, original.bufferVersion);
  assert.equal(f.controller.getSnapshot().proposal.kind, 'region'); assert.equal(f.controller.getSnapshot().proposal.requestId, request.id);
  assert.equal(f.writes(), 0);
  const adopted = f.controller.actions.adopt(offered.proposalId); assert.equal(adopted.kind, 'applied');
  const draft = f.controller.getSnapshot(); assert.equal(draft.descriptor.source, 'fixed'); assert.equal(draft.pin.region, 'review');
  assert.deepEqual(draft.pin.selection, adopted.value); assert.equal(draft.dirty, true);
  assert.ok(draft.text.startsWith(prefix)); assert.ok(draft.text.endsWith(suffix));
  for (const member of [beforeMember, afterMember, pageMember]) assert.ok(draft.text.includes(member), 'A fixed element member was rewritten');
  assert.equal(JSON.parse(draft.text).elements.chosen.props.ref, 'fictional/new');
  assert.equal(Object.hasOwn(JSON.parse(draft.text).elements, 'old'), false);
  assert.equal(decode((await f.saved()).snapshot.bytes), source); assert.equal(f.writes(), 0);
  assert.notEqual((await f.controller.actions.pin(base)).kind, 'saved'); assert.equal(f.writes(), 0);
  const result = await f.controller.actions.pin(adopted.value); assert.equal(result.kind, 'saved'); assert.deepEqual(result.selection, adopted.value);
  assert.deepEqual(result.receipt.changes[0].before, f.initial.ref);
  assert.deepEqual(await f.client.lookup(result.receipt.operationId), { kind: 'committed', receipt: result.receipt });
  const read = await f.saved(); assert.deepEqual(read.snapshot.ref, result.ref); assert.deepEqual(read.snapshot.bytes, encode(draft.text));
  assert.equal(f.writes(), 1); assert.equal(f.controller.getSnapshot().dirty, false);
});

test('a newer request at the same buffer version fences both an old offer and its late result', async t => {
  const f = await fixture(t), old = f.begin(), descriptor = f.controller.getSnapshot().descriptor;
  const offered = f.controller.actions.proposeRegion(old, replacement(descriptor)); assert.equal(offered.kind, 'proposed');
  const newer = f.begin(); assert.notEqual(old.id, newer.id); assert.deepEqual(old.base, newer.base);
  assert.equal(f.controller.actions.adopt(offered.proposalId).kind, 'stale');
  assert.equal(f.controller.actions.proposeRegion(old, replacement(descriptor)).kind, 'stale');
  assert.equal(f.controller.getSnapshot().text, source); assert.equal(f.writes(), 0);
  const current = f.controller.actions.proposeRegion(newer, replacement(descriptor)); assert.equal(current.kind, 'proposed');
  assert.equal(f.controller.actions.adopt(current.proposalId).kind, 'applied');
  assert.equal(f.controller.getSnapshot().descriptor.elements.chosen.props.ref, 'fictional/new');
});

test('a denied trigger does not invalidate the current authorized region request', async t => {
  const f = await fixture(t), request = f.begin();
  assert.equal(f.controller.actions.beginRegion(f.controller.actions.selection(), 'review', 'open').kind, 'denied');
  const offered = f.controller.actions.proposeRegion(request, replacement(f.controller.getSnapshot().descriptor));
  assert.equal(offered.kind, 'proposed'); assert.equal(f.controller.actions.adopt(offered.proposalId).kind, 'applied');
  assert.equal(f.controller.getSnapshot().descriptor.elements.chosen.props.ref, 'fictional/new'); assert.equal(f.writes(), 0);
});

test('visibility callbacks cannot mutate a caller request into another valid region request', async t => {
  const initial = JSON.parse(source);
  initial.elements.page.children.push('other-region');
  initial.elements['other-region'] = { type: 'boring/generated', props: { region: 'other', candidates: ['fictional/new'], maxElements: 8, regenerate: ['request'] }, children: [] };
  let mutate = () => {};
  const f = await fixture(t, { sourceText: JSON.stringify(initial), canView: () => { mutate(); return true; } });
  const first = f.begin(), second = f.controller.actions.beginRegion(f.controller.actions.selection(), 'other', 'request');
  assert.equal(second.kind, 'applied');
  const callerRequest = structuredClone(first), candidate = structuredClone(f.controller.getSnapshot().descriptor);
  candidate.elements['other-region'].children = ['other-cell'];
  candidate.elements['other-cell'] = { type: 'boring/cell', props: { ref: 'fictional/new' }, children: [] };
  mutate = () => { mutate = () => {}; Object.assign(callerRequest, structuredClone(second.value)); };
  assert.equal(f.controller.actions.proposeRegion(callerRequest, candidate).kind, 'denied');
  assert.equal(callerRequest.id, second.value.id); assert.equal(f.controller.getSnapshot().proposal, null); assert.equal(f.writes(), 0);
  const allowed = f.controller.actions.proposeRegion(second.value, candidate); assert.equal(allowed.kind, 'proposed');
  assert.equal(f.controller.getSnapshot().proposal.region, 'other'); assert.equal(f.controller.getSnapshot().proposal.requestId, second.value.id);
});

test('beginRegion fences its captured base when visibility changes the draft and mutates the caller selection', async t => {
  let reenter = () => {};
  const f = await fixture(t, { canView: () => { reenter(); return true; } });
  const supplied = structuredClone(f.controller.actions.selection()), original = structuredClone(supplied);
  const later = structuredClone(f.controller.getSnapshot().descriptor); later.title = 'Later local layout';
  const offered = f.controller.actions.propose(f.controller.actions.selection(), later); assert.equal(offered.kind, 'proposed');
  let adopted;
  reenter = () => {
    reenter = () => {};
    adopted = f.controller.actions.adopt(offered.proposalId);
    Object.assign(supplied, structuredClone(f.controller.actions.selection()));
  };
  const result = f.controller.actions.beginRegion(supplied, 'review', 'request');
  assert.equal(adopted.kind, 'applied'); assert.notDeepEqual(supplied, original); assert.deepEqual(supplied, adopted.value);
  assert.equal(result.kind, 'stale'); assert.equal(f.controller.getSnapshot().descriptor.title, 'Later local layout');
  assert.equal(f.controller.getSnapshot().dirty, true); assert.equal(f.writes(), 0); assert.equal(decode((await f.saved()).snapshot.bytes), source);
  assert.equal(f.controller.actions.beginRegion(f.controller.actions.selection(), 'review', 'request').kind, 'applied');
});

for (const operation of ['Pin', 'Keep']) {
  test(`${operation} retains its captured selection when visibility adopts a later layout and mutates the caller selection`, async t => {
    let reenter = () => {};
    const f = await fixture(t, { canView: () => { reenter(); return true; } });
    const original = f.adopt(), supplied = structuredClone(original);
    const later = structuredClone(f.controller.getSnapshot().descriptor); later.title = 'Later work outside the region';
    const offered = f.controller.actions.propose(f.controller.actions.selection(), later); assert.equal(offered.kind, 'proposed');
    let adopted;
    reenter = () => {
      reenter = () => {};
      adopted = f.controller.actions.adopt(offered.proposalId);
      Object.assign(supplied, structuredClone(f.controller.actions.selection()));
    };
    const result = await (operation === 'Pin' ? f.controller.actions.pin(supplied) : f.controller.flush(supplied));
    assert.equal(adopted.kind, 'applied'); assert.notDeepEqual(supplied, original); assert.deepEqual(supplied, adopted.value);
    assert.equal(result.kind, 'conflict'); assert.equal(f.writes(), 0); assert.equal(decode((await f.saved()).snapshot.bytes), source);
    assert.equal(f.controller.getSnapshot().descriptor.title, 'Later work outside the region');
    assert.equal(f.controller.getSnapshot().dirty, true); assert.equal(f.controller.getSnapshot().pin, null);
    const explicit = await f.controller.flush(f.controller.actions.selection()); assert.equal(explicit.kind, 'saved');
    assert.equal(f.writes(), 1); assert.deepEqual(explicit.selection, adopted.value);
    assert.equal(JSON.parse(decode((await f.saved()).snapshot.bytes)).title, 'Later work outside the region');
  });
}

test('Pin refuses an old region selection after a further same-region adoption', async t => {
  const f = await fixture(t), first = f.adopt(), second = f.adopt('fictional/old'), draft = f.controller.getSnapshot().text;
  assert.notEqual((await f.controller.actions.pin(first)).kind, 'saved'); assert.equal(f.writes(), 0);
  assert.equal(f.controller.getSnapshot().text, draft); assert.deepEqual(f.controller.getSnapshot().pin.selection, second);
  assert.equal((await f.controller.actions.pin(second)).kind, 'saved');
  assert.equal(JSON.parse(decode((await f.saved()).snapshot.bytes)).elements.chosen.props.ref, 'fictional/old');
  assert.equal(f.writes(), 1);
});

test('a region offer cannot alter fixed metadata or sibling elements', async t => {
  const f = await fixture(t), request = f.begin();
  const title = replacement(f.controller.getSnapshot().descriptor); title.title = 'Unexpected fixed title';
  assert.equal(f.controller.actions.proposeRegion(request, title).kind, 'denied');
  const sibling = replacement(f.controller.getSnapshot().descriptor); sibling.elements.before.props.ref = 'fictional/old';
  assert.equal(f.controller.actions.proposeRegion(request, sibling).kind, 'denied');
  assert.equal(f.controller.getSnapshot().text, source); assert.equal(f.controller.getSnapshot().proposal, null);
  assert.equal(f.writes(), 0);
});

test('an unrelated dirty layout cannot be published through region Pin but remains eligible for explicit Keep', async t => {
  const f = await fixture(t), changed = structuredClone(f.controller.getSnapshot().descriptor); changed.title = 'Locally changed fixed title';
  const offer = f.controller.actions.propose(f.controller.actions.selection(), changed); assert.equal(offer.kind, 'proposed');
  assert.equal(f.controller.actions.adopt(offer.proposalId).kind, 'applied');
  const selected = f.adopt(); assert.equal(f.controller.getSnapshot().pin, null);
  assert.notEqual((await f.controller.actions.pin(selected)).kind, 'saved'); assert.equal(f.writes(), 0);
  assert.equal((await f.controller.flush(selected)).kind, 'saved');
  assert.equal(JSON.parse(decode((await f.saved()).snapshot.bytes)).title, 'Locally changed fixed title');
  assert.equal(f.writes(), 1);
});

test('Pin conflicts with a newer remote descriptor and preserves the local region draft', async t => {
  const f = await fixture(t), selected = f.adopt(), draft = f.controller.getSnapshot().text;
  const remote = source.replace('Fictional \\u004cayout', 'Remote layout');
  assert.equal((await f.client.publish({ operationId: 'remote', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: f.initial.ref, bytes: encode(remote), mediaType: 'application/json' }] })).kind, 'committed');
  assert.equal((await f.controller.actions.pin(selected)).kind, 'conflict');
  assert.equal(f.controller.getSnapshot().text, draft); assert.equal(f.controller.getSnapshot().dirty, true);
  assert.equal(decode((await f.saved()).snapshot.bytes), remote); assert.equal(f.writes(), 1);
});

test('a committed Pin with a lost acknowledgement reconciles without replaying or replacing a later region draft', async t => {
  const f = await fixture(t, { publish: async (_request, commit) => { await commit(); throw new Error('Fictional Pin reply loss'); } });
  const first = f.adopt(), committed = f.controller.getSnapshot().text;
  const unknown = await f.controller.actions.pin(first); assert.equal(unknown.kind, 'unknown');
  f.adopt('fictional/old'); const later = f.controller.getSnapshot().text;
  assert.notEqual((await f.controller.actions.pin(f.controller.actions.selection())).kind, 'saved'); assert.equal(f.writes(), 1);
  const recovered = await f.controller.actions.reconcile(); assert.equal(recovered.kind, 'saved');
  assert.equal(recovered.receipt.operationId, unknown.operationId); assert.equal(f.writes(), 1);
  assert.equal(decode((await f.saved()).snapshot.bytes), committed);
  assert.equal(f.controller.getSnapshot().text, later); assert.equal(f.controller.getSnapshot().dirty, true);
});

test('late Pin acknowledgement keeps a newer region adoption selected', async t => {
  const committed = Promise.withResolvers(), release = Promise.withResolvers(); t.after(() => release.resolve());
  const f = await fixture(t, { publish: async (_request, commit) => { const result = await commit(); committed.resolve(); await release.promise; return result; } });
  const first = f.adopt(), firstText = f.controller.getSnapshot().text, pending = f.controller.actions.pin(first);
  await committed.promise; f.adopt('fictional/old'); const later = f.controller.getSnapshot(); release.resolve();
  const result = await pending; assert.equal(result.kind, 'saved'); assert.deepEqual(result.selection, first);
  assert.equal(f.controller.getSnapshot().text, later.text); assert.equal(f.controller.getSnapshot().bufferVersion, later.bufferVersion);
  assert.equal(f.controller.getSnapshot().dirty, true); assert.equal(decode((await f.saved()).snapshot.bytes), firstText); assert.equal(f.writes(), 1);
});

test('read-only, undeclared trigger, stale base and disposed region requests cannot mutate or publish', async t => {
  const f = await fixture(t), selected = f.controller.actions.selection();
  assert.notEqual(f.controller.actions.beginRegion(selected, 'review', 'open').kind, 'applied');
  assert.notEqual(f.controller.actions.beginRegion(selected, 'missing', 'request').kind, 'applied');
  const old = f.begin(); f.adopt();
  assert.equal(f.controller.actions.beginRegion(selected, 'review', 'request').kind, 'stale');
  assert.equal(f.controller.actions.proposeRegion(old, replacement(f.controller.getSnapshot().descriptor)).kind, 'stale');
  const readonly = await fixture(t, { readOnly: true });
  assert.equal(readonly.controller.actions.beginRegion(readonly.controller.actions.selection(), 'review', 'request').kind, 'denied');
  assert.notEqual((await readonly.controller.actions.pin(readonly.controller.actions.selection())).kind, 'saved');
  f.controller.dispose();
  assert.equal(f.controller.actions.beginRegion(f.controller.actions.selection(), 'review', 'request').kind, 'unavailable');
  assert.notEqual((await f.controller.actions.pin(f.controller.actions.selection())).kind, 'saved');
  assert.equal(f.writes(), 0); assert.equal(readonly.writes(), 0); assert.equal((await f.saved()).kind, 'available');
});
