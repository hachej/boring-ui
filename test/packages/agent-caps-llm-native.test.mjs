// The llm capability's native structured output (caps/llm/native.ts): an Anthropic model gets the schema in `output_config.format` and its
// reply is read as the value; any other API keeps the envelope. Offline: a `fetch` double behind pi-ai's real anthropic provider, pi-ai's
// faux provider and the fake; the global `fetch` throws and is checked never called.
import assert from 'node:assert/strict';
import baseTest from 'node:test';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { structured } from '@hachej/boring-agent/caps/llm';

const test = (name, body) => baseTest(name, async (t) => {
  const saved = globalThis.fetch, reached = [];
  globalThis.fetch = (...args) => { reached.push(args); throw new Error('the network is off'); };
  try { await body(t); } finally { globalThis.fetch = saved; }
  assert.deepEqual(reached, [], 'the global fetch was never called');
});

const SCHEMA = { type: 'object', additionalProperties: false, required: ['kind', 'piece'], properties: {
  kind: { type: 'string', enum: ['releve_bancaire', 'facture'] },
  piece: { type: ['object', 'null'], additionalProperties: false, required: ['montant_ttc_cents'], properties: { montant_ttc_cents: { type: 'integer' } } },
} };
const ask = (extra = {}) => ({ purpose: 'statement-read', messages: [{ role: 'system', content: 'Tu lis un relevé fictif.' }, { role: 'user', content: 'Banque Exemple, relevé de mars 2026' }], schema: SCHEMA, ...extra });
const sse = (text) => [['message_start', { message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], usage: { input_tokens: 1000, output_tokens: 0 } } }],
  ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }], ['content_block_delta', { index: 0, delta: { type: 'text_delta', text } }], ['content_block_stop', { index: 0 }],
  ['message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50 } }], ['message_stop', {}]].map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify({ type: e, ...d })}\n\n`).join('');
/** pi-ai's real anthropic provider behind this double: each reply in turn (a text the model said), `wait(n)` before the n-th answers. */
function anthropic(replies, wait) {
  const bodies = [];
  const fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    await wait?.(bodies.length);
    return new Response(sse(replies[Math.min(bodies.length - 1, replies.length - 1)]), { headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetch, bodies };
}
const ANTHROPIC = { providers: ['anthropic:claude-sonnet-5-5'], keys: { ANTHROPIC_API_KEY: 'sk-PLANTED' } };
const value = { kind: 'releve_bancaire', piece: null };

test('native anthropic: the schema rides in output_config.format, the reply is the value, no envelope, one corrective turn', async () => {
  const d = anthropic([JSON.stringify(value)]);
  const result = await structured(ask({ effort: 'medium' }), { ...ANTHROPIC, fetch: d.fetch });
  assert.deepEqual([result.ok, result.value, d.bodies.length], [true, value, 1]);
  const [body] = d.bodies;
  assert.deepEqual(body.output_config.format, { type: 'json_schema', schema: SCHEMA });
  // pi keeps a fixed top-level effort (cached prompt) and carries the asked one on a marker message: both survive the hook.
  assert.equal(typeof body.output_config.effort, 'string', 'the effort pi set in output_config is kept');
  assert.match(JSON.stringify(body.messages), /"output_config":\{"effort":"[a-z]+"\}/);
  assert.ok(!JSON.stringify(body.system ?? '').includes('{"answer"'), 'no envelope instruction');
  const fixed = anthropic(['{"kind": "autre"}', JSON.stringify(value)]);
  assert.deepEqual([(await structured(ask(), { ...ANTHROPIC, fetch: fixed.fetch })).value, fixed.bodies.length], [value, 2]);
  assert.match(JSON.stringify(fixed.bodies[1].messages.filter((m) => m.role === 'user').at(-1)), /not valid/);
  const wrong = anthropic(['not json', '{"kind": "autre"}']);
  assert.deepEqual([await structured(ask(), { ...ANTHROPIC, fetch: wrong.fetch }), wrong.bodies.length], [{ ok: false, kind: 'invalid', retryable: true }, 2]);
});

test('native fallback: any other API keeps the envelope, the subset check and one corrective turn', async () => {
  const models = createModels(), faux = fauxProvider({ provider: 'faux', models: [{ id: 'm' }] }), seen = [];
  models.setProvider(faux.provider);
  faux.setResponses([(context) => { seen.push(JSON.stringify(context.messages.filter((m) => m.role === 'system'))); return fauxAssistantMessage('nope'); }, () => fauxAssistantMessage(JSON.stringify({ answer: value }))]);
  const viaFaux = await structured(ask(), { providers: ['faux:m'], models });
  assert.deepEqual([viaFaux.value, faux.state.callCount], [value, 2]);
  assert.match(seen[0], /Reply with one JSON object/);
  assert.deepEqual((await structured(ask(), { providers: ['fake'] })).value, { kind: 'releve_bancaire', piece: { montant_ttc_cents: 0 } });
});

test('native real check: reads the key from stdin, skips without one, prints no key; the statements balance by construction', async () => {
  const { spawnSync } = await import('node:child_process');
  const { STATEMENTS } = await import('../fixtures/caps/llm/statements.mjs');
  assert.equal(STATEMENTS.length, 20);
  const script = new URL('../../scripts/cap-real/llm-native.mjs', import.meta.url).pathname;
  const off = 'data:text/javascript,globalThis.fetch=async()=>new Response("{}",{status:401})';
  const go = (input) => spawnSync(process.execPath, ['--import', off, script, '--runs', '1'], { input, encoding: 'utf8' });
  assert.deepEqual([go('').status, go('').stdout.trim()], [0, 'skipped: no key']);
  const withKey = go('sk-PLANTED-stdin');
  assert.deepEqual([withKey.status, withKey.stdout.includes('run 1: 0/20 valid'), (withKey.stdout + withKey.stderr).includes('PLANTED')], [1, true, false]);
});

test('native time: up to 600,000 ms, the default stays 60,000, a long answer resolves', async (t) => {
  const refused = anthropic([JSON.stringify(value)]);
  assert.deepEqual(await structured(ask(), { ...ANTHROPIC, fetch: refused.fetch, timeoutMs: 600_001 }), { ok: false, kind: 'llm-timeout:600000', retryable: false });
  assert.equal(refused.bodies.length, 0);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const slow = (ms) => { let reached = false; const d = anthropic([JSON.stringify(value)], () => { reached = true; return new Promise((r) => setTimeout(r, ms)); }); return { ...d, reached: () => reached }; };
  const settle = async (d, pending, ms) => { while (!d.reached()) await new Promise((r) => setImmediate(r)); t.mock.timers.tick(ms); return pending; };
  const long = slow(350_000);
  assert.deepEqual((await settle(long, structured(ask(), { ...ANTHROPIC, fetch: long.fetch, timeoutMs: 600_000 }), 350_000)).value, value);
  const late = slow(61_000);
  assert.deepEqual(await settle(late, structured(ask(), { ...ANTHROPIC, fetch: late.fetch }), 61_000), { ok: false, kind: 'timeout', retryable: true });
});
