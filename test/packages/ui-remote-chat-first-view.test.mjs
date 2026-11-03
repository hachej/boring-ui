// A host that accepts the watch but never sends a first view must not leave the page on « Connecting… »: the chat gives up and says why.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';

const endpoint = 'https://fixture.invalid/chat';

test('a watch response that never sends its first view is an error after firstViewTimeoutMs', async () => {
  let aborted = false;
  const fetch = async request => {
    request.signal.addEventListener('abort', () => { aborted = true; });
    return new Response(new ReadableStream({ start() { /* open, silent */ } }), { headers: { 'content-type': 'application/x-ndjson' } });
  };
  const started = Date.now();
  await assert.rejects(createRemoteChat({ endpoint, fetch, firstViewTimeoutMs: 150 }), /timed out before its first view/);
  assert.ok(Date.now() - started < 1500);
  assert.ok(aborted, 'the stalled request is aborted');
});

test('a watch request that never answers is an error too', async () => {
  const fetch = request => new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(createRemoteChat({ endpoint, fetch, firstViewTimeoutMs: 150 }), /timed out before its first view/);
});

test('a prompt first view is unaffected and the timer does not keep the process or fire later', async () => {
  const view = { conversation: { id: 'c' }, entries: [], docs: {} };
  const fetch = async () => new Response(JSON.stringify({ kind: 'view', view }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
  const remote = await createRemoteChat({ endpoint, fetch, firstViewTimeoutMs: 100 });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(remote.conversation.id, 'c');
  await remote.close();
});
