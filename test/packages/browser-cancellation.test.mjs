import assert from 'node:assert/strict';
import test from 'node:test';
import { connectWorker, serveRequests } from '@hachej/boring-browser/transport';

async function fixture(t) {
  const { port1, port2 } = new MessageChannel();
  let effects = 0;
  const stop = serveRequests(() => { effects++; return new Response(null, { status: 204 }); }, port2);
  const connection = connectWorker(port1);
  t.after(() => { stop(); port1.close(); port2.close(); });
  await connection.ready;
  return { connection, effects: () => effects };
}

test('worker transport refuses an already-cancelled mutation before dispatch', async t => {
  const { connection, effects } = await fixture(t);
  const aborter = new AbortController();
  aborter.abort();
  await assert.rejects(connection.fetch('https://fictional.invalid/write', { method: 'POST', body: 'fictional', signal: aborter.signal }), { name: 'AbortError' });
  assert.equal(effects(), 0);
});

test('worker transport rechecks cancellation after reading the request body', async t => {
  const { connection, effects } = await fixture(t);
  const aborter = new AbortController();
  let body;
  const stream = new ReadableStream({ start(controller) { body = controller; } });
  const result = connection.fetch(new Request('https://fictional.invalid/write', { method: 'POST', body: stream, duplex: 'half', signal: aborter.signal }));
  const rejected = assert.rejects(result, { name: 'AbortError' });
  aborter.abort();
  body.enqueue(new TextEncoder().encode('fictional'));
  body.close();
  await rejected;
  assert.equal(effects(), 0);
});
