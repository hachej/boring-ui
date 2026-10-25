import assert from 'node:assert/strict';
import test from 'node:test';
import { createChannelSocket, createRoomSource, createSharedChat } from '@hachej/boring-ui-kit/shared-chat';
import { startRoomBackend } from '../../examples/shared-chat/room-backend.mjs';

// The room source against a fictional room host that speaks `services/channel/room.mjs`'s door over the real room kit (pi-durable on node
// SQLite). Fictional people: ana, ben. Nothing here runs a model or leaves the machine.
const until = async (label, check, ms = 6000) => { const end = Date.now() + ms; while (!(await check())) { assert.ok(Date.now() < end, label); await new Promise(done => setTimeout(done, 5)); } };

async function open(backend, person, options = {}) {
  const source = await createRoomSource({ url: backend.url, reconnectMs: 20, ...options,
    fetch: async request => { request.headers.set('x-room-person', person); return fetch(request); },
    open: url => { const target = new URL(url); target.searchParams.set('person', person); return new WebSocket(target); } });
  const chat = createSharedChat(source, { conversationId: 'main' });
  await chat.connect();
  const messages = () => chat.getSnapshot().shared.messages;
  return { source, chat, messages, close: () => chat.dispose() };
}
const withBackend = (options, run) => async t => {
  const backend = await startRoomBackend(options);
  const opened = [];
  const as = async (person, extra) => { const side = await open(backend, person, extra); opened.push(side); return side; };
  try { await run({ backend, as, t }); } finally { for (const side of opened) await side.close(); await backend.close(); }
};

test('the room entry kinds read as messages, a system line, a card with its actions, a pin; ids never become names', withBackend({}, async ({ backend, as }) => {
  const ana = await as('person:ana');
  assert.deepEqual(ana.source.me, { id: 'person:ana', name: 'Ana', kind: 'person', role: 'owner' });
  assert.equal(ana.source.engine, 'room');
  assert.deepEqual((await ana.source.conversations()).map(c => [c.id, c.title, c.kind]), [['main', 'Team', 'main']]);
  const members = ana.chat.getSnapshot().shared.members;
  assert.deepEqual(members.map(m => [m.id, m.kind, m.role]), [['person:ana', 'person', 'owner'], ['person:ben', 'person', 'validator'], ['person:dev', 'person', 'member'], ['agent:pm', 'agent', 'agent:pm'], ['agent:worker', 'agent', 'agent:worker'], ['agent:verifier', 'agent', 'agent:verifier']]);
  const [system, ben, card, pin] = ana.messages();
  assert.equal(ana.messages().length, 4);
  assert.equal(system.kind, 'system'); assert.equal(system.text, 'Ben a rejoint');
  assert.deepEqual([ben.author, ben.text], ['person:ben', 'Le plan du jardin est prêt pour relecture.']);
  assert.deepEqual([card.author, card.card.title, card.card.state, card.card.requestId], ['agent:worker', 'Export CSV', 'preview', 'csv']);
  assert.deepEqual(card.card.actions, [{ id: 'try', label: 'Try' }, { id: 'later', label: 'Later', variant: 'secondary' }]);
  assert.deepEqual([pin.card.kind, pin.card.title, pin.card.line], ['pin', 'Le bouton est trop bas', 'Accueil, bouton Exporter']);
  assert.ok(ana.messages().every(m => !/[0-9a-f]{8}-/.test(JSON.stringify(m))), 'no uuid or request id reaches a message');
  assert.equal(ana.source.cursor('main'), Math.max(...(await backend.entries()).map(e => e.id)));
  const french = await createRoomSource({ url: backend.url, locale: 'fr', fetch: async r => { r.headers.set('x-room-person', 'person:ana'); return fetch(r); } });
  assert.equal((await french.conversations())[0].title, 'Équipe');
}));

test('a person joins first (the web door never enrols); a refusal is a calm no-access, and nothing else is called', withBackend({}, async ({ backend }) => {
  const ana = await createRoomSource({ url: backend.url, fetch: async r => { r.headers.set('x-room-person', 'person:ana'); return fetch(r); } });
  assert.equal(ana.space, 'sp_fictionalroom');
  assert.deepEqual(backend.log.map(r => r.operation).slice(0, 2), ['join', 'me'], 'join, then the room');
  const before = backend.log.length;
  await assert.rejects(createRoomSource({ url: backend.url, fetch: async r => { r.headers.set('x-room-person', 'person:eve'); return fetch(r); } }), error => error.code === 'no-access' && error.refused === true && error.retryable === false);
  assert.deepEqual(backend.log.slice(before).map(r => r.operation), ['join'], 'a refused join stops there');
  const bare = await createRoomSource({ url: backend.url, join: false, fetch: async r => { r.headers.set('x-room-person', 'person:ben'); return fetch(r); } }).catch(error => error);
  assert.equal(bare.code, 'no-access', 'without a join the room door says no such space');
}));

test('a card action goes through the door and wakes the card\'s agent once', withBackend({}, async ({ backend, as }) => {
  const ana = await as('person:ana');
  await ana.chat.action(ana.messages()[2].card, 'try');
  const entries = await backend.entries();
  assert.deepEqual(entries.at(-1).data, { author: 'person:ana', requestId: 'csv', actionId: 'try' });
  await until('the worker answers', () => ana.messages().some(m => m.author === 'agent:worker' && m.text === 'Noté, je prépare l’essai.'));
  assert.equal(ana.messages().filter(m => m.author === 'agent:worker' && m.text).length, 1);
}));

test('B1 and B7: my message shows at once, and its echo replaces it in place (never a second bubble)', withBackend({ latencyMs: 80 }, async ({ backend, as }) => {
  const ana = await as('person:ana'), ben = await as('person:ben');
  ana.chat.setText('Bonjour Ben');
  const sent = ana.chat.send();
  const shown = performance.now();
  assert.equal(ana.messages().at(-1).pending, true, 'the bubble is there before the host has answered');
  assert.equal(ana.messages().at(-1).text, 'Bonjour Ben');
  const message = await sent;
  assert.ok(performance.now() - shown >= 70, 'the host really took its time');
  await until('ben sees it', () => ben.messages().some(m => m.text === 'Bonjour Ben'));
  await new Promise(done => setTimeout(done, 100));
  for (const side of [ana, ben]) assert.equal(side.messages().filter(m => m.text === 'Bonjour Ben').length, 1);
  assert.equal(ana.messages().find(m => m.text === 'Bonjour Ben').id, message.id);
  assert.equal(ana.messages().find(m => m.text === 'Bonjour Ben').pending, undefined);
  // The same key again gives the first entry back: a retried send is one message.
  const requests = backend.log.filter(r => r.operation === 'send');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.idempotencyKey, message.clientId);
}));

test('an open wake draws the agent writing, and its answer takes the same place (no double, no orphan)', withBackend({}, async ({ as }) => {
  const ana = await as('person:ana'), ben = await as('person:ben');
  const seen = [];
  ana.chat.subscribe(() => { const w = ana.messages().filter(m => m.author === 'agent:pm'); seen.push(w.map(m => [m.streaming === true, m.text ?? ''].join('|'))); });
  ana.chat.setText('@agent:pm écris-moi un plan');
  await ana.chat.send();
  const writing = () => ana.messages().find(m => m.author === 'agent:pm' && m.streaming);
  await until('the writing sign (from the send answer)', writing);
  await until('ben sees it too (the wake frame)', () => ben.messages().some(m => m.author === 'agent:pm' && m.streaming));
  await until('the text streams in', () => (writing()?.text ?? '').length > 10 && writing().steps?.length > 0);
  await until('the answer lands', () => ana.messages().some(m => m.author === 'agent:pm' && !m.streaming && m.text?.startsWith('Je regarde')));
  for (const side of [ana, ben]) {
    const pm = side.messages().filter(m => m.author === 'agent:pm');
    assert.equal(pm.length, 1, 'one message from the PM: the writing message became the answer');
    assert.equal(pm[0].text, 'Je regarde vos fichiers, puis je prépare une version que vous pourrez essayer.');
    assert.deepEqual(pm[0].steps, [{ label: 'Lire vos fichiers', status: 'done' }, { label: 'Préparer la version', status: 'done' }]);
    assert.ok(!side.messages().some(m => m.id.startsWith('wake:')), 'no orphan writing message');
  }
  assert.ok(Math.max(...seen.map(s => s.length)) <= 1, 'never two PM bubbles at once');
}));

test('a question is a card: a reply answers it, in place on every screen, and the agent goes on', withBackend({}, async ({ as }) => {
  const ana = await as('person:ana'), ben = await as('person:ben');
  ana.chat.setText('@agent:pm quel format ?');
  await ana.chat.send();
  const question = side => side.messages().find(m => m.question);
  await until('both see the question', () => question(ana) && question(ben));
  assert.deepEqual(question(ben).question, { callId: question(ben).question.callId, prompt: 'Quel format voulez-vous pour l’export ?', options: ['PDF', 'CSV'], allowFreeText: true, answered: false });
  assert.equal(question(ben).author, 'agent:pm');
  assert.ok(!ana.messages().some(m => m.author === 'agent:pm' && m.streaming), 'the agent waits for a person: nothing says it is writing');
  await assert.rejects(ana.chat.answer({ ...question(ana), question: { ...question(ana).question, answered: true } }, 'PDF'), /not open/);
  await ben.chat.answer(question(ben), 'CSV');
  await until('answered everywhere', () => question(ana).question.answered && question(ben).question.answered);
  assert.equal(ben.messages().find(m => m.text === 'CSV').replyTo, question(ben).id, 'the answer is a reply to the question');
  await until('the agent continues with the answer', () => ana.messages().some(m => m.author === 'agent:pm' && !m.streaming && m.text === 'Parfait, j’ajoute un export CSV.'));
  for (const side of [ana, ben]) {
    assert.equal(side.messages().filter(m => m.author === 'agent:pm' && m.text?.startsWith('Parfait')).length, 1);
    assert.ok(!side.messages().some(m => m.id.startsWith('wake:')), 'no orphan writing message');
    assert.equal(side.messages().filter(m => m.question).length, 1, 'the question stays, once');
  }
}));

test('resume after a reconnect asks the host for entries after the last one read, and shows each exactly once', withBackend({}, async ({ backend, as }) => {
  const ana = await as('person:ana'), ben = await as('person:ben');
  ben.chat.setText('avant la coupure'); await ben.chat.send();
  await until('ana has it', () => ana.messages().some(m => m.text === 'avant la coupure'));
  const cursor = ana.source.cursor('main');
  assert.equal(cursor, Math.max(...(await backend.entries()).map(e => e.id)), 'frames of an unbroken socket keep the cursor current');
  const statuses = [];
  ana.chat.subscribe(() => statuses.push(ana.chat.getSnapshot().shared.status));
  backend.cut();
  await until('ana sees the connection is lost', () => ana.chat.getSnapshot().shared.status === 'offline');
  // While ana is away, ben speaks twice and the PM answers him.
  ben.chat.setText('@agent:pm pendant la coupure'); await ben.chat.send();
  ben.chat.setText('pendant la coupure 2'); await ben.chat.send();
  await until('the PM answered while ana was away', async () => (await backend.entries()).some(e => e.data.author === 'agent:pm' && e.data.text?.startsWith('Je regarde')));
  assert.ok(!ana.messages().some(m => m.text === 'pendant la coupure 2'), 'ana has seen nothing of it');
  const away = backend.log.length;
  backend.restore();
  await until('ana is back and has caught up', () => ana.chat.getSnapshot().shared.status === 'live' && ana.messages().some(m => m.author === 'agent:pm' && m.text?.startsWith('Je regarde')) && ana.messages().some(m => m.text === 'pendant la coupure 2'));
  await new Promise(done => setTimeout(done, 150));
  for (const text of ['avant la coupure', '@agent:pm pendant la coupure', 'pendant la coupure 2']) assert.equal(ana.messages().filter(m => m.text === text).length, 1, text);
  assert.equal(ana.messages().filter(m => m.author === 'agent:pm').length, 1, 'the answer, once; no writing message left behind');
  const order = ana.messages().map(m => m.text).filter(Boolean);
  assert.ok(order.indexOf('@agent:pm pendant la coupure') < order.indexOf('pendant la coupure 2'));
  const resumed = backend.log.slice(away).filter(r => r.person === 'person:ana' && r.operation === 'history');
  assert.ok(resumed.length >= 1, 'a reconnect reads history');
  assert.ok(resumed.every(r => r.body.after === cursor), `a resume reads after the cursor, never from the start: ${JSON.stringify(resumed.map(r => r.body))}`);
  assert.ok(statuses.includes('offline') && statuses.at(-1) === 'live');
  assert.ok(ana.source.cursor('main') > cursor);
}));

test('B6: an agent silent for the stall time says so and offers Try again; retrying resends the same wake and gives one answer', withBackend({}, async ({ as }) => {
  const ana = await as('person:ana', { stallMs: 150 });
  ana.chat.setText('@agent:pm c’est lent'); await ana.chat.send();
  const stalled = () => ana.messages().find(m => m.author === 'agent:pm' && m.card);
  await until('the writing sign', () => ana.messages().some(m => m.author === 'agent:pm' && m.streaming));
  await until('the stalled card', stalled);
  assert.deepEqual(stalled().card.actions, [{ id: 'retry', label: 'Try again' }]);
  await ana.chat.action(stalled().card, 'retry');
  await until('the answer', () => ana.messages().some(m => m.author === 'agent:pm' && !m.streaming && m.text?.startsWith('Désolé')));
  assert.equal(ana.messages().filter(m => m.author === 'agent:pm').length, 1, 'one message: the stalled card became the answer');
}));

test('removing my own message marks it removed on my screen; an agent\'s message cannot be removed', withBackend({}, async ({ backend, as }) => {
  const ana = await as('person:ana');
  ana.chat.setText('à retirer'); const mine = await ana.chat.send();
  assert.equal(ana.chat.canRemove(ana.messages().find(m => m.id === mine.id)), true);
  await ana.chat.remove(ana.messages().find(m => m.id === mine.id));
  const gone = ana.messages().find(m => m.id === mine.id);
  assert.ok(gone.removed); assert.equal(gone.text, undefined);
  assert.equal(ana.chat.canRemove(gone), false);
  const entries = await backend.entries();
  assert.deepEqual(entries.at(-1).data, { author: 'person:ana', target: Number(mine.id) });
  assert.equal(ana.chat.canRemove(ana.messages().find(m => m.kind === 'system')), false);
}));

test('the door as R2 ships it (no wake frame, no conversation on stream frames, no open wakes): the writing state still shows, in the right conversation', withBackend({ strict: true }, async ({ backend, as }) => {
  const ana = await as('person:ana'), ben = await as('person:ben');
  ana.chat.setText('@agent:pm un plan'); await ana.chat.send();
  await until('the sender sees the working sign from the send answer', () => ana.messages().some(m => m.author === 'agent:pm' && m.streaming));
  await until('ben sees it from the first frame', () => ben.messages().some(m => m.author === 'agent:pm' && (m.streaming || m.text?.startsWith('Je regarde'))));
  await until('the answer', () => ben.messages().some(m => m.author === 'agent:pm' && !m.streaming && m.text?.startsWith('Je regarde')));
  for (const side of [ana, ben]) assert.equal(side.messages().filter(m => m.author === 'agent:pm').length, 1);
  assert.ok(backend.log.every(r => r.operation !== 'retry'));
}));

test('a reload redraws an open wake from the history answer', withBackend({}, async ({ backend, as }) => {
  const ana = await as('person:ana');
  ana.chat.setText('@agent:pm c’est lent'); await ana.chat.send();
  await until('wake open', async () => (await backend.wakes()).length === 1);
  const reloaded = await as('person:ana');
  assert.equal(reloaded.messages().filter(m => m.author === 'agent:pm' && m.streaming).length, 1);
}));

test('the old channel source still takes a message with a question (additive field)', async () => {
  const requests = [];
  const source = await createChannelSocket({ url: 'https://fictional.invalid/', fetch: async request => {
    const op = new URL(request.url).pathname.split('/').at(-1);
    if (op === 'me') return Response.json({ space: 'sp_x', me: { id: 'ana', name: 'Ana', kind: 'person' } });
    requests.push(op);
    return Response.json({ messages: [{ id: '1', conversationId: 'main', author: 'pm', at: '2026-10-19T10:00:00Z', question: { callId: 'c', prompt: 'Which?', options: ['a'], allowFreeText: false, answered: false } }] });
  } });
  assert.equal((await source.history('main', { limit: 5 })).messages[0].question.prompt, 'Which?');
});
