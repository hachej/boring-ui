import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { readJsonBody } from '@hachej/boring-files/request-guard';

for (const [name, body, limit, expected] of [
  ['success', '{"ok":true}', 100, null],
  ['invalid JSON', '{', 100, 400],
  ['oversized body', '{"ok":true}', 2, 413],
]) test(`request guard releases its cancellation listener after ${name}`, async () => {
  const owner = new AbortController();
  for (let count = 0; count < 12; count++) {
    const result = readJsonBody(new Response(body, { headers: { 'content-type': 'application/json' } }), limit, owner.signal);
    if (expected) await assert.rejects(result, error => error.status === expected);
    else assert.deepEqual(await result, { ok: true });
    assert.equal(getEventListeners(owner.signal, 'abort').length, 0);
  }
});

test('request guard cancels a stalled body and releases its listener', async () => {
  const owner = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const result = readJsonBody(new Response(stream, { headers: { 'content-type': 'application/json' } }), 100, owner.signal);
  owner.abort();
  await assert.rejects(result, /aborted/);
  assert.equal(cancelled, true);
  assert.equal(getEventListeners(owner.signal, 'abort').length, 0);
});
