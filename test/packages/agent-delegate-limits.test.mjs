// D-312: the delegate tool's host-owned limits, timeout, meter and child tool allow list, through the native Harness on a scripted
// (faux) model. A refused call is a normal error result the parent model reads, and creates no child.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssistantEntry, Harness, MemoryStorage, createRegistry, defineTool } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { Type } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createDelegateTool, defineAgent } from '@hachej/boring-agent/agents';
import { meterFromSink } from '@hachej/boring-agent/metering';

const resultText = message => message.content.filter(part => part.type === 'text').map(part => part.text).join('');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, what) {
  const deadline = Date.now() + 8000;
  while (!(await check())) { assert.ok(Date.now() < deadline, what); await sleep(5); }
}

/**
 * Parent model: on a user input, calls `delegate` `fanOut` times in one response (Pi runs them in parallel); after the tool
 * results, answers. Child model: one lookup, then answers. While `held` is set, every child request waits for `release()`
 * (or its abort signal, when the child is cancelled).
 */
function scriptedModels({ fanOut = 1, task = 'What is the capital of Fictionland?', hold = false } = {}) {
  const calls = { parent: 0, child: 0, waiting: 0, aborted: 0 };
  let release, released = new Promise(resolve => { release = resolve; });
  if (!hold) release();
  const faux = fauxProvider({ provider: 'fictional-faux', models: [{ id: 'parent' }, { id: 'child' }] });
  const respond = async (transcript, options, _state, model) => {
    const last = transcript.messages.at(-1);
    if (model.id === 'parent') {
      calls.parent++;
      if (last?.role === 'user') return fauxAssistantMessage(Array.from({ length: fanOut }, (_, index) => fauxToolCall('delegate', { task }, { id: `delegate-${calls.parent}-${index}` })), { stopReason: 'toolUse' });
      return fauxAssistantMessage([fauxText('Parent is done.')]);
    }
    calls.child++;
    calls.waiting++;
    try {
      await new Promise((resolve, reject) => {
        const abort = () => { calls.aborted++; reject(new Error('aborted')); };
        if (options?.signal?.aborted) return abort();
        options?.signal?.addEventListener('abort', abort, { once: true });
        released.then(resolve);
      });
    } finally { calls.waiting--; }
    return last?.role === 'toolResult'
      ? fauxAssistantMessage([fauxText(`The capital is ${resultText(last)}.`)])
      : fauxAssistantMessage([fauxToolCall('lookup', { topic: 'capital' }, { id: `lookup-${calls.child}` })], { stopReason: 'toolUse' });
  };
  faux.setResponses(Array.from({ length: 60 }, () => respond));
  const models = createModels();
  models.setProvider(faux.provider);
  return { models, calls, release: () => release() };
}

const lookup = defineTool({
  name: 'lookup', description: 'Look up a fictional fact.', parameters: Type.Object({ topic: Type.String() }), replay: 'safe',
  execute: async () => ({ output: [{ type: 'text', text: 'Glimmerton' }] }),
});
const vault = defineTool({
  name: 'open_vault', description: 'A fictional tool the child agent has but the host does not allow it.', parameters: Type.Object({}), replay: 'safe',
  execute: async () => ({ output: [{ type: 'text', text: 'opened' }] }),
});
const parentOnly = defineTool({
  name: 'parent_only', description: 'A tool only the parent has.', parameters: Type.Object({}), replay: 'safe',
  execute: async () => ({ output: [{ type: 'text', text: 'parent' }] }),
});

function agents(delegate = {}, childTools = [lookup]) {
  const researcher = defineAgent({ id: 'researcher', model: { provider: 'fictional-faux', modelId: 'child' }, instructions: 'Answer briefly.', tools: childTools });
  const lead = defineAgent({ id: 'lead', model: { provider: 'fictional-faux', modelId: 'parent' }, instructions: 'Delegate research.', tools: [parentOnly], delegates: [{ agent: researcher, ...delegate }] });
  const registry = createRegistry();
  lead.install(registry);
  return { lead, registry };
}

async function open(delegate, script, childTools) {
  const { lead, registry } = agents(delegate, childTools);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: script.models }, context);
  return { lead, harness, registry };
}
const children = async conversation => (await conversation.commit(tx => tx.scanConversations({ ownerConversationId: conversation.id }, 50), context)).items;
const delegateResults = async conversation => (await conversation.context(context)).messages.filter(message => message.role === 'toolResult' && message.toolName === 'delegate');
const ask = async (conversation, requestId) => (await conversation.submit({ type: 'input', requestId, content: 'Research the capital.' }, context)).wait(context);

test('maxRunningPerConversation refuses the extra call with a readable result and creates no child for it', { timeout: 20000 }, async t => {
  const script = scriptedModels({ fanOut: 3, hold: true });
  const { lead, harness } = await open({ limits: { maxRunningPerConversation: 2 } }, script);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  const settled = conversation.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context).then(submission => submission.wait(context));
  await until(() => script.calls.waiting === 2, 'two children run');
  await sleep(50);
  assert.equal(script.calls.waiting, 2, 'the third call started no child model request');
  script.release();
  assert.equal((await settled).status, 'done', 'a refusal never throws: the parent turn finishes');

  const results = await delegateResults(conversation);
  assert.equal(results.length, 3);
  const refused = results.filter(result => result.isError);
  assert.equal(refused.length, 1, 'exactly one call was refused');
  assert.equal(resultText(refused[0]), '2 delegates already running for this conversation (limit 2).');
  assert.equal((await children(conversation)).length, 2, 'the refused call created no child conversation');

});

test('maxRunning is shared by every tool given the same limits object, across parent conversations', { timeout: 20000 }, async t => {
  const limits = { maxRunning: 1 };
  const script = scriptedModels({ hold: true });
  const { lead, harness, registry } = await open({ limits }, script);
  t.after(() => harness.close(context));
  const first = await lead.createConversation(harness, context);
  const firstDone = first.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context).then(submission => submission.wait(context));
  await until(() => script.calls.waiting === 1, 'the first child runs');

  // A second agent (its own delegate tool) sharing the limits object, in another conversation.
  const other = defineAgent({ id: 'other-lead', model: { provider: 'fictional-faux', modelId: 'parent' }, instructions: 'Delegate.', delegates: [{ agent: defineAgent({ id: 'researcher', model: { provider: 'fictional-faux', modelId: 'child' }, tools: [lookup] }), limits }] });
  other.install(registry);
  const second = await other.createConversation(harness, context);
  assert.equal((await ask(second, 'ask')).status, 'done');
  const [refused] = await delegateResults(second);
  assert.equal(refused.isError, true);
  assert.equal(resultText(refused), '1 delegate already running across the conversations sharing this limit (limit 1).');
  assert.equal((await children(second)).length, 0);

  script.release();
  assert.equal((await firstDone).status, 'done');
  assert.equal((await delegateResults(first))[0].isError, false, 'the first call was never refused');
});

test('maxStartsPerHour counts children started per parent conversation in the last hour, ended or not', { timeout: 20000 }, async t => {
  const script = scriptedModels();
  const { lead, harness } = await open({ limits: { maxStartsPerHour: 1 } }, script);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  assert.equal((await ask(conversation, 'ask-1')).status, 'done');
  assert.equal((await ask(conversation, 'ask-2')).status, 'done');
  const [first, second] = await delegateResults(conversation);
  assert.equal(first.isError, false);
  assert.equal(second.isError, true);
  assert.equal(resultText(second), '1 delegate already started for this conversation in the last hour (limit 1).');
  assert.equal((await children(conversation)).length, 1);

  const other = await lead.createConversation(harness, context);
  assert.equal((await ask(other, 'ask')).status, 'done');
  assert.equal((await delegateResults(other))[0].isError, false, 'another conversation has its own hour');
});

test('maxTaskChars refuses an oversized task before any child exists', { timeout: 20000 }, async t => {
  const script = scriptedModels({ task: 'x'.repeat(41) });
  const { lead, harness } = await open({ limits: { maxTaskChars: 40 } }, script);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  assert.equal((await ask(conversation, 'ask')).status, 'done');
  const [refused] = await delegateResults(conversation);
  assert.equal(refused.isError, true);
  assert.equal(resultText(refused), 'The task is 41 characters; the limit is 40.');
  assert.equal(refused.details, undefined, 'no child, so no sub-agent details');
  assert.equal((await children(conversation)).length, 0);
  assert.equal(script.calls.child, 0);
});

/** A meter that logs what the tool gives it. */
function recordingMeter() {
  const log = [];
  const meter = (parent, child) => {
    log.push({ open: [parent, child] });
    return { record: event => { log.push({ event }); }, close: end => { log.push({ close: end }); } };
  };
  return { log, meter };
}

test('onChild and meter name the call: callId, taskId and the child input\'s requestId (D-556)', { timeout: 20000 }, async t => {
  const seen = [];
  const { lead, harness } = await open({
    onChild: (_parent, _child, _tx, ids) => { seen.push(['onChild', ids]); },
    meter: (_parent, _child, ids) => { seen.push(['meter', ids]); return { record: () => {}, close: () => {} }; },
  }, scriptedModels());
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  assert.equal((await ask(conversation, 'ask')).status, 'done');
  assert.deepEqual(seen.map(([from]) => from), ['onChild', 'meter']);
  assert.deepEqual(seen[0][1], seen[1][1], 'the same ids on both');
  const { callId, taskId, requestId } = seen[0][1];
  assert.match(callId, /^delegate-/);
  assert.ok(taskId !== undefined);
  assert.equal(requestId, `delegate:${taskId}`);
});

test('meterFromSink: a child\'s responses reach the sink once, under one run, and the run settles (D-556)', { timeout: 20000 }, async t => {
  const calls = [];
  const sink = {
    reserveRun: async input => { calls.push(['reserve', input]); return { reservationId: 'fictional-hold' }; },
    recordUsage: async input => { calls.push(['usage', input]); return { billedMicros: input.amountMicros }; },
    settleRun: async input => { calls.push(['settle', input]); },
    releaseRun: async input => { calls.push(['release', input]); },
  };
  const { lead, harness } = await open({ meter: meterFromSink({ sink, scope: { userId: 'fictional-person' }, price: () => 5, markup: 2 }) }, scriptedModels());
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  assert.equal((await ask(conversation, 'ask')).status, 'done');
  const [child] = await children(conversation);
  assert.deepEqual(calls.map(([kind]) => kind), ['reserve', 'usage', 'usage', 'settle']);
  assert.equal(new Set(calls.map(([, input]) => input.runId)).size, 1, 'one run');
  for (const [, input] of calls) { assert.equal(input.userId, 'fictional-person'); assert.equal(input.conversationId, Number(child.id)); }
  const usages = calls.filter(([kind]) => kind === 'usage').map(([, input]) => input);
  assert.equal(new Set(usages.map(input => input.usageId)).size, 2);
  assert.equal(usages[0].amountMicros, 10, 'price times markup');
  assert.equal(usages[0].reservationId, 'fictional-hold');
  assert.equal(calls.at(-1)[1].status, 'done');
});

test('meterFromSink: a refused reservation fails the call before the child runs; a lost usage report charges the hold (D-556)', { timeout: 20000 }, async t => {
  const script = scriptedModels();
  const refused = await open({ meter: meterFromSink({ sink: { reserveRun: async () => ({ kind: 'refused', reason: 'fictional: out of credits' }) }, scope: { userId: 'p' }, price: () => 0 }) }, script);
  t.after(() => refused.harness.close(context));
  const conversation = await refused.lead.createConversation(refused.harness, context);
  await ask(conversation, 'ask');
  const [result] = await delegateResults(conversation);
  assert.equal(result?.isError, true);
  assert.equal(script.calls.child, 0, 'the child never asked its model');

  const released = [];
  const lost = await open({ meter: meterFromSink({
    sink: { reserveRun: async () => ({}), recordUsage: async () => { throw new Error('fictional store down'); }, settleRun: async () => { released.push('settled'); }, releaseRun: async input => { released.push(input.reason); } },
    scope: { userId: 'p' }, price: () => 0,
  }) }, scriptedModels());
  t.after(() => lost.harness.close(context));
  assert.equal((await ask(await lost.lead.createConversation(lost.harness, context), 'ask')).status, 'done', 'the ledger failing does not fail the child');
  assert.deepEqual(released, ['usage-write-failed']);
});

test('meter gets each child model response once and is closed with done when the child ends', { timeout: 20000 }, async t => {
  const script = scriptedModels();
  const { log, meter } = recordingMeter();
  const { lead, harness } = await open({ meter }, script);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  assert.equal((await ask(conversation, 'ask')).status, 'done');
  const [child] = await children(conversation);

  assert.deepEqual(log[0], { open: [conversation.id, child.id] }, 'opened with the parent and the new child');
  const events = log.filter(item => item.event).map(item => item.event);
  assert.equal(events.length, 2, 'the lookup response and the answer');
  assert.equal(new Set(events.map(event => event.entryId)).size, 2, 'each response once');
  for (const event of events) {
    assert.equal(event.provider, 'fictional-faux');
    assert.equal(event.model, 'child');
    assert.equal(typeof event.usage.input, 'number');
    assert.equal(typeof event.usage.output, 'number');
  }
  assert.deepEqual(log.at(-1), { close: 'done' }, 'closed last, once');
  assert.equal(log.filter(item => item.close).length, 1);
});

test('timeoutMs cancels the child and reports the call failed with a timeout reason; the meter closes with timeout', { timeout: 20000 }, async t => {
  const script = scriptedModels({ hold: true });
  const { log, meter } = recordingMeter();
  const { lead, harness } = await open({ limits: { timeoutMs: 200 }, meter }, script);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  const started = Date.now();
  assert.equal((await ask(conversation, 'ask')).status, 'done', 'the parent turn goes on after the timeout');
  assert.ok(Date.now() - started < 5000, 'the call ended at its deadline, not when the child would have');
  assert.equal(script.calls.aborted, 1, 'the child\'s model request was aborted');

  const [result] = await delegateResults(conversation);
  assert.equal(result.isError, true);
  assert.equal(resultText(result), 'The researcher agent timed out after 200 ms.');
  assert.equal(result.details.status, 'failed');
  assert.equal(result.details.error, 'The researcher agent timed out after 200 ms.');
  const [child] = await children(conversation);
  assert.equal(result.details.conversationId, child.id);
  assert.deepEqual(log.at(-1), { close: 'timeout' });
  script.release();
});

test('childTools: the child gets the intersection of the allow list with its own tools', { timeout: 20000 }, async t => {
  const script = scriptedModels();
  const { lead, harness } = await open({ childTools: ['lookup', 'parent_only'] }, script, [lookup, vault]);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  assert.equal((await ask(conversation, 'ask')).status, 'done');
  const [record] = await children(conversation);
  const child = await harness.conversation(record.id, context);
  assert.deepEqual((await child.agent(context)).tools.map(tool => tool.name), ['lookup'], 'open_vault is not allowed; parent_only was never the child\'s');
  assert.equal((await delegateResults(conversation))[0].isError, false);
});

test('a replay that reattaches to its child is never refused and counts once (limits survive a crash rerun)', { timeout: 20000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-delegate-limits-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'native.sqlite');
  const limits = { maxRunningPerConversation: 1, maxStartsPerHour: 2 };
  const { log, meter } = recordingMeter();

  const first = scriptedModels({ hold: true });
  let { lead, registry } = agents({ limits, meter });
  let harness = await Harness.open(await openNodeSqliteStorage(file), { registry, models: first.models }, context);
  const conversation = await lead.createConversation(harness, context);
  await conversation.submit({ type: 'input', requestId: 'ask-1', content: 'Research the capital.' }, context);
  await until(() => first.calls.waiting === 1, 'the child request starts');
  await harness.close(context); // crash mid-call

  const second = scriptedModels();
  ({ lead, registry } = agents({ limits, meter }));
  harness = await Harness.open(await openNodeSqliteStorage(file), { registry, models: second.models }, context);
  t.after(() => harness.close(context));
  const again = await harness.conversation(conversation.id, context);
  harness.resume();
  assert.equal((await ask(again, 'ask-1')).status, 'done');
  const [rerun] = await delegateResults(again);
  assert.equal(rerun.isError, false, 'the rerun reattached instead of being refused');
  const [child] = await children(again);
  assert.equal(log.filter(item => item.open).length, 2, 'each process run gets its own meter handle for the child');
  assert.ok(log.filter(item => item.open).every(item => item.open[1] === child.id));

  assert.equal((await ask(again, 'ask-2')).status, 'done');
  assert.equal((await delegateResults(again))[1].isError, false, 'the reattached child counted once: a second start fits in the hour');
  assert.equal((await ask(again, 'ask-3')).status, 'done');
  const third = (await delegateResults(again))[2];
  assert.equal(third.isError, true);
  assert.equal(resultText(third), '2 delegates already started for this conversation in the last hour (limit 2).');
});

test('maxRunning counts per limits object: a delegate with its own literal has its own budget, as the refusal text says', { timeout: 20000 }, async t => {
  const script = scriptedModels({ hold: true });
  const { lead, harness, registry } = await open({ limits: { maxRunning: 1 } }, script);
  t.after(() => harness.close(context));
  const first = await lead.createConversation(harness, context);
  const firstDone = first.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context).then(submission => submission.wait(context));
  await until(() => script.calls.waiting === 1, 'the first child runs');
  // Same numbers, another object: not shared, so this call is not refused.
  const other = defineAgent({ id: 'other-lead', model: { provider: 'fictional-faux', modelId: 'parent' }, instructions: 'Delegate.', delegates: [{ agent: defineAgent({ id: 'researcher', model: { provider: 'fictional-faux', modelId: 'child' }, tools: [lookup] }), limits: { maxRunning: 1 } }] });
  other.install(registry);
  const second = await other.createConversation(harness, context);
  const secondDone = ask(second, 'ask');
  await until(() => script.calls.waiting === 2, 'the second child runs too');
  script.release();
  assert.equal((await firstDone).status, 'done');
  assert.equal((await secondDone).status, 'done');
  assert.equal((await delegateResults(second))[0].isError, false);
});

/**
 * The real delegate tool, run by Pi with its own `ToolExecutionApi` except for one fault: `fault(api)` returns overrides of
 * the api's methods (a commit whose AssistantEntry write throws, a details publish that throws).
 */
function faultyLead(meter, fault) {
  const researcher = defineAgent({ id: 'researcher', model: { provider: 'fictional-faux', modelId: 'child' }, instructions: 'Answer briefly.', tools: [lookup] });
  const real = createDelegateTool({ agent: researcher, meter });
  const faulty = { ...real, execute: (args, api, ctx) => {
    const overrides = fault(api);
    return real.execute(args, new Proxy(api, { get: (target, key) => key in overrides ? overrides[key] : typeof target[key] === 'function' ? target[key].bind(target) : target[key] }), ctx);
  } };
  const lead = defineAgent({ id: 'lead', model: { provider: 'fictional-faux', modelId: 'parent' }, instructions: 'Delegate research.', tools: [faulty] });
  const registry = createRegistry();
  lead.install(registry);
  researcher.install(registry);
  return { lead, registry };
}

test('meter: a delegate call that throws closes failed, whether its final commit or an earlier step threw', { timeout: 20000 }, async t => {
  const faults = {
    // The AssistantEntry commit that hands the child's answer to the parent fails.
    commit: api => ({ commit: (change, ctx) => api.commit(tx => change(new Proxy(tx, { get: (target, key) => key === 'entry'
      ? (doc, ...rest) => { if (doc === AssistantEntry) throw new Error('fictional commit failure'); return target.entry(doc, ...rest); }
      : typeof target[key] === 'function' ? target[key].bind(target) : target[key] })), ctx) }),
    // Publishing the running details fails, before the child is asked anything.
    details: () => ({ details: async () => { throw new Error('fictional details failure'); } }),
  };
  for (const [name, fault] of Object.entries(faults)) await t.test(`the ${name} step throws`, async t => {
    const script = scriptedModels();
    const { log, meter } = recordingMeter();
    const { lead, registry } = faultyLead(meter, fault);
    const harness = await Harness.open(new MemoryStorage(), { registry, models: script.models }, context);
    t.after(() => harness.close(context));
    const conversation = await lead.createConversation(harness, context);
    await ask(conversation, 'ask');
    const [result] = await delegateResults(conversation);
    assert.equal(result?.isError, true, `${name}: the call failed`);
    assert.equal(log.filter(item => item.close).length, 1, `${name}: closed once`);
    assert.deepEqual(log.at(-1), { close: 'failed' }, `${name}: a thrown call is metered failed, not done or cancelled`);
  });
});

test('meter: a delegate call stopped while its child runs closes cancelled', { timeout: 20000 }, async t => {
  const script = scriptedModels({ hold: true });
  const { log, meter } = recordingMeter();
  const { lead, harness } = await open({ meter }, script);
  t.after(() => harness.close(context));
  const conversation = await lead.createConversation(harness, context);
  const submission = await conversation.submit({ type: 'input', requestId: 'ask', content: 'Research the capital.' }, context);
  await until(() => script.calls.waiting === 1, 'the child request starts');
  await conversation.abort(context);
  await submission.wait(context).catch(() => undefined);
  await until(() => log.some(item => item.close), 'the meter is closed');
  assert.deepEqual(log.filter(item => item.close), [{ close: 'cancelled' }]);
  script.release();
});
