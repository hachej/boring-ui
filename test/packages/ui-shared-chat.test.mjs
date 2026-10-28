import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedChat, createFakeChannelSource, createChannelSocket, ChannelRequestError, cardActions } from '@hachej/boring-ui-kit/shared-chat';
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

test('a card pushed before the first page is not a reconnect: the first page keeps its cursor and earlier pages still load', async t => {
  // A host that delivers its pending cards as soon as the thread subscribes, before the thread has read any history.
  const fake = createFakeChannelSource(sharedChatSeed);
  const card = { id: 'card', conversationId: 'main', author: 'pm', at: '2026-10-21T09:00:00Z', text: 'Try this', card: { id: 'c1', title: 'A fictional request', actions: [] } };
  const source = { ...fake, subscribe: (id, event, status) => { const off = fake.subscribe(id, event, status); event({ type: 'message', message: card }); return off; } };
  const chat = createSharedChat(source, { conversationId: 'main', limit: 2 }); t.after(() => chat.dispose());
  await chat.connect();
  assert.deepEqual(chat.getSnapshot().shared.messages.map(message => message.id), ['six', 'seven', 'card'], 'one page, not a walk through the whole history');
  assert.equal(chat.getSnapshot().history.hasMore, true, 'the cursor of the first page is kept');
  await chat.loadEarlier();
  assert.deepEqual(chat.getSnapshot().shared.messages.slice(0, 2).map(message => message.id), ['four', 'five']);
});

test('a page loaded above or a delta keeps every other message object, so only changed rows render again', async t => {
  const source = createFakeChannelSource(sharedChatSeed);
  const chat = createSharedChat(source, { conversationId: 'main', limit: 2 }); t.after(() => chat.dispose());
  await chat.connect();
  const [six, seven] = chat.getSnapshot().shared.messages;
  await chat.loadEarlier();
  const after = chat.getSnapshot().shared.messages;
  assert.equal(after.find(message => message.id === 'six'), six, 'a kept message keeps its object');
  assert.equal(after.find(message => message.id === 'seven'), seven);
  source.emit({ type: 'delta', conversationId: 'main', messageId: 'seven', text: ' more' });
  const delta = chat.getSnapshot().shared.messages;
  assert.equal(delta.find(message => message.id === 'six'), six, 'a delta on another message leaves this one alone');
  assert.notEqual(delta.find(message => message.id === 'seven'), seven, 'the changed message is a new object');
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
      if (lost) { lost = false; deliver = false; await fake.send(input); deliver = true; fake.setStatus('offline'); throw new ChannelRequestError('network', 'Lost reply', true); }
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

test('a sent message is in the thread at once, pending, and the host confirmation replaces it in place', async t => {
  const fake = createFakeChannelSource(sharedChatSeed);
  let release;
  const source = { ...fake, send: async input => { await new Promise(resolve => { release = resolve; }); return fake.send(input); } };
  const chat = createSharedChat(source, { conversationId: 'main' }); t.after(() => chat.dispose()); await chat.connect();
  const before = chat.getSnapshot().shared.messages.length;
  chat.setText('A fictional question'); const sending = chat.send();
  const pending = chat.getSnapshot().shared.messages.at(-1);
  assert.equal(chat.getSnapshot().shared.messages.length, before + 1, 'drawn before the host answered');
  assert.deepEqual([pending.author, pending.text, pending.pending], ['mira', 'A fictional question', true]);
  assert.equal(chat.getSnapshot().draft.text, '');
  await until(() => release); release(); await sending;
  const messages = chat.getSnapshot().shared.messages;
  assert.equal(messages.length, before + 1, 'the confirmation replaces the pending copy: one message');
  assert.equal(messages.at(-1).clientId, pending.clientId);
  assert.equal(messages.at(-1).pending, undefined);
  assert.notEqual(messages.at(-1).id, pending.id);
});

test('a refused send takes its pending copy out and gives the text back', async t => {
  const fake = createFakeChannelSource(sharedChatSeed);
  const source = { ...fake, send: async () => { throw new ChannelRequestError('refused', 'Not allowed here', false, { refused: true }); } };
  const chat = createSharedChat(source, { conversationId: 'main' }); t.after(() => chat.dispose()); await chat.connect();
  const before = chat.getSnapshot().shared.messages.length;
  chat.setText('A refused message'); await chat.send();
  assert.equal(chat.getSnapshot().shared.messages.length, before);
  assert.equal(chat.getSnapshot().shared.messages.some(message => message.pending), false);
  assert.equal(chat.getSnapshot().draft.text, 'A refused message');
  assert.equal(chat.getSnapshot().send.kind, 'blocked');
});

test('a pending copy sorts last even when this device clock is behind the host', async t => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const fake = createFakeChannelSource({ ...sharedChatSeed, messages: [...sharedChatSeed.messages, { id: 'ahead', conversationId: 'main', author: 'leo', at: future, text: 'From a host clock an hour ahead' }] });
  const source = { ...fake, send: () => new Promise(() => {}) };
  const chat = createSharedChat(source, { conversationId: 'main' }); t.after(() => chat.dispose()); await chat.connect();
  chat.setText('Mine'); void chat.send();
  assert.equal(chat.getSnapshot().shared.messages.at(-1).text, 'Mine');
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

test('channel socket RPC, validated events, overrides and owned reconnect lifecycle', async () => {
  const requests = [], sockets = [], events = [], statuses = [];
  const msg = { id: 'posted', conversationId: 'main', author: 'mira', at: '2026-10-20T12:00:00Z', text: 'Hello', clientId: 'c1', via: 'Claude', replyTo: 'parent', card: { requestId: 'pdf', title: 'Export PDF', line: 'Une version à essayer', state: 'preview' }, steps: [{ label: 'Vérifier le PDF', detail: 'fictional admin detail', status: 'done' }] };
  const source = await createChannelSocket({ url: 'https://fictional.invalid', reconnectMs: 1,
    fetch: async request => {
      requests.push(request);
      const path = new URL(request.url).pathname;
      if (path.endsWith('/me')) return Response.json({ space: 'sp_fictional', me: sharedChatSeed.me });
      if (path.endsWith('/conversations')) return Response.json(sharedChatSeed.conversations);
      if (path.endsWith('/members')) return Response.json(sharedChatSeed.members);
      if (path.endsWith('/action')) return Response.json({ ok: true });
      return Response.json(path.endsWith('/send') ? msg : { messages: [msg], before: 'old' });
    },
    open: url => { const socket = { url, close() { this.onclose?.(); } }; sockets.push(socket); return socket; },
  });
  assert.equal(source.me.id, 'mira'); assert.equal((await source.conversations()).length, 3);
  assert.equal((await source.members('main')).length, 5);
  assert.equal((await source.history('main', { before: 'last', limit: 20 })).before, 'old');
  const posted = await source.send({ conversationId: 'main', text: 'Hello', mentions: ['leo'], clientId: 'c1' }); assert.equal(posted.id, 'posted'); assert.equal(posted.via, 'Claude'); assert.equal(posted.card.state, 'preview'); assert.deepEqual(posted.steps, msg.steps);
  await source.action({ conversationId: 'main', requestId: 'review-plan', actionId: 'review' });
  assert.deepEqual(requests.map(request => [request.method, new URL(request.url).pathname]), [
    ['POST', '/_channel/me'], ['POST', '/_channel/conversations'], ['POST', '/_channel/members'],
    ['POST', '/_channel/history'], ['POST', '/_channel/send'], ['POST', '/_channel/action'],
  ]);
  assert.deepEqual(await requests[3].json(), { conversationId: 'main', before: 'last', limit: 20 });
  assert.deepEqual(await requests[4].json(), { conversationId: 'main', text: 'Hello', mentions: ['leo'], clientId: 'c1', idempotencyKey: 'c1' });
  const stop = source.subscribe('main', event => events.push(event), status => statuses.push(status));
  assert.equal(sockets[0].url.href, 'wss://fictional.invalid/spaces/sp_fictional/live');
  sockets[0].onopen(); sockets[0].onmessage({ data: JSON.stringify({ type: 'message', message: msg }) });
  assert.equal(events[0].message.id, 'posted'); assert.equal(events[0].message.via, 'Claude');
  sockets[0].onmessage({ data: JSON.stringify({ type: 'step', messageId: 'posted', conversationId: 'main', index: 0, step: { label: 'Relire', status: 'running' } }) });
  assert.deepEqual(events[1], { type: 'step', messageId: 'posted', conversationId: 'main', index: 0, step: { label: 'Relire', status: 'running' } });
  sockets[0].onclose(); await until(() => sockets.length === 2); sockets[1].onopen();
  assert.deepEqual(statuses, ['reconnecting', 'live', 'offline', 'reconnecting', 'live']);
  stop(); await tick(); assert.equal(sockets.length, 2);
  const overridden = await createChannelSocket({ url: 'https://fictional.invalid', fetch: async () => Response.json({ space: 'sp_fictional', me: sharedChatSeed.me }), routes: { history: async () => ({ messages: [] }) } });
  assert.deepEqual(await overridden.history('main', { limit: 20 }), { messages: [] });
});

test('a card with several actions runs the chosen one; the single action and the first action stay the default', async t => {
  const card = { requestId: 'reminders', title: 'Reminders by text', line: 'Ready to build.', actions: [{ id: 'build', label: 'Build it', variant: 'primary' }, { id: 'later', label: 'Not now', variant: 'secondary' }] };
  const source = createFakeChannelSource(sharedChatSeed);
  const chat = createSharedChat(source, { conversationId: 'main' }); t.after(() => chat.dispose()); await chat.connect();
  await chat.action(card, 'later');
  await chat.action(card);
  await chat.action({ requestId: 'review-plan', title: 'Review', line: 'Waiting.', action: { id: 'review', label: 'Review' } });
  await chat.action({ requestId: 'review-plan', title: 'Review', line: 'Waiting.', action: { id: 'review', label: 'Review' } }, 'review');
  await chat.action({ requestId: 'none', title: 'No choice', line: 'Nothing to do.' });
  await assert.rejects(chat.action(card, 'forged'), /offers no action forged/);
  assert.deepEqual(source.actions.map(action => action.actionId), ['later', 'build', 'review', 'review']);
  assert.deepEqual(cardActions({ action: { id: 'one', label: 'One' } }), [{ id: 'one', label: 'One' }]);
  assert.deepEqual(cardActions({ action: { id: 'one', label: 'One' }, actions: [] }), [], 'actions, when present, win over the single action');
});

test('the channel socket keeps card actions and the member role line', async () => {
  const actions = [{ id: 'build', label: 'Build it', variant: 'primary' }, { id: 'later', label: 'Not now', variant: 'secondary' }];
  const msg = { id: 'card', conversationId: 'main', author: 'pm', at: '2026-10-20T12:00:00Z', card: { requestId: 'r', title: 'Reminders', line: 'Ready.', actions } };
  const members = [{ id: 'reminder', name: 'Reminder agent', kind: 'agent', role: 'agent:reminder', roleLabel: 'the reminders' }];
  const source = await createChannelSocket({ url: 'https://fictional.invalid',
    fetch: async request => {
      const path = new URL(request.url).pathname;
      if (path.endsWith('/me')) return Response.json({ space: 'sp_fictional', me: sharedChatSeed.me });
      if (path.endsWith('/members')) return Response.json(members);
      return Response.json({ messages: [msg] });
    },
    open: url => ({ url, close() {} }) });
  assert.deepEqual((await source.history('main', { limit: 20 })).messages[0].card.actions, actions);
  assert.equal((await source.members('main'))[0].roleLabel, 'the reminders');
});

test('the channel socket keeps system notices and pinned comments; an unknown kind reads as absent, never as a refused page', async () => {
  const messages = [
    { id: 'joined', conversationId: 'main', author: 'lea', at: '2026-10-20T12:00:00Z', kind: 'system', text: 'Léa joined' },
    { id: 'pin', conversationId: 'main', author: 'mira', at: '2026-10-20T12:01:00Z', card: { requestId: 'p', kind: 'pin', title: 'White bg', line: 'Preview of Due date column' } },
    { id: 'future', conversationId: 'main', author: 'pm', at: '2026-10-20T12:02:00Z', kind: 'poll', text: 'A newer host kind', card: { requestId: 'f', kind: 'vote', title: 'Vote', line: 'Later' } },
  ];
  const source = await createChannelSocket({ url: 'https://fictional.invalid',
    fetch: async request => new URL(request.url).pathname.endsWith('/me') ? Response.json({ space: 'sp_fictional', me: sharedChatSeed.me }) : Response.json({ messages }),
    open: url => ({ url, close() {} }) });
  const [joined, pin, future] = (await source.history('main', { limit: 20 })).messages;
  assert.equal(joined.kind, 'system');
  assert.equal(pin.card.kind, 'pin');
  assert.equal(future.kind, undefined); assert.equal(future.card.kind, undefined);
  assert.equal(future.text, 'A newer host kind');
});
