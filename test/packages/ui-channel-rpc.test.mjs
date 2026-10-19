import assert from 'node:assert/strict';
import test from 'node:test';
import { createChannelSocket, createSharedChat } from '@hachej/boring-ui-kit/shared-chat';
import { sharedChatSeed } from '../../examples/shared-chat/seed.mjs';

const msg = { id: 'rpc-message', conversationId: 'main', author: 'mira', at: '2026-10-19T12:00:00Z', text: 'Hello', clientId: 'client-one' };
const errorResponse = (retryable, message = 'Le service est indisponible.') => Response.json({ error: { code: retryable ? 'unavailable' : 'forbidden', message, retryable } }, { status: retryable ? 503 : 403 });

function host() {
  const requests = [], sockets = [];
  return {
    requests, sockets,
    fetch: async request => {
      const body = await request.json(); const op = new URL(request.url).pathname.split('/').at(-1);
      requests.push({ method: request.method, url: request.url, contentType: request.headers.get('content-type'), op, body });
      if (op === 'me') return Response.json({ space: 'sp_fictional', me: sharedChatSeed.me });
      if (op === 'conversations') return Response.json(sharedChatSeed.conversations);
      if (op === 'members') return Response.json(sharedChatSeed.members);
      if (op === 'history') return Response.json({ messages: [msg], before: 'earlier' });
      if (op === 'send') return Response.json({ ...msg, clientId: body.clientId, text: body.text });
      if (op === 'join') return Response.json({ space: 'sp_fictional' });
      return Response.json({ ok: true });
    },
    open: url => { const socket = { url, close() { this.onclose?.(); } }; sockets.push(socket); return socket; },
  };
}

test('the default host source uses app RPC bodies and the me response supplies its live space', async () => {
  const server = host();
  const source = await createChannelSocket({ url: 'https://fictional.invalid/app', fetch: server.fetch, open: server.open, reconnectMs: 1 });
  assert.equal(source.me.id, 'mira');
  await source.conversations(); await source.members('main'); await source.history('main', { before: 'last', limit: 20 });
  await source.send({ conversationId: 'main', text: 'Hello', mentions: ['pm'], replyTo: 'parent', clientId: 'client-one' });
  await source.action({ conversationId: 'main', requestId: 'pdf', actionId: 'try' });
  await source.remove('rpc-message'); await source.join();
  assert.deepEqual(server.requests.map(request => [request.method, new URL(request.url).pathname]), ['me', 'conversations', 'members', 'history', 'send', 'action', 'remove', 'join'].map(op => ['POST', `/app/_channel/${op}`]));
  assert.ok(server.requests.every(request => request.contentType === 'application/json'));
  assert.deepEqual(server.requests[0].body, {}); assert.deepEqual(server.requests[1].body, {});
  assert.deepEqual(server.requests[2].body, { conversationId: 'main' });
  assert.deepEqual(server.requests[3].body, { conversationId: 'main', before: 'last', limit: 20 });
  assert.deepEqual(server.requests[4].body, { conversationId: 'main', text: 'Hello', mentions: ['pm'], replyTo: 'parent', clientId: 'client-one', idempotencyKey: 'client-one' });
  assert.equal(server.requests[5].body.requestId, 'pdf'); assert.equal(server.requests[5].body.actionId, 'try');
  assert.equal(server.requests[5].body.conversationId, 'main'); assert.ok(server.requests[5].body.idempotencyKey);
  assert.deepEqual(server.requests[6].body, { messageId: 'rpc-message' });
  const events = [];
  const stop = source.subscribe('main', event => events.push(event));
  assert.equal(server.sockets[0].url.href, 'wss://fictional.invalid/app/spaces/sp_fictional/live');
  server.sockets[0].onmessage({ data: JSON.stringify({ type: 'message', message: { ...msg, conversationId: 'admin' } }) });
  server.sockets[0].onmessage({ data: JSON.stringify({ type: 'message', message: msg }) });
  assert.deepEqual(events, [{ type: 'message', message: msg }]); stop();
});

test('RPC errors preserve the host message, code and retryability without read/action retry loops', async () => {
  await assert.rejects(createChannelSocket({ url: 'https://fictional.invalid', fetch: async () => errorResponse(false, 'Accès refusé.') }), error => error.message === 'Accès refusé.' && error.code === 'forbidden' && error.retryable === false);
  const server = host();
  let calls = 0;
  const source = await createChannelSocket({ url: 'https://fictional.invalid', fetch: request => {
    if (new URL(request.url).pathname.endsWith('/me')) return server.fetch(request);
    calls++; return errorResponse(true);
  } });
  await assert.rejects(source.history('main', { limit: 20 }), error => error.message === 'Le service est indisponible.' && error.retryable === true);
  await assert.rejects(source.action({ conversationId: 'main', requestId: 'pdf', actionId: 'try' }), error => error.message === 'Le service est indisponible.' && error.retryable === true);
  assert.equal(calls, 2, 'read and action errors are surfaced, never blindly looped');
});

test('only retryable sends replay through the existing shared outbox with the same idempotency key', async t => {
  for (const retryable of [true, false]) await t.test(String(retryable), async t => {
    const server = host(); let sendCalls = 0; const bodies = [];
    const source = await createChannelSocket({ url: 'https://fictional.invalid', open: server.open, fetch: async request => {
      if (!new URL(request.url).pathname.endsWith('/send')) return server.fetch(request);
      const body = await request.json(); bodies.push(body); sendCalls++;
      if (sendCalls === 1) return errorResponse(retryable, 'Veuillez réessayer plus tard.');
      return Response.json({ ...msg, clientId: body.clientId });
    } });
    const chat = createSharedChat(source, { conversationId: 'main' }); t.after(() => chat.dispose()); await chat.connect();
    chat.setText('Hello'); const pending = chat.send();
    for (let n = 0; n < 100 && !['unknown', 'blocked'].includes(chat.getSnapshot().send.kind); n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(chat.getSnapshot().send.kind, retryable ? 'unknown' : 'blocked');
    assert.equal(chat.getSnapshot().send.reason, 'Veuillez réessayer plus tard.');
    await chat.retrySameRequest();
    if (retryable) { await pending; assert.equal(sendCalls, 2); assert.deepEqual(bodies[1], bodies[0]); }
    else { await pending; assert.equal(sendCalls, 1); assert.equal(chat.getSnapshot().draft.text, 'Hello'); }
    assert.equal(bodies[0].idempotencyKey, bodies[0].clientId);
  });
});

test('JSON RPC refuses File attachments before dispatch rather than serializing them as empty objects', async () => {
  const server = host();
  const source = await createChannelSocket({ url: 'https://fictional.invalid', fetch: server.fetch });
  await assert.rejects(source.send({ conversationId: 'main', text: 'See attached', mentions: [], clientId: 'with-file', attachments: [new File(['fictional'], 'fictional.txt')] }), error => error.code === 'unsupported-attachments' && error.retryable === false && error.refused);
  assert.equal(server.requests.length, 1, 'only bootstrap reached the host');
});

test('a malformed acknowledgement cannot replay but history can confirm the original submission', async t => {
  const server = host(); let committed, sends = 0;
  const source = await createChannelSocket({ url: 'https://fictional.invalid', open: server.open, fetch: async request => {
    const op = new URL(request.url).pathname.split('/').at(-1);
    if (op === 'send') { const input = await request.json(); sends++; committed = { ...msg, id: 'committed', clientId: input.clientId }; return new Response(null, { status: 204 }); }
    if (op === 'history' && committed) return Response.json({ messages: [msg, committed] });
    return server.fetch(request);
  } });
  const chat = createSharedChat(source, { conversationId: 'main' }); t.after(() => chat.dispose()); await chat.connect();
  chat.setText('Hello'); const pending = chat.send();
  for (let n = 0; n < 100 && chat.getSnapshot().send.kind !== 'unknown'; n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(chat.getSnapshot().send.kind, 'unknown'); assert.equal(chat.getSnapshot().send.retryable, false);
  await chat.retrySameRequest(); assert.equal(sends, 1);
  await chat.reconcile(); await pending;
  assert.equal(chat.getSnapshot().send.kind, 'admitted'); assert.equal(sends, 1);
  assert.equal(chat.getSnapshot().shared.messages.filter(message => message.clientId === committed.clientId).length, 1);
});
