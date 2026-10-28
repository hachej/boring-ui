import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Harness, createRegistry, defineDoc } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createRoom, createRoomTurn } from '@hachej/boring-agent/room';

// One room and one agent home, each on its own SQLite file, killed between the wake's submit and its settle.
const [directory, phase, boundary] = process.argv.slice(2);
const keepAlive = setInterval(() => {}, 1000);
const hang = () => new Promise(() => {});
const until = async check => { const deadline = Date.now() + 10000; while (!await check()) { assert.ok(Date.now() < deadline, 'room checkpoint timeout'); await delay(5); } };
const ready = value => writeFileSync(join(directory, 'ready.json'), JSON.stringify(value));
const holding = phase === 'hold';

const model = { id: 'fictional', name: 'Fictional', provider: 'fictional', api: 'fictional', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const stream = () => {
  const events = createAssistantMessageEventStream();
  appendFileSync(join(directory, 'model.jsonl'), JSON.stringify({ phase }) + '\n');
  void (async () => {
    if (holding && boundary === 'mid-run') { ready({ boundary }); await hang(); }
    const message = { role: 'assistant', content: [{ type: 'text', text: 'Bonjour ana.' }], api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'stop', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    events.push({ type: 'start', partial: message });
    events.push({ type: 'done', reason: 'stop', message });
    events.end(message);
  })();
  return events;
};
const models = createModels();
models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: 'Fictional keyless', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
const agent = defineAgent({ id: 'pm', model: { provider: model.provider, modelId: model.id }, instructions: 'Answer the room.' });
const registry = createRegistry(); agent.install(registry);

const roomHarness = await Harness.open(await openNodeSqliteStorage(join(directory, 'room.sqlite')), { registry: createRegistry(), models: createModels() }, context);
// After the restart the alarm is long past every wake's deadline.
const room = createRoom({ harness: roomHarness, context, now: () => Date.now() + (holding ? 0 : 3_600_000) });
const home = await Harness.open(await openNodeSqliteStorage(join(directory, 'home.sqlite')), { registry, models }, context);
const conversation = holding ? await agent.createConversation(home, context)
  : await home.conversation(JSON.parse(readFileSync(join(directory, 'home.json'), 'utf8')).conversationId, context);
if (holding) writeFileSync(join(directory, 'home.json'), JSON.stringify({ conversationId: conversation.id }));

const port = {
  settle: async (wakeId, reply) => {
    appendFileSync(join(directory, 'settles.jsonl'), JSON.stringify({ phase, wakeId }) + '\n');
    if (holding && boundary === 'before-settle') { ready({ boundary }); await hang(); }
    const result = await room.settle('agent:pm', wakeId, reply);
    if (holding && boundary === 'after-settle') { ready({ boundary }); await hang(); }
    return result;
  },
};
const turn = createRoomTurn({ conversation, context, port });

if (holding) {
  const { wakes: [wake] } = await room.write('main', { requestId: 'web:person:ana:1', kind: 'room.message', data: { author: 'person:ana', text: 'Salut', mentions: [], attachments: [], steps: [] } }, { people: ['person:ana'], agents: ['agent:pm'] });
  await turn.wake({ wakeId: wake.id, input: 'ana: Salut' });
  await hang();
} else {
  home.resume();
  await turn.start();
  // The room's alarm resends the open wake too: the home finds its submission by `requestId` and starts nothing new.
  for (const wake of (await room.resend()).resend) await turn.wake({ wakeId: wake.id, input: 'ana: Salut' });
  // Done when the room has no open wake and the home owes no settle.
  const turns = defineDoc({ kind: 'boring.room.turns', checkpointWhen: () => false, version: 1, scope: 'conversation', history: 'latest', fork: 'initial', initial: () => ({ owed: [] }) });
  const settled = async () => (await room.wakes()).length === 0 && !(await home.snapshot(turns, conversation.id, context))?.owed.length;
  await until(settled);
  await turn.close();
  const messages = (await room.entries('main')).filter(entry => entry.kind === 'room.message');
  writeFileSync(join(directory, 'result.json'), JSON.stringify({ messages: messages.map(entry => entry.data) }));
  await home.close(context); await roomHarness.close(context); clearInterval(keepAlive);
}
