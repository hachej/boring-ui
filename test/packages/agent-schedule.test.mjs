// The schedule tools through the native Harness on a scripted (faux) model and a fake Harness clock: a schedule is a native
// durable task that fires once at its deadline (also across a restart), can be listed and cancelled by its conversation, and
// is idempotent on its operation id.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { SCHEDULED_INPUT_KIND, addSchedule, createScheduleExtension, listSchedules, scheduledDeadline } from '@hachej/boring-agent/schedule';

const T0 = Date.UTC(2026, 9, 18, 9, 0, 0);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (label, check) => { const deadline = Date.now() + 8000; while (!(await check())) { assert.ok(Date.now() < deadline, label); await pause(10); } };
const text = content => typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('');

/** Replies by the last message: a person's request maps to one tool call; a tool result or a due instruction to a short text. */
function scriptedModels() {
  const faux = fauxProvider({ provider: 'fictional-faux', models: [{ id: 'planner' }] });
  const respond = transcript => {
    const last = transcript.messages.at(-1);
    if (last.role === 'toolResult') return fauxAssistantMessage([fauxText(`${last.toolName}: ${text(last.content)}`)]);
    const said = text(last.content);
    if (said.includes('is due now')) return fauxAssistantMessage([fauxText('Watering the fictional fern now.')]);
    const call = said === 'Remind me' ? ['schedule', { instruction: 'Water the fictional fern', delaySeconds: 60 }]
      : said === 'Remind me soon' ? ['schedule', { instruction: 'Water the fictional fern', delaySeconds: 1 }]
      : said === 'Never mind' ? ['cancel_schedule', { id: 'schedule-1' }]
        : said === 'What is planned?' ? ['list_schedules', {}] : undefined;
    if (!call) return fauxAssistantMessage([fauxText('Nothing to do.')]);
    return fauxAssistantMessage([fauxToolCall(call[0], call[1], { id: `call-${said.length}` })], { stopReason: 'toolUse' });
  };
  faux.setResponses(Array.from({ length: 40 }, () => respond));
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}

async function open(storage, clock, deadlines = []) {
  const planner = defineAgent({ id: 'planner', model: { provider: 'fictional-faux', modelId: 'planner' }, extensions: [createScheduleExtension({ now: clock.now, onDeadline: runAt => { deadlines.push(runAt); } })] });
  const registry = createRegistry();
  planner.install(registry);
  const harness = await Harness.open(storage, { registry, models: scriptedModels(), now: clock.now }, context);
  return { planner, harness, deadlines };
}
const fakeClock = () => { const clock = { at: T0, now: () => clock.at }; return clock; };
let asked = 0;
const ask = async (conversation, content) => {
  const settled = await (await conversation.submit({ type: 'input', requestId: `ask-${++asked}`, content }, context)).wait(context);
  assert.equal(settled.status, 'done');
  const messages = (await conversation.context(context)).messages.filter(message => message.role === 'assistant');
  return text(messages.at(-1).content);
};
const deliveries = conversation => conversation.commit(async tx => (await tx.scanEntries({ conversationId: conversation.id }, 100)).items.filter(entry => entry.kind === SCHEDULED_INPUT_KIND), context);
const deadlinesOf = async harness => (await harness.inspect(context)).tasks.map(scheduledDeadline).filter(deadline => deadline !== undefined);

test('a schedule is a native task that fires once at its deadline and not before', async t => {
  // The Harness's own clock and timers: Pi's scheduler sleeps the task on a real timer, so this deadline is one real second away.
  const clock = { now: () => Date.now() };
  const { planner, harness, deadlines } = await open(new MemoryStorage(), clock);
  t.after(() => harness.close(context));
  const conversation = await planner.createConversation(harness, context);
  assert.match(await ask(conversation, 'Remind me soon'), /^schedule: Scheduled schedule-1 for /);
  const [runAt] = deadlines;
  assert.equal(deadlines.length, 1, 'the host wake-up hook got the deadline');
  assert.deepEqual(await deadlinesOf(harness), [runAt], 'a host derives its one timer from the native tasks');
  assert.deepEqual((await listSchedules(harness, conversation.id, context)).map(item => [item.id, item.instruction]), [['schedule-1', 'Water the fictional fern']]);
  assert.equal((await deliveries(conversation)).length, 0, 'not before its deadline');

  await until('delivered at the deadline', async () => (await deliveries(conversation)).length === 1);
  assert.ok(Date.now() >= runAt, 'not delivered early');
  await conversation.waitForIdle(context);
  const messages = (await conversation.context(context)).messages;
  assert.equal(text(messages.at(-1).content), 'Watering the fictional fern now.');
  assert.ok(messages.some(message => message.role === 'user' && text(message.content) === 'Scheduled instruction schedule-1 is due now: Water the fictional fern'));
  await pause(300);
  assert.equal((await deliveries(conversation)).length, 1, 'exactly once');
  assert.deepEqual(await listSchedules(harness, conversation.id, context), []);
  assert.deepEqual(await deadlinesOf(harness), []);
});

test('a schedule survives a restart and fires once after it', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-schedule-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'native.sqlite');
  const clock = fakeClock();
  let opened = await open(await openNodeSqliteStorage(file), clock);
  const conversation = await opened.planner.createConversation(opened.harness, context);
  await ask(conversation, 'Remind me');
  await opened.harness.close(context);

  clock.at = T0 + 61_000; // the process was down when it came due
  opened = await open(await openNodeSqliteStorage(file), clock);
  let again = await opened.harness.conversation(conversation.id, context);
  opened.harness.resume();
  await until('delivered after the restart', async () => (await deliveries(again)).length === 1);
  await again.waitForIdle(context);
  await opened.harness.close(context);

  opened = await open(await openNodeSqliteStorage(file), clock);
  t.after(() => opened.harness.close(context));
  again = await opened.harness.conversation(conversation.id, context);
  opened.harness.resume();
  await pause(300);
  assert.equal((await deliveries(again)).length, 1, 'a second restart does not deliver again');
});

test('the conversation lists and cancels its own schedule; a cancelled schedule never fires', async t => {
  const clock = fakeClock();
  const { planner, harness } = await open(new MemoryStorage(), clock);
  t.after(() => harness.close(context));
  const conversation = await planner.createConversation(harness, context);
  const other = await planner.createConversation(harness, context);
  await ask(conversation, 'Remind me');
  assert.match(await ask(conversation, 'What is planned?'), /"id":"schedule-1".*"instruction":"Water the fictional fern"/);
  assert.equal(await ask(other, 'Never mind'), 'cancel_schedule: No pending schedule schedule-1 in this conversation.', 'another conversation cannot cancel it');
  assert.equal(await ask(conversation, 'Never mind'), 'cancel_schedule: Cancelled schedule-1.');
  await until('the delivery task ended', async () => (await deadlinesOf(harness)).length === 0 && (await harness.inspect(context)).tasks.length === 0);
  assert.equal(await ask(conversation, 'What is planned?'), 'list_schedules: []');
  clock.at = T0 + 120_000;
  await pause(300);
  assert.equal((await deliveries(conversation)).length, 0, 'cancelled before its deadline: never delivered');
});

test('scheduling is idempotent on the operation id', async t => {
  const clock = fakeClock();
  const { planner, harness } = await open(new MemoryStorage(), clock);
  t.after(() => harness.close(context));
  const conversation = await planner.createConversation(harness, context);
  const request = { operationId: 'host-op-1', instruction: 'Send the fictional digest', runAt: T0 + 5_000 };
  const first = await conversation.commit(tx => addSchedule(tx, conversation.id, request), context);
  const second = await conversation.commit(tx => addSchedule(tx, conversation.id, { ...request, instruction: 'changed' }), context);
  assert.deepEqual(second, first);
  assert.equal((await listSchedules(harness, conversation.id, context)).length, 1);
  assert.deepEqual(await deadlinesOf(harness), [T0 + 5_000], 'one native task');
});
