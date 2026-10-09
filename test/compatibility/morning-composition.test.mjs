import assert from 'node:assert/strict';
import test from 'node:test';
import { composeMorning, fakeMorningEvaluator, morningLayout, morningMetadata } from '../../examples/morning/composition.mjs';

const privateMarker = 'FICTIONAL_MORNING_PRIVATE_RECORD_ee09';
const records = {
  email: { status: 'pending', subject: privateMarker, body: privateMarker },
  calendar: { selected: null, title: privateMarker, attendees: [privateMarker], options: [{ id: 'slot-a', label: privateMarker }] },
  todo: { items: [{ id: 'reply', title: privateMarker, completed: false }] },
};
const options = extra => ({ descriptor: morningLayout, metadata: morningMetadata(records), canView: () => true,
  evaluate: fakeMorningEvaluator, signal: new AbortController().signal, ...extra });
async function collect(input) { const result = []; for await (const snapshot of composeMorning(input)) result.push(snapshot); return result; }

test('morning composition exposes only approved metadata and preserves fixed reply and header cells', async () => {
  const requests = [], before = JSON.stringify(morningLayout);
  const snapshots = await collect(options({ evaluate: request => { requests.push(JSON.stringify(request)); return fakeMorningEvaluator(request); } }));
  assert.ok(requests.length > 0);
  assert.equal(snapshots[0].kind, 'default'); assert.equal(snapshots.at(-1).kind, 'final');
  const composed = snapshots.at(-1).descriptor;
  assert.equal(JSON.stringify(morningLayout), before);
  assert.deepEqual(composed.elements.reply, morningLayout.elements.reply);
  assert.deepEqual(composed.elements.header, morningLayout.elements.header);
  const references = Object.values(composed.elements).filter(node => node.type === 'boring/cell').map(node => node.props.ref);
  assert.deepEqual(references.sort(), ['calendar/conflict', 'email/reply', 'morning/header', 'morning/reply', 'todo/morning']);
  assert.ok(requests.every(text => !text.includes(privateMarker)));
  assert.ok(!JSON.stringify(snapshots).includes(privateMarker));
  assert.ok(!requests.join('').includes('email/reply'), 'The evaluator sees opaque markers, not application reference paths');
  assert.deepEqual(morningMetadata({ email: { status: 'queued' }, calendar: { selected: 'slot-a' }, todo: { items: [{ completed: true }] } }),
    { email: 'queued', calendar: 'settled', todo: 'complete' });
});

test('unknown metadata and extra fields are refused before the evaluator is called', async () => {
  let calls = 0;
  const evaluate = request => { calls++; return fakeMorningEvaluator(request); };
  for (const metadata of [{ ...morningMetadata(records), email: privateMarker }, { ...morningMetadata(records), body: privateMarker }]) {
    await assert.rejects(collect(options({ metadata, evaluate })));
  }
  assert.equal(calls, 0);
});

test('denied cells and mid-composition revocation prevent evaluator delegation', async () => {
  let calls = 0;
  const denied = await collect(options({ canView: ref => ref !== 'email/reply', evaluate: request => { calls++; return fakeMorningEvaluator(request); } }));
  assert.equal(calls, 0); assert.equal(denied.at(-1).kind, 'default'); assert.equal(denied.at(-1).reason, 'unavailable');
  let permitted = true;
  const revoked = await collect(options({ canView: () => permitted, evaluate: request => { calls++; permitted = false; return fakeMorningEvaluator(request); } }));
  assert.equal(calls, 1); assert.equal(revoked.at(-1).kind, 'default'); assert.equal(revoked.at(-1).reason, 'unavailable');
  assert.equal(revoked.filter(item => item.kind === 'final').length, 0);
});

test('failed or cancelled composition retains the default without leaking provider errors', async () => {
  const failed = await collect(options({ evaluate: async () => { throw new Error(privateMarker); } }));
  assert.equal(failed.at(-1).kind, 'default'); assert.equal(failed.at(-1).reason, 'unavailable');
  assert.deepEqual(failed.at(-1).descriptor, morningLayout);
  assert.ok(!JSON.stringify(failed).includes(privateMarker));
  const cancellation = new AbortController();
  const cancelled = await collect(options({ signal: cancellation.signal, evaluate: async () => { cancellation.abort(); await new Promise(() => {}); } }));
  assert.equal(cancelled.at(-1).kind, 'default'); assert.equal(cancelled.at(-1).reason, 'cancelled');
  assert.deepEqual(cancelled.at(-1).descriptor, morningLayout);
});
