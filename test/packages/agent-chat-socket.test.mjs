// The chat transport over hibernatable WebSockets: the real server handler (`createConversationSocketHandler`) mounted on an in-memory
// Hibernation API, the real browser client (`createRemoteChat({ transport: 'websocket' })`) and the unchanged native chat controller.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createChatTransportHandler, createConversationSocketHandler, routeSubmissions } from '@hachej/boring-agent/chat-transport';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { createNativeChatController } from '@hachej/boring-ui-kit/native-chat';
import { createFakeChatModel } from '@hachej/boring-testing/model';

const identity = { runtimeId: 'fictional-runtime', scopeId: 'fictional-scope', principalId: 'fictional-person' };
const endpoint = 'https://fixture.invalid/chat?conversation=main';
const until = async (label, check) => { const deadline = Date.now() + 5000; while (!check()) { assert.ok(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 10)); } };
const texts = view => view.entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'assistant')
  .flatMap(message => message.content.filter(part => part.type === 'text').map(part => part.text));
const userTexts = view => view.entries.flatMap(entry => entry.model ?? []).filter(message => message.role === 'user')
  .map(message => typeof message.content === 'string' ? message.content : message.content.map(part => part.text).join(''));
const noHttp = async () => { throw new Error('the socket transport must not use HTTP'); };

/**
 * A Durable Object stand-in: sockets accepted into an in-memory Hibernation API whose attachments are JSON round-tripped, and a handler
 * that can be dropped and rebuilt (`evict`) the way an evicted object loses its memory while its sockets stay connected.
 */
async function fixture(t) {
  const fake = createFakeChatModel();
  const harness = await Harness.open(new MemoryStorage(), { registry: createRegistry(), models: fake.models }, context);
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model: fake.model } }, context);
  t.after(() => harness.close(context));
  const drafts = [];
  const routed = routeSubmissions(conversation, async draft => { drafts.push(draft); await conversation.submit(draft, context); });
  const accepted = new Map(); // raw server socket -> tags
  let instance = 0;
  /** What the platform hands one object instance: a fresh wrapper per instance, whose sends go nowhere once the instance is gone. */
  const view = (raw, owner = instance) => ({
    send: message => { if (owner === instance) raw.deliver(message); },
    close: (code, reason) => raw.shut(code, reason),
    serializeAttachment: value => { raw.attachment = JSON.stringify(value); },
    deserializeAttachment: () => raw.attachment === undefined ? null : JSON.parse(raw.attachment),
  });
  const state = {
    acceptWebSocket: (socket, tags) => { accepted.set(socket.raw, tags); },
    getWebSockets: tag => [...accepted].filter(([, tags]) => !tag || tags.includes(tag)).map(([raw]) => raw.views.get(instance) ?? raw.views.set(instance, Object.assign(view(raw), { raw })).get(instance)),
  };
  let opened = 0;
  const make = () => createConversationSocketHandler({ state,
    authenticate: async request => new URL(request.url).searchParams.get('conversation') === 'main' ? { owner: 'fictional-person', conversationId: String(conversation.id) } : null,
    access: async attachment => { opened++; return attachment.conversationId === String(conversation.id) ? { conversation: routed, context } : null; } });
  const server = { handler: make(), calls: [], dropReply: undefined };
  const evict = () => { instance++; server.handler = make(); };

  /** `webSocket.open` for the client: a socket pair wired to the current handler. */
  const sockets = [];
  const open = url => {
    const client = { readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
      send: text => {
        if (client.readyState !== 1) throw new Error('not open');
        if (text !== 'ping') server.calls.push(JSON.parse(text));
        void server.handler.webSocketMessage(raw.views.get(instance) ?? state.getWebSockets().find(item => item.raw === raw), text);
      },
      close: () => drop(1000) };
    const raw = { views: new Map(), attachment: undefined,
      deliver: message => {
        if (client.readyState !== 1) return;
        if (server.dropReply && message.startsWith('{"kind":"reply"') && server.dropReply(JSON.parse(message))) { server.dropReply = undefined; drop(1006); return; }
        queueMicrotask(() => client.onmessage?.({ data: message }));
      },
      shut: code => drop(code) };
    function drop(code) {
      if (client.readyState === 3) return;
      client.readyState = 3; accepted.delete(raw);
      const socket = raw.views.get(instance);
      if (socket) void server.handler.webSocketClose(socket, code, '');
      queueMicrotask(() => client.onclose?.({ code }));
    }
    sockets.push({ client, raw, drop });
    assert.match(url.protocol, /^wss?:$/, 'the socket URL is derived from the page endpoint');
    const socket = Object.assign(view(raw), { raw }); raw.views.set(instance, socket);
    client.readyState = 1;
    void server.handler.accept(socket, new Request(String(url).replace(/^ws/, 'http'))).then(ok => { if (!ok) drop(1008); });
    return client;
  };
  return { fake, conversation, drafts, server, evict, open, sockets, accepted, opened: () => opened };
}

test('a socket session receives a snapshot, then native deltas, and drives the unchanged controller', async t => {
  const { fake, conversation, drafts, open, server } = await fixture(t);
  const remote = await createRemoteChat({ endpoint, fetch: noHttp, transport: 'websocket', webSocket: { open }, pollMs: 10 });
  assert.equal(remote.conversation.id, conversation.id);
  const controller = createNativeChatController({ identity, ...remote });
  t.after(() => controller.dispose());
  await controller.connect();
  controller.setText('Describe the fictional document.');
  const submission = await controller.send();
  const call = await fake.nextCall();
  call.append('Streaming ');
  await until('a delta reaches the remote view', () => JSON.stringify(controller.getSnapshot().view?.docs ?? {}).includes('Streaming '));
  call.respond('answer.');
  assert.equal((await submission.wait(remote.context)).status, 'done');
  const native = await conversation.watch(context);
  t.after(() => native.stop());
  await until('the replica rebuilt from socket deltas equals the native view', () => JSON.stringify(controller.getSnapshot().view) === JSON.stringify(native.value));
  assert.ok(texts(controller.getSnapshot().view).includes('Streaming answer.'));
  assert.equal(drafts[0].whenBusy, 'followUp', 'a socket submit without whenBusy is a follow-up when the conversation is busy');
  assert.ok(server.calls.some(frame => frame.op === 'submit') && server.calls.every(frame => frame.kind === 'call'));
});

test('a dropped socket reconnects with a fresh snapshot and resends the pending submit once; the host runs it once', { timeout: 10_000 }, async t => {
  const { fake, conversation, server, open, sockets } = await fixture(t);
  const remote = await createRemoteChat({ endpoint, fetch: noHttp, transport: 'websocket', webSocket: { open }, reconnect: { baseDelayMs: 5, maxDelayMs: 20 }, pollMs: 10 });
  const controller = createNativeChatController({ identity, ...remote });
  t.after(() => controller.dispose());
  await controller.connect();
  // The host admits the submit, then the socket dies before the reply arrives: the client cannot know it was admitted.
  server.dropReply = frame => server.calls.find(call => call.id === frame.id)?.op === 'submit';
  controller.setText('Only once, please.');
  const sending = controller.send();
  await until('the client reconnects on a new socket', () => sockets.length >= 2);
  const submission = await sending;
  assert.equal(controller.getSnapshot().send.kind, 'admitted');
  const submits = server.calls.filter(frame => frame.op === 'submit');
  assert.equal(submits.length, 2, 'the unanswered submit was sent again exactly once');
  assert.equal(submits[0].id, submits[1].id);
  assert.equal(submits[0].body.requestId, submits[1].body.requestId, 'unchanged: same call and request ID');
  (await fake.nextCall()).respond('Done once.');
  assert.equal((await submission.wait(remote.context)).status, 'done');
  const native = await conversation.watch(context);
  t.after(() => native.stop());
  assert.deepEqual(userTexts(native.value), ['Only once, please.'], 'the resent submit was deduplicated by its request ID');
  await until('the reopened socket started from a complete view and stays current', () => texts(controller.getSnapshot().view).includes('Done once.'));
});

test('an evicted object keeps its sockets: the attachment survives and the wake reopens the watch with a fresh view', async t => {
  const { conversation, server, evict, open, sockets, opened } = await fixture(t);
  const remote = await createRemoteChat({ endpoint, fetch: noHttp, transport: 'websocket', webSocket: { open }, pollMs: 10 });
  const controller = createNativeChatController({ identity, ...remote });
  t.after(() => controller.dispose());
  await controller.connect();
  assert.deepEqual(server.handler.connections().map(({ owner, conversationId }) => ({ owner, conversationId })), [{ owner: 'fictional-person', conversationId: String(conversation.id) }]);
  const before = opened();
  evict(); // memory gone (no watch, no access), the socket is still connected
  assert.deepEqual(server.handler.connections().map(({ owner, conversationId }) => ({ owner, conversationId })), [{ owner: 'fictional-person', conversationId: String(conversation.id) }], 'the attachment survived hibernation');
  // Work done while the object slept (here a write; on Cloudflare a run resumed by the wake alarm), then the wake reopens the watches.
  await conversation.submit({ type: 'write', entry: { kind: 'fictional.note', model: [{ role: 'user', content: 'Written while hibernating', timestamp: 0 }] } }, context);
  await server.handler.resume();
  assert.equal(opened(), before + 1, 'the wake resolved the access again from the attachment alone');
  await until('the reopened watch sent a complete view', () => userTexts(controller.getSnapshot().view).includes('Written while hibernating'));
  assert.equal(sockets.length, 1, 'no reconnect was needed');
  assert.equal(controller.getSnapshot().connection.kind, 'connected');
  server.handler.broadcast({ kind: 'presence', count: 1 }, { owner: 'fictional-person' });
});

test('a socket that cannot open falls back to the HTTP transport; HTTP alone is unchanged', async t => {
  const { conversation } = await fixture(t);
  const http = createChatTransportHandler({ authenticate: async () => ({ conversation, context }) });
  const ops = [];
  const fetch = request => { ops.push(new URL(request.url).searchParams.get('op')); return http(request); };
  const failing = () => { const socket = { readyState: 0, send() {}, close() {} }; queueMicrotask(() => socket.onclose?.({ code: 1006 })); return socket; };
  const remote = await createRemoteChat({ endpoint, fetch, transport: 'websocket', webSocket: { open: failing } });
  const controller = createNativeChatController({ identity, ...remote });
  t.after(() => controller.dispose());
  await controller.connect();
  assert.equal(controller.getSnapshot().connection.kind, 'connected');
  assert.deepEqual(ops, ['watch'], 'the chat reached the host over HTTP');
});

test('the socket handler refuses an unauthenticated upgrade and answers ping without the conversation', async t => {
  const { server } = await fixture(t);
  const sent = [];
  const socket = { send: message => sent.push(message), close() {}, serializeAttachment() { throw new Error('a refused socket is never accepted'); }, deserializeAttachment: () => null };
  assert.equal(await server.handler.accept(socket, new Request('https://fixture.invalid/chat?conversation=other')), false);
  assert.equal((await server.handler.fetch(new Request('https://fixture.invalid/chat?conversation=main'))).status, 426, 'a plain request is not an upgrade');
  await server.handler.webSocketMessage(socket, 'ping');
  assert.deepEqual(sent, ['pong']);
});

test('a socket upgrade is accepted only from the same origin or an allow-listed one (D-248)', async () => {
  const accepted = [];
  const state = { acceptWebSocket: socket => { accepted.push(socket); }, getWebSockets: () => [] };
  const socket = () => ({ send() {}, close() {}, serializeAttachment() {}, deserializeAttachment: () => null });
  const make = extra => createConversationSocketHandler({ state, ...extra,
    authenticate: async () => ({ owner: 'fictional-person', conversationId: 'c1' }), access: async () => null });
  const upgrade = origin => new Request('https://app.fixture.invalid/api/chat', { headers: { upgrade: 'websocket', ...(origin ? { origin } : {}) } });

  const strict = make({});
  assert.equal(await strict.accept(socket(), upgrade('https://evil.fixture.invalid')), false, 'a cross-origin page cannot open the socket with the visitor\'s cookies');
  assert.equal(await strict.accept(socket(), upgrade('https://app.fixture.invalid')), true, 'same origin');
  assert.equal(await strict.accept(socket(), upgrade(undefined)), true, 'a non-browser client sends no Origin');
  const listed = make({ allowedOrigins: ['https://other.fixture.invalid'] });
  assert.equal(await listed.accept(socket(), upgrade('https://other.fixture.invalid')), true, 'allow-listed');
  assert.equal(await listed.accept(socket(), upgrade('https://evil.fixture.invalid')), false);
  assert.equal(accepted.length, 3);
});
