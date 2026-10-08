import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createRedactionProposals } from '../../examples/redaction/proposals.mjs';

const actor = { principalId: 'fictional-editor', initiatorId: 'fictional-human', scopeId: 'fictional-team' };
const source = { resource: { providerId: 'redaction', path: 'fictional-source.md' }, view: { kind: 'published' }, revision: 'source-1' };
const settings = (order = ['source', 'calculation'], scenario = 'repair', maxRepairs = 1) => ({
  format: 'fictional.redaction', version: 2, prefix: '# Fictional', proposal: { order, scenario, maxRepairs },
});

async function fixture(t, options = {}) {
  let harness;
  const feature = createRedactionProposals({ harness: () => harness,
    allowed: options.allowed ?? (() => true), beforeProduce: options.beforeProduce,
    afterRepairDecision: options.afterRepairDecision });
  const registry = createRegistry();
  registry.install(feature.extension);
  registry.install(feature.validation.extension);
  harness = await Harness.open(new MemoryStorage(), { registry, models: feature.models }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  const catalog = subject => conversation.commit(tx => feature.catalog(tx, subject), context);
  const run = async (subject = 'A', currentSettings = settings()) => {
    const input = { request: { subject, source }, actor, text: 'Fictional source text',
      catalog: await catalog(subject), settings: currentSettings, model: feature.model };
    const ids = await conversation.commit(tx => feature.admit(tx, input), context);
    harness.resume();
    const [producer, validation, formatter] = await Promise.all(Object.values(ids).map(id => harness.waitForTask(id, context)));
    return { ids, producer: producer.state.outcome, validation: validation.state.outcome,
      formatter: formatter.state.outcome, input };
  };
  return { feature, harness, conversation, catalog, run };
}

test('native source and calculator evidence support one repair, typed item IDs and separate formatting', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const done = await f.run();
  assert.equal(done.producer.status, 'completed');
  assert.equal(done.producer.result.evidence.length, 2);
  assert.equal(done.validation.status, 'completed');
  assert.deepEqual(done.validation.result, { kind: 'valid', value: { items: [
    { itemId: done.input.catalog.source, text: 'Fictional source text' },
    { itemId: done.input.catalog.calculation, text: '4' },
  ] } });
  assert.equal(done.formatter.status, 'completed');
  assert.equal(done.formatter.result, '# Fictional A\nFictional source text\n4');
  assert.equal(f.feature.fake.calls.length, 3);
  const conversations = await f.harness.commit(tx => tx.scanConversations({ ownerTaskId: done.ids.producer }, 10), context);
  assert.equal(conversations.items.length, 1);
  const budget = await f.harness.snapshot(f.feature.repairs, String(conversations.items[0].id), context);
  assert.equal(budget.attempts, 1);
  assert.equal(Object.keys(budget.decisions).length, 1);
  assert.deepEqual(budget.evidence, done.producer.result.evidence);
});

test('catalog IDs persist per subject and order and omission follow pinned config', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const a = await f.catalog('A');
  assert.deepEqual(await f.catalog('A'), a);
  assert.notDeepEqual(await f.catalog('B'), a);
  const reversed = await f.run('A', settings(['calculation', 'source']));
  assert.deepEqual(reversed.validation.result.value.items, [
    { itemId: a.calculation, text: '4' }, { itemId: a.source, text: 'Fictional source text' },
  ]);
  const single = await f.run('A', settings(['source']));
  assert.deepEqual(single.validation.result.value.items, [{ itemId: a.source, text: 'Fictional source text' }]);
  assert.equal(single.formatter.result, '# Fictional A\nFictional source text');
});

test('a completed sibling producer cannot lend its real native tool entries', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const first = await f.run('A');
  const second = await f.run('B');
  assert.equal(first.validation.result.kind, 'valid');
  assert.equal(second.validation.result.kind, 'valid');
  const borrowed = await f.feature.validation.check(first.producer.result, second.ids.producer, context);
  assert.equal(borrowed.kind, 'invalid');
});

for (const [name, options, expectedKind = 'invalid'] of [
  ['exhausted', { currentSettings: settings(undefined, 'exhausted', 0) }],
  ['missing', { currentSettings: settings(undefined, 'missing') }],
  ['forged', { currentSettings: settings(undefined, 'forged') }],
  ['source denied', { allowed: (_actor, action) => action !== 'read' }, 'producer-failed'],
  ['execute denied', { allowed: (_actor, action) => action !== 'execute' }, 'producer-failed'],
  ['validation denied', { allowed: (_actor, action) => action !== 'validate' }],
]) test(`${name} cannot become a typed proposal or formatted output`, { timeout: 20000 }, async t => {
  const f = await fixture(t, options);
  const done = await f.run('A', options.currentSettings ?? settings());
  assert.equal(done.validation.status, 'completed');
  assert.equal(done.validation.result.kind, expectedKind);
  assert.equal(done.formatter.status, 'failed');
});

test('a failed repair callback does not bypass separate native validation', { timeout: 20000 }, async t => {
  const f = await fixture(t, { afterRepairDecision: () => { throw new Error('Fictional repair callback failure'); } });
  const done = await f.run();
  assert.notEqual(done.validation.result.kind, 'valid');
  assert.equal(done.formatter.status, 'failed');
});

test('revocation before native generation sends no source to the model', { timeout: 20000 }, async t => {
  let canRead = true;
  const f = await fixture(t, { allowed: (_actor, action) => action !== 'read' || canRead,
    beforeProduce: () => { canRead = false; } });
  const done = await f.run();
  assert.equal(f.feature.fake.calls.length, 0);
  assert.notEqual(done.producer.status, 'completed');
  assert.equal(done.validation.result.kind, 'producer-failed');
  assert.equal(done.formatter.status, 'failed');
});
