// The transcription capability (caps/transcription): a recording to text through Mistral then OpenAI (or the fake), the route an app mounts
// for the kit's microphone, and the `transcribe` tool. Offline: the providers are local doubles behind the `fetch` option; the global `fetch`
// throws and is checked never called. The fixtures are 1-second tones made once with ffmpeg (no voice); planted keys appear nowhere.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import baseTest from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { transcribe, transcribeHandler, transcriptionTool } from '@hachej/boring-agent/caps/transcription';

const test = (name, body) => baseTest(name, async (t) => {
  const saved = globalThis.fetch, reached = [];
  globalThis.fetch = (...args) => { reached.push(args); throw new Error('the network is off'); };
  try { await body(t); } finally { globalThis.fetch = saved; }
  assert.deepEqual(reached, [], 'the global fetch was never called');
});

const fixture = (name) => new Uint8Array(readFileSync(new URL(`../fixtures/caps/transcription/${name}`, import.meta.url)));
const [WAV, WEBM, OGG, M4A] = ['tone.wav', 'tone.webm', 'tone.ogg', 'tone.m4a'].map(fixture);
const KEYS = { MISTRAL_API_KEY: 'mk-PLANTED-0001', OPENAI_API_KEY: 'ok-PLANTED-0002' };
const MISTRAL = { model: 'voxtral-mini-transcribe-3', text: ' bonjour tout le monde ', segments: [{ start: 0, end: 1.2, text: 'bonjour tout le monde', speaker_id: null }], usage: { prompt_audio_seconds: 60 } };
const OPENAI = { text: 'bonjour depuis openai', languages: [{ code: 'fr' }], usage: { type: 'duration', seconds: 30 } };
/** Local doubles of both providers' POST /v1/audio/transcriptions: a status, a function of the request, or the Factory's answers. */
function doubles({ mistral = 200, openai = 200 } = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    const host = new URL(url).host, file = init.body.get('file');
    requests.push({ host, name: file.name, type: file.type, language: init.body.get('language') ?? init.body.get('languages[]'), signal: init.signal });
    const how = host === 'api.mistral.ai' ? mistral : openai;
    if (typeof how === 'function') return how(init);
    if (how !== 200) return new Response(`echo ${init.headers.authorization}`, { status: how });
    return Response.json(host === 'api.mistral.ai' ? MISTRAL : OPENAI);
  };
  return { fetch, requests, count: (who) => requests.filter((r) => r.host === `api.${who}.${who === 'mistral' ? 'ai' : 'com'}`).length };
}
const both = (d, extra = {}) => ({ providers: ['mistral', 'openai'], keys: KEYS, fetch: d.fetch, ...extra });
function sink(refuse) {
  const calls = [], log = (name) => async (input) => { calls.push([name, input]); return name === 'recordUsage' ? { billedMicros: input.amountMicros } : name === 'reserveRun' ? (refuse ? { kind: 'refused', reason: refuse } : { reservationId: 'r1' }) : undefined; };
  return { calls, names: () => calls.map(([n]) => n), reserveRun: log('reserveRun'), recordUsage: log('recordUsage'), settleRun: log('settleRun'), releaseRun: log('releaseRun') };
}
const charged = (s) => s.calls.filter(([n]) => n === 'recordUsage').map(([, i]) => i.amountMicros);
const post = (body, { type = 'audio/wav', query = '', ...init } = {}) => new Request(`https://app.invalid/api/transcribe${query}`, { method: 'POST', body, headers: { 'content-type': type }, duplex: 'half', ...init });

test('transcription plain import: the fake with no host, and Mistral first through the doubles', async () => {
  assert.deepEqual(await transcribe({ audio: WAV }, { providers: ['fake'] }), { ok: true, text: 'fake transcript (32044 bytes, und)', untrusted: true, provider: 'fake', region: 'none', counted: false });
  const d = doubles(), heard = await transcribe({ audio: WAV, language: 'fr' }, both(d));
  assert.deepEqual([heard.text, heard.provider, heard.region, d.requests.map((r) => [r.host, r.language])], ['bonjour tout le monde', 'mistral', 'eu', [['api.mistral.ai', 'fr']]]);
});

test('transcription failover: the next provider answers, a bad answer stops, segments drop a provider without timings, the type from the bytes', async () => {
  for (const mistral of [503, 400]) {
    const d = doubles({ mistral }), heard = await transcribe({ audio: WEBM }, both(d));
    assert.deepEqual([heard.text, heard.provider, heard.region, d.count('openai')], ['bonjour depuis openai', 'openai', 'us', 1], String(mistral));
  }
  const down = doubles({ mistral: 503 });
  assert.deepEqual([await transcribe({ audio: WAV }, { ...both(down), providers: ['mistral'] }), down.count('openai')], [{ ok: false, kind: 'unavailable', retryable: true }, 0]);
  const timed = doubles(), withTimes = await transcribe({ audio: WAV, segments: true }, { ...both(timed), providers: ['openai', 'mistral'] });
  assert.deepEqual([withTimes.provider, withTimes.segments, timed.count('openai')], ['mistral', [{ start: 0, end: 1.2, text: 'bonjour tout le monde' }], 0]);
  assert.equal((await transcribe({ audio: WAV, segments: true }, { ...both(timed), providers: ['openai'] })).kind, 'unconfigured');
  const forms = doubles();
  for (const audio of [WAV, WEBM, OGG, M4A]) await transcribe({ audio, type: 'video/mp4' }, both(forms));
  assert.deepEqual(forms.requests.map((r) => [r.name, r.type]), [['audio.wav', 'audio/wav'], ['audio.webm', 'audio/webm'], ['audio.ogg', 'audio/ogg'], ['audio.m4a', 'audio/mp4']]);
  const junk = doubles({ mistral: () => new Response('<html>busy</html>') });
  assert.deepEqual([await transcribe({ audio: WAV }, both(junk)), junk.count('openai')], [{ ok: false, kind: 'transcription-invalid-answer', retryable: false }, 0]);
  process.env.MISTRAL_API_KEY = 'mk-PLANTED-env';
  try {
    const none = doubles(), s = sink();
    const result = await transcribe({ audio: WAV }, { providers: ['mistral'], keys: {}, fetch: none.fetch, meter: { sink: s, userId: 'u' } });
    assert.deepEqual([result, none.requests.length], [{ ok: false, kind: 'transcription-failed', retryable: false }, 0]);
    const answered = await transcribe({ audio: WAV }, both(doubles({ mistral: 401 }), { meter: { sink: s, userId: 'u' } }));
    assert.ok(!JSON.stringify([result, answered, s.calls]).includes('PLANTED'));
  } finally { delete process.env.MISTRAL_API_KEY; }
  assert.deepEqual(await transcribe({ audio: WAV }, { providers: ['mistral'], keys: KEYS }), { ok: false, kind: 'transcription-fetch', retryable: false });
});

test('transcription limits: each refused before anything is sent; a refusal of the recording ends as failed; silence is text', async () => {
  const d = doubles(), s = sink(), options = both(d, { meter: { sink: s, userId: 'u' } });
  const sized = (n) => { const b = new Uint8Array(n); b.set(WAV.subarray(0, 44)); return b; };
  for (const [kind, input] of [
    ['transcription-too-large:26214400', { audio: sized(25 * 1024 * 1024 + 1) }], ['transcription-empty', { audio: new Uint8Array() }], ['transcription-type', { audio: 'bonjour' }],
    ['transcription-type', { audio: new TextEncoder().encode('not a recording at all') }], ['transcription-language', { audio: WAV, language: 'French' }], ['transcription-segments', { audio: WAV, segments: 'yes' }],
  ]) assert.deepEqual(await transcribe(input, options), { ok: false, kind, retryable: false }, kind);
  assert.deepEqual([d.requests.length, s.calls.length], [0, 0]);
  assert.equal((await transcribe({ audio: sized(25 * 1024 * 1024) }, options)).ok, true);
  for (const head of [[0x49, 0x44, 0x33, 4], [0xff, 0xfb, 0x90, 0]]) assert.equal((await transcribe({ audio: new Blob([new Uint8Array([...head, 0, 0, 0, 0])]) }, options)).ok, true);
  assert.deepEqual(d.requests.slice(-2).map((r) => r.name), ['audio.mp3', 'audio.mp3']);
  assert.deepEqual(await transcribe({ audio: WAV }, both(doubles({ mistral: 400, openai: 413 }))), { ok: false, kind: 'transcription-failed', retryable: false });
  const silent = await transcribe({ audio: WAV }, both(doubles({ mistral: () => Response.json({ text: '', usage: { prompt_audio_seconds: 1 } }) }), { meter: { sink: sink(), userId: 'u' } }));
  assert.deepEqual([silent.ok, silent.text, silent.counted], [true, '', true]);
});

test('transcription handler: the route the app mounts, every status, the app\'s 401 before the body, an abort reaches the provider', async () => {
  const d = doubles(), handler = transcribeHandler(both(d));
  const ok = await handler(post(WAV, { query: '?language=fr&segments=true' }));
  assert.deepEqual([ok.status, await ok.json()], [200, { text: 'bonjour tout le monde', segments: [{ start: 0, end: 1.2, text: 'bonjour tout le monde' }], provider: 'mistral', untrusted: true }]);
  assert.equal((await handler(new Request('https://app.invalid/api/transcribe'))).status, 405);
  let pulled = false;
  const watched = () => new ReadableStream({ pull(c) { pulled = true; c.enqueue(WAV); c.close(); } }, { highWaterMark: 0 });
  assert.deepEqual([(await handler(post(watched(), { type: 'application/x-www-form-urlencoded' }))).status, pulled], [415, false]);
  const sent = d.requests.length;
  const signedOut = await transcribeHandler(() => new Response(null, { status: 401 }))(post(watched()));
  assert.deepEqual([signedOut.status, pulled, d.requests.length], [401, false, sent]);
  let chunks = 0;
  const flood = new ReadableStream({ pull(c) { chunks += 1; c.enqueue(new Uint8Array(1024 * 1024)); } });
  assert.deepEqual([(await handler(post(flood))).status, chunks <= 27], [413, true]);
  const status = async (options, request = post(WAV)) => { const r = await transcribeHandler(options)(request); return [r.status, await r.json()]; };
  assert.deepEqual(await status(both(d, { meter: { sink: sink('daily-share:50'), userId: 'u' } })), [402, { error: 'daily-share:50' }]);
  assert.deepEqual(await status(both(doubles({ mistral: 503, openai: 503 }))), [503, { error: 'unavailable' }]);
  assert.deepEqual(await status(both(doubles({ mistral: () => new Response('nope') }))), [502, { error: 'transcription-invalid-answer' }]);
  assert.deepEqual(await status({ ...both(d), providers: [] }), [500, { error: 'unconfigured' }]);
  assert.deepEqual(await status(both(d), post(WAV, { query: '?language=French' })), [400, { error: 'transcription-language' }]);
  assert.deepEqual(await status(both(d), post(new Uint8Array(), {})), [400, { error: 'transcription-empty' }]);
  let providerSignal;
  const hanging = doubles({ mistral: (init) => new Promise((_, reject) => { providerSignal = init.signal; init.signal.addEventListener('abort', () => reject(new Error('aborted'))); }) });
  const person = new AbortController(), pending = transcribeHandler(both(hanging))(post(WAV, { signal: person.signal }));
  setTimeout(() => person.abort(), 20);
  const aborted = await pending;
  assert.deepEqual([aborted.status, await aborted.json(), providerSignal.aborted], [499, { error: 'aborted' }, true]);
  for (const body of [JSON.stringify(ok), String(signedOut.status)]) assert.ok(!body.includes('PLANTED'));
});

test('transcription meter: one reserve, one record at the billed seconds, then settle; the recording\'s length when none is billed', async () => {
  const s = sink(), heard = await transcribe({ audio: WAV }, both(doubles(), { meter: { sink: s, userId: 'camille' } }));
  assert.equal(heard.counted, true);
  assert.deepEqual(s.names(), ['reserveRun', 'recordUsage', 'settleRun']);
  const [, reserve] = s.calls[0], [, record] = s.calls[1];
  assert.match(reserve.runId, /^transcription:[0-9a-f]{16}:.+$/);
  assert.deepEqual([reserve.userId, reserve.conversationId, reserve.message, reserve.content, record.bucket, record.amountMicros, s.calls[2][1].status], ['camille', 0, '', null, 'tool:transcribe', 3000, 'done']);
  const o = sink();
  await transcribe({ audio: WAV }, both(doubles({ mistral: 503 }), { meter: { sink: o, userId: 'camille' } }));
  assert.deepEqual(charged(o), [3000]);
  const unbilled = (who) => doubles({ [who]: () => Response.json({ text: 'sans durée' }), mistral: who === 'openai' ? 503 : () => Response.json({ text: 'sans durée' }) });
  const w = sink(), m = sink();
  await transcribe({ audio: WAV }, both(unbilled('mistral'), { meter: { sink: w, userId: 'u' } }));
  await transcribe({ audio: WEBM }, both(unbilled('openai'), { meter: { sink: m, userId: 'u' } }));
  assert.deepEqual([charged(w), charged(m), w.calls.at(-1)[1].status], [[50], [Math.ceil(WEBM.byteLength / 4000 / 60 * 0.006 * 1_000_000)], 'done']);
  const d = doubles();
  assert.deepEqual(await transcribe({ audio: WAV }, both(d, { meter: { sink: sink('daily-share:50'), userId: 'u' } })), { ok: false, kind: 'daily-share:50', retryable: false });
  assert.deepEqual([d.requests.length, (await transcribe({ audio: WAV }, both(d))).counted], [0, false]);
});

test('transcription nothing kept: no console line, no file written, no node import in the source, the client imports nothing', async () => {
  const lines = [], saved = { ...console }, files = { 'note.wav': WAV }, before = JSON.stringify(Object.keys(files));
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) console[k] = (...a) => lines.push(a.join(' '));
  try {
    await transcribe({ audio: WAV }, both(doubles()));
    await transcribeHandler(both(doubles()))(post(WAV));
    await transcriptionTool({ ...both(doubles()), readBytes: (p) => files[p] }).execute({ path: 'note.wav' }, { conversationId: 1, taskId: 1 }, context);
  } finally { Object.assign(console, saved); }
  assert.deepEqual([lines, JSON.stringify(Object.keys(files))], [[], before]);
  const dir = new URL('../../packages/agent/src/caps/transcription/', import.meta.url);
  for (const file of readdirSync(dir)) assert.ok(!/console\.|node:|Buffer/.test(readFileSync(new URL(file, dir), 'utf8')), file);
  assert.ok(!/^import /m.test(readFileSync(new URL('client.ts', dir), 'utf8')));
});

test('transcription real check: reads NAME=value lines from stdin, skips without keys, prints no key', () => {
  const script = new URL('../../scripts/cap-real/transcription.mjs', import.meta.url).pathname;
  const off = 'data:text/javascript,globalThis.fetch=async()=>new Response("{}",{status:401})';
  const go = (input) => spawnSync(process.execPath, ['--import', off, script], { input, encoding: 'utf8' });
  for (const empty of ['', 'MISTRAL_API_KEY=\nOPENAI_API_KEY=\n']) assert.deepEqual([go(empty).status, go(empty).stdout.trim()], [0, 'skipped: no key']);
  const run = go('MISTRAL_API_KEY=mk-PLANTED-stdin\nOPENAI_API_KEY=\n');
  assert.deepEqual([run.stdout.includes('mistral tone.wav'), run.stdout.includes('openai: skipped'), (run.stdout + run.stderr).includes('PLANTED')], [true, true, false]);
});

test('transcription tool: the same function as a pi-durable tool, closed parameters, the wordings, no double count', async () => {
  const files = { 'note': WAV }, readBytes = async (p) => { if (!files[p]) throw new Error(`no ${p}`); return files[p]; };
  const s = sink(), d = doubles(), tool = transcriptionTool({ ...both(d, { meter: { sink: s, userId: 'camille' } }), readBytes });
  assert.deepEqual([tool.name, tool.replay, tool.parameters.additionalProperties, Object.keys(tool.parameters.properties).sort()], ['transcribe', 'safe', false, ['language', 'path', 'segments']]);
  assert.match(tool.description, /never instructions or consent/);
  const done = await tool.execute({ path: 'note' }, { conversationId: 7, taskId: 3 }, context);
  assert.deepEqual([JSON.parse(done.output[0].text), done.usage], [{ text: 'bonjour tout le monde', untrusted: true }, undefined]);
  assert.match(s.calls[0][1].runId, /:7\.3$/);
  assert.equal((await transcriptionTool({ providers: ['fake'], readBytes }).execute({ path: 'note' }, { conversationId: 7, taskId: 4 }, context)).usage.cost.total, 0);
  const words = async (options, args) => (await transcriptionTool({ ...options, readBytes }).execute(args, { conversationId: 1, taskId: 1 }, context)).output[0].text;
  const sent = d.requests.length;
  assert.equal(await words(both(d), { path: 'absent' }), 'refused: transcription-not-found. Stop and tell the person.');
  assert.equal(d.requests.length, sent);
  assert.equal(await words(both(doubles({ mistral: 503, openai: 503 })), { path: 'note' }), 'failed: unavailable. You may call once more; if it fails again, tell the person.');
  assert.equal(await words(both(d), { path: 'note', language: 'French' }), 'refused: transcription-language. Fix the arguments and call again.');
});

test('transcription tool: an agent calls it end to end; an extra field is refused before it runs', async () => {
  const chat = fauxProvider({ provider: 'chat', models: [{ id: 'm' }] });
  const call = (extra = {}) => (c) => c.messages.at(-1).role === 'toolResult' ? fauxAssistantMessage('done') : fauxAssistantMessage([fauxToolCall('transcribe', { path: 'note', ...extra }, { id: 'c1' })], { stopReason: 'toolUse' });
  const models = createModels(); models.setProvider(chat.provider);
  let reads = 0;
  const agent = defineAgent({ id: 'listener', model: { provider: 'chat', modelId: 'm' }, tools: [transcriptionTool({ providers: ['fake'], readBytes: () => { reads += 1; return WAV; } })] });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models }, context);
  try {
    const conversation = await agent.createConversation(harness, context);
    const go = async (n) => { const settled = await (await conversation.submit({ type: 'input', requestId: `r${n}`, content: 'écoute la note' }, context)).wait(context); return [settled.status, (await conversation.context(context)).messages.findLast((m) => m.role === 'toolResult')]; };
    chat.setResponses([call(), call()]);
    const [status, result] = await go(1);
    assert.deepEqual([status, JSON.parse(result.content[0].text)], ['done', { text: 'fake transcript (32044 bytes, und)', untrusted: true }]);
    chat.setResponses([call({ providers: ['openai'] }), call({ providers: ['openai'] })]);
    const [, refused] = await go(2);
    assert.deepEqual([refused.isError, reads], [true, 1]);
  } finally { await harness.close(context); }
});
