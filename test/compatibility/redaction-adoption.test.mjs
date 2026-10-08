import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { parsePublicationResult } from '@hachej/boring-files/publication';
import { openRedactionFixture, redactionActor } from '../../examples/redaction/app.mjs';

const actor = redactionActor();
const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
const decode = snapshot => new TextDecoder('utf-8', { ignoreBOM: true }).decode(snapshot.bytes);
const config = (order = ['source', 'calculation']) => ({ format: 'fictional.redaction', version: 2,
  prefix: '# Fictional', proposal: { order, maxRepairs: 1, scenario: 'repair' } });

async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-adoption-'));
  const app = await openRedactionFixture({ directory, ...options });
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const paths = app.paths('A');
  const seeded = await app.local.provider.publication.publish({ operationId: 'adoption-fixture-inputs', atomicity: 'all-or-nothing', changes: [
    { kind: 'create', target: paths.source, expected: { kind: 'absent' }, bytes: encode('Invented redaction input.'), mediaType: 'text/markdown' },
    { kind: 'create', target: paths.config, expected: { kind: 'absent' }, bytes: encode(config()), mediaType: 'application/json' },
  ] }, actor);
  assert.equal(seeded.kind, 'committed');
  const read = target => app.local.provider.read({ target, revision: { kind: 'latest' } }, actor);
  const propose = async (subject, requestId) => {
    const captured = await app.capture(subject, requestId, actor);
    assert.equal(captured.kind, 'captured');
    const admitted = await app.admitProposal(captured.request, actor);
    assert.equal(admitted.kind, 'admitted');
    const validation = await app.local.harness.waitForTask(admitted.ref.validation, context);
    const delivery = await app.local.harness.waitForTask(admitted.ref.delivery, context);
    const view = await app.viewProposal(admitted.ref, actor);
    return { request: captured.request, ref: admitted.ref, validation: validation.state.outcome,
      delivery: delivery.state.outcome, view };
  };
  const changeConfig = async (order, operationId) => {
    const current = await read(paths.config);
    assert.equal(current.kind, 'available');
    const result = await app.local.provider.publication.publish({ operationId, atomicity: 'all-or-nothing', changes: [
      { kind: 'replace', target: current.snapshot.ref, bytes: encode(config(order)), mediaType: 'application/json' },
    ] }, actor);
    assert.equal(result.kind, 'committed');
  };
  return { app, paths, read, propose, changeConfig };
}

test('proposal item IDs persist across reordering and omission; correction remains attached to its item', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const first = await f.propose('A', 'first');
  assert.equal(first.validation.result.kind, 'valid');
  assert.equal(first.delivery.result.kind, 'committed');
  assert.equal(first.view.kind, 'ready');
  const { source, calculation } = first.view.catalog;
  assert.deepEqual(first.view.value.items.map(item => item.itemId), [source, calculation]);
  const sourceSlot = first.view.corrections.find(item => item.itemId === source);
  assert.ok(sourceSlot);
  const corrected = await f.app.correctItem(first.ref, { requestId: 'correct-source', itemId: source,
    expected: sourceSlot.expected, text: 'Human correction retained.' }, actor);
  assert.equal(corrected.kind, 'committed');
  const correctedView = await f.app.viewProposal(first.ref, actor);
  assert.equal(correctedView.kind, 'ready');
  assert.equal(correctedView.corrections.find(item => item.itemId === source).value.text, 'Human correction retained.');
  await f.changeConfig(['calculation', 'source'], 'reverse-proposal-order');
  const second = await f.propose('A', 'second');
  assert.equal(second.view.kind, 'ready');
  assert.deepEqual(second.view.catalog, first.view.catalog);
  assert.deepEqual(second.view.value.items.map(item => item.itemId), [calculation, source]);
  assert.equal(second.view.corrections.find(item => item.itemId === source).value.text, 'Human correction retained.');
  await f.changeConfig(['calculation'], 'omit-source-proposal');
  const third = await f.propose('A', 'third');
  assert.equal(third.view.kind, 'ready');
  assert.deepEqual(third.view.catalog, first.view.catalog);
  assert.deepEqual(third.view.value.items.map(item => item.itemId), [calculation]);
  assert.equal(third.view.corrections.find(item => item.itemId === source).value.text, 'Human correction retained.');
});

test('explicit corrected and proposed choices atomically publish one record and letter', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const proposed = await f.propose('A', 'first');
  const { source, calculation } = proposed.view.catalog;
  const slot = proposed.view.corrections.find(item => item.itemId === source);
  const corrected = await f.app.correctItem(proposed.ref, { requestId: 'correct-source', itemId: source,
    expected: slot.expected, text: 'Human correction retained.' }, actor);
  assert.equal(corrected.kind, 'committed');
  const captured = await f.app.captureAdoption(proposed.ref, [
    { itemId: source, kind: 'corrected' }, { itemId: calculation, kind: 'proposed' },
  ], 'adopt-first', actor);
  assert.equal(captured.kind, 'captured');
  const admitted = await f.app.adopt(captured.request, actor);
  assert.equal(admitted.kind, 'admitted');
  const task = await f.app.local.harness.waitForTask(admitted.ref.taskId, context);
  assert.equal(task.state.outcome.status, 'completed');
  const result = await f.app.adoptionResult(admitted.ref, actor);
  assert.equal(result.kind, 'committed');
  assert.equal(result.receipt.changes.length, 2);
  const domain = f.app.domainPaths('A');
  const record = await f.read(domain.record), letter = await f.read(domain.letter);
  assert.equal(record.kind, 'available'); assert.equal(letter.kind, 'available');
  assert.deepEqual(result.receipt.changes.map(change => change.after), [record.snapshot.ref, letter.snapshot.ref]);
  assert.deepEqual(JSON.parse(decode(record.snapshot)), { format: 'fictional.redaction.record', version: 1,
    subject: 'A', proposal: proposed.ref.validation, items: [
      { itemId: source, text: 'Human correction retained.', kind: 'corrected' },
      { itemId: calculation, text: '4', kind: 'proposed' },
    ] });
  assert.equal(decode(letter.snapshot), '# Fictional A\nHuman correction retained.\n4');
  assert.deepEqual(await f.app.adopt(captured.request, actor), admitted);
  const changed = await f.app.captureAdoption(proposed.ref, [
    { itemId: calculation, kind: 'proposed' }, { itemId: source, kind: 'corrected' },
  ], 'adopt-first', actor);
  assert.equal(changed.kind, 'captured');
  assert.equal((await f.app.adopt(changed.request, actor)).kind, 'conflict');
  assert.equal((await f.app.adopt(captured.request, redactionActor({ principalId: 'fictional-editor-2' }))).kind, 'conflict');
});

for (const change of ['correction', 'letter', 'generation']) test(`${change} after capture prevents the two adoption outputs as one batch`, { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const proposed = await f.propose('A', 'initial');
  const { source, calculation } = proposed.view.catalog;
  const slot = proposed.view.corrections.find(item => item.itemId === source);
  const firstCorrection = await f.app.correctItem(proposed.ref, { requestId: 'initial-correction', itemId: source,
    expected: slot.expected, text: 'First human correction.' }, actor);
  assert.equal(firstCorrection.kind, 'committed');
  const captured = await f.app.captureAdoption(proposed.ref, [
    { itemId: source, kind: 'corrected' }, { itemId: calculation, kind: 'proposed' },
  ], `adopt-before-${change}`, actor);
  assert.equal(captured.kind, 'captured');
  const domain = f.app.domainPaths('A');
  if (change === 'correction') {
    const latest = await f.app.viewProposal(proposed.ref, actor);
    const changed = await f.app.correctItem(proposed.ref, { requestId: 'changed-correction', itemId: source,
      expected: latest.corrections.find(item => item.itemId === source).expected, text: 'Later human correction.' }, actor);
    assert.equal(changed.kind, 'committed');
  } else if (change === 'letter') {
    const edit = await f.app.local.provider.publication.publish({ operationId: 'human-letter-before-adoption', atomicity: 'all-or-nothing', changes: [
      { kind: 'create', target: domain.letter, expected: { kind: 'absent' }, bytes: encode('Human letter stays.'), mediaType: 'text/markdown' },
    ] }, actor);
    assert.equal(edit.kind, 'committed');
  } else {
    const newer = await f.propose('A', 'new-generation');
    assert.equal(newer.validation.result.kind, 'valid');
  }
  const admitted = await f.app.adopt(captured.request, actor);
  assert.equal(admitted.kind, 'admitted');
  const task = await f.app.local.harness.waitForTask(admitted.ref.taskId, context);
  assert.equal(task.state.outcome.status, 'completed');
  assert.equal((await f.app.adoptionResult(admitted.ref, actor)).kind, 'conflict');
  assert.equal((await f.read(domain.record)).kind, 'missing');
  const letter = await f.read(domain.letter);
  if (change === 'letter') {
    assert.equal(letter.kind, 'available');
    assert.equal(decode(letter.snapshot), 'Human letter stays.');
  } else assert.equal(letter.kind, 'missing');
});

test('A, B and C adopt independently with separate record and letter revisions', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const refs = {};
  for (const subject of ['A', 'B', 'C']) {
    const proposed = await f.propose(subject, `proposal-${subject.toLowerCase()}`);
    assert.equal(proposed.view.kind, 'ready');
    const captured = await f.app.captureAdoption(proposed.ref, proposed.view.value.items.map(item => ({ itemId: item.itemId, kind: 'proposed' })),
      `adopt-${subject.toLowerCase()}`, actor);
    assert.equal(captured.kind, 'captured');
    const admitted = await f.app.adopt(captured.request, actor);
    assert.equal(admitted.kind, 'admitted');
    refs[subject] = admitted.ref;
  }
  for (const subject of ['C', 'A', 'B']) {
    await f.app.local.harness.waitForTask(refs[subject].taskId, context);
    const result = await f.app.adoptionResult(refs[subject], actor);
    assert.equal(result.kind, 'committed');
    const domain = f.app.domainPaths(subject);
    const [record, letter] = await Promise.all([f.read(domain.record), f.read(domain.letter)]);
    assert.equal(record.kind, 'available'); assert.equal(letter.kind, 'available');
    assert.equal(JSON.parse(decode(record.snapshot)).subject, subject);
    assert.match(decode(letter.snapshot), new RegExp(`^# Fictional ${subject}\\n`));
    assert.deepEqual(result.receipt.changes.map(change => change.after), [record.snapshot.ref, letter.snapshot.ref]);
  }
});

test('a forged cross-subject validation ID cannot capture adoption', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const a = await f.propose('A', 'proposal-a');
  const b = await f.propose('B', 'proposal-b');
  const forged = { ...a.ref, validation: b.ref.validation };
  const choices = a.view.value.items.map(item => ({ itemId: item.itemId, kind: 'proposed' }));
  const captured = await f.app.captureAdoption(forged, choices, 'forged-cross-subject', actor);
  assert.notEqual(captured.kind, 'captured');
  assert.equal((await f.read(f.app.domainPaths('A').record)).kind, 'missing');
  assert.equal((await f.read(f.app.domainPaths('A').letter)).kind, 'missing');
});

test('capture snapshots caller choices and proposal ref before its first provider await', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const proposed = await f.propose('A', 'proposal-original');
  const originalRef = structuredClone(proposed.ref);
  const choices = proposed.view.value.items.map(item => ({ itemId: item.itemId, kind: 'proposed' }));
  const expectedChoices = structuredClone(choices);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const provider = f.app.local.provider, read = provider.read.bind(provider);
  let armed = true;
  provider.read = async (...args) => {
    if (armed) { armed = false; entered.resolve(); await release.promise; }
    return read(...args);
  };
  try {
    const pending = f.app.captureAdoption(proposed.ref, choices, 'capture-mutation', actor);
    await entered.promise;
    choices[0].kind = 'corrected';
    proposed.ref.validation = 999999;
    release.resolve();
    const captured = await pending;
    assert.equal(captured.kind, 'captured');
    assert.deepEqual(captured.request.choices, expectedChoices);
    assert.equal(captured.request.proposal.validation, originalRef.validation);
    const admitted = await f.app.adopt(captured.request, actor);
    assert.equal(admitted.kind, 'admitted');
    await f.app.local.harness.waitForTask(admitted.ref.taskId, context);
    assert.equal((await f.app.adoptionResult(admitted.ref, actor)).kind, 'committed');
  } finally { release.resolve(); provider.read = read; }
});

test('denial on the letter write leaves both previous output revisions intact', { timeout: 25000 }, async t => {
  let denyLetter = false;
  const f = await fixture(t, { policy: (_actor, action, target) =>
    !(denyLetter && action === 'publish' && target?.resource.path.endsWith('/letter.md')) });
  const proposed = await f.propose('A', 'proposal-first');
  const choices = proposed.view.value.items.map(item => ({ itemId: item.itemId, kind: 'proposed' }));
  const first = await f.app.captureAdoption(proposed.ref, choices, 'first-adoption', actor);
  assert.equal(first.kind, 'captured');
  const firstAdmission = await f.app.adopt(first.request, actor);
  assert.equal(firstAdmission.kind, 'admitted');
  await f.app.local.harness.waitForTask(firstAdmission.ref.taskId, context);
  assert.equal((await f.app.adoptionResult(firstAdmission.ref, actor)).kind, 'committed');
  const domain = f.app.domainPaths('A');
  const before = await Promise.all([f.read(domain.record), f.read(domain.letter)]);
  assert.deepEqual(before.map(read => read.kind), ['available', 'available']);
  const second = await f.app.captureAdoption(proposed.ref, choices, 'second-adoption', actor);
  assert.equal(second.kind, 'captured');
  denyLetter = true;
  const denied = await f.app.adopt(second.request, actor);
  if (denied.kind === 'admitted') {
    await f.app.local.harness.waitForTask(denied.ref.taskId, context);
    assert.equal((await f.app.adoptionResult(denied.ref, actor)).kind, 'denied');
  } else assert.equal(denied.kind, 'denied');
  const after = await Promise.all([f.read(domain.record), f.read(domain.letter)]);
  assert.deepEqual(after.map(read => read.snapshot.ref), before.map(read => read.snapshot.ref));
});

test('correction request identity, actor and replacement keep the original item identity and Unicode text', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const proposed = await f.propose('A', 'proposal-source');
  const itemId = proposed.view.catalog.source;
  const firstExpected = proposed.view.corrections.find(item => item.itemId === itemId).expected;
  const original = { requestId: 'correction-original', itemId, expected: firstExpected, text: '\ufeffHuman correction.' };
  const saved = await f.app.correctItem(proposed.ref, original, actor);
  assert.equal(saved.kind, 'committed');
  assert.equal(saved.receipt.changes.length, 2);
  assert.deepEqual(await f.app.correctItem(proposed.ref, original, actor), saved);
  assert.equal((await f.app.correctItem(proposed.ref, { ...original, text: 'Changed body.' }, actor)).kind, 'conflict');
  const otherActor = await f.app.correctItem(proposed.ref, original, redactionActor({ principalId: 'fictional-editor-2' }));
  assert.equal(otherActor.kind, 'conflict');
  assert.equal(parsePublicationResult(otherActor).kind, 'conflict');
  const first = await f.app.viewProposal(proposed.ref, actor);
  const slot = first.corrections.find(item => item.itemId === itemId);
  assert.equal(slot.value.text, '\ufeffHuman correction.');
  assert.equal(slot.value.basedOnProposal, proposed.ref.validation);
  assert.equal(slot.expected.kind, 'revision');
  const replaced = await f.app.correctItem(proposed.ref, { requestId: 'correction-replacement', itemId,
    expected: slot.expected, text: 'Later correction.' }, actor);
  assert.equal(replaced.kind, 'committed');
  const second = await f.app.viewProposal(proposed.ref, actor);
  const current = second.corrections.find(item => item.itemId === itemId);
  assert.equal(current.value.text, 'Later correction.');
  assert.equal(current.itemId, itemId);
  assert.notEqual(current.expected.target.revision, slot.expected.target.revision);
  const stale = await f.app.correctItem(proposed.ref, { requestId: 'correction-stale', itemId,
    expected: slot.expected, text: 'Stale correction.' }, actor);
  assert.equal(stale.kind, 'conflict');
  assert.equal(parsePublicationResult(stale).kind, 'conflict');
});

test('adopt permission revoked during provider commit denies both outputs after native admission', { timeout: 25000 }, async t => {
  let armed = false;
  const f = await fixture(t, { beforeAdoptionPublish: async () => { armed = true; },
    policy: (_actor, action, target) => !(armed && action === 'adopt' && target?.resource.path.endsWith('/record.json')) });
  const proposed = await f.propose('A', 'proposal-original');
  const choices = proposed.view.value.items.map(item => ({ itemId: item.itemId, kind: 'proposed' }));
  const captured = await f.app.captureAdoption(proposed.ref, choices, 'adopt-revoked-at-publish', actor);
  assert.equal(captured.kind, 'captured');
  const admitted = await f.app.adopt(captured.request, actor);
  assert.equal(admitted.kind, 'admitted');
  const task = await f.app.local.harness.waitForTask(admitted.ref.taskId, context);
  assert.equal(task.state.outcome.result.kind, 'denied');
  const domain = f.app.domainPaths('A');
  assert.equal((await f.read(domain.record)).kind, 'missing');
  assert.equal((await f.read(domain.letter)).kind, 'missing');
});

test('correction committed before a policy revoke reports unknown and exact retry recovers its receipt', { timeout: 25000 }, async t => {
  let canCorrect = true;
  const f = await fixture(t, { policy: (_actor, action) => action !== 'correct' || canCorrect });
  const proposed = await f.propose('A', 'proposal-original');
  const itemId = proposed.view.catalog.source;
  const slot = proposed.view.corrections.find(item => item.itemId === itemId);
  const request = { requestId: 'correction-postcommit-revoke', itemId, expected: slot.expected, text: 'Committed correction.' };
  const provider = f.app.local.provider;
  const publish = provider.publication.publish.bind(provider.publication);
  provider.publication.publish = async (...args) => {
    const result = await publish(...args);
    if (args[0].operationId.includes('fictional.redaction.correct.v1') && result.kind === 'committed') canCorrect = false;
    return result;
  };
  const first = await f.app.correctItem(proposed.ref, request, actor);
  assert.equal(first.kind, 'unknown');
  assert.equal(typeof first.operationId, 'string');
  assert.equal(Object.hasOwn(first, 'receipt'), false);
  const stored = await f.read(f.app.domainPaths('A', itemId).correction);
  assert.equal(stored.kind, 'available');
  assert.equal(JSON.parse(decode(stored.snapshot)).text, 'Committed correction.');
  canCorrect = true;
  provider.publication.publish = publish;
  const recovered = await f.app.correctItem(proposed.ref, request, actor);
  assert.equal(recovered.kind, 'committed');
  assert.equal(recovered.receipt.operationId, first.operationId);
  assert.deepEqual(recovered.receipt.changes[1].after, stored.snapshot.ref);
});

test('revocation during prior adoption binding lookup conceals the original native ref', { timeout: 25000 }, async t => {
  let canAdopt = true;
  const f = await fixture(t, { policy: (_actor, action) => action !== 'adopt' || canAdopt });
  const proposed = await f.propose('A', 'proposal-original');
  const choices = proposed.view.value.items.map(item => ({ itemId: item.itemId, kind: 'proposed' }));
  const captured = await f.app.captureAdoption(proposed.ref, choices, 'adopt-original', actor);
  assert.equal(captured.kind, 'captured');
  const first = await f.app.adopt(captured.request, actor);
  assert.equal(first.kind, 'admitted');
  await f.app.local.harness.waitForTask(first.ref.taskId, context);
  assert.equal((await f.app.adoptionResult(first.ref, actor)).kind, 'committed');
  const harness = f.app.local.harness, snapshot = harness.snapshot.bind(harness);
  harness.snapshot = async (...args) => {
    const found = await snapshot(...args);
    if (found?.binding?.ref?.taskId === first.ref.taskId) canAdopt = false;
    return found;
  };
  try {
    const concealed = await f.app.adopt(captured.request, actor);
    assert.equal(concealed.kind, 'denied');
    assert.equal(Object.hasOwn(concealed, 'ref'), false);
  } finally { harness.snapshot = snapshot; }
});

test('config read revoked during a correction read conceals the proposal view', { timeout: 25000 }, async t => {
  let configReadable = true;
  const f = await fixture(t, { policy: (_actor, action, target) =>
    !(action === 'read' && target?.resource.path.endsWith('/config.json') && !configReadable) });
  const proposed = await f.propose('A', 'proposal-original');
  const provider = f.app.local.provider, read = provider.read.bind(provider);
  provider.read = async (...args) => {
    const result = await read(...args);
    if (args[0].target.resource.path.includes('/corrections/')) configReadable = false;
    return result;
  };
  try {
    const view = await f.app.viewProposal(proposed.ref, actor);
    assert.equal(view.kind, 'denied');
    assert.equal(Object.hasOwn(view, 'value'), false);
    assert.equal(Object.hasOwn(view, 'corrections'), false);
  } finally { provider.read = read; }
});

test('a retained correction request keeps uncertainty when receipt lookup fails', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const proposed = await f.propose('A', 'retained-correction');
  const slot = proposed.view.corrections[0];
  const input = { requestId: 'retained-correction', itemId: slot.itemId, expected: slot.expected, text: 'Retained human correction.' };
  const first = await f.app.correctItem(proposed.ref, input, actor);
  assert.equal(first.kind, 'committed');
  const lookup = f.app.local.provider.reconciliation.lookup;
  f.app.local.provider.reconciliation.lookup = async () => { throw new Error('Fictional lookup unavailable'); };
  try {
    const result = await f.app.correctItem(proposed.ref, input, actor);
    assert.equal(result.kind, 'unknown');
    assert.equal(result.operationId, first.receipt.operationId);
    assert.equal(result.receipt, undefined);
  } finally { f.app.local.provider.reconciliation.lookup = lookup; }
  assert.deepEqual(await f.app.correctItem(proposed.ref, input, actor), first);
});

test('a lost native admission acknowledgement returns unknown and recovers the retained adoption', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const proposed = await f.propose('A', 'native-ack');
  const captured = await f.app.captureAdoption(proposed.ref, proposed.view.value.items.map(item => ({ itemId: item.itemId, kind: 'proposed' })), 'native-ack', actor);
  assert.equal(captured.kind, 'captured');
  const conversation = f.app.local.conversation, commit = conversation.commit.bind(conversation);
  conversation.commit = async (...args) => { await commit(...args); throw new Error('Fictional acknowledgement loss'); };
  try { assert.equal((await f.app.adopt(captured.request, actor)).kind, 'unknown'); }
  finally { conversation.commit = commit; }
  const recovered = await f.app.adopt(captured.request, actor);
  assert.equal(recovered.kind, 'admitted');
  f.app.local.harness.resume();
  await f.app.local.harness.waitForTask(recovered.ref.taskId, context);
  assert.equal((await f.app.adoptionResult(recovered.ref, actor)).kind, 'committed');
});

test('revocation during native task creation rolls back adoption admission', { timeout: 25000 }, async t => {
  let permitted = true;
  const f = await fixture(t, { policy: (_actor, action) => action !== 'adopt' || permitted });
  const proposed = await f.propose('A', 'native-revoke');
  const captured = await f.app.captureAdoption(proposed.ref, proposed.view.value.items.map(item => ({ itemId: item.itemId, kind: 'proposed' })), 'native-revoke', actor);
  assert.equal(captured.kind, 'captured');
  const conversation = f.app.local.conversation, commit = conversation.commit.bind(conversation);
  let rolledBackId;
  conversation.commit = (fn, ctx) => commit(tx => fn(new Proxy(tx, { get(target, property) {
    if (property === 'createTask') return async (...args) => { rolledBackId = await target.createTask(...args); permitted = false; return rolledBackId; };
    const value = Reflect.get(target, property);
    return typeof value === 'function' ? value.bind(target) : value;
  } })), ctx);
  try { assert.equal((await f.app.adopt(captured.request, actor)).kind, 'denied'); }
  finally { conversation.commit = commit; permitted = true; }
  assert.ok(rolledBackId);
  assert.equal(await f.app.local.harness.getTask(rolledBackId, context), undefined);
  const retried = await f.app.adopt(captured.request, actor);
  assert.equal(retried.kind, 'admitted');
  await f.app.local.harness.waitForTask(retried.ref.taskId, context);
  assert.equal((await f.app.adoptionResult(retried.ref, actor)).kind, 'committed');
});

test('target-specific adoption revocation cannot disclose a cached native receipt', { timeout: 25000 }, async t => {
  let denyRecord = false;
  const f = await fixture(t, { policy: (_actor, action, target) =>
    !(denyRecord && action === 'adopt' && target?.resource.path.endsWith('/record.json')) });
  const proposed = await f.propose('A', 'cached-receipt');
  const captured = await f.app.captureAdoption(proposed.ref, proposed.view.value.items.map(item => ({ itemId: item.itemId, kind: 'proposed' })), 'cached-receipt', actor);
  const admitted = await f.app.adopt(captured.request, actor);
  assert.equal(admitted.kind, 'admitted');
  await f.app.local.harness.waitForTask(admitted.ref.taskId, context);
  const first = await f.app.adoptionResult(admitted.ref, actor);
  assert.equal(first.kind, 'committed');
  denyRecord = true;
  const hidden = await f.app.adoptionResult(admitted.ref, actor);
  assert.equal(hidden.kind, 'unknown');
  assert.equal(hidden.receipt, undefined);
  assert.equal(hidden.operationId, first.receipt.operationId);
  denyRecord = false;
  assert.deepEqual(await f.app.adoptionResult(admitted.ref, actor), first);
});

for (const scenario of ['missing', 'forged', 'exhausted', 'hook-failure']) test(`${scenario} cannot publish a proposed document or enter adoption`, { timeout: 25000 }, async t => {
  const f = await fixture(t, scenario === 'hook-failure' ? { afterRepairDecision: () => { throw new Error('Fictional hook failure'); } } : {});
  const current = await f.read(f.paths.config);
  const settings = config();
  settings.proposal.scenario = scenario === 'hook-failure' ? 'repair' : scenario;
  const changed = await f.app.local.provider.publication.publish({ operationId: `config-${scenario}`, atomicity: 'all-or-nothing', changes: [
    { kind: 'replace', target: current.snapshot.ref, bytes: encode(settings), mediaType: 'application/json' },
  ] }, actor);
  assert.equal(changed.kind, 'committed');
  const proposed = await f.propose('A', `invalid-${scenario}`);
  assert.equal(proposed.validation.result.kind, 'invalid');
  assert.equal(proposed.delivery.result.kind, 'producer-failed');
  assert.equal(proposed.view.kind, 'invalid');
  const producer = await f.app.local.harness.getTask(proposed.ref.producer, context);
  const adoption = await f.app.captureAdoption(proposed.ref, [{ itemId: producer.input.catalog.source, kind: 'proposed' }], `adopt-${scenario}`, actor);
  assert.equal(adoption.kind, 'invalid');
  assert.equal((await f.read(f.paths.output)).kind, 'missing');
  const domain = f.app.domainPaths('A');
  assert.equal((await f.read(domain.record)).kind, 'missing');
  assert.equal((await f.read(domain.letter)).kind, 'missing');
});

test('maximum correction text survives JSON escaping and subsequent viewing', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  const proposed = await f.propose('A', 'escaped-correction');
  const slot = proposed.view.corrections[0];
  const text = '\u0000'.repeat(4096);
  const result = await f.app.correctItem(proposed.ref, { requestId: 'escaped-correction', itemId: slot.itemId, expected: slot.expected, text }, actor);
  assert.equal(result.kind, 'committed');
  const view = await f.app.viewProposal(proposed.ref, actor);
  assert.equal(view.kind, 'ready');
  assert.equal(view.corrections.find(item => item.itemId === slot.itemId).value.text, text);
});

for (const point of ['before publication', 'inside publisher', 'after commit']) test(`native abort ${point} preserves actual publication evidence`, { timeout: 15000 }, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let committed;
  const pause = async () => { entered.resolve(); await release.promise; };
  const f = await fixture(t, {
    beforeAdoptionPublish: point === 'before publication' ? pause : async () => {},
    afterAdoptionCommit: point === 'after commit' ? async result => { committed = result; await pause(); } : async () => {},
  });
  const proposed = await f.propose('A', 'cancel-proposal');
  const captured = await f.app.captureAdoption(proposed.ref, proposed.view.value.items.map(item => ({ itemId: item.itemId, kind: 'proposed' })), 'cancel-adoption', actor);
  assert.equal(captured.kind, 'captured');
  const provider = f.app.local.provider, publish = provider.publication.publish.bind(provider.publication);
  if (point === 'inside publisher') provider.publication.publish = async (...args) => { await pause(); return publish(...args); };
  let abort;
  try {
    const admitted = await f.app.adopt(captured.request, actor);
    assert.equal(admitted.kind, 'admitted');
    await entered.promise;
    let acknowledged = false;
    abort = f.app.local.harness.abortTask(admitted.ref.taskId, context).then(value => { acknowledged = true; return value; });
    const deadline = Date.now() + 3000;
    let marked;
    while (!(marked = await f.app.local.harness.getTask(admitted.ref.taskId, context)).abortRequested) {
      assert.ok(Date.now() < deadline, 'Native abort intent was not recorded');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.notEqual(marked.state.status, 'terminal');
    assert.equal(acknowledged, false);
    release.resolve();
    assert.equal(await abort, 'marked');
    const terminal = await f.app.local.harness.waitForTask(admitted.ref.taskId, context);
    assert.equal(terminal.state.outcome.status, 'aborted');
    const result = await f.app.adoptionResult(admitted.ref, actor);
    const domain = f.app.domainPaths('A');
    const pair = await Promise.all([f.read(domain.record), f.read(domain.letter)]);
    if (point === 'after commit') {
      assert.equal(committed.kind, 'committed');
      assert.deepEqual(result, committed);
      assert.deepEqual(pair.map(read => read.snapshot.ref), committed.receipt.changes.map(change => change.after));
    } else {
      assert.deepEqual(pair.map(read => read.kind), ['missing', 'missing']);
      assert.equal(result.kind, 'unknown');
      assert.equal(result.operationId, admitted.ref.operationId);
      assert.equal((await provider.reconciliation.lookup(admitted.ref.operationId, actor)).kind, 'not-found');
    }
    assert.deepEqual(await f.app.adopt(captured.request, actor), admitted);
  } finally {
    release.resolve();
    if (abort) await abort.catch(() => {});
    provider.publication.publish = publish;
  }
});
