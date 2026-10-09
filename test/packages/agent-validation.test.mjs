import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, AssistantEntry, ToolResultEntry, ToolTask, createRegistry, defineExtension, defineTask, defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createOutputValidation } from '@hachej/boring-agent/validation';

const gate = () => Promise.withResolvers();
const assistant = callId => ({ role: 'assistant',
  content: [{ type: 'toolCall', id: callId, name: 'fictional_source', arguments: {} }],
  api: 'fixture', provider: 'fixture', model: 'fictional-no-model', timestamp: 1, stopReason: 'toolUse',
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

async function fixture(t, options = {}) {
  let harness, authorizeCalls = 0, validateCalls = 0;
  const tool = defineTool({ name: 'fictional_source', description: 'Return a fictional source result.',
    parameters: Type.Object({}, { additionalProperties: false }), replay: 'safe',
    ...(options.truncated ? { outputLimits: { maxBytes: 12, maxLines: 100 } } : {}),
    execute: async () => ({ content: [{ type: 'text', text: options.truncated ? 'Fictional source result exceeds the native output limit' : 'Fictional source result' }],
      ...(options.toolError ? { isError: true } : {}),
      ...(options.warning ? { diagnostics: [{ severity: 'warn', code: 'fictional_warning', message: 'Incomplete source' }] } : {}),
      ...(options.info ? { diagnostics: [{ severity: 'info', code: 'fictional_info', message: 'Source may be incomplete' }] } : {}),
    }),
  });
  const producer = defineTask({ name: 'fixture.validation.producer', version: 1,
    initial: () => ({ phase: 'start' }), phases: {
      start: async (task, runtime, ctx) => {
        if (task.input.fail) {
          await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'failed', error: { message: 'Fictional producer failed' } } }), ctx);
          return;
        }
        if (task.input.reuseEvidence) {
          await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed',
            result: { text: '# Reused fictional answer', evidence: [task.input.reuseEvidence] } } }), ctx);
          return;
        }
        await runtime.commit(async tx => {
          const callId = `source-${task.id}`;
          const selectedConversation = task.input.childConversation
            ? (await tx.createConversation({ ownership: { kind: 'task', taskId: task.id } })).id
            : runtime.conversationId;
          const entry = await tx.appendEntry(AssistantEntry, selectedConversation, { model: [assistant(callId)] });
          const child = await tx.createTask(ToolTask, { assistant: entry.id, callId },
            task.input.childConversation
              ? { ownership: { kind: 'conversation' }, conversationId: selectedConversation }
              : { ownership: { kind: 'task', taskId: task.id } });
          return { status: 'waiting', on: [child], policy: 'allSettled', checkpoint: { phase: 'finish', child } };
        }, ctx);
      },
      finish: async (task, runtime, ctx) => {
        const [outcome] = await runtime.outcomes([task.state.checkpoint.child], ctx);
        if (outcome?.status !== 'completed') throw new Error('Fictional source tool did not complete');
        const proposal = { text: '# Fictional answer', evidence: task.input.omitEvidence ? [] : [outcome.result.entryId] };
        await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: proposal } }), ctx);
      },
    }, abort: async (_task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx),
  });
  const validation = createOutputValidation({ name: 'fictional_answer', version: 1, harness: () => harness,
    authorize: async (...args) => { authorizeCalls++; return options.authorize ? options.authorize(...args) : true; },
    validate: async (...args) => { validateCalls++; return options.validate ? options.validate(...args)
      : { kind: 'valid', value: { text: args[0], evidenceCount: args[1].length } }; },
  });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.validation.producer', tasks: [producer], tools: [tool] }));
  registry.install(validation.extension);
  harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  const createProducer = input => conversation.commit(tx => tx.createTask(producer, input,
    { ownership: { kind: 'conversation' } }), context);
  const validateProducer = async producerId => {
    const taskId = await conversation.commit(tx => tx.createTask(validation.task, { producer: producerId },
      { ownership: { kind: 'conversation' } }), context);
    return (await harness.waitForTask(taskId, context)).state.outcome;
  };
  return { harness, conversation, producer, validation, createProducer, validateProducer,
    authorizeCalls: () => authorizeCalls, validateCalls: () => validateCalls };
}

test('actual native ToolTask evidence authorizes a typed result through the native validation task', { timeout: 15000 }, async t => {
  let examined;
  const f = await fixture(t, { validate: (text, evidence) => {
    examined = { text, evidence };
    return { kind: 'valid', value: { heading: text, sourceTask: evidence[0].taskId } };
  } });
  const owner = await f.createProducer({});
  const producer = await f.harness.waitForTask(owner, context);
  assert.equal(producer.state.outcome.status, 'completed');
  const proposal = producer.state.outcome.result;
  assert.equal(proposal.text, '# Fictional answer'); assert.equal(proposal.evidence.length, 1);
  const result = await f.validateProducer(owner);
  assert.equal(result.status, 'completed');
  assert.equal(result.result.kind, 'valid');
  assert.equal(result.result.value.heading, proposal.text);
  assert.equal(examined.text, proposal.text);
  assert.equal(examined.evidence.length, 1);
  assert.equal(examined.evidence[0].entryId, proposal.evidence[0]);
  assert.equal(examined.evidence[0].call.name, 'fictional_source');
  assert.equal(examined.evidence[0].result.isError, false);
  assert.equal(f.validateCalls(), 1);
});

test('missing, forged and another producer’s ToolResultEntry cannot validate this owner', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const owner = await f.createProducer({});
  const other = await f.createProducer({});
  const own = (await f.harness.waitForTask(owner, context)).state.outcome.result;
  const foreign = (await f.harness.waitForTask(other, context)).state.outcome.result;
  assert.equal((await f.validation.check({ text: own.text, evidence: [] }, owner, context)).kind, 'invalid');
  assert.equal((await f.validation.check({ text: own.text, evidence: [999999] }, owner, context)).kind, 'invalid');
  assert.equal((await f.validation.check({ text: own.text, evidence: [foreign.evidence[0]] }, owner, context)).kind, 'invalid');
  assert.equal((await f.validation.check({ text: own.text, evidence: [own.evidence[0], own.evidence[0]] }, owner, context)).kind, 'invalid');
  assert.equal(f.validateCalls(), 0);
});

test('a real tool in an owned child conversation is accepted; an ownerless fork cannot lend evidence to its ancestor', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const owner = await f.createProducer({ childConversation: true });
  const proposal = (await f.harness.waitForTask(owner, context)).state.outcome.result;
  assert.equal((await f.validation.check(proposal, owner, context)).kind, 'valid');
  const resultEntry = await f.harness.commit(tx => tx.entry(ToolResultEntry, proposal.evidence[0]), context);
  const child = await f.harness.conversation(resultEntry.conversationId, context);
  const fork = await child.fork(proposal.evidence[0], { ownership: { kind: 'ownerless' } }, context);
  const assistantId = await fork.commit(tx => tx.appendEntry(AssistantEntry, fork.id, { model: [assistant('fork-source')] }), context);
  const toolId = await fork.commit(tx => tx.createTask(ToolTask, { assistant: assistantId.id, callId: 'fork-source' },
    { ownership: { kind: 'conversation' } }), context);
  const toolTask = await f.harness.waitForTask(toolId, context);
  assert.equal(toolTask.state.outcome.status, 'completed');
  assert.equal((await f.validation.check({ text: proposal.text, evidence: [toolTask.state.outcome.result.entryId] }, owner, context)).kind, 'invalid');
  const forkProducer = await fork.commit(tx => tx.createTask(f.producer, { reuseEvidence: proposal.evidence[0] },
    { ownership: { kind: 'conversation' } }), context);
  const inherited = (await f.harness.waitForTask(forkProducer, context)).state.outcome.result;
  assert.equal((await f.validation.check(inherited, forkProducer, context)).kind, 'invalid');
});

for (const fault of ['toolError', 'warning', 'info', 'truncated']) {
  test(`native ${fault} evidence cannot certify a valid output`, { timeout: 15000 }, async t => {
    const f = await fixture(t, { [fault]: true });
    const owner = await f.createProducer({});
    const result = await f.validateProducer(owner);
    assert.equal(result.status, 'completed');
    assert.equal(result.result.kind, 'invalid');
    assert.equal(f.validateCalls(), 0);
  });
}

test('authorization must be literally true before and after awaited validation', { timeout: 15000 }, async t => {
  let allowed = 'true';
  const denied = await fixture(t, { authorize: () => allowed });
  const deniedOwner = await denied.createProducer({});
  assert.equal((await denied.validateProducer(deniedOwner)).result.kind, 'invalid');
  assert.equal(denied.validateCalls(), 0);

  const entered = gate(), release = gate();
  allowed = true;
  const revoked = await fixture(t, { authorize: () => allowed, validate: async text => {
    entered.resolve(); await release.promise; return { kind: 'valid', value: { text } };
  } });
  const owner = await revoked.createProducer({});
  const pending = revoked.validateProducer(owner);
  await entered.promise;
  allowed = false; release.resolve();
  assert.equal((await pending).result.kind, 'invalid');
  assert.ok(revoked.authorizeCalls() >= 2);
});

test('failed producer and thrown or malformed validator output fail closed', { timeout: 15000 }, async t => {
  const failed = await fixture(t);
  const failedOwner = await failed.createProducer({ fail: true });
  const failedResult = await failed.validateProducer(failedOwner);
  assert.equal(failedResult.status, 'completed');
  assert.deepEqual(failedResult.result, { kind: 'producer-failed', status: 'failed' });
  assert.equal(failed.validateCalls(), 0);
  for (const validate of [() => { throw new Error('Fictional validator failure'); },
    ...[undefined, NaN, new Date('2020-01-01T00:00:00.000Z'), new Map([['key', 'value']]), { nested: undefined }]
      .map(value => () => ({ kind: 'valid', value })),
    () => ({ kind: 'invalid', errors: [false] }), () => ({ kind: 'invalid', errors: Array(1) })]) {
    const f = await fixture(t, { validate });
    const owner = await f.createProducer({});
    const result = (await f.validateProducer(owner)).result;
    assert.equal(result.kind, 'invalid');
    assert.ok(result.errors.length > 0);
    assert.ok(Array.from(result.errors).every(error => typeof error === 'string'));
  }
});

test('a validator accessor cannot substitute a later non-JSON value after its first read', { timeout: 15000 }, async t => {
  let reads = 0;
  const f = await fixture(t, { validate: () => ({ kind: 'valid', get value() {
    reads++; return reads === 1 ? { verdict: 'original' } : new Date('2020-01-01T00:00:00.000Z');
  } }) });
  const owner = await f.createProducer({});
  const result = (await f.validateProducer(owner)).result;
  assert.deepEqual(result, { kind: 'valid', value: { verdict: 'original' } });
  assert.equal(reads, 1);
});

test('returned validator value is captured before the final authorization await', { timeout: 15000 }, async t => {
  const entered = gate(), release = gate();
  const returned = { verdict: 'original' };
  let checks = 0;
  const f = await fixture(t, { authorize: async () => {
    checks++;
    if (checks === 2) { entered.resolve(); await release.promise; }
    return true;
  }, validate: () => ({ kind: 'valid', value: returned }) });
  const owner = await f.createProducer({});
  const proposal = (await f.harness.waitForTask(owner, context)).state.outcome.result;
  const pending = f.validation.check(proposal, owner, context);
  await entered.promise;
  returned.verdict = 'mutated'; release.resolve();
  assert.deepEqual(await pending, { kind: 'valid', value: { verdict: 'original' } });
});

test('proposal text and evidence are captured before asynchronous authorization', { timeout: 15000 }, async t => {
  const entered = gate(), release = gate();
  let examined;
  const f = await fixture(t, { authorize: async () => { entered.resolve(); await release.promise; return true; },
    validate: (text, evidence) => { examined = { text, entryId: evidence[0].entryId }; return { kind: 'valid', value: { text } }; } });
  const owner = await f.createProducer({});
  const proposal = structuredClone((await f.harness.waitForTask(owner, context)).state.outcome.result);
  const original = structuredClone(proposal);
  const pending = f.validation.check(proposal, owner, context);
  await entered.promise;
  proposal.text = '# Mutated by caller'; proposal.evidence[0] = 999999;
  release.resolve();
  const result = await pending;
  assert.equal(result.kind, 'valid');
  assert.deepEqual(examined, { text: original.text, entryId: original.evidence[0] });
});
