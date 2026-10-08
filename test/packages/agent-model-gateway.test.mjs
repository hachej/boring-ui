// @hachej/boring-agent/model-gateway and @hachej/boring-agent/gateway-provider: browser-side Pi agents call models through the host with the app
// session, never a key. No network: fake upstreams (in-process) and loopback sockets only. Fictional data only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createModels } from '@earendil-works/pi-ai/models';
import { anthropicUpstream, createModelGateway, memoryBudget, openAICompatibleUpstream, scriptedUpstream, OPENAI_BASE_URL } from '@hachej/boring-agent/model-gateway';
import { GATEWAY_PROVIDER, gatewayProvider } from '@hachej/boring-agent/gateway-provider';
import { checkSource } from '../../scripts/pi-policy.mjs';
import { modelUpstreamFromEnv, PREVIEW_MODEL } from '../../examples/feedback/model-gateway-route.mjs';
import { previewComplete, previewModels } from '../../examples/feedback/model-preview.mjs';
import { openApp } from '../fixtures/feedback-app.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const policy = JSON.parse(readFileSync(new URL('../../ARCHITECTURE.json', import.meta.url), 'utf8'));
const SECRET = 'sk-fictional-0123456789';
const SESSION = 'session-fictional-ada';
const PROMPT = 'Fictional prompt about the Fernhill glaze order';
const REPLY = 'Fictional reply naming the kiln schedule';
const BASE = 'http://gateway.invalid/api/llm';

/** An OpenAI-shaped upstream fetch that records what it was sent and answers with `answer(body)`. */
function fakeOpenAI(answer = body => body.stream ? sse(REPLY) : Response.json({ id: 'x', choices: [{ index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7 } })) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), headers: new Headers(init.headers), body });
    return answer(body);
  };
  return { calls, fetch };
}

/** Upstream SSE frames, delivered in awkward chunks (a frame split across reads). */
function sse(text, { split = 7 } = {}) {
  const frames = [
    `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
    `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  const bytes = new TextEncoder().encode(frames);
  return new Response(new ReadableStream({ start(controller) { for (let at = 0; at < bytes.length; at += split) controller.enqueue(bytes.slice(at, at + split)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}

function gateway({ upstream, budget = memoryBudget({ requestsPerMinute: 100, maxTokensPerRequest: 512 }), allow = { 'fernhill-preview': 'gpt-fictional-mini' }, now } = {}) {
  const logs = [];
  const handler = createModelGateway({ basePath: '/api/llm', upstream: upstream ?? openAICompatibleUpstream({ apiKey: SECRET, fetch: fakeOpenAI().fetch }), allow, budget,
    authorize: request => request.headers.get('authorization') === `Bearer ${SESSION}` ? 'p_fictional_ada' : null, log: entry => logs.push(entry), ...(now ? { now } : {}) });
  return { handler, logs };
}

const post = (body, headers = { authorization: `Bearer ${SESSION}` }, path = '/v1/chat/completions') =>
  new Request(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const ask = (extra = {}) => ({ model: 'fernhill-preview', messages: [{ role: 'user', content: PROMPT }], ...extra });

test('a session is required: 401 without it, before the body or the model is looked at', async () => {
  const upstream = fakeOpenAI();
  const { handler, logs } = gateway({ upstream: openAICompatibleUpstream({ apiKey: SECRET, fetch: upstream.fetch }) });
  for (const headers of [{}, { authorization: 'Bearer someone-else' }, { authorization: `Bearer ${SECRET}` }]) {
    const answer = await handler(post(ask(), headers));
    assert.equal(answer.status, 401);
    assert.deepEqual((await answer.json()).error.code, 'unauthenticated');
  }
  assert.equal((await handler(new Request(`${BASE}/v1/models`))).status, 401);
  assert.equal(upstream.calls.length, 0);
  assert.deepEqual(logs.map(entry => [entry.person, entry.status]), [[null, 401], [null, 401], [null, 401], [null, 401]]);
});

test('model allowlist: only the host\'s ids pass (403 otherwise); the host maps them to the upstream model', async () => {
  const upstream = fakeOpenAI();
  const { handler } = gateway({ upstream: openAICompatibleUpstream({ apiKey: SECRET, fetch: upstream.fetch }) });
  for (const model of ['gpt-fictional-mini', 'gpt-5', 'fernhill-preview ', '']) {
    const answer = await handler(post(ask({ model })));
    assert.equal(answer.status, model ? 403 : 400, model);
    if (model) assert.equal((await answer.json()).error.code, 'model-not-allowed');
  }
  assert.equal(upstream.calls.length, 0);
  assert.equal((await handler(post(ask()))).status, 200);
  assert.equal(upstream.calls[0].body.model, 'gpt-fictional-mini');
  const listed = await (await handler(new Request(`${BASE}/v1/models`, { headers: { authorization: `Bearer ${SESSION}` } }))).json();
  assert.deepEqual(listed.data.map(model => model.id), ['fernhill-preview']);
  const plain = createModelGateway({ upstream: scriptedUpstream({ reply: () => 'ok' }), allow: ['a'], budget: memoryBudget({ requestsPerMinute: 1, maxTokensPerRequest: 1 }), authorize: () => 'p' });
  assert.equal((await plain(new Request('http://x.invalid/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'a', messages: [{ role: 'user', content: 'x' }] }) }))).status, 200);
});

test('budget: requests per minute per person (429 with Retry-After), output ceiling clamped', async () => {
  let clock = 1_000_000;
  const upstream = fakeOpenAI();
  const { handler, logs } = gateway({ upstream: openAICompatibleUpstream({ apiKey: SECRET, fetch: upstream.fetch }), budget: memoryBudget({ requestsPerMinute: 2, maxTokensPerRequest: 300, now: () => clock }) });
  assert.equal((await handler(post(ask({ max_completion_tokens: 100 })))).status, 200);
  assert.equal((await handler(post(ask({ max_tokens: 99_999 })))).status, 200);
  const refused = await handler(post(ask()));
  assert.equal(refused.status, 429);
  assert.equal((await refused.json()).error.code, 'budget');
  assert.ok(Number(refused.headers.get('retry-after')) >= 1);
  assert.equal(upstream.calls.length, 2, 'a refused request never reaches the upstream');
  assert.deepEqual(upstream.calls.map(call => call.body.max_completion_tokens), [100, 300]);
  assert.equal(upstream.calls[1].body.max_tokens, undefined, 'the client field is not forwarded; the upstream field carries the clamp');
  clock += 61_000;
  assert.equal((await handler(post(ask()))).status, 200);
  assert.equal(upstream.calls[2].body.max_completion_tokens, 300, 'a missing ceiling gets the budget\'s');
  assert.equal(logs.find(entry => entry.status === 429).code, 'budget');
  // The budget is per person: another person's window is untouched.
  const budget = memoryBudget({ requestsPerMinute: 1, maxTokensPerRequest: 10, now: () => clock });
  assert.equal((await budget.admit('a', { model: 'm', maxTokens: undefined })).kind, 'admitted');
  assert.equal((await budget.admit('a', { model: 'm', maxTokens: undefined })).kind, 'refused');
  assert.equal((await budget.admit('b', { model: 'm', maxTokens: 5 })).maxTokens, 5);
});

test('the provider key is injected server-side, at the fixed upstream, and never echoed (not even from an upstream error)', async () => {
  const upstream = fakeOpenAI();
  const { handler } = gateway({ upstream: openAICompatibleUpstream({ apiKey: SECRET, fetch: upstream.fetch }) });
  const answer = await handler(post(ask()));
  const text = await answer.text();
  assert.equal(answer.status, 200);
  assert.match(text, new RegExp(REPLY));
  assert.equal(upstream.calls[0].url, `${OPENAI_BASE_URL}/chat/completions`);
  assert.equal(upstream.calls[0].headers.get('authorization'), `Bearer ${SECRET}`);
  assert.ok(!text.includes(SECRET) && ![...answer.headers].some(([, value]) => value.includes(SECRET)));
  // OpenAI's 401 quotes part of the key: the gateway answers 502 with its own words.
  const quoting = fakeOpenAI(() => Response.json({ error: { message: `Incorrect API key provided: ${SECRET}` } }, { status: 401 }));
  const failing = gateway({ upstream: openAICompatibleUpstream({ apiKey: SECRET, fetch: quoting.fetch }) });
  const refused = await failing.handler(post(ask()));
  assert.equal(refused.status, 502);
  const body = await refused.text();
  assert.ok(!body.includes(SECRET) && !body.includes('Incorrect'), body);
  assert.deepEqual(JSON.parse(body).error.code, 'upstream-failed');
  // Anthropic through its OpenAI-compatible endpoint uses its own ceiling field.
  const claude = fakeOpenAI();
  await gateway({ upstream: anthropicUpstream({ apiKey: SECRET, fetch: claude.fetch }) }).handler(post(ask()));
  assert.equal(claude.calls[0].url, 'https://api.anthropic.com/v1/chat/completions');
  assert.equal(claude.calls[0].body.max_tokens, 512);
  assert.throws(() => openAICompatibleUpstream({ apiKey: '' }), /apiKey/);
});

test('the browser cannot choose an upstream, a key or a header: the body is rebuilt and no request header is forwarded', async () => {
  const upstream = fakeOpenAI();
  const { handler } = gateway({ upstream: openAICompatibleUpstream({ apiKey: SECRET, fetch: upstream.fetch }) });
  const hostile = ask({ baseURL: 'https://evil.invalid/v1', base_url: 'https://evil.invalid', api_key: 'sk-browser', apiKey: 'sk-browser', provider: { order: ['x'] }, user: 'tracking', store: true, n: 5, metadata: { a: 1 }, temperature: 0.2, stream_options: { include_usage: false, extra: 1 } });
  const answer = await handler(new Request(`${BASE}/v1/chat/completions?base_url=https://evil.invalid&api_key=sk-browser`, { method: 'POST', body: JSON.stringify(hostile),
    headers: { authorization: `Bearer ${SESSION}`, 'x-api-key': 'sk-browser', 'openai-organization': 'org-fictional', 'x-upstream-url': 'https://evil.invalid', 'content-type': 'application/json' } }));
  assert.equal(answer.status, 200);
  const [call] = upstream.calls;
  assert.equal(call.url, `${OPENAI_BASE_URL}/chat/completions`);
  assert.deepEqual(Object.keys(call.body).sort(), ['max_completion_tokens', 'messages', 'model', 'stream', 'temperature']);
  assert.deepEqual([...call.headers.keys()].sort(), ['accept', 'authorization', 'content-type']);
  assert.equal(call.headers.get('authorization'), `Bearer ${SECRET}`, 'the session token is the browser\'s credential, never sent upstream');
  assert.ok(!JSON.stringify(call).includes('sk-browser') && !JSON.stringify(call).includes('evil'));
  // Streaming requests always ask the upstream for usage (for the log), whatever the browser said.
  await handler(post(ask({ stream: true, stream_options: { include_usage: false } })));
  assert.deepEqual(upstream.calls[1].body.stream_options, { include_usage: true });
});

test('streaming: SSE passes through byte for byte; usage is logged; logs never hold prompt or completion text', async () => {
  const reference = new Uint8Array(await sse(REPLY).arrayBuffer());
  const upstream = fakeOpenAI();
  const { handler, logs } = gateway({ upstream: openAICompatibleUpstream({ apiKey: SECRET, fetch: upstream.fetch }) });
  const answer = await handler(post(ask({ stream: true })));
  assert.equal(answer.status, 200);
  assert.match(answer.headers.get('content-type'), /^text\/event-stream/);
  assert.deepEqual(new Uint8Array(await answer.arrayBuffer()), reference);
  assert.deepEqual(logs.at(-1), { person: 'p_fictional_ada', model: 'fernhill-preview', status: 200, latencyMs: logs.at(-1).latencyMs, inputTokens: 13, outputTokens: 5 });
  // Non-streaming usage too; and a cancelled stream is logged once.
  await (await handler(post(ask()))).json();
  assert.deepEqual([logs.at(-1).inputTokens, logs.at(-1).outputTokens], [11, 7]);
  const open = await handler(post(ask({ stream: true })));
  await open.body.cancel();
  assert.equal(logs.at(-1).status, 499);
  const serialized = JSON.stringify(logs);
  assert.ok(!serialized.includes(PROMPT) && !serialized.includes(REPLY) && !serialized.includes('Fernhill') && !serialized.includes(SECRET), serialized);
});

test('errors map to { error: { code, message } }: 400, 404, 405, 413, 502', async () => {
  const thrown = gateway({ upstream: openAICompatibleUpstream({ apiKey: SECRET, fetch: async () => { throw new Error(`socket hang up ${SECRET}`); } }) });
  const unreachable = await thrown.handler(post(ask()));
  assert.equal(unreachable.status, 502);
  const unreachableText = await unreachable.text();
  assert.equal(JSON.parse(unreachableText).error.code, 'upstream-unreachable');
  assert.ok(!unreachableText.includes(SECRET));
  const broken = gateway({ upstream: openAICompatibleUpstream({ apiKey: SECRET, fetch: async () => new Response('oops', { status: 500 }) }) });
  assert.equal((await (await broken.handler(post(ask()))).json()).error.code, 'upstream-failed');
  const { handler } = gateway();
  const cases = [
    [post('{not json'), 400, 'invalid'], [post({ model: 'fernhill-preview', messages: [] }), 400, 'invalid'], [post([1, 2]), 400, 'invalid'],
    [post(ask(), undefined, '/v1/responses'), 404, 'not-found'], [new Request('http://gateway.invalid/elsewhere/v1/chat/completions', { method: 'POST' }), 404, 'not-found'],
    [new Request(`${BASE}/v1/chat/completions`, { headers: { authorization: `Bearer ${SESSION}` } }), 405, 'method-not-allowed'],
    [post(ask({ messages: [{ role: 'user', content: 'x'.repeat(3 * 1024 * 1024) }] })), 413, 'too-large'],
    [post(ask(), { authorization: `Bearer ${SESSION}`, 'content-type': 'text/plain' }), 415, 'unsupported-media-type'],
  ];
  for (const [request, status, code] of cases) {
    const answer = await handler(request);
    assert.equal(answer.status, status, code);
    const body = await answer.json();
    assert.equal(body.error.code, code);
    assert.equal(typeof body.error.message, 'string');
  }
  assert.throws(() => createModelGateway({ upstream: scriptedUpstream({ reply: () => '' }), allow: [], budget: memoryBudget({ requestsPerMinute: 1, maxTokensPerRequest: 1 }) }), /authorize/);
});

/** The gateway on a loopback socket, recording every request path and authorization it receives. */
async function serve(t, handler) {
  const seen = [];
  const server = createServer(async (incoming, outgoing) => {
    seen.push({ path: incoming.url, authorization: incoming.headers.authorization });
    const request = new Request(new URL(incoming.url, 'http://127.0.0.1'), { method: incoming.method, headers: incoming.headers, ...(incoming.method === 'POST' ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) for await (const chunk of response.body) outgoing.write(chunk);
    outgoing.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}

test('browser provider: native Pi models.complete and stream through the gateway with the session, no key, only to baseUrl', async t => {
  const { handler, logs } = gateway({ upstream: scriptedUpstream({ reply: messages => `scripted answer to ${messages.length} message(s)` }) });
  const { url, seen } = await serve(t, handler);
  let sessions = 0;
  const models = createModels();
  models.setProvider(gatewayProvider({ baseUrl: `${url}/api/llm/`, models: ['fernhill-preview'], getAuth: () => { sessions++; return { authorization: `Bearer ${SESSION}` }; } }));
  const model = models.getModel(GATEWAY_PROVIDER, 'fernhill-preview');
  assert.equal(model.baseUrl, `${url}/api/llm/v1`);
  const message = await models.complete(model, { systemPrompt: 'Be brief.', messages: [{ role: 'user', content: PROMPT, timestamp: 0 }] });
  assert.equal(message.stopReason, 'stop', message.errorMessage);
  assert.deepEqual(message.content, [{ type: 'text', text: 'scripted answer to 2 message(s)' }]);
  assert.ok(message.usage.input > 0 && message.usage.output > 0);
  const events = [];
  for await (const event of models.stream(model, { messages: [{ role: 'user', content: 'again', timestamp: 0 }] })) events.push(event.type);
  assert.ok(events.includes('text_delta') && events.at(-1) === 'done', events.join());
  assert.ok(seen.length >= 2 && seen.every(request => request.path === '/api/llm/v1/chat/completions' && request.authorization === `Bearer ${SESSION}`), JSON.stringify(seen));
  assert.ok(sessions >= 2, 'the session is read on every request');
  assert.deepEqual(logs.map(entry => entry.status), [200, 200]);
  // A refused session surfaces as a Pi error message, not a key prompt.
  const strangers = createModels();
  strangers.setProvider(gatewayProvider({ baseUrl: `${url}/api/llm`, models: ['fernhill-preview'], getAuth: () => ({ authorization: 'Bearer nobody' }) }));
  const refused = await strangers.complete(strangers.getModel(GATEWAY_PROVIDER, 'fernhill-preview'), { messages: [{ role: 'user', content: 'x', timestamp: 0 }] });
  assert.equal(refused.stopReason, 'error');
  assert.throws(() => gatewayProvider({ baseUrl: '/api/llm', models: [], getAuth: () => ({}) }), /absolute baseUrl/);
});

test('browser provider bundle: no node, no gateway server code, no key or env access of its own; path rules keep it that way', async () => {
  const result = await build({ stdin: { contents: "export { gatewayProvider } from '@hachej/boring-agent/gateway-provider';", resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser', metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(result.metafile.inputs);
  assert.deepEqual(inputs.filter(path => /^node:|model-gateway|packages\/(?:files|feedback|ui|execution)\//.test(path)), []);
  assert.deepEqual(inputs.filter(path => path.includes('packages/agent/')), ['packages/agent/dist/gateway-provider.js']);
  const own = readFileSync(new URL('../../packages/agent/dist/gateway-provider.js', import.meta.url), 'utf8');
  assert.doesNotMatch(own, /process|\benv\b|API_KEY|sk-/);
  // The vendored SDKs' own env readers are guarded shims; the bundle carries no secret and no fixed model host of ours.
  const text = result.outputFiles[0].text;
  assert.ok(!text.includes(SECRET) && !text.includes('api.anthropic.com/v1'));
  const rule = (file, source) => checkSource(file, source, policy);
  assert.ok(rule('packages/agent/src/gateway-provider.ts', "import { createModelGateway } from './model-gateway.js';\nexport const x = createModelGateway;\n").some(error => /forbidden relative import/.test(error)));
  assert.ok(rule('packages/agent/src/gateway-provider.ts', "import { randomUUID } from 'node:crypto';\nexport const x = randomUUID;\n").some(error => /forbidden import/.test(error)));
  assert.ok(rule('packages/agent/src/model-gateway.ts', "import { createModels } from '@earendil-works/pi-ai/models';\nexport const x = createModels;\n").some(error => /forbidden import/.test(error)));
});

test('Fernhill example: /api/llm answers the page keyless with the scripted model, as the page\'s session', async t => {
  const logs = [];
  const app = await openApp(t, { modelGateway: { configuration: modelUpstreamFromEnv({}), log: entry => logs.push(entry) } });
  const base = new URL('/api/llm', app.url).href;
  const ada = previewModels({ baseUrl: base, getAuth: () => ({ authorization: `Bearer ${app.people.ada.token}` }) });
  const answer = await previewComplete(ada, 'check feedback');
  assert.equal(answer.stopReason, 'stop', answer.error);
  assert.match(answer.text, /scripted/);
  const hint = await previewComplete(ada, 'hello there');
  assert.match(hint.text, /check feedback/);
  assert.deepEqual(logs.map(entry => [entry.person, entry.model, entry.status]), [['p_fictional_ada', PREVIEW_MODEL, 200], ['p_fictional_ada', PREVIEW_MODEL, 200]]);
  const anonymous = await fetch(new URL('/api/llm/v1/chat/completions', app.url), { method: 'POST', body: JSON.stringify({ model: PREVIEW_MODEL, messages: [{ role: 'user', content: 'x' }] }) });
  assert.equal(anonymous.status, 401);
  // With a key in the server environment the same id maps to a real upstream; nothing about it reaches the page.
  const openai = modelUpstreamFromEnv({ OPENAI_API_KEY: SECRET, FEEDBACK_GATEWAY_MODEL: 'gpt-fictional' });
  assert.deepEqual([openai.upstream.id, openai.allow], ['openai', { [PREVIEW_MODEL]: 'gpt-fictional' }]);
  assert.equal(modelUpstreamFromEnv({ ANTHROPIC_API_KEY: SECRET }).upstream.id, 'anthropic');
  assert.equal(modelUpstreamFromEnv({}).upstream.id, 'scripted');
});

test('scripted upstream: tool calls for declared tools only, as JSON and as SSE', async () => {
  const tools = [{ type: 'function', function: { name: 'set_style', parameters: { type: 'object' } } }];
  const { handler } = gateway({ upstream: scriptedUpstream({ reply: () => ({ toolCalls: [{ name: 'set_style', arguments: { element: 'p1', css: 'color: red' } }, { name: 'not_declared', arguments: {} }] }) }) });
  const json = await (await handler(post(ask({ tools })))).json();
  assert.equal(json.choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(json.choices[0].message.tool_calls.map(call => [call.function.name, JSON.parse(call.function.arguments)]), [['set_style', { element: 'p1', css: 'color: red' }]]);
  const streamed = await (await handler(post(ask({ tools, stream: true })))).text();
  assert.match(streamed, /"tool_calls":\[\{"index":0,"id":"call_scripted_\d+_0","type":"function","function":\{"name":"set_style"/);
  assert.match(streamed, /"finish_reason":"tool_calls"/);
  assert.doesNotMatch(streamed, /not_declared/);
  const none = await (await handler(post(ask()))).json();
  assert.equal(none.choices[0].finish_reason, 'stop', 'no declared tool: a text answer');
});
