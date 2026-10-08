import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry, defineExtension, defineTask, UserEntry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createQuestions } from '@hachej/boring-agent/questions';

async function fixture(t, overrides = {}) {
  const policy = { principalId: 'fictional-reviewer', scopeId: 'cabinet', current: true, allowed: true };
  const feature = createQuestions({ runtimeId: 'runtime-one', authorize: () => policy.allowed ? policy : undefined,
    isCurrent: () => policy.current, ...overrides });
  const registry = createRegistry();
  registry.install(feature.extension);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  const input = { conversationId: conversation.id, questionId: 'choose-format', scopeId: 'cabinet', subjectDigest: 'draft-v1',
    policyVersion: 'policy-v1', expiresAt: new Date(Date.now() + 60_000).toISOString(), prompt: 'Choose the fictional report format', choices: ['brief', 'detailed'] };
  const admit = (value = input) => conversation.commit(tx => feature.admit(tx, value, { kind: 'conversation' }, context), context);
  const resolve = (ref, resolutionId = 'answer-one', answer = 'brief') => conversation.commit(tx => feature.resolve(tx, ref, { resolutionId, answer }, context), context);
  const consume = (ref, consumerId = 'report-one') => conversation.commit(tx => feature.consume(tx, ref, 'answer-one', consumerId, context), context);
  return { feature, harness, conversation, policy, input, admit, resolve, consume };
}

test('native choice question persists before presentation, deduplicates admission and resolves without UI or model', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const ref = await f.admit();
  const record = await f.harness.snapshot(f.feature.documents, f.feature.documentKey(ref), context);
  assert.equal(record.question.state.kind, 'pending');
  assert.equal(record.question.ref.taskId, ref.taskId);
  assert.deepEqual(await f.admit(), ref);
  await assert.rejects(f.admit({ ...f.input, prompt: 'Different payload' }), /different input/);
  assert.deepEqual(await f.resolve(ref), { kind: 'resolved', answer: 'brief', resolutionId: 'answer-one' });
  const terminal = await f.harness.waitForTask(ref.taskId, context);
  assert.equal(terminal.state.outcome.status, 'completed');
  assert.equal(terminal.state.outcome.result.answer, 'brief');
  assert.equal((await f.harness.snapshot(f.feature.documents, f.feature.documentKey(ref), context)).question.state.kind, 'resolved');
  assert.equal((await f.resolve(ref)).kind, 'resolved');
  assert.equal((await f.resolve(ref, 'other', 'detailed')).kind, 'conflict');
  assert.equal((await f.consume(ref)).kind, 'resolved');
  assert.equal((await f.consume(ref)).kind, 'resolved');
  assert.equal((await f.consume(ref, 'report-two')).kind, 'conflict');
});

test('resolution authenticates exact original binding, offered choice, responder and current policy', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const ref = await f.admit();
  for (const property of ['runtimeId', 'questionId', 'scopeId', 'subjectDigest', 'policyVersion', 'expiresAt']) {
    assert.notEqual((await f.resolve({ ...ref, [property]: 'foreign' })).kind, 'resolved', property);
  }
  assert.equal((await f.resolve({ ...ref, taskId: 999999 })).kind, 'conflict');
  assert.equal((await f.resolve({ ...ref, conversationId: 999999 })).kind, 'conflict');
  assert.equal((await f.resolve(ref, 'bad-choice', 'not offered')).kind, 'conflict');
  assert.equal((await f.resolve(ref, 42)).kind, 'conflict');
  f.policy.allowed = false;
  assert.equal((await f.resolve(ref)).kind, 'denied');
  f.policy.allowed = true;
  f.policy.current = false;
  assert.equal((await f.resolve(ref)).kind, 'conflict');
  f.policy.current = true;
  const answers = await Promise.all([f.resolve(ref), f.resolve(ref, 'competing-answer', 'detailed')]);
  assert.equal(answers.filter(answer => answer.kind === 'resolved').length, 1);
  f.policy.principalId = 'different-person';
  assert.equal((await f.resolve(ref)).kind, 'conflict');
  f.policy.current = false;
  assert.equal((await f.consume(ref)).kind, 'conflict');
  const forgedKey = f.feature.documentKey({ ...ref, questionId: 'foreign' });
  assert.equal(await f.harness.snapshot(f.feature.documents, forgedKey, context), undefined);
});

test('pending questions expire natively and cannot later be resolved or consumed', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const ref = await f.admit({ ...f.input, expiresAt: new Date(Date.now() + 200).toISOString() });
  const terminal = await f.harness.waitForTask(ref.taskId, context);
  assert.deepEqual(terminal.state.outcome.result, { kind: 'expired' });
  assert.equal((await f.resolve(ref)).kind, 'expired');
  assert.equal((await f.consume(ref)).kind, 'expired');
});

test('native cancellation records cancelled question and does not resolve it', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const ref = await f.admit();
  await f.harness.abortTask(ref.taskId, context);
  const terminal = await f.harness.waitForTask(ref.taskId, context);
  assert.equal(terminal.state.outcome.status, 'aborted');
  assert.equal((await f.resolve(ref)).kind, 'cancelled');
  assert.equal((await f.harness.snapshot(f.feature.documents, f.feature.documentKey(ref), context)).question.state.kind, 'cancelled');
});

test('denied admission rolls back both native task and question record', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  f.policy.allowed = false;
  await assert.rejects(f.admit(), /denied/);
  assert.equal(await f.harness.snapshot(f.feature.documents, f.feature.documentKey(f.input), context), undefined);
  f.policy.allowed = true;
  const ref = await f.admit();
  assert.equal((await f.resolve(ref)).kind, 'resolved');
});

test('late retries retain resolved and cancelled evidence; expired consumption refuses without erasing history', { timeout: 10000 }, async t => {
  let clock = Date.now();
  const f = await fixture(t, { now: () => clock });
  const answered = await f.admit();
  const cancelled = await f.admit({ ...f.input, questionId: 'cancelled' });
  await f.resolve(answered);
  await f.harness.abortTask(cancelled.taskId, context);
  await f.harness.waitForTask(cancelled.taskId, context);
  await f.harness.waitForTask(answered.taskId, context);
  const before = await f.harness.snapshot(f.feature.documents, f.feature.documentKey(answered), context);
  clock += 120_000;
  assert.equal((await f.resolve(answered)).kind, 'resolved');
  assert.equal((await f.consume(answered)).kind, 'expired');
  assert.deepEqual(await f.harness.snapshot(f.feature.documents, f.feature.documentKey(answered), context), before);
  assert.equal((await f.resolve(cancelled)).kind, 'cancelled');
  assert.equal((await f.consume(cancelled)).kind, 'cancelled');
  assert.equal((await f.harness.snapshot(f.feature.documents, f.feature.documentKey(cancelled), context)).question.state.kind, 'cancelled');
});

test('consumption shares the caller native transaction and rechecks revoked access', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const ref = await f.admit();
  await f.resolve(ref);
  await assert.rejects(f.conversation.commit(async tx => {
    assert.equal((await f.feature.consume(tx, ref, 'answer-one', 'rolled-back', context)).kind, 'resolved');
    throw new Error('Host write failed');
  }, context), /Host write failed/);
  f.policy.allowed = false;
  assert.equal((await f.consume(ref)).kind, 'denied');
  f.policy.allowed = true;
  assert.equal((await f.consume(ref)).kind, 'resolved');
});

test('JavaScript policy callbacks cannot grant current-subject authority through truthy values', async t => {
  for (const current of ['stale', Promise.resolve(false)]) {
    const f = await fixture(t, { isCurrent: () => current });
    await assert.rejects(f.admit(), /denied/);
  }
  const f = await fixture(t, { authorize: () => ({ principalId: 42, scopeId: 'cabinet' }) });
  await assert.rejects(f.admit(), /denied/);
});


test('a preceding native table write cannot bypass an abort-marked question', { timeout: 10000 }, async t => {
  const feature = createQuestions({ runtimeId: 'fictional-runtime', authorize: ref => ({ principalId: 'reviewer', scopeId: ref.scopeId }), isCurrent: () => true });
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const original = feature.task.definition.phases.wait;
  const held = defineTask({ ...feature.task.definition, phases: { ...feature.task.definition.phases, wait: async (...args) => { entered.resolve(); await release.promise; await original(...args); } } });
  const registry = createRegistry(); registry.install(defineExtension({ name: 'fixture.held-question', tasks: [held] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(async () => { release.resolve(); await harness.close(context); });
  const conversation = await harness.root(context);
  const ref = await conversation.commit(tx => feature.admit(tx, { conversationId: conversation.id, questionId: 'fictional-q', scopeId: 'team', subjectDigest: 'draft', policyVersion: 'v1', expiresAt: new Date(Date.now() + 60000).toISOString(), prompt: 'Choose', choices: ['yes', 'no'] }, { kind: 'conversation' }, context), context);
  const waiting = harness.waitForTask(ref.taskId, context);
  await entered.promise;
  const aborting = harness.abortTask(ref.taskId, context);
  while (!(await harness.getTask(ref.taskId, context)).abortRequested) await new Promise(resolve => setTimeout(resolve, 5));
  for (const decide of [tx => feature.resolve(tx, ref, { resolutionId: 'answer', answer: 'yes' }, context), tx => feature.consume(tx, ref, 'answer', 'consumer', context)]) {
    const result = await conversation.commit(async tx => {
      await tx.appendEntry(UserEntry, conversation.id, { model: [{ role: 'user', content: 'Fictional host write', timestamp: 1 }] });
      return decide(tx);
    }, context);
    assert.equal(result.kind, 'conflict', 'unreadable task status cannot authorize an answer');
  }
  assert.equal((await harness.snapshot(feature.documents, feature.documentKey(ref), context)).question.state.kind, 'pending');
  release.resolve(); await aborting; await waiting;
  assert.equal((await conversation.commit(tx => feature.consume(tx, ref, 'answer', 'consumer', context), context)).kind, 'cancelled');
});
