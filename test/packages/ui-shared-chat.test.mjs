import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedChat, createFakeChannelSource, createChannelSocket } from '@hachej/boring-ui-kit/shared-chat';
import { sharedChatSeed } from '../../examples/shared-chat/seed.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const until = async ready => { for (let n = 0; n < 100 && !ready(); n++) await tick(); assert.ok(ready()); };

test('shared reconnect pages across a long gap, in order, without duplicate messages', async t => {
  const source = createFakeChannelSource(sharedChatSeed);
  const chat = createSharedChat(source, { conversationId: 'main', limit: 2 });
  t.after(() => chat.dispose()); await chat.connect();
  assert.deepEqual(chat.getSnapshot().shared.messages.map(message => message.id), ['six', 'seven']);
  source.setStatus('offline');
  for (let n = 0; n < 11; n++) source.emit({ type: 'message', message: { id: `gap-${n}`, conversationId: 'main', author: 'leo', at: new Date(Date.UTC(2026, 9, 20, 12, n)).toISOString(), text: `Gap ${n}` } });
  source.setStatus('live');
  await until(() => chat.getSnapshot().shared.messages.length === 13);
  assert.deepEqual(chat.getSnapshot().shared.messages.map(message => message.id), ['six', 'seven', ...Array.from({ length: 11 }, (_, n) => `gap-${n}`)]);
  await chat.loadEarlier();
  assert.deepEqual(chat.getSnapshot().shared.messages.slice(0, 4).map(message => message.id), ['four', 'five', 'six', 'seven']);
});

test('a delta arriving during the initial history read wins over its stale page', async t => {
  const fake = createFakeChannelSource({ ...sharedChatSeed, messages: [{ id: 'live', conversationId: 'main', author: 'pm', at: '2026-10-19T12:00:00Z', text: 'One', streaming: true }] });
  let release, reading = false;
  const source = { ...fake, history: async (...args) => { const page = await fake.history(...args); reading = true; await new Promise(resolve => { release = resolve; }); return page; } };
  const chat = createSharedChat(source, { conversationId: 'main' }); t.after(() => chat.dispose());
  const opening = chat.connect(); await until(() => reading);
  fake.emit({ type: 'message', message: { id: 'live', conversationId: 'main', author: 'pm', at: '2026-10-19T12:00:00Z', text: 'One', streaming: true } });
  fake.emit({ type: 'delta', conversationId: 'main', messageId: 'live', text: ' two' });
  release(); await opening;
  assert.equal(chat.getSnapshot().shared.messages[0].text, 'One two');
});

test('a committed send with a lost acknowledgement replays the same payload and dedupes its echo', async t => {
  const fake = createFakeChannelSource(sharedChatSeed);
  let lost = true, deliver = true;
  const payloads = [];
  const source = { ...fake,
    subscribe: (id, event, status) => fake.subscribe(id, update => { if (deliver) event(update); }, status),
    send: async input => {
      payloads.push({ ...input });
      if (lost) { lost = false; deliver = false; await fake.send(input); deliver = true; fake.setStatus('offline'); throw new Error('Lost reply'); }
      return fake.send(input);
    },
  };
  const chat = createSharedChat(source, { conversationId: 'main' }); t.after(() => chat.dispose()); await chat.connect();
  chat.setText('@leo A retained message'); const sending = chat.send();
  await until(() => chat.getSnapshot().send.kind === 'unknown');
  chat.setText('Later draft'); fake.setStatus('live'); await sending;
  assert.equal(payloads.length, 2); assert.deepEqual(payloads[1], payloads[0]);
  assert.equal(chat.getSnapshot().draft.text, 'Later draft');
  assert.equal(chat.getSnapshot().shared.messages.filter(message => message.clientId === payloads[0].clientId).length, 1);
  assert.deepEqual(payloads[0].mentions, ['leo']);
});

test('an initially offline source is not reported live; disposal releases only its subscription', async () => {
  const source = createFakeChannelSource(sharedChatSeed); source.setStatus('offline');
  const first = createSharedChat(source, { conversationId: 'main' }), second = createSharedChat(source, { conversationId: 'main' });
  await first.connect(); await second.connect();
  assert.equal(first.getSnapshot().shared.status, 'offline');
  assert.equal(first.getSnapshot().connection.kind, 'reconnecting');
  await first.dispose(); source.setStatus('live');
  await until(() => second.getSnapshot().shared.status === 'live');
  source.emit({ type: 'message', message: { id: 'after-detach', conversationId: 'main', author: 'leo', at: '2026-10-20T12:00:00Z', text: 'Still attached' } });
  assert.equal(second.getSnapshot().shared.messages.at(-1).id, 'after-detach');
  assert.equal(first.getSnapshot().shared.messages.some(message => message.id === 'after-detach'), false);
  await second.dispose();
});

test('shared file bytes are retained until the exact send; member ids do not depend on display names', async t => {
  const source = createFakeChannelSource({ ...sharedChatSeed, members: [...sharedChatSeed.members, { id: 'second-leo', name: 'Leo', kind: 'person' }], conversations: [{ ...sharedChatSeed.conversations[0], members: [...sharedChatSeed.conversations[0].members, 'second-leo'] }] });
  let sent;
  const chat = createSharedChat({ ...source, send: async input => { sent = input; return source.send(input); } }, { conversationId: 'main' });
  t.after(() => chat.dispose()); await chat.connect();
  const file = new File(['fictional seeds'], 'seeds.txt', { type: 'text/plain' });
  chat.setFiles([file]); chat.setText('@second-leo'); await chat.send();
  assert.deepEqual(sent.mentions, ['second-leo']); assert.equal(sent.attachments[0].name, 'seeds.txt');
  assert.equal(await sent.attachments[0].text(), 'fictional seeds'); assert.equal(chat.getSnapshot().shared.files.length, 0);
});

test('channel socket default routes, validated events, overrides and owned reconnect lifecycle', async () => {
  const requests = [], sockets = [], events = [], statuses = [];
  const msg = { id: 'posted', conversationId: 'main', author: 'mira', at: '2026-10-20T12:00:00Z', text: 'Hello', clientId: 'c1', via: 'Claude', replyTo: 'parent', card: { requestId: 'pdf', title: 'Export PDF', line: 'Une version à essayer', state: 'preview' }, steps: [{ label: 'Vérifier le PDF', detail: 'fictional admin detail', status: 'done' }] };
  const source = await createChannelSocket({ url: 'https://fictional.invalid/spaces/garden', reconnectMs: 1,
    fetch: async request => {
      requests.push(request);
      const path = new URL(request.url).pathname;
      if (path.endsWith('/me')) return Response.json(sharedChatSeed.me);
      if (path.endsWith('/conversations')) return Response.json(sharedChatSeed.conversations);
      if (path.endsWith('/members')) return Response.json(sharedChatSeed.members);
      if (path.endsWith('/actions')) return new Response(null, { status: 204 });
      return Response.json(request.method === 'POST' ? msg : { messages: [msg], before: 'old' });
    },
    open: url => { const socket = { url, close() { this.onclose?.(); } }; sockets.push(socket); return socket; },
  });
  assert.equal(source.me.id, 'mira'); assert.equal((await source.conversations()).length, 3);
  assert.equal((await source.members('main')).length, 5);
  assert.equal((await source.history('main', { before: 'last', limit: 20 })).before, 'old');
  const posted = await source.send({ conversationId: 'main', text: 'Hello', mentions: ['leo'], clientId: 'c1' }); assert.equal(posted.id, 'posted'); assert.equal(posted.via, 'Claude'); assert.equal(posted.card.state, 'preview'); assert.deepEqual(posted.steps, msg.steps);
  await source.action({ conversationId: 'main', requestId: 'review-plan', actionId: 'review' });
  assert.deepEqual(requests.map(request => [request.method, new URL(request.url).pathname]), [
    ['GET', '/spaces/garden/me'], ['GET', '/spaces/garden/conversations'], ['GET', '/spaces/garden/conversations/main/members'],
    ['GET', '/spaces/garden/conversations/main/messages'], ['POST', '/spaces/garden/conversations/main/messages'], ['POST', '/spaces/garden/conversations/main/actions'],
  ]);
  assert.equal(new URL(requests[3].url).search, '?limit=20&before=last');
  assert.deepEqual(await requests[4].json(), { text: 'Hello', mentions: ['leo'], clientId: 'c1' });
  const stop = source.subscribe('main', event => events.push(event), status => statuses.push(status));
  assert.equal(sockets[0].url.href, 'wss://fictional.invalid/spaces/garden/live?conversationId=main');
  sockets[0].onopen(); sockets[0].onmessage({ data: JSON.stringify({ type: 'message', message: msg }) });
  assert.equal(events[0].message.id, 'posted'); assert.equal(events[0].message.via, 'Claude');
  sockets[0].onmessage({ data: JSON.stringify({ type: 'step', messageId: 'posted', conversationId: 'main', index: 0, step: { label: 'Relire', status: 'running' } }) });
  assert.deepEqual(events[1], { type: 'step', messageId: 'posted', conversationId: 'main', index: 0, step: { label: 'Relire', status: 'running' } });
  sockets[0].onclose(); await until(() => sockets.length === 2); sockets[1].onopen();
  assert.deepEqual(statuses, ['reconnecting', 'live', 'offline', 'reconnecting', 'live']);
  stop(); await tick(); assert.equal(sockets.length, 2);
  const overridden = await createChannelSocket({ url: 'https://fictional.invalid/spaces/garden', me: sharedChatSeed.me, routes: { history: async () => ({ messages: [] }) } });
  assert.deepEqual(await overridden.history('main', { limit: 20 }), { messages: [] });
});
