import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createAskUserTool } from '@hachej/boring-agent/ask-user';
import { defineAgent } from '@hachej/boring-agent/agents';
import { ROOM, agentsConversation, createRoom, createRoomTurn, roomView, wakeFor } from '@hachej/boring-agent/room';

const until = async (label, check) => { const deadline = Date.now() + 8000; while (!(await check())) { assert.ok(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 5)); } };
const people = ['person:ana', 'person:ben'];
const agents = ['agent:pm', 'agent:worker', 'agent:verifier'];
const alone = { people: ['person:ana'], agents };
const both = { people, agents };
const message = (author, text, extra = {}) => ({ author, text, mentions: [], attachments: [], steps: [], ...extra });

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'boring-room-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

/** A room on node SQLite that never runs a model; `clock` drives the resend schedule. */
async function openRoom(path, clock = { now: 1_000 }, wrap = storage => storage) {
  const storage = wrap(await openNodeSqliteStorage(join(path, 'room.sqlite')));
  const harness = await Harness.open(storage, { registry: createRegistry(), models: createModels() }, context);
  return { harness, storage, room: createRoom({ harness, context, now: () => clock.now }) };
}

/** A local model for the agent's home: `script(transcript)` returns `{ text }`, `{ ask }`, or a promise of either. */
function scriptedModel(script) {
  const model = { id: 'fictional-room', name: 'Fictional room', provider: 'fictional-room-provider', api: 'fictional-room-api', baseUrl: 'https://fixture.invalid',
    input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const calls = [];
  const stream = (_model, transcript) => {
    const events = createAssistantMessageEventStream();
    calls.push(transcript.messages.length);
    void (async () => {
      const step = await script(transcript);
      if (step.fail) {
        const failed = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'error', errorMessage: step.fail,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        events.push({ type: 'error', reason: 'error', error: failed }); events.end(failed); return;
      }
      if (step.chunks) {
        // A streaming reply: the partial grows with a pause between chunks, so pi commits it into `pi.live` several times.
        const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
        const partial = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'stop', usage };
        events.push({ type: 'start', partial: structuredClone(partial) });
        let text = '';
        for (const chunk of step.chunks) {
          text += chunk;
          partial.content = [{ type: 'text', text }];
          events.push({ type: 'text_delta', contentIndex: 0, delta: chunk, partial: structuredClone(partial) });
          await new Promise(resolve => setTimeout(resolve, 160));
        }
        events.push({ type: 'done', reason: 'stop', message: partial });
        events.end(partial);
        return;
      }
      const part = step.ask ? { type: 'toolCall', id: `ask-${calls.length}`, name: 'ask_user', arguments: step.ask } : { type: 'text', text: step.text };
      const message = { role: 'assistant', content: [part], api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: step.ask ? 'toolUse' : 'stop',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      events.push({ type: 'start', partial: message });
      events.push({ type: 'done', reason: message.stopReason, message });
      events.end(message);
    })();
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: 'Fictional keyless', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { models, ref: { provider: model.provider, modelId: model.id }, calls };
}

/** The PM's home: its own harness and its own conversation, joined to the room through a bound port. */
async function openHome(path, room, script) {
  const model = scriptedModel(script);
  const agent = defineAgent({ id: 'pm', model: model.ref, tools: [createAskUserTool()], instructions: 'Answer the room.' });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(await openNodeSqliteStorage(join(path, 'home.sqlite')), { registry, models: model.models }, context);
  const conversation = await agent.createConversation(harness, context);
  const port = { settles: [], frames: [], settle: async (wakeId, reply) => { port.settles.push(wakeId); return room.settle('agent:pm', wakeId, reply); },
    stream: async (_wakeId, frames) => { port.frames.push(...frames); }, question: async (wakeId, question) => room.question('agent:pm', wakeId, question) };
  const turn = createRoomTurn({ conversation, context, port, onError: error => { throw error; } });
  return { harness, conversation, turn, port, model };
}

const messages = async (room, name = 'main') => (await room.entries(name)).filter(entry => entry.kind === 'room.message');

test('wakeFor decides who answers, case by case (CH-22)', () => {
  const entry = (kind, data, id = 10) => ({ id, kind, data });
  const pmMessage = entry('room.message', message('agent:pm', 'Voici.'), 3);
  const workerCard = entry('room.card', { author: 'agent:worker', requestId: 'r1' }, 4);
  const question = entry('room.question', { author: 'agent:pm', callId: '5:call', prompt: 'Lequel ?', options: ['a', 'b'], allowFreeText: true }, 5);
  const ben = entry('room.message', message('person:ben', 'Bonjour.'), 6);
  const main = { conversation: 'main', people, agents };
  const one = agentsConversation('agent:worker', 'agent:pm');
  const cases = [
    ['alone, unaddressed: the PM', entry('room.message', message('person:ana', 'Salut')), { ...main, people: ['person:ana'] }, [{ kind: 'wake', agent: 'agent:pm', conversation: 'main' }]],
    ['two people, unaddressed: nobody', entry('room.message', message('person:ana', 'Salut')), main, []],
    ['alone, but the PM is not provisioned: nobody', entry('room.message', message('person:ana', 'Salut')), { ...main, people: ['person:ana'], agents: ['agent:worker'] }, []],
    ['a mention wakes that agent', entry('room.message', message('person:ana', '@worker', { mentions: ['agent:worker'] })), main, [{ kind: 'wake', agent: 'agent:worker', conversation: 'main' }]],
    ['mentions wake at most two', entry('room.message', message('person:ana', 'tous', { mentions: ['agent:verifier', 'agent:worker', 'agent:pm'] })), main,
      [{ kind: 'wake', agent: 'agent:verifier', conversation: 'main' }, { kind: 'wake', agent: 'agent:worker', conversation: 'main' }]],
    ['a mention of a person or an unknown agent wakes nobody', entry('room.message', message('person:ana', '@ben', { mentions: ['person:ben', 'agent:ghost'] })), main, []],
    ['a reply to an agent message wakes it', entry('room.message', message('person:ana', 'Et ça ?', { replyTo: 3 })), { ...main, target: pmMessage }, [{ kind: 'wake', agent: 'agent:pm', conversation: 'main' }]],
    ['a reply to a card wakes its agent', entry('room.message', message('person:ben', 'Pourquoi ?', { replyTo: 4 })), { ...main, target: workerCard }, [{ kind: 'wake', agent: 'agent:worker', conversation: 'main' }]],
    ['a reply and a mention of the same agent wake it once', entry('room.message', message('person:ana', '@pm', { mentions: ['agent:pm'], replyTo: 3 })), { ...main, target: pmMessage }, [{ kind: 'wake', agent: 'agent:pm', conversation: 'main' }]],
    ['a reply to a person wakes nobody', entry('room.message', message('person:ana', 'Oui', { replyTo: 6 })), { ...main, target: ben }, []],
    ['a reply to a question answers it, no new turn', entry('room.message', message('person:ana', 'b', { replyTo: 5 })), { ...main, target: question }, [{ kind: 'answer', agent: 'agent:pm', callId: '5:call' }]],
    ['a message through the person\'s own agent counts as the person', entry('room.message', message('person:ana', 'Salut', { via: 'agent:ana-own' })), { ...main, people: ['person:ana'] }, [{ kind: 'wake', agent: 'agent:pm', conversation: 'main' }]],
    ['an agent in main wakes nobody, even by mention', entry('room.message', message('agent:pm', '@worker', { mentions: ['agent:worker'] })), main, []],
    ['an agent reply to an agent in main wakes nobody', entry('room.message', message('agent:worker', 'ok', { replyTo: 3 })), { ...main, target: pmMessage }, []],
    ['in a 1:1 an agent message wakes the other agent', entry('room.message', message('agent:pm', 'Tu peux ?')), { conversation: one, people, agents, turns: 0 }, [{ kind: 'wake', agent: 'agent:worker', conversation: one }]],
    ['the 1:1 answer wakes back', entry('room.message', message('agent:worker', 'Oui.')), { conversation: one, people, agents, turns: 4 }, [{ kind: 'wake', agent: 'agent:pm', conversation: one }]],
    ['the sixth turn closes the 1:1', entry('room.message', message('agent:worker', 'Encore.')), { conversation: one, people, agents, turns: 5 }, [{ kind: 'capped', conversation: one }]],
    ['a third agent in a 1:1 wakes nobody', entry('room.message', message('agent:verifier', 'Moi ?')), { conversation: one, people, agents, turns: 0 }, []],
    ['a person action on a card wakes the card agent', entry('room.action', { author: 'person:ana', requestId: 'r1', actionId: 'try' }), { ...main, target: workerCard }, [{ kind: 'wake', agent: 'agent:worker', conversation: 'main' }]],
    ['a platform card change wakes nobody', entry('room.card', { author: 'platform:requests', requestId: 'r1' }), main, []],
    ['a platform action wakes nobody', entry('room.action', { author: 'platform:requests', requestId: 'r1', actionId: 'live' }), { ...main, target: workerCard }, []],
    ['an agent card wakes nobody', entry('room.card', { author: 'agent:worker', requestId: 'r2' }), main, []],
    ['a pin wakes nobody', entry('room.pin', { author: 'person:ana', title: 'Accueil', line: 'Trop gros', anchor: '#hero' }), { ...main, people: ['person:ana'] }, []],
    ['a system line wakes nobody', entry('room.system', { author: 'platform:room', line: 'ana a rejoint' }), { ...main, people: ['person:ana'] }, []],
    ['the room closing a wake wakes nobody', entry('room.message', message('platform:room', ROOM.unanswered, { for: 'agent:pm' })), { ...main, people: ['person:ana'] }, []],
  ];
  for (const [label, value, room, expected] of cases) assert.deepEqual(wakeFor(value, room), expected, label);
  assert.equal(one, 'agents:pm:worker');
  assert.equal(agentsConversation('agent:pm', 'agent:worker'), one, 'the same 1:1 whoever opens it');
  assert.throws(() => agentsConversation('person:ana', 'agent:pm'), /Not an agent id/);
});

test('the same requestId twice gives one entry and wakes once (CH-20)', async t => {
  const { harness, room } = await openRoom(directory(t));
  t.after(() => harness.close(context));
  const draft = { requestId: 'web:person:ana:c1', kind: 'room.message', data: message('person:ana', 'Bonjour') };
  const first = await room.write('main', draft, alone);
  const again = await room.write('main', { ...draft, data: message('person:ana', 'Autre texte') }, alone);
  assert.equal(first.duplicate, false);
  assert.equal(first.wakes.length, 1);
  assert.equal(again.duplicate, true);
  assert.deepEqual(again.entry, first.entry, 'the first entry comes back');
  assert.deepEqual(again.wakes, []);
  assert.equal((await messages(room)).length, 1);
  assert.equal((await room.wakes()).length, 1);
  // The record is Pi's own passive write: a native submit with the same id appends nothing either.
  const main = await harness.conversation(await room.conversation('main'), context);
  const native = await main.submit({ type: 'write', requestId: draft.requestId, entry: { kind: 'room.message', data: message('person:ana', 'Troisième') } }, context);
  assert.deepEqual(await native.status(context), { id: native.id, conversationId: main.id, requestId: draft.requestId, type: 'write', status: 'done', entry: first.entry.id });
  assert.equal((await messages(room)).length, 1);
  // The namespace is the writer's: another writer's same key is another entry.
  assert.equal((await room.write('main', { ...draft, requestId: 'mcp:person:ana:c1' }, alone)).duplicate, false);
  assert.equal((await messages(room)).length, 2);
});

test('replaying the same entries gives the same view, byte for byte (CH-24)', async t => {
  const path = directory(t);
  const transcript = [
    ['main', { requestId: 'web:person:ana:1', kind: 'room.system', data: { author: 'platform:room', line: 'ana a rejoint' } }],
    ['main', { requestId: 'web:person:ana:2', kind: 'room.message', data: message('person:ana', 'Ajoute un export CSV à notes-demo.') }],
    ['main', { requestId: 'card:r1:1', kind: 'room.card', data: { author: 'agent:worker', requestId: 'r1' } }],
    ['main', { requestId: 'web:person:ben:1', kind: 'room.message', data: message('person:ben', 'Et pour ledger-demo ?', { mentions: ['agent:pm'], attachments: [{ path: 'attachments/4/plan.png' }] }) }],
    ['main', { requestId: 'web:person:ben:2', kind: 'room.removed', data: { author: 'person:ben', target: 0 } }],
    ['main', { requestId: 'web:person:ana:3', kind: 'room.pin', data: { author: 'person:ana', title: 'Accueil', line: 'Le bouton est trop bas', anchor: '#export' } }],
    ['main', { requestId: 'act:person:ana:1', kind: 'room.action', data: { author: 'person:ana', requestId: 'r1', actionId: 'try' } }],
  ];
  const cards = { r1: { version: 2, title: 'Export CSV', state: 'building', line: 'En cours', since: 1, actions: ['try', 'later'] } };
  const viewer = { id: 'person:ana' };
  async function play(room, twice) {
    let ben;
    for (const [name, draft] of transcript) {
      const resolved = draft.kind === 'room.removed' ? { ...draft, data: { ...draft.data, target: ben } } : draft;
      const written = await room.write(name, resolved, both);
      if (twice) assert.equal((await room.write(name, resolved, both)).duplicate, true);
      if (draft.requestId === 'web:person:ben:1') ben = written.entry.id;
    }
    // The PM's settled answer with a question it asked, and ana's reply to that question.
    const [wake] = await room.wakes();
    const asked = await room.question('agent:pm', wake.id, { callId: 'q-entry:call-1', prompt: 'Quel format ?', options: ['CSV', 'XLSX'], allowFreeText: true });
    await room.write('main', { requestId: 'web:person:ana:4', kind: 'room.message', data: message('person:ana', 'CSV', { replyTo: asked.entry.id }) }, both);
    await room.settle('agent:pm', wake.id, { text: 'C\'est noté.', steps: [{ label: 'Lire la fiche', status: 'done' }] });
  }
  const bytes = async room => JSON.stringify(roomView(await room.entries('main'), cards, viewer));

  const first = await openRoom(path);
  await play(first.room, false);
  const live = await bytes(first.room);
  assert.equal(await bytes(first.room), live, 'folding twice');
  await first.harness.close(context);

  const reopened = await openRoom(path);
  assert.equal(await bytes(reopened.room), live, 'after reopening the storage');
  await reopened.harness.close(context);

  const replay = await openRoom(directory(t));
  await play(replay.room, true);
  assert.equal(await bytes(replay.room), live, 'a second room fed the same writes, each twice');
  await replay.harness.close(context);

  const view = JSON.parse(live);
  assert.deepEqual(view.items.map(item => item.kind), ['system', 'message', 'card', 'message', 'pin', 'question', 'message', 'message']);
  const removed = view.items[3];
  assert.equal(removed.removed, true);
  assert.equal(removed.text, ROOM.removed);
  assert.deepEqual(removed.attachments, [], 'a removed message keeps no attachment');
  assert.equal(view.items[5].answered, true);
  assert.equal(view.items[2].card.state, 'building');
  assert.equal(view.items[1].mine, true);
  assert.equal(view.items[7].author, 'agent:pm');
  assert.equal(view.cursor, view.items.at(-1).id);
  // Resume from a cursor is the same fold over the entries after it.
  const resumed = await openRoom(path);
  t.after(() => resumed.harness.close(context));
  const tail = await resumed.room.entries('main', view.items[4].id);
  assert.deepEqual(roomView(tail, cards, viewer).items, view.items.slice(5));
});

test('a passive write submitted mid-run is done at once', async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const model = scriptedModel(async () => { await held; return { text: 'Fini.' }; });
  const agent = defineAgent({ id: 'busy', model: model.ref, instructions: 'Work.' });
  const registry = createRegistry(); agent.install(registry);
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory(t), 'busy.sqlite')), { registry, models: model.models }, context);
  t.after(() => harness.close(context));
  const conversation = await agent.createConversation(harness, context);
  const input = await conversation.submit({ type: 'input', requestId: 'room:1:agent:pm', content: 'Travaille.' }, context);
  await until('the run is placed', async () => (await input.status(context)).status === 'placed' && model.calls.length === 1);
  const write = await conversation.submit({ type: 'write', requestId: 'web:person:ana:mid', entry: { kind: 'room.message', data: message('person:ana', 'Pendant ce temps') } }, context);
  const status = await write.status(context);
  assert.equal(status.status, 'done', 'appended at once, not queued behind the run');
  assert.equal((await input.status(context)).status, 'placed', 'the run is still going');
  assert.equal((await conversation.entries({ order: 'ascending' }, 50, undefined, context)).items.some(entry => entry.id === status.entry && entry.kind === 'room.message'), true);
  release();
  assert.equal((await input.wait(context)).status, 'done');
});

test('the message, its requestId record and its wake land in one commit or not at all (B2)', async t => {
  const path = directory(t);
  const batches = [];
  let fail = false;
  const wrap = storage => {
    const commit = storage.commit.bind(storage);
    storage.commit = async (writes, ctx) => { batches.push(writes.map(write => write.type)); if (fail) throw new Error('fictional disk failure'); return commit(writes, ctx); };
    return storage;
  };
  const { harness, room } = await openRoom(path, undefined, wrap);
  await room.conversation('main');
  batches.length = 0;
  const written = await room.write('main', { requestId: 'web:person:ana:1', kind: 'room.message', data: message('person:ana', 'Bonjour') }, alone);
  assert.equal(written.wakes.length, 1);
  assert.equal(batches.length, 1, 'one storage commit');
  assert.ok(batches[0].includes('entry') && batches[0].includes('submission') && batches[0].some(type => type.startsWith('document.')), `entry, write record and wake together: ${batches[0]}`);

  fail = true;
  await assert.rejects(room.write('main', { requestId: 'web:person:ana:2', kind: 'room.message', data: message('person:ana', 'Encore') }, alone), /fictional disk failure/);
  await harness.closed;
  const reopened = await openRoom(path);
  t.after(() => reopened.harness.close(context));
  const main = await reopened.harness.conversation(await reopened.room.conversation('main'), context);
  assert.deepEqual((await messages(reopened.room)).map(entry => entry.data.text), ['Bonjour'], 'no message');
  assert.equal(await main.commit(tx => tx.submissionByRequest(main.id, 'web:person:ana:2'), context), undefined, 'no requestId record');
  assert.deepEqual((await reopened.room.wakes()).map(wake => wake.id), [written.wakes[0].id], 'no wake');
  // The retry lands whole.
  const retried = await reopened.room.write('main', { requestId: 'web:person:ana:2', kind: 'room.message', data: message('person:ana', 'Encore') }, alone);
  assert.equal(retried.duplicate, false);
  assert.equal((await reopened.room.wakes()).length, 2);
});

test('after five resends the room closes the wake with one message, and a late reply adds none', async t => {
  const clock = { now: 1_000 };
  const { harness, room } = await openRoom(directory(t), clock);
  t.after(() => harness.close(context));
  const { wakes: [wake] } = await room.write('main', { requestId: 'web:person:ana:1', kind: 'room.message', data: message('person:ana', 'Tu es là ?') }, alone);
  assert.equal(wake.agent, 'agent:pm');
  assert.deepEqual(await room.resend(), { resend: [], closed: [], next: wake.due }, 'nothing is due before two minutes');
  const delays = [];
  for (let attempt = 1; attempt <= ROOM.maxResends; attempt += 1) {
    clock.now = (await room.wakes())[0].due;
    const step = await room.resend();
    assert.deepEqual(step.resend.map(item => [item.id, item.attempts]), [[wake.id, attempt]]);
    delays.push(step.next - clock.now);
  }
  assert.deepEqual(delays, [1, 2, 3, 4, 5].map(n => ROOM.resendAfterMs * 2 ** n), 'backoff');
  clock.now = (await room.wakes())[0].due;
  const closing = await room.resend();
  assert.deepEqual(closing.resend, []);
  assert.deepEqual(closing.closed.map(item => item.id), [wake.id]);
  assert.equal(closing.next, null);
  assert.deepEqual(await room.wakes(), []);
  const closed = await messages(room);
  assert.equal(closed.length, 2);
  assert.deepEqual(closed[1].data, { author: 'platform:room', for: 'agent:pm', text: ROOM.unanswered, mentions: [], attachments: [], steps: [] });
  assert.deepEqual(await room.resend(), { resend: [], closed: [], next: null }, 'closing twice writes nothing');

  const late = await room.settle('agent:pm', wake.id, { text: 'Désolé, me voilà.' });
  assert.equal(late.duplicate, true, 'the late reply finds the room\'s message under the same key');
  assert.equal(late.entry.data.author, 'platform:room');
  assert.equal((await messages(room)).length, 2, 'no second message');
  // CH-23: no open wake, no post; another agent cannot settle someone else's wake.
  const { wakes: [next] } = await room.write('main', { requestId: 'web:person:ana:2', kind: 'room.message', data: message('person:ana', 'Allô ?') }, alone);
  assert.deepEqual(await room.settle('agent:worker', next.id, { text: 'Pas moi.' }), { refused: 'no-open-wake' });
  assert.deepEqual(await room.settle('agent:pm', '999:agent:pm', { text: 'Rien.' }), { refused: 'no-open-wake' });
  assert.deepEqual(await room.settle('agent:pm', 'forged', { text: 'Rien.' }), { refused: 'no-open-wake' });
  assert.equal((await messages(room)).length, 3);
});

test('a 1:1 between agents stops at six turns', async t => {
  const { harness, room } = await openRoom(directory(t));
  t.after(() => harness.close(context));
  const one = agentsConversation('agent:pm', 'agent:worker');
  // The PM opens the 1:1; each settle in it wakes the other agent with the turn counted.
  let { wakes, decisions } = await room.write(one, { requestId: 'wake:open', kind: 'room.message', data: message('agent:pm', 'Tu peux vérifier ?') }, both);
  const turns = [];
  while (wakes.length) {
    const [wake] = wakes;
    turns.push([wake.agent, wake.turns]);
    ({ wakes, decisions } = await room.settle(wake.agent, wake.id, { text: `tour ${wake.turns}` }));
  }
  assert.deepEqual(turns, [['agent:worker', 1], ['agent:pm', 2], ['agent:worker', 3], ['agent:pm', 4], ['agent:worker', 5]]);
  assert.deepEqual(decisions, [{ kind: 'capped', conversation: one }]);
  assert.equal((await messages(room, one)).length, 6, 'six turns, then the 1:1 closes');
  assert.deepEqual(await room.wakes(), []);
  assert.deepEqual(await messages(room), [], 'main stays quiet');
});

test('an agent home settles its wake once; a resend of a done submission settles again with no second message', async t => {
  const path = directory(t);
  const { harness, room } = await openRoom(path);
  const home = await openHome(path, room, async () => ({ text: 'Bonjour ana, je regarde notes-demo.' }));
  t.after(async () => { await home.turn.close(); await home.harness.close(context); await harness.close(context); });
  const { wakes: [wake] } = await room.write('main', { requestId: 'web:person:ana:1', kind: 'room.message', data: message('person:ana', 'Salut') }, alone);
  await home.turn.wake({ wakeId: wake.id, input: 'ana: Salut' });
  await until('settled', async () => (await messages(room)).length === 2);
  assert.deepEqual((await messages(room))[1].data, message('agent:pm', 'Bonjour ana, je regarde notes-demo.'));
  assert.deepEqual(home.port.frames, [{ type: 'text', text: 'Bonjour ana, je regarde notes-demo.' }], 'frames were relayed, never stored');
  assert.deepEqual(await room.wakes(), []);

  await home.turn.wake({ wakeId: wake.id, input: 'ana: Salut' });
  await until('settled again', () => home.port.settles.length === 2);
  assert.equal(home.model.calls.length, 1, 'the resend started nothing');
  assert.equal((await messages(room)).length, 2, 'no second message');
});

test('an agent question becomes a room.question and the reply answers the same run', async t => {
  const path = directory(t);
  const { harness, room } = await openRoom(path);
  const home = await openHome(path, room, async transcript => transcript.messages.at(-1)?.role === 'toolResult'
    ? { text: `Export en ${JSON.parse(transcript.messages.at(-1).content[0].text).answer}.` }
    : { ask: { question: 'Quel format ?', options: ['CSV', 'XLSX'] } });
  t.after(async () => { await home.turn.close(); await home.harness.close(context); await harness.close(context); });
  const { wakes: [wake] } = await room.write('main', { requestId: 'web:person:ana:1', kind: 'room.message', data: message('person:ana', 'Un export ?') }, alone);
  await home.turn.wake({ wakeId: wake.id, input: 'ana: Un export ?' });
  await until('asked', async () => (await room.entries('main')).some(entry => entry.kind === 'room.question'));
  const question = (await room.entries('main')).find(entry => entry.kind === 'room.question');
  assert.deepEqual({ ...question.data, callId: undefined }, { author: 'agent:pm', callId: undefined, prompt: 'Quel format ?', options: ['CSV', 'XLSX'], allowFreeText: true });
  const reply = await room.write('main', { requestId: 'web:person:ana:2', kind: 'room.message', data: message('person:ana', 'CSV', { replyTo: question.id }) }, alone);
  assert.deepEqual(reply.decisions, [{ kind: 'answer', agent: 'agent:pm', callId: question.data.callId }], 'not a new turn');
  assert.deepEqual(reply.wakes, []);
  assert.deepEqual(await home.turn.answer(question.data.callId, 'CSV'), { kind: 'answered' });
  await until('settled', async () => (await messages(room)).at(-1).data.author === 'agent:pm');
  assert.equal((await messages(room)).at(-1).data.text, 'Export en CSV.');
  assert.deepEqual(home.port.frames.filter(frame => frame.type === 'step'), [{ type: 'step', label: 'ask_user', status: 'running' }, { type: 'step', label: 'ask_user', status: 'done' }]);
  assert.equal(roomView(await room.entries('main'), {}, { id: 'person:ana' }).items.find(item => item.kind === 'question').answered, true);
});

test('a wake queued behind a running one is followed: its question reaches the room and its answer settles it', async t => {
  const path = directory(t);
  const { harness, room } = await openRoom(path);
  let asks = 0;
  const home = await openHome(path, room, async transcript => transcript.messages.at(-1)?.role === 'toolResult'
    ? { text: `Reçu ${JSON.parse(transcript.messages.at(-1).content[0].text).answer}.` }
    : { ask: { question: `Question ${++asks} ?`, options: ['oui', 'non'] } });
  t.after(async () => { await home.turn.close(); await home.harness.close(context); await harness.close(context); });
  const { wakes: [a] } = await room.write('main', { requestId: 'web:person:ana:1', kind: 'room.message', data: message('person:ana', 'A') }, alone);
  const { wakes: [b] } = await room.write('main', { requestId: 'web:person:ana:2', kind: 'room.message', data: message('person:ana', 'B') }, alone);
  await home.turn.wake({ wakeId: a.id, input: 'ana: A' });
  await home.turn.wake({ wakeId: b.id, input: 'ana: B' });

  const questions = async () => (await room.entries('main')).filter(entry => entry.kind === 'room.question');
  await until('A asks', async () => (await questions()).length === 1);
  assert.equal((await questions())[0].data.prompt, 'Question 1 ?');
  assert.deepEqual(await home.turn.answer((await questions())[0].data.callId, 'oui'), { kind: 'answered' });
  await until('A settled, B asks', async () => (await questions()).length === 2 && home.port.settles.includes(a.id));
  const second = (await questions())[1];
  assert.notEqual(second.data.callId, (await questions())[0].data.callId, 'B asks its own question');
  assert.deepEqual(await home.turn.answer(second.data.callId, 'non'), { kind: 'answered' });
  await until('B settled', () => home.port.settles.includes(b.id));
  assert.deepEqual((await messages(room)).filter(entry => entry.data.author === 'agent:pm').map(entry => entry.data.text), ['Reçu oui.', 'Reçu non.']);
  assert.deepEqual(await room.wakes(), []);
});

test('an unanswered submission closes its wake with the room line instead of dropping it', async t => {
  const path = directory(t);
  const { harness, room } = await openRoom(path);
  const home = await openHome(path, room, async () => ({ fail: 'fictional model failure' }));
  t.after(async () => { await home.turn.close(); await home.harness.close(context); await harness.close(context); });
  const { wakes: [wake] } = await room.write('main', { requestId: 'web:person:ana:1', kind: 'room.message', data: message('person:ana', 'Salut') }, alone);
  await home.turn.wake({ wakeId: wake.id, input: 'ana: Salut' });
  await until('closed', async () => (await messages(room)).length === 2);
  assert.equal((await messages(room)).at(-1).data.text, ROOM.unanswered);
  assert.deepEqual(await room.wakes(), []);
});

test('text frames grow: each relay sends only the new tail', async t => {
  const path = directory(t);
  const { harness, room } = await openRoom(path);
  const home = await openHome(path, room, async () => ({ text: 'Bonjour ana.' }));
  t.after(async () => { await home.turn.close(); await home.harness.close(context); await harness.close(context); });
  const { wakes: [wake] } = await room.write('main', { requestId: 'web:person:ana:1', kind: 'room.message', data: message('person:ana', 'Salut') }, alone);
  await home.turn.wake({ wakeId: wake.id, input: 'ana: Salut' });
  await until('settled', () => home.port.settles.length === 1);
  const text = home.port.frames.filter(frame => frame.type === 'text').map(frame => frame.text).join('');
  assert.equal(text, 'Bonjour ana.', 'the deltas add up to the reply once');
});

test('a reply streams word by word from the live partial, and the settled entry adds nothing twice', async t => {
  const path = directory(t);
  const { harness, room } = await openRoom(path);
  const chunks = ['Bonjour', ' ana,', ' voici', ' la', ' réponse.'];
  const home = await openHome(path, room, async () => ({ chunks }));
  t.after(async () => { await home.turn.close(); await home.harness.close(context); await harness.close(context); });
  const { wakes: [wake] } = await room.write('main', { requestId: 'web:person:ana:1', kind: 'room.message', data: message('person:ana', 'Salut') }, alone);
  await home.turn.wake({ wakeId: wake.id, input: 'ana: Salut' });
  await until('settled', () => home.port.settles.length === 1);
  const texts = home.port.frames.filter(frame => frame.type === 'text').map(frame => frame.text);
  assert.ok(texts.length >= 3, `several text frames, got ${JSON.stringify(texts)}`);
  assert.equal(texts.join(''), chunks.join(''), 'the deltas add up to the reply exactly once');
  assert.equal((await messages(room)).at(-1).data.text, chunks.join(''));
});

test('a queued wake streams only its own run, not the live partial of the wake ahead of it', async t => {
  const path = directory(t);
  const { harness, room } = await openRoom(path);
  const home = await openHome(path, room, async transcript => ({ chunks: transcript.messages.some(m => JSON.stringify(m).includes('ana: B')) ? ['Bé', 'ta'] : ['Al', 'pha'] }));
  t.after(async () => { await home.turn.close(); await home.harness.close(context); await harness.close(context); });
  const { wakes: [a] } = await room.write('main', { requestId: 'web:person:ana:1', kind: 'room.message', data: message('person:ana', 'A') }, alone);
  const { wakes: [b] } = await room.write('main', { requestId: 'web:person:ana:2', kind: 'room.message', data: message('person:ana', 'B') }, alone);
  const seen = { a: [], b: [] };
  const base = home.port.stream;
  home.port.stream = async (wakeId, frames) => { seen[wakeId === a.id ? 'a' : 'b'].push(...frames.filter(frame => frame.type === 'text').map(frame => frame.text)); return base(wakeId, frames); };
  await home.turn.wake({ wakeId: a.id, input: 'ana: A' });
  await home.turn.wake({ wakeId: b.id, input: 'ana: B' });
  await until('both settled', () => home.port.settles.length === 2);
  assert.equal(seen.a.join(''), 'Alpha');
  assert.equal(seen.b.join(''), 'Béta');
});
