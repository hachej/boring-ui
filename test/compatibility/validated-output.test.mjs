import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openValidatedOutputFixture } from '../../examples/validated-output/app.mjs';

const actor = { principalId: 'fictional-editor', initiatorId: 'fictional-human', scopeId: 'fictional-team' };
const decode = bytes => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
async function fixture(t, options) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-validated-test-'));
  const app = await openValidatedOutputFixture({ directory, ...options });
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  return app;
}
async function run(app, requestId = 'request') {
  const admitted = await app.admit(requestId);
  assert.equal(admitted.kind, 'admitted');
  const [producer, validation, formatter, delivery] = await Promise.all([
    app.harness.waitForTask(admitted.ref.producer, context),
    app.harness.waitForTask(admitted.ref.validation, context),
    app.harness.waitForTask(admitted.ref.formatter, context),
    app.harness.waitForTask(admitted.ref.delivery, context),
  ]);
  const output = await app.provider.read({ target: app.target.output, revision: { kind: 'latest' } }, actor);
  return { admitted, producer: producer.state.outcome, validation: validation.state.outcome,
    formatter: formatter.state.outcome, delivery: delivery.state.outcome, output };
}

test('native tools, one bounded repair, distinct validation and guarded delivery', { timeout: 20000 }, async t => {
  const app = await fixture(t);
  const done = await run(app);
  assert.equal(done.producer.status, 'completed');
  assert.equal(done.producer.result.text, '{"number":4,"label":"Fictional answer"}');
  assert.equal(done.producer.result.evidence.length, 2);
  assert.equal(done.validation.result.kind, 'valid');
  assert.equal(done.formatter.status, 'completed');
  assert.equal(done.delivery.result.kind, 'committed');
  assert.equal(done.output.kind, 'available');
  assert.equal(decode(done.output.snapshot.bytes), '# Fictional validated output\nFictional answer: 4');
  assert.equal(app.fake.calls.length, 3);
  const conversations = await app.harness.commit(tx => tx.scanConversations({ ownerTaskId: done.admitted.ref.producer }, 10), context);
  assert.equal(conversations.items.length, 1);
  const budget = await app.harness.snapshot(app.budgets, String(conversations.items[0].id), context);
  assert.equal(budget.attempts, 1);
  assert.equal(Object.keys(budget.decisions).length, 1);
  assert.deepEqual(budget.evidence, done.producer.result.evidence);
});

for (const [scenario, options] of [
  ['exhausted', { maxRepairs: 0 }],
  ['missing', { scenario: 'missing' }],
  ['forged', { scenario: 'forged' }],
  ['denied-source-tool', { authorizeTool: name => name !== 'read_fictional_source' }],
  ['denied-calculator-tool', { authorizeTool: name => name !== 'calculate_fictional' }],
  ['denied-validation', { authorize: () => false }],
  ['failed-repair-hook', { afterRepairDecision: () => { throw new Error('Fictional hook failure'); } }],
]) test(`${scenario} cannot publish unvalidated output`, { timeout: 20000 }, async t => {
  const app = await fixture(t, options);
  const done = await run(app);
  assert.equal(done.validation.result.kind, 'invalid');
  assert.equal(done.output.kind, 'missing');
  assert.notEqual(done.delivery.result.kind, 'committed');
});

test('actual prior tool entries cannot authorize a later unrelated producer', { timeout: 20000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-validated-unrelated-'));
  let app = await openValidatedOutputFixture({ directory });
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const first = await run(app, 'first');
  assert.equal(first.validation.result.kind, 'valid');
  const revision = first.output.snapshot.ref.revision;
  const prior = first.producer.result.evidence;
  await app.close();
  app = await openValidatedOutputFixture({ directory, scenario: 'unrelated', unrelatedEvidence: prior });
  const second = await run(app, 'second');
  assert.equal(second.validation.result.kind, 'invalid');
  assert.equal(second.formatter.status, 'failed');
  assert.notEqual(second.delivery.result.kind, 'committed');
  assert.equal(second.output.snapshot.ref.revision, revision);
});

test('a later latest-evidence overwrite cannot substitute the sealed answer evidence', { timeout: 20000 }, async t => {
  let app;
  app = await fixture(t, { afterAnswerEvidence: async answer => {
    if (answer.kind !== 'valid') return;
    await app.harness.commit(async tx => { (await tx.doc(app.budgets, String(answer.conversationId), null)).evidence = [999999]; }, context);
  } });
  const done = await run(app);
  assert.equal(done.validation.result.kind, 'valid');
  assert.equal(done.delivery.result.kind, 'committed');
  assert.equal(done.producer.result.evidence.length, 2);
  assert.ok(done.producer.result.evidence.every(id => id !== 999999));
  const child = (await app.harness.commit(tx => tx.scanConversations({ ownerTaskId: done.admitted.ref.producer }, 10), context)).items[0];
  const budget = await app.harness.snapshot(app.budgets, String(child.id), context);
  assert.deepEqual(budget.evidence, [999999]);
});

test('publication policy revocation after generation prevents output', { timeout: 20000 }, async t => {
  let canPublish = true;
  const app = await fixture(t, { authorizePublication: ({ resource }) => resource.resource.path !== 'output.md' || canPublish,
    authorize: () => { canPublish = false; return true; } });
  const done = await run(app);
  assert.equal(done.validation.result.kind, 'valid');
  assert.equal(done.output.kind, 'missing');
  assert.notEqual(done.delivery.result.kind, 'committed');
});
