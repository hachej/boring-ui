// The shared call of the capabilities (caps/shared.ts): run id, failover, a refusal that stops the call, meter calls, time limit and abort,
// through a stub `send` and a test sink. No network, no key.
import assert from 'node:assert/strict';
import test from 'node:test';
import { call, refusedText, toolKey, usageOf } from '@hachej/boring-agent/caps';

const sink = (refuse) => {
  const calls = [];
  const log = (name) => async (input) => { calls.push([name, input]); return name === 'recordUsage' ? { billedMicros: input.amountMicros } : name === 'reserveRun' ? (refuse ? { kind: 'refused', reason: refuse } : { reservationId: 'r1' }) : undefined; };
  return { calls, names: () => calls.map(([n]) => n), reserveRun: log('reserveRun'), recordUsage: log('recordUsage'), settleRun: log('settleRun'), releaseRun: log('releaseRun') };
};
const table = { a: { name: 'a', region: 'eu' }, b: { name: 'b', region: 'us', key: 'B_KEY' }, c: { name: 'c', region: 'global', key: 'C_KEY' } };
const charge = { bucket: 'tool:x', usage: usageOf(0.002), amountMicros: 2000 };
const answer = async () => ({ text: 'hi' });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('shared run id is built from the input and the tool key', async () => {
  const ids = [];
  const send = async (p, key, signal, record) => { await record(charge); return { text: 'x' }; };
  for (const input of [{ q: 1 }, { q: 1 }, { q: 2 }, { f: new Uint8Array([1, 2]) }, { f: new Uint8Array([1, 3]) }]) {
    const s = sink();
    await call('llm', input, { providers: ['a'], meter: { sink: s, userId: 'camille' } }, table, send, '7.3');
    const [, reserve] = s.calls[0];
    assert.match(reserve.runId, /^llm:[0-9a-f]{16}:7\.3$/);
    assert.deepEqual([reserve.userId, reserve.conversationId, reserve.requestId, reserve.kind, reserve.message, reserve.content], ['camille', 0, '7.3', 'input', '', null]);
    ids.push(reserve.runId);
  }
  assert.equal(ids[0], ids[1]);
  assert.equal(new Set(ids).size, 4);
  const s = sink();
  await call('llm', {}, { providers: ['a'], meter: { sink: s, userId: 'u' } }, table, answer);
  assert.match(s.calls[0][1].runId, /^llm:[0-9a-f]{16}:[0-9a-f-]{36}$/);
  assert.equal(toolKey({ conversationId: 7, taskId: 3 }), '7.3');
});

test('shared failover moves on a throw or a missing key, never past a refusal', async () => {
  const tried = [];
  const send = (behave) => async (p) => { tried.push(p.name); return behave[p.name](); };
  const fail = () => { throw new Error('down'); };
  const keys = { B_KEY: 'k', C_KEY: 'k' };
  assert.deepEqual(await call('x', {}, { providers: ['a', 'b'], keys }, table, send({ a: fail, b: async () => ({ n: 1 }) })), { n: 1, ok: true, provider: 'b', region: 'us', counted: false });
  assert.deepEqual(await call('x', {}, { providers: ['b', 'c'], keys: { C_KEY: 'k' } }, table, send({ c: async () => ({ n: 2 }) })), { n: 2, ok: true, provider: 'c', region: 'global', counted: false });
  tried.length = 0;
  const refusal = { ok: false, kind: 'invalid', retryable: true };
  assert.deepEqual(await call('x', {}, { providers: ['a', 'b'], keys }, table, send({ a: async () => refusal, b: async () => ({ n: 3 }) })), refusal);
  assert.deepEqual(tried, ['a']);
  assert.deepEqual(await call('x', {}, { providers: ['a', 'b'], keys }, table, send({ a: fail, b: fail })), { ok: false, kind: 'unavailable', retryable: true });
  assert.deepEqual(await call('x', {}, { providers: ['b'], keys: {} }, table, send({})), { ok: false, kind: 'x-failed', retryable: false });
  tried.length = 0;
  assert.deepEqual(await call('x', {}, { providers: ['a', 'zz'] }, table, send({ a: answer })), { ok: false, kind: 'x-provider', retryable: false });
  assert.deepEqual(await call('x', {}, { providers: [] }, table, send({})), { ok: false, kind: 'unconfigured', retryable: false });
  assert.deepEqual(tried, []);
});

test('shared meter reserves, records each charge, then settles or releases', async () => {
  const s = sink(), meter = { sink: s, userId: 'camille' };
  const send = async (p, key, signal, record) => { await record(charge); await record({ ...charge, amountMicros: 5 }); return { text: 'ok' }; };
  const result = await call('llm', { secret: 'planted prompt' }, { providers: ['a'], meter }, table, send, '1.1');
  assert.equal(result.counted, true);
  assert.deepEqual(s.names(), ['reserveRun', 'recordUsage', 'recordUsage', 'settleRun']);
  assert.deepEqual(s.calls.filter(([n]) => n === 'recordUsage').map(([, i]) => [i.usageId, i.amountMicros, i.reservationId]), [['llm:' + s.calls[0][1].runId.split(':')[1] + ':1.1:1', 2000, 'r1'], ['llm:' + s.calls[0][1].runId.split(':')[1] + ':1.1:2', 5, 'r1']]);
  assert.equal(s.calls.at(-1)[1].status, 'done');
  assert.ok(!JSON.stringify(s.calls).includes('planted'));
  const paid = sink();
  await call('llm', {}, { providers: ['a'], meter: { sink: paid, userId: 'u' } }, table, async (p, k, sg, record) => { await record(charge); return { ok: false, kind: 'invalid', retryable: true }; });
  assert.equal(paid.calls.at(-1)[1].status, 'unanswered');
  const none = sink();
  await call('llm', {}, { providers: ['a'], meter: { sink: none, userId: 'u' } }, table, async () => { throw new Error('down'); });
  assert.deepEqual([none.names().at(-1), none.calls.at(-1)[1].reason], ['releaseRun', 'error-before-usage']);
  const refusing = sink('daily-share:50'), sent = [];
  assert.deepEqual(await call('llm', {}, { providers: ['a'], meter: { sink: refusing, userId: 'u' } }, table, async () => sent.push(1)), { ok: false, kind: 'daily-share:50', retryable: false });
  assert.deepEqual([sent.length, refusing.names()], [0, ['reserveRun']]);
  const off = sink();
  off.isEnabled = () => false;
  assert.equal((await call('llm', {}, { providers: ['a'], meter: { sink: off, userId: 'u' } }, table, answer)).counted, false);
  assert.deepEqual(off.names(), []);
});

test('shared time limit covers the whole call and the caller can abort', async () => {
  let seen;
  const slow = async (p, key, signal) => { seen = signal; await pause(300); return { text: 'late' }; };
  const started = Date.now();
  assert.deepEqual(await call('llm', {}, { providers: ['a'], timeoutMs: 40 }, table, slow), { ok: false, kind: 'timeout', retryable: true });
  assert.ok(Date.now() - started < 200 && seen.aborted);
  const caller = new AbortController(), pending = call('llm', {}, { providers: ['a'], signal: caller.signal }, table, slow);
  await pause(10); caller.abort();
  assert.deepEqual(await pending, { ok: false, kind: 'aborted', retryable: false });
  assert.deepEqual(await call('llm', {}, { providers: ['a'], signal: AbortSignal.abort() }, table, answer), { ok: false, kind: 'aborted', retryable: false });
});

test('shared wordings and usage', () => {
  assert.equal(refusedText({ ok: false, kind: 'timeout', retryable: true }), 'failed: timeout. You may call once more; if it fails again, tell the person.');
  assert.equal(refusedText({ ok: false, kind: 'daily-share:50', retryable: false }), 'refused: daily-share:50. Stop and tell the person.');
  assert.deepEqual([usageOf(0.5).cost.total, usageOf(0.5).totalTokens], [0.5, 0]);
});
