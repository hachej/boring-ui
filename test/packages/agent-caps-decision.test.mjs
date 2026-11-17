// The decision capability (caps/decision): questions about a state answered with a confidence through pi-ai's classify, `pickOne` that
// never throws, and the pi-durable tool `decide`. Offline: the fake, scripted pi-ai classifiers, or a `fetch` double behind pi's real
// typesafe and openrouter providers; the global `fetch` throws and is checked never called. Fictional data only; planted keys appear nowhere.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import baseTest from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { decisionTool, pickOne, run } from '@hachej/boring-agent/caps/decision';

const test = (name, body) => baseTest(name, async (t) => {
  const saved = globalThis.fetch, reached = [];
  globalThis.fetch = (...args) => { reached.push(args); throw new Error('the network is off'); };
  try { await body(t); } finally { globalThis.fetch = saved; }
  assert.deepEqual(reached, [], 'the global fetch was never called');
});

const foods = JSON.parse(readFileSync(new URL('../fixtures/caps/decision/foods.json', import.meta.url), 'utf8'));
const KEYS = { TYPESAFE_API_KEY: 'ts-PLANTED', OPENROUTER_API_KEY: 'or-PLANTED' };
const choice = (criteria = { cafe: 'Un café', the: 'Un thé' }) => ({ type: 'choice', instructions: 'Quelle boisson ?', criteria });
const ask = (questions = { a: choice(), b: choice() }, state = { line: 'Café 3,50 €' }) => ({ state, questions });
const COST = { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 };
/** pi-ai Models holding scripted classifiers for typesafe/jev-latest and openrouter/typesafe/jev-1.14; `script[pi]` returns part of the result. */
function world(script = {}) {
  const models = createModels(), calls = { typesafe: 0, openrouter: 0 }, seen = [];
  for (const [pi, id] of [['typesafe', 'jev-latest'], ['openrouter', 'typesafe/jev-1.14']]) {
    const classify = async (model, ctx, options) => { calls[pi] += 1; seen.push({ pi, ctx, options }); return { api: 'scripted', provider: pi, model: id, answers: {}, stopReason: 'stop', timestamp: 0, ...(await script[pi]?.(ctx, options)) }; };
    models.setProvider(createProvider({ id: pi, auth: { apiKey: { name: 'k', resolve: async () => ({ auth: {} }) } }, classifiers: { scripted: { classify } },
      models: [{ type: 'classifier', id, name: id, api: 'scripted', provider: pi, baseUrl: '', input: ['text'], cost: COST, contextWindow: 64_000 }] }));
  }
  return { models, calls, seen };
}
const says = (answers, extra = {}) => () => ({ answers, ...extra });
const usage = { input: 10, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 0.00001, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.00001 } };
function sink(refuse) {
  const calls = [], log = (name) => async (input) => { calls.push([name, input]); return name === 'recordUsage' ? { billedMicros: input.amountMicros } : name === 'reserveRun' ? (refuse ? { kind: 'refused', reason: refuse } : { reservationId: 'r1' }) : undefined; };
  return { calls, names: () => calls.map(([n]) => n), reserveRun: log('reserveRun'), recordUsage: log('recordUsage'), settleRun: log('settleRun'), releaseRun: log('releaseRun') };
}
const ts = (extra) => ({ providers: ['typesafe'], keys: KEYS, ...extra });

test('decision plain import: the fake answers with no host, no key, no network', async () => {
  assert.deepEqual(await run(ask(), { providers: ['fake'] }), { ok: true, answers: { a: { type: 'choice', choice: 'cafe', confidence: 0.5 }, b: { type: 'choice', choice: 'cafe', confidence: 0.5 } }, untrusted: true, provider: 'fake', region: 'none', counted: false });
  const pick = { state: { line: 'Café 3,50 €' }, options: { cafe: 'Un café', the: 'Un thé' }, threshold: 0.7, timeoutMs: 700 };
  assert.deepEqual(await pickOne(pick, { providers: ['fake'] }), { choice: 'none', confidence: 0.5, reason: 'below-threshold', counted: false });
  const fixtures = [{ match: { state: 'Café' }, answer: { choice: 'the', confidence: 0.9 } }];
  assert.deepEqual(await pickOne(pick, { providers: ['fake'], fixtures }), { choice: 'the', confidence: 0.9, provider: 'fake', counted: false });
  const mixed = await run(ask({ s: { type: 'score', instructions: 'Combien ?', criteria: ['peu', 'moyen', 'beaucoup'] }, y: { type: 'yes_no', instructions: 'Une boisson ?' } }), { providers: ['fake'] });
  assert.deepEqual(mixed.answers, { s: { type: 'score', score: 1, confidence: 0.5 }, y: { type: 'yes_no', answer: false, confidence: 0.5 } });
});

test('decision limits: each refused before anything is sent', async () => {
  const w = world(), s = sink(), options = ts({ models: w.models, meter: { sink: s, userId: 'u' } });
  const many = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`q${i}`, choice()]));
  const cases = {
    'decision-questions:8': [ask({}), ask(many(9))],
    'decision-options:12': [ask({ a: choice({ seul: 'Un seul' }) }), ask({ a: choice(Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`o${i}`, 'x']))) }), ask({ a: { type: 'score', instructions: 'x', criteria: ['un'] } })],
    'decision-state:24000': [ask(undefined, { line: 'x'.repeat(24_001) }), ask(undefined, 'texte'), ask(undefined, ['a'])],
    'decision-instructions:2000': [ask({ a: { ...choice(), instructions: 'x'.repeat(2001) } }), ask({ a: choice({ cafe: 'x'.repeat(401), the: 'Un thé' }) })],
    'decision-key': [ask({ 'A-b': choice() }), ask({ '1a': choice() })],
  };
  for (const [kind, inputs] of Object.entries(cases)) for (const input of inputs) assert.deepEqual(await run(input, options), { ok: false, kind, retryable: false }, kind);
  assert.deepEqual([w.calls.typesafe, s.calls.length], [0, 0]);
});

test('decision checks: only what was asked, in range, at a confidence in [0, 1]; yes_no is pi\'s bool', async () => {
  const w = world({ typesafe: says({
    a: { type: 'choice', choice: 'cafe', probabilities: {}, confidence: 0.9 }, b: { type: 'choice', choice: 'biere', probabilities: {}, confidence: 0.9 },
    c: { type: 'score', score: 5, confidence: 0.9 }, d: { type: 'choice', choice: 'the', probabilities: {}, confidence: 1.2 }, e: { type: 'score', score: 1, confidence: 0.7 },
    y: { type: 'bool', probability: 0.2 }, z: { type: 'bool', probability: 0.9 }, extra: { type: 'choice', choice: 'cafe', probabilities: {}, confidence: 1 },
  }) });
  const levels = { type: 'score', instructions: 'Combien ?', criteria: ['peu', 'beaucoup'] }, yes = { type: 'yes_no', instructions: 'Une boisson ?' };
  const result = await run(ask({ a: choice(), b: choice(), c: levels, d: choice(), e: levels, y: yes, z: { ...yes, type: 'choice', criteria: { a: 'A', b: 'B' } } }), ts({ models: w.models }));
  assert.deepEqual(result.answers, { a: { type: 'choice', choice: 'cafe', confidence: 0.9 }, e: { type: 'score', score: 1, confidence: 0.7 }, y: { type: 'yes_no', answer: false, confidence: 0.8 } });
  assert.deepEqual(w.seen[0].ctx.questions.y, { type: 'bool', instructions: 'Une boisson ?', criteria: { true: 'yes', false: 'no' } });
  const none = world({ typesafe: says({ a: { type: 'choice', choice: 'biere', probabilities: {}, confidence: 1 } }) });
  const dropped = await run(ask({ a: choice() }), ts({ models: none.models }));
  assert.deepEqual([dropped.ok, dropped.answers], [true, {}]);
});

test('decision meter: one reserve, one record per classifier usage, then settle; nothing of the state reaches the sink', async () => {
  const w = world({ typesafe: says({ a: { type: 'choice', choice: 'cafe', probabilities: {}, confidence: 0.9 } }, { usage }) }), s = sink();
  const input = ask({ a: choice() }, { line: 'PLANTED-STATE-TEXT' });
  const result = await run(input, ts({ models: w.models, meter: { sink: s, userId: 'camille' } }));
  assert.equal(result.counted, true);
  assert.deepEqual(s.names(), ['reserveRun', 'recordUsage', 'settleRun']);
  const [, reserve] = s.calls[0], [, recorded] = s.calls[1];
  assert.match(reserve.runId, /^decision:[0-9a-f]{16}:.+$/);
  assert.deepEqual([reserve.userId, reserve.conversationId, reserve.message, reserve.content], ['camille', 0, '', null]);
  assert.deepEqual([recorded.bucket, recorded.amountMicros, s.calls[2][1].status], ['model:typesafe/jev-latest', 10, 'done']);
  assert.ok(!JSON.stringify(s.calls).includes('PLANTED'));
  const refusing = sink('daily-share:50'), before = w.calls.typesafe;
  assert.deepEqual(await run(input, ts({ models: w.models, meter: { sink: refusing, userId: 'camille' } })), { ok: false, kind: 'daily-share:50', retryable: false });
  const pick = await pickOne({ state: input.state, options: choice().criteria, threshold: 0.7, timeoutMs: 700 }, ts({ models: w.models, meter: { sink: refusing, userId: 'camille' } }));
  assert.deepEqual(pick, { choice: 'none', confidence: 0, reason: 'error', code: 'daily-share:50', counted: false });
  assert.equal(w.calls.typesafe, before);
  assert.equal((await run(input, ts({ models: w.models }))).counted, false);
});

test('decision pick never throws: every failure is none with a reason', async () => {
  const pick = (extra = {}, options = { providers: ['fake'] }) => pickOne({ state: { line: 'Café' }, options: { cafe: 'Un café', the: 'Un thé' }, threshold: 0.7, timeoutMs: 700, ...extra }, options);
  for (const [extra, code] of [[{ threshold: undefined }, 'decision-threshold'], [{ threshold: 1.5 }, 'decision-threshold'], [{ timeoutMs: 0 }, 'decision-timeout:60000'], [{ timeoutMs: 60_001 }, 'decision-timeout:60000'], [{ options: { none: 'rien', cafe: 'Un café' } }, 'decision-none'], [{ state: 'texte' }, 'decision-state:24000']]) {
    assert.deepEqual(await pick(extra), { choice: 'none', confidence: 0, reason: 'error', code, counted: false });
  }
  assert.deepEqual(await pickOne(undefined, { providers: ['fake'] }), { choice: 'none', confidence: 0, reason: 'error', code: 'decision-threshold', counted: false });
  const down = world({ typesafe: says({}, { stopReason: 'error' }) });
  assert.deepEqual(await pick({}, ts({ models: down.models })), { choice: 'none', confidence: 0, reason: 'error', code: 'unavailable', counted: false });
  let signal;
  const slow = world({ typesafe: async (ctx, options) => { signal = options.signal; await new Promise((r) => setTimeout(r, 200)); return { answers: {} }; } });
  const started = Date.now();
  assert.deepEqual(await pick({ timeoutMs: 40 }, ts({ models: slow.models, timeoutMs: 5000 })), { choice: 'none', confidence: 0, reason: 'timeout', counted: false });
  assert.ok(Date.now() - started < 150 && signal.aborted);
  const low = world({ typesafe: says({ pick: { type: 'choice', choice: 'the', probabilities: {}, confidence: 0.6 } }, { usage }) });
  assert.deepEqual(await pick({}, ts({ models: low.models, meter: { sink: sink(), userId: 'u' } })), { choice: 'none', confidence: 0.6, reason: 'below-threshold', counted: true });
  assert.deepEqual(await pick({}, ts({ models: low.models })), { choice: 'none', confidence: 0.6, reason: 'below-threshold', counted: false });
});

test('decision failover: an error moves on, a listed provider only, pi asked for no retry, keys only from `keys`', async () => {
  const answer = { a: { type: 'choice', choice: 'the', probabilities: {}, confidence: 0.9 } };
  const w = world({ typesafe: says({}, { stopReason: 'error' }), openrouter: says(answer) });
  const both = await run(ask({ a: choice() }), { providers: ['typesafe', 'openrouter-jev'], keys: KEYS, models: w.models });
  assert.deepEqual([both.provider, both.answers.a.choice, w.calls.typesafe, w.calls.openrouter, w.seen[0].options.maxRetries], ['openrouter-jev', 'the', 1, 1, 0]);
  assert.deepEqual(await run(ask({ a: choice() }), ts({ models: w.models })), { ok: false, kind: 'unavailable', retryable: true });
  assert.equal(w.calls.openrouter, 1);
  process.env.TYPESAFE_API_KEY = 'ts-PLANTED-env';
  try {
    const seen = [], s = sink(), wire = { type: 'choice', choice: 'cafe', probabilities: { cafe: 0.9 }, confidence: 0.9 };
    const answers = (init) => Object.fromEntries(Object.keys(JSON.parse(init.body).questions).map((k) => [k, wire]));
    const fetch = async (url, init) => { seen.push([String(url), init]); return String(url).includes('typesafe.ai') ? new Response('busy', { status: 503 }) : Response.json({ answers: answers(init), usage: { input_tokens: 100, output_tokens: 1 } }); };
    const pick = await pickOne({ state: { line: 'Café' }, options: { cafe: 'Un café', the: 'Un thé' }, threshold: 0.7, timeoutMs: 5000 }, { providers: ['typesafe', 'openrouter-jev'], keys: KEYS, fetch, meter: { sink: s, userId: 'u' } });
    assert.deepEqual([pick.choice, pick.provider, seen.map(([u]) => new URL(u).host)], ['cafe', 'openrouter-jev', ['api.typesafe.ai', 'openrouter.ai']]);
    assert.ok(s.calls.some(([n, i]) => n === 'recordUsage' && i.amountMicros > 0));
    seen.length = 0;
    const skipped = await run(ask({ a: choice() }), { providers: ['typesafe', 'openrouter-jev'], keys: { OPENROUTER_API_KEY: 'or-PLANTED' }, fetch });
    assert.deepEqual([skipped.provider, seen.map(([u]) => new URL(u).host)], ['openrouter-jev', ['openrouter.ai']]);
    for (const text of [JSON.stringify(pick), JSON.stringify(s.calls), JSON.stringify(skipped)]) assert.ok(!text.includes('PLANTED'));
  } finally { delete process.env.TYPESAFE_API_KEY; }
});

test('decision coach max: a scripted food is kept as sure, the other item of the same sentence is left to the search', async () => {
  const [tarte, jus] = foods, fixtures = [{ match: { state: { item: 'tarte aux pommes' } }, answer: { choice: 'tarte-pommes', confidence: 0.9 } }];
  const pick = (food) => pickOne({ state: { sentence: food.sentence, item: food.item }, options: food.options, threshold: 0.7, timeoutMs: 700, instructions: 'Quel aliment de la table ?' }, { providers: ['fake'], fixtures });
  assert.equal(tarte.sentence, jus.sentence);
  assert.deepEqual(await pick(tarte), { choice: 'tarte-pommes', confidence: 0.9, provider: 'fake', counted: false });
  const other = await pick(jus);
  assert.deepEqual([other.choice, other.reason], ['none', 'below-threshold']);
  const verdict = (p, hits) => (p.choice === 'none' ? { food: hits[0], check: true } : { food: p.choice, check: false });
  assert.deepEqual(verdict(other, Object.keys(jus.options)), { food: 'orange', check: true });
});

test('decision real check: reads the key from stdin, skips without one, prints no key', () => {
  const script = new URL('../../scripts/cap-real/decision.mjs', import.meta.url).pathname, planted = 'ts-PLANTED-stdin-key';
  const off = 'data:text/javascript,globalThis.fetch=async()=>new Response("{}",{status:401})';
  const go = (input) => spawnSync(process.execPath, ['--import', off, script, '--runs', '1'], { input, encoding: 'utf8' });
  assert.deepEqual([go('').status, go('').stdout.trim()], [0, 'skipped: no key']);
  const withKey = go(planted);
  assert.deepEqual([withKey.status, withKey.stdout.includes('run 1: 0/20 lines right'), (withKey.stdout + withKey.stderr).includes('PLANTED')], [1, true, false]);
});

test('decision tool: the same function as a pi-durable tool, closed parameters, the wordings, no double count', async () => {
  const s = sink(), tool = decisionTool({ providers: ['fake'], meter: { sink: s, userId: 'camille' } });
  assert.deepEqual([tool.name, tool.replay, tool.parameters.additionalProperties, Object.keys(tool.parameters.properties).sort()], ['decide', 'safe', false, ['questions', 'state']]);
  assert.match(tool.description, /never a permission/);
  const done = await tool.execute(ask(), { conversationId: 7, taskId: 3 }, context);
  assert.deepEqual([JSON.parse(done.output[0].text).answers.a.choice, done.usage], ['cafe', undefined]);
  assert.match(s.calls[0][1].runId, /:7\.3$/);
  assert.ok((await decisionTool({ providers: ['fake'] }).execute(ask(), { conversationId: 7, taskId: 4 }, context)).usage);
  const words = async (options, input = ask()) => (await decisionTool(options).execute(input, { conversationId: 1, taskId: 1 }, context)).output[0].text;
  assert.equal(await words({ providers: ['fake'], meter: { sink: sink('daily-share:50'), userId: 'u' } }), 'refused: daily-share:50. Stop and tell the person.');
  assert.equal(await words(ts({ models: world({ typesafe: says({}, { stopReason: 'error' }) }).models })), 'failed: unavailable. You may call once more; if it fails again, tell the person.');
  assert.equal(await words({ providers: ['fake'] }, ask({})), 'refused: decision-questions:8. Fix the arguments and call again.');
});

test('decision tool: an agent calls it end to end; an extra field is refused before it runs', async () => {
  const s = sink(), chat = fauxProvider({ provider: 'chat', models: [{ id: 'm' }] }), w = world({ typesafe: says({ a: { type: 'choice', choice: 'the', probabilities: {}, confidence: 0.8 } }) });
  const call = (extra = {}) => (c) => c.messages.at(-1).role === 'toolResult' ? fauxAssistantMessage('done') : fauxAssistantMessage([fauxToolCall('decide', { ...ask({ a: choice() }), ...extra }, { id: 'c1' })], { stopReason: 'toolUse' });
  const models = createModels(); models.setProvider(chat.provider);
  const agent = defineAgent({ id: 'sorter', model: { provider: 'chat', modelId: 'm' }, tools: [decisionTool(ts({ models: w.models, meter: { sink: s, userId: 'camille' } }))] });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  try {
    const conversation = await agent.createConversation(harness, context);
    const go = async (n) => { const settled = await (await conversation.submit({ type: 'input', requestId: `r${n}`, content: 'range' }, context)).wait(context); return [settled.status, (await conversation.context(context)).messages.findLast((m) => m.role === 'toolResult')]; };
    chat.setResponses([call(), call()]);
    const [status, result] = await go(1);
    assert.deepEqual([status, JSON.parse(result.content[0].text).answers.a], ['done', { type: 'choice', choice: 'the', confidence: 0.8 }]);
    const before = [s.calls.length, w.calls.typesafe];
    chat.setResponses([call({ providers: ['x'] }), call({ providers: ['x'] })]);
    const [, refused] = await go(2);
    assert.equal(refused.isError, true);
    assert.deepEqual([s.calls.length, w.calls.typesafe], before);
  } finally { await harness.close(context); }
});
