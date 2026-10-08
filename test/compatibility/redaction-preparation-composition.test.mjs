import assert from 'node:assert/strict';
import test from 'node:test';
import { composePreparation, fakePreparationEvaluator, preparationLayout, validatePreparationLayout } from '../../examples/redaction-browser/preparation-composition.mjs';
import { preparationSlots, preparationTargets, parsePreparation } from '../../examples/redaction/preparation-schema.mjs';

const privateMarker = 'FICTIONAL_PRIVATE_PREPARATION_894';
const instanceId = 'c78a12cf-dcfe-4bd3-a9c7-3961258e6f4a';
const targets = preparationTargets(instanceId);
const document = { format: 'fictional.redaction.preparation', version: 1, instanceId, requestId: 'request-private-123', generationId: '72b96c48-1bf9-4c97-9ab4-520bc7c18486',
  sources: Object.fromEntries(['notes', 'dossier', 'config'].map(name => [name, { ...targets[name], revision: `private-${name}-revision` }])),
  header: privateMarker, synthesis: privateMarker, schedule: [{ label: privateMarker, at: privateMarker }],
  cards: preparationSlots.map(slot => ({ itemId: slot.itemId, title: privateMarker, summary: privateMarker, details: [{ text: privateMarker, status: 'uncertain' }], status: 'uncertain', attention: 'today', target: 'unknown', review: 'due' })),
};
const options = extra => ({ descriptor: preparationLayout, document, canView: () => true, evaluate: fakePreparationEvaluator, signal: new AbortController().signal, ...extra });
async function collect(input) { const result = []; for await (const snapshot of composePreparation(input)) result.push(snapshot); return result; }

test('individual preparation cards compose without private content, IDs or source refs; fixed shell and hierarchy survive', async () => {
  const requests = [];
  const snapshots = await collect(options({ evaluate: request => { requests.push(JSON.stringify(request)); return fakePreparationEvaluator(request); } }));
  assert.ok(requests.length > 0);
  assert.equal(snapshots.at(-1).kind, 'final', JSON.stringify(snapshots.at(-1)));
  for (const snapshot of snapshots) if (snapshot.descriptor) validatePreparationLayout(snapshot.descriptor);
  const final = snapshots.at(-1).descriptor;
  for (const id of ['page', 'header', 'synthesis', 'preparation', 'notes', 'actions', 'schedule']) assert.deepEqual(final.elements[id], preparationLayout.elements[id]);
  for (const value of [privateMarker, instanceId, document.requestId, document.generationId, 'private-notes-revision', 'source.md', 'preparation/c01']) assert.equal(requests.join('').includes(value), false, value);
  assert.equal(JSON.stringify(snapshots).includes(privateMarker), false);
  assert.ok(requests.join('').includes('candidate_11'), 'The evaluator receives twelve individual candidates');
});

test('host preserves recent chronology while allowing another section to reorder individual cards', async () => {
  const snapshots = await collect(options({ evaluate: ({ questions }) => ({ answers: Object.fromEntries(Object.entries(questions).map(([name, question]) => {
    const choices = Object.keys(question.criteria), cards = choices.filter(key => key.startsWith('use:')).reverse();
    return [name, { choice: name === 'root' ? 'layout_stack' : name.startsWith('order_node_') ? String(13 - Number(name.slice(11))) : cards[0] ?? choices[0] }];
  })) }) }));
  const final = snapshots.at(-1); assert.equal(final.kind, 'final');
  assert.deepEqual(final.descriptor.elements['section-overview'].children, ['heading-overview', 'c02', 'c01']);
  assert.deepEqual(final.descriptor.elements['section-recent-history'].children, ['heading-recent-history', 'c09', 'c10']);
});

test('layout rejects missing cards, changed fixed controls, section movement and chronology reversal', () => {
  for (const mutate of [
    value => { value.elements['section-overview'].children.pop(); delete value.elements.c02; },
    value => { value.elements.page.children.reverse(); },
    value => { value.elements.preparation.children.reverse(); },
    value => { value.elements['section-recent-history'].children = ['heading-recent-history', 'c10', 'c09']; },
    value => { value.elements.c01.props.ref = 'preparation/c02'; },
    value => { value.elements.header.props.secret = privateMarker; },
  ]) { const value = structuredClone(preparationLayout); mutate(value); assert.throws(() => validatePreparationLayout(value)); }
});

test('untrusted preparation fields and cross-instance sources never reach the evaluator', async () => {
  let calls = 0;
  for (const value of [{ ...document, extra: privateMarker }, { ...document, cards: document.cards.slice(1) }, { ...document, sources: { ...document.sources, notes: { ...document.sources.notes, resource: { ...document.sources.notes.resource, path: 'another/source.md' } } } }]) {
    await assert.rejects(collect(options({ document: value, evaluate: request => { calls++; return fakePreparationEvaluator(request); } })));
  }
  assert.equal(calls, 0);
  assert.equal(parsePreparation(document).cards.length, 12);
});

test('failed, incomplete, revoked and cancelled compositions retain only authorized defaults', async () => {
  const failed = await collect(options({ evaluate: () => { throw new Error(privateMarker); } }));
  assert.equal(failed.at(-1).reason, 'unavailable'); assert.deepEqual(failed.at(-1).descriptor, preparationLayout);
  assert.equal(JSON.stringify(failed).includes(privateMarker), false);
  const incomplete = await collect(options({ evaluate: async request => {
    const result = await fakePreparationEvaluator(request);
    for (const [name, question] of Object.entries(request.questions)) if ('use:candidate_0' in question.criteria) result.answers[name] = { choice: 'omit' };
    return result;
  } }));
  assert.equal(incomplete.at(-1).reason, 'unavailable'); assert.deepEqual(incomplete.at(-1).descriptor, preparationLayout);
  assert.equal(incomplete.some(event => event.kind === 'partial' || event.kind === 'final'), false);
  let permitted = true;
  const revoked = await collect(options({ canView: () => permitted, evaluate: request => { permitted = false; return fakePreparationEvaluator(request); } }));
  assert.equal(revoked.at(-1).reason, 'unavailable'); assert.equal(revoked.at(-1).descriptor, null);
  const cancellation = new AbortController();
  const cancelled = await collect(options({ signal: cancellation.signal, evaluate: () => { cancellation.abort(); return new Promise(() => {}); } }));
  assert.equal(cancelled.at(-1).reason, 'cancelled');
});


test('hostile descriptor and document keys cannot leak through composition errors', async () => {
  let calls = 0;
  for (const input of [{ document: { ...document, [privateMarker]: 'secret' } }, { descriptor: { ...preparationLayout, [privateMarker]: 'secret' } }]) {
    await assert.rejects(collect(options({ ...input, evaluate: request => { calls++; return fakePreparationEvaluator(request); } })), error => {
      assert.equal(error.message, 'Preparation input unavailable'); assert.equal(String(error).includes(privateMarker), false); assert.equal(error.cause, undefined); return true;
    });
  }
  assert.equal(calls, 0);
});
