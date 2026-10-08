export async function checkIndexedDbStore(openDraftDatabase, indexedDB, assert) {
  let time = Date.now(), release, held = false;
  const host = await openDraftDatabase({ indexedDB, name: `fictional-conformance-${time}`, now: () => time, maxBytes: 128, beforeMutation: async operation => { if (operation === 'write' && held) await new Promise(resolve => { release = resolve; }); } });
  const identity = { principalId: 'a', scopeId: 'b', initiatorId: 'c' };
  const session = await host.login(identity, 10000), store = host.storeFor(session);
  const key = { identity, providerInstanceId: 'stable', format: 'markdown/v1', target: { resource: { providerId: 'fictional', path: 'notes.md' }, view: { kind: 'published' } } };
  const draft = (sequence, writerId = 'one', revision = 'r1', text = `draft${sequence}`) => ({ version: 1, ref: { key, base: { kind: 'revision', target: { ...key.target, revision } }, writerId, sequence }, text, createdAt: time, expiresAt: time + 1000 });
  try {
    assert((await host.login(identity)).epoch === session.epoch, 'Reload retains authenticated epoch');
    const first = draft(1); assert((await store.write(first)).kind === 'stored', 'First write persisted');
    assert((await store.write(first)).kind === 'stored', 'Identical retry idempotent');
    assert((await store.write({ ...first, text: 'changed' })).kind === 'denied', 'Same version cannot change');
    assert((await store.remove(first.ref)).kind === 'removed', 'Exact remove');
    assert((await store.write(first)).kind === 'superseded', 'Deleted draft cannot resurrect');
    const future = draft(3); assert((await store.remove(future.ref)).kind === 'missing', 'Remove before delayed write raises floor');
    assert((await store.write(future)).kind === 'superseded', 'Delayed write blocked by floor');
    await store.write(draft(1, 'ack-before-write'));
    assert((await store.remove(draft(2, 'ack-before-write').ref)).kind === 'removed', 'Later acknowledged version removes the older retained payload');
    assert(!(await store.list(key, 20)).drafts.some(item => item.ref.writerId === 'ack-before-write'), 'Acknowledged writer has no stale recovery offer');
    assert((await store.write(draft(2, 'ack-before-write'))).kind === 'superseded', 'Acknowledged delayed write cannot recreate payload');
    const newer = draft(5, 'one', 'r2'); await store.write(newer); await store.remove(draft(4).ref);
    assert((await store.list(key, 20)).drafts[0].ref.sequence === 5, 'Old base remove preserves newer base');
    assert((await store.write(draft(4))).kind === 'superseded', 'Floor spans base changes');
    await store.write(draft(1, 'two')); const limited = await store.list(key, 1);
    assert(limited.drafts.length === 1 && limited.truncated, 'Bounded truncated listing');
    await store.remove(newer.ref); assert((await store.list(key, 20)).drafts[0].ref.writerId === 'two', 'Other writer preserved');
    assert((await store.list(key, 101)).kind === 'unavailable', 'Unbounded listing refused');
    assert((await store.write(draft(1, 'invalid', 'r1', '\ud800'))).kind === 'unavailable', 'Invalid Unicode refused');
    assert((await store.write(draft(1, 'large', 'r1', 'x'.repeat(129)))).kind === 'unavailable', 'Oversize refused');
    const foreign = { ...key, identity: { ...identity, principalId: 'foreign' } }; assert((await store.list(foreign, 20)).kind === 'denied', 'Cross principal refused');
    assert((await store.list({ ...key, providerInstanceId: 'replacement' }, 20)).drafts.length === 0, 'Recycled provider excluded');
    assert((await store.list({ ...key, target: { ...key.target, view: { kind: 'working', viewId: 'private' } } }, 20)).drafts.length === 0, 'Private view excluded');
    time += 1001; assert((await store.list(key, 20)).drafts.length === 0, 'Expired draft hidden');
    held = true; const delayed = store.write(draft(6)); while (!release) await new Promise(resolve => setTimeout(resolve, 0));
    await host.logout(session); held = false; release(); assert((await delayed).kind === 'denied', 'Delayed write fenced after durable logout');
    assert((await store.list(key, 20)).kind === 'denied', 'Old session refused');
    const next = await host.login(identity); assert(next.epoch !== session.epoch, 'Login receives new epoch');
    assert((await host.storeFor(next).list(key, 20)).drafts.length === 0, 'Old payload purged');
    time = next.expiresAt; assert((await host.storeFor(next).list(key, 20)).kind === 'expired', 'Session expiry enforced');
  } finally { host.close(); }
  assert((await store.write(draft(7))).kind === 'unavailable', 'Closed storage failure is explicit');
}
