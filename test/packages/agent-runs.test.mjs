// Run orchestration shared by every home: the result protocol (schema, validator, repair budget, evidence), the run vocabulary and
// the delivery of a run's end, the outbox of starts, and the runner over a person's SQLite store. The model turns are the native
// Harness on a scripted (faux) model; stores are node:sqlite. Fictional data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent, jsonSchemaTool } from '@hachej/boring-agent/agents';
import {
  resultConfig, resultState, resultParameters, resultDescription, resultExecutor, runMessage, runResult, settleResult, validateResult, validationError, withEvidence,
} from '@hachej/boring-agent/run-result';
import { OVER_BUDGET, RUN_ENDS, deliverRunEnd, isOverBudget, sumUsage } from '@hachej/boring-agent/runs';
import { RunRefused, createRunLedger, createRunner } from '@hachej/boring-agent/run-ledger';
import { checkStarts, drainStarts, outboxOver, stageStarts } from '@hachej/boring-agent/run-outbox';

const schema = { type: 'object', properties: { verdict: { type: 'string', enum: ['yes', 'no'] }, note: { type: 'string' } }, required: ['verdict'], additionalProperties: false };
const card = (extra = {}) => ({
  name: 'triage',
  output: { name: 'submit_result', description: 'Submit the verdict.', input: schema },
  result: resultConfig({ validate: 'checks.verdict', repairs: 2, ...extra }, undefined, 'triage'),
});
const call = (args, id) => fauxAssistantMessage([fauxToolCall('submit_result', args, { id })], { stopReason: 'toolUse' });
const say = text => fauxAssistantMessage([fauxText(text)]);

/** A model response that never comes, until its request is aborted (the run is cancelled or the harness closes). */
const stalled = (_transcript, options) => new Promise((_resolve, reject) => {
  const abort = () => reject(new Error('aborted'));
  if (options?.signal?.aborted) abort(); else options?.signal?.addEventListener('abort', abort, { once: true });
});

/** A home for one scripted agent: the harness, the agent's conversations, and the operations the host would run. */
async function home(t, { script, validate = () => ({ valid: true }), agentCard = card() }) {
  const faux = fauxProvider({ provider: 'fictional-faux', models: [{ id: 'writer' }] });
  const seen = { model: 0, invoked: [] };
  faux.setResponses(script.map(step => (...args) => { seen.model++; return typeof step === 'function' ? step(...args) : step; }));
  const models = createModels();
  models.setProvider(faux.provider);
  const invoke = async (operation, input, key) => {
    seen.invoked.push({ operation, input, key });
    if (operation === agentCard.result?.validate) return validate(input, key);
    if (operation === 'deliver.fail-once' && seen.invoked.filter(i => i.operation === operation).length === 1) throw new Error('operation unavailable');
    return { ok: true };
  };
  const tool = jsonSchemaTool({ name: agentCard.output.name, description: resultDescription(agentCard), parameters: resultParameters(agentCard), replay: 'safe', execute: withEvidence({ execute: resultExecutor(agentCard, invoke) }).execute });
  const agent = defineAgent({ id: 'triage', model: { provider: 'fictional-faux', modelId: 'writer' }, instructions: 'Return the verdict.', tools: [tool] });
  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  t.after(() => harness.close(context));
  return { agent, harness, invoke, seen, card: agentCard };
}
async function run(h, input = { case: 'fictional-1' }) {
  const conversation = await h.agent.createConversation(h.harness, context);
  const submission = await conversation.submit({ type: 'input', content: runMessage(h.card, input) }, context);
  return { conversation, submission };
}
const settle = async h => { const { conversation, submission } = await run(h); return { conversation, ...(await settleResult({ card: h.card, conversation, submission, invoke: h.invoke, context })) }; };

test('resultConfig: defaults, the schema from tool.json, and the refusals name the agent', () => {
  assert.deepEqual(resultConfig(undefined, { input: schema }, 'a'), { schema, repairs: 2 });
  assert.deepEqual(resultConfig({ validate: 'checks.x', repairs: 0 }, undefined, 'a'), { validate: 'checks.x', repairs: 0 });
  assert.throws(() => resultConfig({ repairs: 11 }, undefined, 'a'), /agents\/a: result.repairs/);
  assert.throws(() => resultConfig({ validate: 'not an op' }, undefined, 'a'), /agents\/a: result.validate/);
  assert.throws(() => resultConfig({ schema: { type: 'array' } }, undefined, 'a'), /object JSON Schema/);
  assert.throws(() => resultConfig([], undefined, 'a'), /result is/);
});

test('a result the model submits is validated twice (attempt, then delivery) and returned with its evidence record', async t => {
  const h = await home(t, { script: [call({ verdict: 'yes' }, 'c1'), say('Done.')] });
  const settled = await settle(h);
  assert.deepEqual(settled.result, { output: { verdict: 'yes' } });
  assert.equal(settled.validation.card.name, 'triage');
  const validations = h.seen.invoked.filter(i => i.operation === 'checks.verdict');
  assert.deepEqual(validations.map(v => v.input.phase), [undefined, 'delivery'], 'once while answering, once more as the delivery check');
  assert.match(validations[1].key, /^result-delivery:\d+:/);
  assert.equal(h.seen.model, 2);
});

test('a call that breaks the schema is refused by Pi before the tool runs and repaired inside the turn, without a follow-up input', async t => {
  const h = await home(t, { script: [call({ verdict: 'maybe' }, 'c1'), call({ verdict: 'no' }, 'c2'), say('Done.')] });
  const settled = await settle(h);
  assert.deepEqual(settled.result, { output: { verdict: 'no' } });
  const refused = (await settled.conversation.context(context)).messages.filter(m => m.role === 'toolResult');
  assert.equal(refused[0].isError, true);
  assert.match(refused[0].content[0].text, /Validation failed for tool "submit_result"/, 'Pi\'s own argument validation answers first');
  assert.equal((await settled.conversation.context(context)).messages.filter(m => m.role === 'user').length, 1, 'no follow-up input was needed');
});

test('the validator operation decides, and its hint is what the model is told', async t => {
  const answers = [{ valid: false, hint: 'The note is required when the verdict is no.' }, { valid: true }];
  const h = await home(t, { script: [call({ verdict: 'no' }, 'c1'), call({ verdict: 'no', note: 'because' }, 'c2'), say('Done.')], validate: () => answers.shift() ?? { valid: true } });
  const settled = await settle(h);
  assert.deepEqual(settled.result, { output: { verdict: 'no', note: 'because' } });
  const told = (await settled.conversation.context(context)).messages.filter(m => m.role === 'toolResult').map(m => m.content[0].text);
  assert.ok(told.includes('Invalid result: The note is required when the verdict is no.'));
});

test('a turn that ends without the result tool is asked again with a native follow-up (repair:<conversation>:<n>), then ends invalid_output when the budget is gone', async t => {
  const h = await home(t, { agentCard: card({ repairs: 1 }), script: [say('I think yes.'), say('Still yes.'), say('Yes.')] });
  const settled = await settle(h);
  assert.equal(settled.end, 'invalid_output');
  assert.equal(settled.error, 'Return the result using submit_result.', 'the hint of the last miss');
  const inputs = (await settled.conversation.context(context)).messages.filter(m => m.role === 'user').map(m => (typeof m.content === 'string' ? m.content : m.content.map(p => p.text).join('')));
  assert.equal(inputs.filter(text => text.startsWith('Invalid result:')).length, 1, 'repairs: 1 means one follow-up');
  assert.ok(h.seen.model <= 3);
});

test('a turn that is aborted settles as interrupted, any other non-answer as an error', async t => {
  const h = await home(t, { script: [stalled] });
  const { conversation, submission } = await run(h);
  await new Promise(resolve => setTimeout(resolve, 30));
  await conversation.abort(context);
  const settled = await settleResult({ card: h.card, conversation, submission, invoke: h.invoke, context });
  assert.equal(settled.end, 'interrupted');
});

test('validators that throw: a refusal by authority is revoked, anything else an error', () => {
  assert.deepEqual(validationError(Object.assign(new Error('no'), { status: 403 })), { error: 'no', end: 'revoked' });
  assert.deepEqual(validationError(Object.assign(new Error('no'), { status: 401 })), { error: 'no', end: 'revoked' });
  assert.deepEqual(validationError(new Error('boom')), { error: 'boom', end: 'error' });
});

test('validateResult: schema first without coercion, then the operation, whose answer shape is checked', async () => {
  const c = card();
  assert.equal((await validateResult(c, { verdict: 'yes', extra: 1 }, [], async () => ({ valid: true }), 'attempt', 'k')).valid, false);
  assert.equal((await validateResult(c, { verdict: 'yes' }, [], async () => ({ valid: true }), 'attempt', 'k')).valid, true);
  await assert.rejects(validateResult(c, { verdict: 'yes' }, [], async () => ({ ok: true }), 'attempt', 'k'), /expected \{ valid: boolean, hint\?: string \}/);
});

test('resultState: only a host tool result accepts a call, and the budget counts calls plus misses', () => {
  const c = card({ repairs: 1 });
  const msgs = (accepted) => [
    { role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'submit_result', arguments: { verdict: 'yes' } }] },
    { role: 'toolResult', toolCallId: 'a', toolName: 'submit_result', isError: !accepted, details: { resultValidation: { valid: accepted } } },
  ];
  assert.deepEqual(resultState(c, msgs(true)).accepted, { verdict: 'yes' });
  assert.equal(resultState(c, msgs(false)).accepted, null);
  assert.equal(resultState(c, msgs(false)).exhausted, false, 'one attempt of two used');
  assert.equal(resultState(c, msgs(false), 1).exhausted, true, 'a recorded miss uses the second');
  assert.deepEqual(runResult({ name: 'plain' }, [{ role: 'assistant', content: [{ type: 'text', text: 'Hello' }] }]), { text: 'Hello' });
  assert.equal(runResult({ name: 'plain' }, []), null);
  assert.match(runMessage(c, { a: 1 }), /calling the tool submit_result exactly once/);
});

test('sumUsage adds the answers of a run; no answer is null; over_budget is recognised by code', () => {
  const answer = (n, model) => ({ role: 'assistant', model, usage: { input: n, output: 2 * n, cacheRead: 1, cacheWrite: 0, cost: { total: 0.5 } } });
  assert.deepEqual(sumUsage([answer(1, 'm1'), { role: 'user' }, answer(2, 'm1'), answer(3, 'm2')]), { input: 6, output: 12, cacheRead: 3, cacheWrite: 0, cost: 1.5, models: ['m1', 'm2'] });
  assert.equal(sumUsage([{ role: 'user' }]), null);
  assert.ok(isOverBudget({ code: OVER_BUDGET }) && isOverBudget({ extra: { code: OVER_BUDGET } }) && !isOverBudget(new Error('x')));
  assert.deepEqual([...RUN_ENDS], ['completed', 'invalid_output', 'cancelled', 'interrupted', 'revoked', 'error']);
});

test('deliverRunEnd: bounded attempts under one receipt key; a completed end is checked again and downgraded when it fails', async () => {
  const keys = [];
  let failures = 1;
  const invoke = async (operation, input, key) => { keys.push([key, input.status]); if (failures-- > 0) throw new Error('unavailable'); };
  const sent = await deliverRunEnd({ operation: 'triage.delivered', key: 'k1', end: { status: 'completed', output: { verdict: 'yes' }, usage: null }, invoke, backoffMs: 1 });
  assert.equal(sent.delivered, true);
  assert.deepEqual(keys, [['deliver:k1', 'completed'], ['deliver:k1', 'completed']], 'the same receipt key on the retry');

  const told = [];
  const downgraded = await deliverRunEnd({ operation: 'triage.delivered', key: 'k2', end: { status: 'completed', output: { verdict: 'yes' }, usage: null }, backoffMs: 1,
    invoke: async (operation, input) => { told.push(input); }, recheck: async () => ({ error: 'The record changed.', end: 'invalid_output' }), onFailure: failure => told.push(failure.end) });
  assert.equal(downgraded.delivered, true);
  assert.deepEqual(downgraded.failure, { error: 'The record changed.', end: 'invalid_output' });
  assert.equal(told[0], 'invalid_output');
  assert.deepEqual(told[1], { run: 'k2', status: 'invalid_output', usage: null, error: 'The record changed.' }, 'no output is delivered for a failed end');

  const never = await deliverRunEnd({ operation: 'triage.delivered', key: 'k3', end: { status: 'error', usage: null }, backoffMs: 1, invoke: async () => { throw new Error('down'); } });
  assert.equal(never.delivered, false);
  assert.match(never.error, /deliver triage.delivered: down/);

  const sentAfterOutage = [];
  let outages = 3;
  const outage = { operation: 'triage.delivered', end: { status: 'completed', output: { verdict: 'yes' }, usage: null }, backoffMs: 1, attempts: 3,
    invoke: async (operation, input) => { sentAfterOutage.push(input.status); },
    recheck: async () => { if (outages-- > 0) throw Object.assign(new Error('validator down'), { status: 503 }); }, onFailure: () => sentAfterOutage.push('failed') };
  const held = await deliverRunEnd({ ...outage, key: 'k4' });
  assert.equal(held.delivered, false, 'a re-check that cannot run holds the delivery');
  assert.deepEqual(sentAfterOutage, [], 'and never changes the completed end');
  const later = await deliverRunEnd({ ...outage, key: 'k4' });
  assert.deepEqual([later.delivered, later.end.status, sentAfterOutage], [true, 'completed', ['completed']]);

  const revoked = await deliverRunEnd({ ...outage, key: 'k5', recheck: async () => { throw Object.assign(new Error('no'), { status: 403 }); } });
  assert.deepEqual([revoked.delivered, revoked.end.status], [true, 'revoked'], 'a refusal by authority still downgrades it');
});

const sqlOf = db => (text, params = []) => db.prepare(text).all(...params);

test('outbox: staged in the caller\'s transaction, launched with the key, acknowledged, retried with backoff, dropped when refused for good', async () => {
  const db = new DatabaseSync(':memory:');
  const sql = sqlOf(db);
  const person = { id: 'p1' };
  db.exec('BEGIN');
  stageStarts(sql, { actor: 'op.save', person, at: '2026-10-27T10:00:00Z', starts: [
    { key: 'a', agent: 'triage', input: { n: 1 }, deliver: 'triage.delivered' },
    { key: 'a', agent: 'triage', input: { n: 1 }, deliver: 'triage.delivered' },
    { key: 'b', agent: 'triage', input: 'text', model: 'anthropic:claude-sonnet-5-5', effort: 'high' },
    { key: 'c', agent: 'triage' },
  ] });
  db.exec('ROLLBACK');
  assert.deepEqual(outboxOver(sql).due(0), [], 'a rolled-back operation leaves nothing to launch');

  db.exec('BEGIN');
  stageStarts(sql, { actor: 'op.save', person, at: '2026-10-27T10:00:00Z', starts: [
    { key: 'a', agent: 'triage', input: { n: 1 }, deliver: 'triage.delivered' },
    { key: 'b', agent: 'triage', input: 'text', model: 'anthropic:claude-sonnet-5-5', effort: 'high' },
    { key: 'c', agent: 'triage' },
  ] });
  db.exec('COMMIT');
  const outbox = outboxOver(sql);
  const due = outbox.due(0);
  assert.deepEqual(due.map(r => r.key), ['a', 'b', 'c']);
  assert.deepEqual([due[1].model, due[1].effort, due[0].person], ['anthropic:claude-sonnet-5-5', 'high', person]);

  const launched = [];
  const first = await drainStarts(outbox, { now: 1000, launch: async row => { launched.push(row.key); return row.key === 'a' ? { ok: true } : row.key === 'b' ? { ok: false, retry: true } : { ok: false, status: 409 }; }, onDrop: row => launched.push(`dropped:${row.key}`) });
  assert.deepEqual(first, { launched: ['a'], retried: ['b'], dropped: ['c'] });
  assert.equal(outbox.pending('op.save', 'a'), null, 'acknowledged');
  assert.equal(outbox.pending('op.save', 'c'), null, 'dropped');
  assert.equal(outbox.pending('op.save', 'b').attempts, 1);
  assert.equal(outbox.next(), 2000, 'backs off one second');
  assert.deepEqual((await drainStarts(outbox, { now: 1500, launch: async () => ({ ok: true }) })).launched, [], 'not due yet');
  assert.deepEqual((await drainStarts(outbox, { now: 2000, launch: async () => { throw new Error('boom'); } })).retried, ['b'], 'a throwing launch is a retry');

  assert.throws(() => checkStarts([{ key: 'x', agent: 'a', input: 1 }, { key: 'x', agent: 'a', input: 2 }]), /used twice with different runs/);
  assert.throws(() => checkStarts([{ key: 'bad key', agent: 'a' }]), /key is 1 to 100/);
  assert.throws(() => checkStarts([{ key: 'k', agent: 'a', effort: 'huge' }]), /effort is one of/);
  assert.throws(() => checkStarts(Array.from({ length: 21 }, (_, i) => ({ key: `k${i}`, agent: 'a' }))), /at most 20/);
});

/** A runner over one person's store, on the scripted agent. */
async function runnerOver(t, h, { db = new DatabaseSync(':memory:'), admit, known = ['triage'], deliverBackoffMs = 1 } = {}) {
  const ledger = createRunLedger(sqlOf(db));
  const runner = createRunner({
    ledger, person: { id: 'p1' }, context, has: name => known.includes(name), invoke: h.invoke, admit, deliverBackoffMs,
    prepare: async (name, input) => { const { conversation, submission } = await run(h, input); return { conversation, submission, card: h.card }; },
    usage: async conversation => sumUsage((await conversation.context(context)).messages),
  });
  return { runner, ledger, db };
}
const settledRun = async (runner, key) => { for (let i = 0; i < 200; i++) { const v = await runner.status(key); if (v && !['running', 'queued'].includes(v.status)) return v; await new Promise(r => setTimeout(r, 10)); } throw new Error('run did not end'); };
const deliveries = (h, key) => h.seen.invoked.filter(i => i.operation === 'triage.delivered' && i.key === `deliver:${key}`);

test('runner: a started run completes, is delivered once under deliver:<key>, and the same key is the same run', async t => {
  const h = await home(t, { script: [call({ verdict: 'yes' }, 'c1'), say('Done.')] });
  const { runner } = await runnerOver(t, h);
  const started = await runner.start('triage', { case: 1 }, 'run-1', 'triage.delivered');
  assert.equal(started.status, 'running');
  assert.ok(started.startedAt);
  const ended = await settledRun(runner, 'run-1');
  assert.deepEqual([ended.status, ended.output], ['completed', { verdict: 'yes' }]);
  assert.deepEqual(ended.usage.models, ['writer']);
  assert.ok(ended.usage.input > 0 && ended.usage.output > 0, 'the run reports what its model answers used');
  const sent = deliveries(h, 'run-1');
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].input.run, sent[0].input.status, sent[0].input.output], ['run-1', 'completed', { verdict: 'yes' }]);
  assert.deepEqual(sent[0].input.usage, ended.usage, 'the delivery carries the same usage');

  const again = await runner.start('triage', { case: 'different input' }, 'run-1', 'triage.delivered');
  assert.equal(again.status, 'completed', 'a replay of the key returns the run, whatever else is asked');
  assert.equal(h.seen.model, 2, 'no second conversation, no second model turn');
  await assert.rejects(runner.start('nobody', 1, 'run-2', null), error => error instanceof RunRefused && error.status === 404);
});

test('runner: a key that belongs to another agent is refused 409', async t => {
  const h = await home(t, { script: [call({ verdict: 'yes' }, 'c1'), say('Done.')] });
  const { runner } = await runnerOver(t, h, { known: ['triage', 'other'] });
  await runner.start('triage', 1, 'run-1', null);
  await assert.rejects(runner.start('other', 1, 'run-1', null), error => error instanceof RunRefused && error.status === 409);
});

test('runner: an end that cannot be delivered now stays pending and is delivered by recover, once', async t => {
  const h = await home(t, { script: [call({ verdict: 'yes' }, 'c1'), say('Done.')] });
  let up = false;
  const refused = [];
  const flaky = async (operation, input, key) => {
    if (operation === 'triage.delivered' && !up) { refused.push(key); throw new Error('down'); }
    return h.invoke(operation, input, key);
  };
  const ledger = createRunLedger(sqlOf(new DatabaseSync(':memory:')));
  const runner = createRunner({ ledger, person: { id: 'p1' }, context, has: () => true, invoke: flaky, deliverBackoffMs: 1,
    prepare: async (name, input) => { const { conversation, submission } = await run(h, input); return { conversation, submission, card: h.card }; } });
  await runner.start('triage', 1, 'run-1', 'triage.delivered');
  for (let i = 0; i < 200 && refused.length < 3; i++) await new Promise(r => setTimeout(r, 10));
  await new Promise(r => setTimeout(r, 30));
  assert.deepEqual(refused, ['deliver:run-1', 'deliver:run-1', 'deliver:run-1'], 'three bounded attempts under one receipt key');
  assert.equal(ledger.left().length, 1, 'the end is kept as undelivered');
  up = true;
  assert.equal((await runner.status('run-1')).status, 'completed');
  assert.equal(deliveries(h, 'run-1').length, 1, 'delivered by recover, once');
  assert.equal(ledger.left().length, 0);
});

test('runner: cancel ends the run once, aborts its turn and delivers cancelled; a run that ended stays as it is', async t => {
  const h = await home(t, { script: [stalled] });
  const { runner } = await runnerOver(t, h);
  await runner.start('triage', 1, 'run-1', 'triage.delivered');
  await new Promise(r => setTimeout(r, 40));
  const cancelled = await runner.cancel('run-1');
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(deliveries(h, 'run-1').map(d => d.input.status), ['cancelled']);
  assert.equal((await runner.cancel('run-1')).status, 'cancelled', 'cancelling again changes nothing');
  assert.equal(deliveries(h, 'run-1').length, 1);
  assert.equal(await runner.cancel('nope'), null);
  await new Promise(r => setTimeout(r, 250)); // the aborted turn settles after the cancel and tries to end the run too
  assert.equal((await settledRun(runner, 'run-1')).status, 'cancelled', 'the late end of the turn does not overwrite it');
  assert.equal(deliveries(h, 'run-1').length, 1, 'and is not delivered a second time');
});

test('runner: a process that stopped mid-run leaves it interrupted, and delivered, by the next one', async t => {
  const h = await home(t, { script: [] });
  const db = new DatabaseSync(':memory:');
  const ledger = createRunLedger(sqlOf(db));
  ledger.begin({ key: 'old', agent: 'triage', deliver: 'triage.delivered', person: { id: 'p1' }, startedAt: '2026-10-27T09:00:00Z' });
  const { runner } = await runnerOver(t, h, { db });
  const view = await runner.status('old');
  assert.deepEqual([view.status, view.error], ['interrupted', 'the process stopped before the run ended']);
  assert.deepEqual(deliveries(h, 'old').map(d => d.input.status), ['interrupted']);
  await runner.status('old');
  assert.equal(deliveries(h, 'old').length, 1, 'once');
});

test('runner: over the spend cap a run is never started and ends error: over_budget, delivered', async t => {
  const h = await home(t, { script: [] });
  const { runner } = await runnerOver(t, h, { admit: () => { throw Object.assign(new Error('budget reached'), { code: OVER_BUDGET, status: 429 }); } });
  await runner.start('triage', 1, 'run-1', 'triage.delivered');
  const ended = await settledRun(runner, 'run-1');
  assert.deepEqual([ended.status, ended.error], ['error', OVER_BUDGET]);
  assert.equal(h.seen.model, 0, 'no model call');
  assert.deepEqual(deliveries(h, 'run-1').map(d => d.input.error), [OVER_BUDGET]);
});

test('runner: a completed run that no longer validates at delivery is delivered as invalid_output, never as completed', async t => {
  let phaseSeen = 0;
  const h = await home(t, { script: [call({ verdict: 'yes' }, 'c1'), say('Done.')], validate: input => (input.phase === 'delivery' && ++phaseSeen > 1 ? { valid: false, hint: 'The record changed.' } : { valid: true }) });
  const { runner } = await runnerOver(t, h);
  await runner.start('triage', 1, 'run-1', 'triage.delivered');
  const ended = await settledRun(runner, 'run-1');
  assert.deepEqual([ended.status, ended.error], ['invalid_output', 'The record changed.']);
  assert.deepEqual(deliveries(h, 'run-1').map(d => d.input.status), ['invalid_output']);
});
