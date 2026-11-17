// The llm capability (caps/llm): one model call outside a conversation, plain or with a checked structured answer, and the pi-durable tool
// built from the same function. Offline: pi-ai's faux provider, or a `fetch` double behind its real anthropic provider; the global
// `fetch` throws and is checked never called. No real key: the planted ones are checked to appear nowhere.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { complete, llmTool, structured } from '@hachej/boring-agent/caps/llm';

const reached = [];
globalThis.fetch = (...args) => { reached.push(args); throw new Error('the network is off'); };
test.after(() => assert.deepEqual(reached, [], 'the global fetch was never called'));

const SCHEMA = { type: 'object', additionalProperties: false, required: ['heard'], properties: { heard: { type: 'array', items: { type: 'string' } } } };
const ask = (extra = {}) => ({ purpose: 'read', messages: [{ role: 'user', content: 'deux tartines' }], schema: SCHEMA, ...extra });
const reply = (value) => fauxAssistantMessage(JSON.stringify({ answer: value }));
const bad = () => fauxAssistantMessage('not json at all');
function world(ids = ['faux'], max = 4096) {
  const models = createModels(), fauxes = {};
  for (const id of ids) { fauxes[id] = fauxProvider({ provider: id, models: [{ id: 'm', maxTokens: max, reasoning: true }, { id: 'model-a' }] }); models.setProvider(fauxes[id].provider); }
  return { models, ...fauxes, calls: (id) => fauxes[id].state.callCount };
}
function sink(refuse) {
  const calls = [], log = (name) => async (input) => { calls.push([name, input]); return name === 'recordUsage' ? { billedMicros: input.amountMicros } : name === 'reserveRun' ? (refuse ? { kind: 'refused', reason: refuse } : { reservationId: 'r1' }) : undefined; };
  return { calls, names: () => calls.map(([n]) => n), reserveRun: log('reserveRun'), recordUsage: log('recordUsage'), settleRun: log('settleRun'), releaseRun: log('releaseRun') };
}
const sse = (text) => [['message_start', { message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], usage: { input_tokens: 1000, output_tokens: 0 } } }],
  ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }], ['content_block_delta', { index: 0, delta: { type: 'text_delta', text } }], ['content_block_stop', { index: 0 }],
  ['message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 500 } }], ['message_stop', {}]].map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify({ type: e, ...d })}\n\n`).join('');
const anthropic = (statuses, answer = { heard: ['ok'] }) => { const seen = []; return { seen, fetch: async (url, init) => { seen.push(init); const status = statuses[Math.min(seen.length - 1, statuses.length - 1)]; return status === 200 ? new Response(sse(JSON.stringify({ answer })), { headers: { 'content-type': 'text/event-stream' } }) : new Response('{"type":"error","error":{"type":"overloaded_error","message":"busy"}}', { status, headers: { 'retry-after-ms': '1' } }); } }; };
const ANTHROPIC = ['anthropic:claude-sonnet-5-5'];

test('llm plain import: the fake answers with no host, no key, no network', async () => {
  assert.deepEqual(await structured(ask(), { providers: ['fake'] }), { ok: true, value: { heard: ['fake'] }, provider: 'fake', region: 'none', counted: false });
  const plain = await complete({ purpose: 'say', messages: [{ role: 'user', content: 'bonjour' }] }, { providers: ['fake'] });
  assert.equal(plain.ok, true); assert.equal(typeof plain.text, 'string'); assert.equal(plain.counted, false);
});

test('llm structured: checked, one corrective turn, nothing throws', async () => {
  const w = world();
  const run = (steps, input = ask()) => { w.faux.setResponses(steps); w.faux.state.callCount = 0; return structured(input, { providers: ['faux:m'], models: w.models }); };
  assert.deepEqual((await run([reply({ heard: ['a'] })])).value, { heard: ['a'] });
  assert.deepEqual([(await run([bad(), reply({ heard: ['b'] })])).value, w.calls('faux')], [{ heard: ['b'] }, 2]);
  assert.deepEqual([await run([bad(), reply({ nope: 1 })]), w.calls('faux')], [{ ok: false, kind: 'invalid', retryable: true }, 2]);
  assert.deepEqual(await run([fauxAssistantMessage('{"refusal": "no"}')]), { ok: false, kind: 'refused', retryable: false });
});

test('llm closed schema: an open object or a keyword outside the subset is refused before any request', async () => {
  const w = world(), options = { providers: ['faux:m'], models: w.models };
  const open = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } };
  const nested = { ...SCHEMA, properties: { heard: { type: 'array', items: open } } };
  for (const schema of [open, nested, { anyOf: [{ type: 'string' }] }, { ...SCHEMA, $defs: {} }]) assert.deepEqual(await structured(ask({ schema }), options), { ok: false, kind: 'invalid-schema', retryable: false });
  assert.equal(w.calls('faux'), 0);
  w.faux.setResponses([reply({ piece: null })]);
  const nullable = { type: 'object', additionalProperties: false, properties: { piece: { type: ['object', 'null'], additionalProperties: false, properties: { id: { type: 'string' } } } } };
  assert.equal((await structured(ask({ schema: nullable }), options)).ok, true);
});

test('llm model and effort: chosen per call, images pass through, an unknown model is refused', async () => {
  const w = world(), seen = [], image = { type: 'image', data: 'AAAA', mimeType: 'image/png' };
  const spy = (context, options, state, model) => { seen.push({ reasoning: options?.reasoning, model: model.id, parts: context.messages.at(-1).content }); return reply({ heard: [] }); };
  w.faux.setResponses([spy, spy]);
  const options = { providers: ['faux:model-a'], models: w.models };
  await structured(ask({ effort: 'low', messages: [{ role: 'user', content: [{ type: 'text', text: 'lis' }, image] }] }), options);
  await structured(ask({ effort: 'off' }), options);
  assert.deepEqual(seen.map((s) => [s.model, s.reasoning]), [['model-a', 'low'], ['model-a', undefined]]);
  assert.deepEqual(seen[0].parts[1], image);
  assert.deepEqual(await structured(ask(), { providers: ['faux:nope'], models: w.models }), { ok: false, kind: 'llm-provider', retryable: false });
  assert.equal(w.calls('faux'), 2);
});

test('llm limits: each refused before anything is sent, a model maximum caps the tokens', async () => {
  const w = world(), sent = sink(), options = { providers: ['faux:m'], models: w.models, meter: { sink: sent, userId: 'u' } };
  const user = { role: 'user', content: 'x' };
  const cases = { 'llm-purpose': [ask({ purpose: 'Bad Purpose' }), ask({ purpose: undefined })], 'llm-messages:50': [ask({ messages: [] }), ask({ messages: [{ role: 'assistant', content: 'x' }] }), ask({ messages: Array(51).fill(user) })],
    'llm-chars:200000': [ask({ messages: [{ role: 'user', content: 'x'.repeat(200_001) }] })], 'llm-max-tokens:32000': [ask({ maxTokens: 0 }), ask({ maxTokens: 32_001 })], 'llm-field': [ask({ temperature: 0 })] };
  for (const [kind, inputs] of Object.entries(cases)) for (const input of inputs) assert.deepEqual(await structured(input, options), { ok: false, kind, retryable: false }, kind);
  assert.equal((await complete({ purpose: 'say', messages: [user], schema: SCHEMA }, options)).kind, 'llm-field');
  assert.deepEqual(await structured(ask(), { ...options, timeoutMs: 300_001 }), { ok: false, kind: 'llm-timeout:300000', retryable: false });
  assert.deepEqual([w.calls('faux'), sent.calls.length], [0, 0]);
  let maxTokens;
  w.faux.setResponses([(c, o) => { maxTokens = o.maxTokens; return reply({ heard: [] }); }]);
  await structured(ask({ maxTokens: 8000 }), options);
  assert.equal(maxTokens, 4096);
});

test('llm meter: one reserve, a record per model turn, then settle; nothing of the prompt reaches the sink', async () => {
  const w = world(), s = sink();
  w.faux.setResponses([bad(), reply({ heard: ['x'] })]);
  const input = ask({ messages: [{ role: 'user', content: 'PLANTED-PROMPT-TEXT' }] });
  const result = await structured(input, { providers: ['faux:m'], models: w.models, meter: { sink: s, userId: 'camille' } });
  assert.equal(result.counted, true);
  assert.deepEqual(s.names(), ['reserveRun', 'recordUsage', 'recordUsage', 'settleRun']);
  const [, reserve] = s.calls[0];
  assert.match(reserve.runId, /^llm:[0-9a-f]{16}:.+$/);
  assert.deepEqual([reserve.userId, reserve.conversationId, reserve.message, reserve.content], ['camille', 0, '', null]);
  assert.deepEqual(s.calls.filter(([n]) => n === 'recordUsage').map(([, i]) => [i.usageId.slice(-2), Number.isInteger(i.amountMicros)]), [[':1', true], [':2', true]]);
  assert.equal(s.calls.at(-1)[1].status, 'done');
  assert.ok(!JSON.stringify(s.calls).includes('PLANTED'));
  const refusing = sink('daily-share:50');
  w.faux.setResponses([reply({ heard: [] })]); w.faux.state.callCount = 0;
  assert.deepEqual(await structured(input, { providers: ['faux:m'], models: w.models, meter: { sink: refusing, userId: 'camille' } }), { ok: false, kind: 'daily-share:50', retryable: false });
  assert.equal(w.calls('faux'), 0);
  w.faux.setResponses([reply({ heard: [] })]);
  assert.equal((await structured(input, { providers: ['faux:m'], models: w.models })).counted, false);
});

test('llm time: the time limit aborts the request, the caller can abort, no corrective turn starts late', async () => {
  const w = world();
  let signal;
  const slow = async (c, o) => { signal = o.signal; await new Promise((r) => setTimeout(r, 200)); return reply({ heard: [] }); };
  w.faux.setResponses([slow]);
  const started = Date.now(), result = await structured(ask(), { providers: ['faux:m'], models: w.models, timeoutMs: 50 });
  const took = Date.now() - started;
  assert.deepEqual(result, { ok: false, kind: 'timeout', retryable: true });
  assert.ok(took >= 45 && took < 150, `took ${took} ms`);
  assert.equal(signal.aborted, true);
  const caller = new AbortController();
  w.faux.setResponses([slow]);
  const pending = structured(ask(), { providers: ['faux:m'], models: w.models, signal: caller.signal });
  setTimeout(() => caller.abort(), 20);
  assert.deepEqual(await pending, { ok: false, kind: 'aborted', retryable: false });
  w.faux.state.callCount = 0;
  w.faux.setResponses([async () => { await new Promise((r) => setTimeout(r, 80)); return bad(); }, reply({ heard: [] })]);
  assert.equal((await structured(ask(), { providers: ['faux:m'], models: w.models, timeoutMs: 50 })).kind, 'timeout');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(w.calls('faux'), 1);
});

test('llm keys: only from `keys`, never the environment, never in a result', async () => {
  const planted = 'sk-PLANTED-from-env', passed = 'sk-PLANTED-passed';
  process.env.ANTHROPIC_API_KEY = planted;
  try {
    const none = anthropic([200]);
    assert.deepEqual(await structured(ask(), { providers: ANTHROPIC, keys: {}, fetch: none.fetch }), { ok: false, kind: 'llm-failed', retryable: false });
    assert.equal(none.seen.length, 0);
    const s = sink(), double = anthropic([200]);
    const result = await structured(ask(), { providers: ANTHROPIC, keys: { ANTHROPIC_API_KEY: passed }, fetch: double.fetch, meter: { sink: s, userId: 'u' } });
    assert.deepEqual([result.ok, result.value, result.provider, result.region, double.seen.length], [true, { heard: ['ok'] }, ANTHROPIC[0], 'us', 1]);
    assert.ok(Object.values(double.seen[0].headers instanceof Headers ? Object.fromEntries(double.seen[0].headers) : double.seen[0].headers).some((v) => String(v).includes(passed)), 'the passed key is the one sent');
    assert.ok(s.calls.filter(([n]) => n === 'recordUsage').every(([, i]) => i.amountMicros > 0));
    for (const text of [JSON.stringify(result), JSON.stringify(s.calls)]) assert.ok(!text.includes('PLANTED'));
  } finally { delete process.env.ANTHROPIC_API_KEY; }
  const { readdirSync } = await import('node:fs'), dir = new URL('../../packages/agent/src/caps/', import.meta.url);
  for (const file of ['shared.ts', 'llm/index.ts', 'llm/structured-port.ts']) assert.ok(!/console\./.test(readFileSync(new URL(file, dir), 'utf8')), file);
  assert.ok(readdirSync(dir).includes('llm'));
});

test('llm failover: a provider failure moves on, a refusal stops, pi retries a 529 twice', async () => {
  const w = world(['a', 'b']), steps = [fauxAssistantMessage('x', { stopReason: 'error', errorMessage: 'down' })];
  w.a.setResponses(steps); w.b.setResponses([reply({ heard: ['b'] })]);
  const both = await structured(ask(), { providers: ['a:m', 'b:m'], models: w.models });
  assert.deepEqual([both.ok, both.provider, w.calls('a'), w.calls('b')], [true, 'b:m', 1, 1]);
  w.a.setResponses(steps); w.a.state.callCount = 0; w.b.state.callCount = 0;
  assert.deepEqual([await structured(ask(), { providers: ['a:m'], models: w.models }), w.calls('b')], [{ ok: false, kind: 'unavailable', retryable: true }, 0]);
  w.a.setResponses([bad(), bad()]);
  assert.deepEqual([await structured(ask(), { providers: ['a:m', 'b:m'], models: w.models }), w.calls('b')], [{ ok: false, kind: 'invalid', retryable: true }, 0]);
  const keys = { ANTHROPIC_API_KEY: 'sk-PLANTED' }, flaky = anthropic([529, 200]);
  assert.equal((await structured(ask(), { providers: ANTHROPIC, keys, fetch: flaky.fetch })).ok, true);
  assert.equal(flaky.seen.length, 2);
  const down = anthropic([529]);
  assert.deepEqual(await structured(ask(), { providers: ANTHROPIC, keys, fetch: down.fetch }), { ok: false, kind: 'unavailable', retryable: true });
  assert.equal(down.seen.length, 3);
});

test('llm real check: reads the key from stdin, skips without one, prints no key', () => {
  const script = new URL('../../scripts/cap-real/llm.mjs', import.meta.url).pathname, planted = 'sk-PLANTED-stdin-key';
  const off = 'data:text/javascript,globalThis.fetch=async()=>new Response("{}",{status:401})';
  const run = (input) => spawnSync(process.execPath, ['--import', off, script, '--runs', '1'], { input, encoding: 'utf8' });
  assert.deepEqual([run('').status, run('').stdout.trim()], [0, 'skipped: no key']);
  const withKey = run(planted);
  assert.deepEqual([withKey.status, withKey.stdout.includes('run 1: 0/20 valid'), (withKey.stdout + withKey.stderr).includes('PLANTED')], [1, true, false]);
});

test('llm tool: the same function as a pi-durable tool, closed parameters, two wordings, no double count', async () => {
  const w = world(), s = sink(), models = w.models, providers = ['faux:m'];
  const tool = llmTool({ providers, models, meter: { sink: s, userId: 'camille' } });
  assert.deepEqual([tool.name, tool.replay, tool.parameters.additionalProperties, Object.keys(tool.parameters.properties).sort()], ['llm_structured', 'safe', false, ['input', 'instructions', 'purpose', 'schema']]);
  const args = { purpose: 'read', instructions: 'Read the sentence.', input: 'deux tartines', schema: SCHEMA };
  w.faux.setResponses([reply({ heard: ['ok'] })]);
  const done = await tool.execute(args, { conversationId: 7, taskId: 3 }, context);
  assert.deepEqual([JSON.parse(done.output[0].text), done.usage, done.isError], [{ value: { heard: ['ok'] } }, undefined, undefined]);
  assert.match(s.calls[0][1].runId, /:7\.3$/);
  const bare = llmTool({ providers, models });
  w.faux.setResponses([reply({ heard: [] })]);
  assert.ok((await bare.execute(args, { conversationId: 7, taskId: 4 }, context)).usage.totalTokens > 0);
  const words = async (options, input = args) => (await llmTool(options).execute(input, { conversationId: 1, taskId: 1 }, context)).output[0].text;
  assert.equal(await words({ providers, models, meter: { sink: sink('daily-share:50'), userId: 'u' } }), 'refused: daily-share:50. Stop and tell the person.');
  w.faux.setResponses([async () => { await new Promise((r) => setTimeout(r, 100)); return reply({ heard: [] }); }]);
  assert.equal(await words({ providers, models, timeoutMs: 20 }), 'failed: timeout. You may call once more; if it fails again, tell the person.');
  assert.equal(await words({ providers, models }, { ...args, schema: { type: 'object' } }), 'refused: invalid-schema. Fix the arguments and call again.');
});

test('llm tool: an agent calls it end to end; an extra field is refused before it runs', async () => {
  const w = world(['inner']), s = sink(), chat = fauxProvider({ provider: 'chat', models: [{ id: 'm' }] });
  const call = (extra = {}) => (c) => c.messages.at(-1).role === 'toolResult' ? fauxAssistantMessage('done') : fauxAssistantMessage([fauxToolCall('llm_structured', { purpose: 'read', instructions: 'Read.', input: 'deux tartines', schema: SCHEMA, ...extra }, { id: 'c1' })], { stopReason: 'toolUse' });
  const models = createModels(); models.setProvider(chat.provider); models.setProvider(w.inner.provider);
  const agent = defineAgent({ id: 'reader', model: { provider: 'chat', modelId: 'm' }, tools: [llmTool({ providers: ['inner:m'], models, meter: { sink: s, userId: 'camille' } })] });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  try {
    const conversation = await agent.createConversation(harness, context);
    const run = async (n) => { const settled = await (await conversation.submit({ type: 'input', requestId: `r${n}`, content: 'go' }, context)).wait(context); const msgs = (await conversation.context(context)).messages; return [settled.status, msgs.findLast((m) => m.role === 'toolResult')]; };
    chat.setResponses([call(), call()]); w.inner.setResponses([reply({ heard: ['ok'] })]);
    const [status, result] = await run(1);
    assert.equal(status, 'done');
    assert.deepEqual(JSON.parse(result.content[0].text), { value: { heard: ['ok'] } });
    assert.match(s.calls[0][1].runId, new RegExp(`:${conversation.id}\\.\\d+$`));
    const before = [s.calls.length, w.calls('inner')];
    chat.setResponses([call({ providers: ['x'] }), call({ providers: ['x'] })]);
    const [, refused] = await run(2);
    assert.equal(refused.isError, true);
    assert.deepEqual([s.calls.length, w.calls('inner')], before);
  } finally { await harness.close(context); }
});
