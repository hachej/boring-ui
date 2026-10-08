// The feedback example's transcription glue (examples/feedback/transcription.mjs and transcribe-route.mjs): app code, not part of
// @hachej/boring-feedback, which only takes a `transcribe` callback in the page. A client for a configured transcription service
// (provider discovery, fallback on 502, plain error reasons, the key kept on the server), the keyless fake the journeys use, and
// the `/api/transcribe` route. Fictional data only; no network (every fetch is injected).
import assert from 'node:assert/strict';
import test from 'node:test';
import { TranscriptionError, assertAudio, fakeTranscription, serviceTranscription, transcriptionFromEnv } from '../../examples/feedback/transcription.mjs';
import { transcribeHandler } from '../../examples/feedback/transcribe-route.mjs';

const AUDIO = { bytes: new Uint8Array([26, 69, 223, 163, 1, 2, 3, 4]), mimeType: 'audio/webm;codecs=opus' };
const KEY = 'sk-fictional-0123456789';
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('assertAudio refuses (400) empty audio and non-audio types', () => {
  assert.throws(() => assertAudio(undefined), error => error instanceof TranscriptionError && error.status === 400 && /no audio/.test(error.message));
  assert.throws(() => assertAudio({ bytes: AUDIO.bytes, mimeType: 'text/html' }), error => error.status === 400);
  assert.doesNotThrow(() => assertAudio(AUDIO));
});

test('fake transcription: deterministic default, segments configurable (array or function of the request)', async () => {
  const plain = await fakeTranscription().transcribe(AUDIO);
  assert.deepEqual(plain.segments.map(s => [s.start, s.end]), [[0, 1.5], [1.5, 3]]);
  assert.equal(plain.segments[1].text, '(1 KB of audio/webm)');
  assert.equal(plain.text, plain.segments.map(s => s.text).join(' '));
  assert.deepEqual(await fakeTranscription().transcribe(AUDIO), plain);
  const fixed = await fakeTranscription({ segments: [{ start: 0.4, end: 1.1, text: 'The save button' }] }).transcribe(AUDIO);
  assert.deepEqual(fixed, { provider: 'fake', text: 'The save button', segments: [{ start: 0.4, end: 1.1, text: 'The save button' }] });
  const dynamic = await fakeTranscription({ segments: request => [{ start: 0, end: request.bytes.length, text: request.mimeType }] }).transcribe(AUDIO);
  assert.deepEqual(dynamic.segments, [{ start: 0, end: 8, text: 'audio/webm;codecs=opus' }]);
  await assert.rejects(fakeTranscription().transcribe({ bytes: new Uint8Array(), mimeType: 'audio/webm' }), error => error.status === 400);
});

test('transcription service client: provider from capabilities, timed segments, plain errors, key never leaves the server call', async () => {
  const seen = [];
  let next = () => reply(200, { provider: 'assemblyai', model: 'best', text: 'this button', segments: [{ start: 0.4, end: 1.2, text: 'this button', speaker: 'S1' }, { start: 2, end: 2, text: '' }] });
  const fetch = async (url, init = {}) => {
    seen.push({ url: String(url), auth: init.headers?.authorization, type: init.headers?.['content-type'] });
    if (String(url).endsWith('/v1/capabilities')) return reply(200, { providers: [{ name: 'openai', batch: true, segments: false }, { name: 'assemblyai', batch: true, segments: true }] });
    return next();
  };
  const t = serviceTranscription({ apiKey: KEY, url: 'https://transcription.fictional.invalid/', fetch });
  assert.equal(t.configured(), true);
  const out = await t.transcribe({ bytes: new Uint8Array([1, 2]), mimeType: 'audio/webm', language: 'fr' });
  assert.deepEqual(out, { provider: 'assemblyai', text: 'this button', segments: [{ start: 0.4, end: 1.2, text: 'this button' }] });
  assert.ok(!JSON.stringify(out).includes(KEY), 'the key is never in a transcript');
  assert.equal(seen[0].url, 'https://transcription.fictional.invalid/v1/capabilities');
  const post = seen.find(s => s.url.includes('/v1/transcriptions'));
  assert.match(post.url, /provider=assemblyai/); assert.match(post.url, /segments=true/); assert.match(post.url, /language=fr/);
  assert.equal(post.auth, `Bearer ${KEY}`); assert.equal(post.type, 'audio/webm');
  for (const [status, code, pattern] of [[401, 'invalid_key', /key was refused/], [413, 'too_long', /too long/], [429, 'service_busy', /busy/], [502, 'provider_failed', /provider failed/], [503, 'down', /unavailable/], [400, 'bad_audio', /refused \(bad_audio\)/]]) {
    next = () => reply(status, { error: { code, message: `raw provider text ${KEY}` } });
    const before = seen.length;
    await assert.rejects(t.transcribe({ bytes: new Uint8Array([1]), mimeType: 'audio/webm' }), error => error instanceof TranscriptionError && pattern.test(error.message) && !/raw provider text/.test(error.message) && !error.message.includes(KEY));
    assert.equal(seen.length - before, 1, `${status}: no retry inside one call (one provider with segments)`);
  }
  const off = serviceTranscription({ fetch });
  assert.equal(off.configured(), false); assert.match(off.unconfigured, /TRANSCRIPTION_API_KEY/);
  const offSeen = seen.length;
  await assert.rejects(off.transcribe(AUDIO), error => error.status === 503 && /TRANSCRIPTION_API_KEY/.test(error.message));
  assert.equal(seen.length, offSeen, 'no request without a key');
});

test('transcription service client: a provider that fails (502, e.g. out of credit) falls through to the next one, which is then preferred', async () => {
  const posts = [];
  const fetch = async url => {
    if (String(url).endsWith('/v1/capabilities')) return reply(200, { providers: [{ name: 'openai', batch: true, segments: true }, { name: 'assemblyai', batch: true, segments: true }] });
    const provider = new URL(url).searchParams.get('provider'); posts.push(provider);
    return provider === 'openai' ? reply(502, { error: { code: 'provider_failed', message: 'insufficient_quota' } }) : reply(200, { provider, text: 'ok', segments: [{ start: 0, end: 1, text: 'ok' }] });
  };
  const t = serviceTranscription({ apiKey: KEY, url: 'https://transcription.fictional.invalid', fetch });
  assert.equal((await t.transcribe({ bytes: new Uint8Array([1]), mimeType: 'audio/webm' })).provider, 'assemblyai');
  assert.deepEqual(posts, ['openai', 'assemblyai']);
  await t.transcribe({ bytes: new Uint8Array([1]), mimeType: 'audio/webm' });
  assert.deepEqual(posts, ['openai', 'assemblyai', 'assemblyai'], 'the provider that answered is tried first next time');
  // Every provider failing: the plain reason, once each.
  const down = serviceTranscription({ apiKey: KEY, url: 'https://transcription.fictional.invalid', fetch: async url => String(url).endsWith('/v1/capabilities') ? reply(200, { providers: [{ name: 'a', batch: true, segments: true }, { name: 'b', batch: true, segments: true }] }) : reply(502, {}) });
  await assert.rejects(down.transcribe(AUDIO), error => error.status === 502 && error.message === 'the transcription provider failed, try again');
  // A pinned provider is not replaced by another.
  const pinned = [];
  const only = serviceTranscription({ apiKey: KEY, url: 'https://transcription.fictional.invalid', provider: 'openai', fetch: async url => { pinned.push(String(url)); return reply(502, {}); } });
  await assert.rejects(only.transcribe(AUDIO), error => error.status === 502);
  assert.equal(pinned.length, 1, 'no capabilities call and no fallback with a pinned provider');
  // No usable provider, or the key refused at discovery.
  await assert.rejects(serviceTranscription({ apiKey: KEY, url: 'https://transcription.fictional.invalid', fetch: async () => reply(200, { providers: [{ name: 'x', batch: true, segments: false }] }) }).transcribe(AUDIO), error => error.status === 503 && /no transcription provider/.test(error.message));
  await assert.rejects(serviceTranscription({ apiKey: KEY, url: 'https://transcription.fictional.invalid', fetch: async () => reply(401, {}) }).transcribe(AUDIO), error => error.status === 401 && /key was refused/.test(error.message));
});

test('transcriptionFromEnv: the service with TRANSCRIPTION_API_KEY (and TRANSCRIPTION_URL), else the keyless fake', async () => {
  const fake = transcriptionFromEnv({});
  assert.equal(fake.configured(), true);
  assert.equal((await fake.transcribe(AUDIO)).provider, 'fake');
  assert.equal(transcriptionFromEnv({ OPENAI_API_KEY: 'sk-fictional' }).configured(), true, 'an OpenAI key alone selects nothing new: the fake');
  const urls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => { urls.push(String(url)); return reply(200, { providers: [] }); };
  try {
    const service = transcriptionFromEnv({ TRANSCRIPTION_API_KEY: KEY, TRANSCRIPTION_URL: 'https://transcription.fictional.invalid' });
    assert.equal(service.configured(), true);
    await assert.rejects(service.transcribe(AUDIO), error => error.status === 503);
    assert.deepEqual(urls, ['https://transcription.fictional.invalid/v1/capabilities']);
    const nowhere = transcriptionFromEnv({ TRANSCRIPTION_API_KEY: KEY });
    assert.equal(nowhere.configured(), false, 'the service URL has no default');
    assert.match(nowhere.unconfigured, /TRANSCRIPTION_URL/);
  } finally { globalThis.fetch = realFetch; }
});

test('transcribeHandler: POST audio returns { segments, text }; refuses unauthenticated, non-audio, oversized and unconfigured', async () => {
  const provider = fakeTranscription({ segments: [{ start: 0.2, end: 1, text: 'The plan field' }] });
  const handler = transcribeHandler({ provider, authorize: request => request.headers.get('authorization') === 'Bearer fictional', maxBytes: 16 });
  const post = (body, headers = {}) => new Request('http://fictional.invalid/api/transcribe', { method: 'POST', body, headers: { authorization: 'Bearer fictional', 'content-type': 'audio/webm;codecs=opus', ...headers } });
  const ok = await handler(post(AUDIO.bytes));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { segments: [{ start: 0.2, end: 1, text: 'The plan field' }], text: 'The plan field' });
  assert.equal((await handler(post(AUDIO.bytes, { authorization: 'Bearer other' }))).status, 401);
  assert.equal((await handler(post(AUDIO.bytes, { 'content-type': 'application/json' }))).status, 415);
  assert.equal((await handler(post(new Uint8Array(17)))).status, 413);
  assert.equal((await handler(post(new Uint8Array()))).status, 400);
  assert.equal((await handler(new Request('http://fictional.invalid/api/transcribe'))).status, 405);
  const unconfigured = transcribeHandler({ provider: serviceTranscription({ fetch: async () => { throw new Error('no request expected'); } }), authorize: () => true });
  const answer = await unconfigured(post(AUDIO.bytes));
  assert.equal(answer.status, 503);
  assert.match((await answer.json()).reason, /TRANSCRIPTION_API_KEY is not set/);
  const failing = transcribeHandler({ provider: serviceTranscription({ apiKey: KEY, url: 'https://transcription.fictional.invalid', provider: 'p', fetch: async () => reply(429, { error: { code: 'busy' } }) }), authorize: () => true });
  const busy = await failing(post(AUDIO.bytes));
  assert.equal(busy.status, 429);
  const body = await busy.json();
  assert.match(body.reason, /busy/);
  assert.ok(!JSON.stringify(body).includes(KEY));
  assert.throws(() => transcribeHandler({ provider }), /authorize/);
});
