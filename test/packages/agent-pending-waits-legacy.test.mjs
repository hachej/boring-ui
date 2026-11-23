// Pi 1.6.0 parks a waiting tool call or task (`{ sleep: { until, signals } }`) instead of holding it in a running phase that watches a
// document. A store written before that (fixture `store-pending-waits.json`, fictional, dumped from the kit's previous code with an
// `ask_user` question, a browser task, an acknowledged `present`, two schedules and a native question all pending) must still open:
// each wait settles through the public answer functions, and each waiting call or task is parked by Pi afterwards.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Harness, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { answerUserQuestion, askUserQuestionId, createAskUserTool } from '@hachej/boring-agent/ask-user';
import { answerBrowserTask, createBrowserTaskTool } from '@hachej/boring-agent/browser-task';
import { answerViewOpen, createPresentTool } from '@hachej/boring-agent/artifacts';
import { SCHEDULED_INPUT_KIND, cancelSchedule, createScheduleExtension, listSchedules } from '@hachej/boring-agent/schedule';
import { createQuestions } from '@hachej/boring-agent/questions';

const dump = JSON.parse(readFileSync(new URL('../fixtures/store-pending-waits.json', import.meta.url), 'utf8'));
const decode = value => value !== null && typeof value === 'object' && '$blob' in value ? Buffer.from(value.$blob, 'hex') : value;
const until = async (label, check, ms = 8000) => { const deadline = Date.now() + ms; while (!(await check())) { assert.ok(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 10)); } };

const MEASURE = { name: 'measure_page', description: 'Fictional: ask the page for a width.', parameters: { type: 'object', properties: { instructions: { type: 'string' } }, required: ['instructions'], additionalProperties: false },
  checkAnswer: answer => answer.kind === 'measured' && typeof answer.width === 'number' ? undefined : 'expected { kind: "measured", width }' };
const model = { id: 'fictional-caller', name: 'Fictional caller', provider: 'fictional-caller-provider', api: 'fictional-caller-api', baseUrl: 'https://fixture.invalid',
  input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

/** Reports each tool result in one text, so the reopened call's answer is visible in the transcript. */
function reportingModels(requests) {
  const stream = (_model, transcript) => {
    requests.push(transcript.messages.at(-1).role);
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const results = transcript.messages.filter(entry => entry.role === 'toolResult');
    const reply = results.map(result => `${result.toolName}=${result.content[0].text}`).join(' | ') || 'nothing';
    message.content.push({ type: 'text', text: reply });
    events.push({ type: 'start', partial: message }, { type: 'text_start', contentIndex: 0, partial: message }, { type: 'text_delta', contentIndex: 0, delta: reply, partial: message },
      { type: 'text_end', contentIndex: 0, content: reply, partial: message }, { type: 'done', reason: 'stop', message });
    events.end(message);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: 'Fictional keyless provider', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return models;
}

function writeStore(path) {
  const db = new DatabaseSync(path);
  for (const statement of dump.schema) db.exec(statement);
  for (const [table, rows] of Object.entries(dump.rows)) for (const row of rows) {
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO "${table}" (${columns.map(name => `"${name}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...columns.map(name => decode(row[name])));
  }
  db.close();
}

async function reopen(t) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-pending-waits-'));
  const path = join(directory, 'store.sqlite');
  writeStore(path);
  const clock = { at: Date.now(), now: () => clock.at };
  const requests = [];
  const questions = createQuestions({ runtimeId: 'runtime-one', now: clock.now, authorize: () => ({ principalId: 'fictional-reviewer', scopeId: 'cabinet' }), isCurrent: () => true });
  const agent = defineAgent({ id: 'legacy', model: { provider: model.provider, modelId: model.id }, instructions: 'Call, then report.',
    tools: [createAskUserTool(), createBrowserTaskTool(MEASURE), createPresentTool({ ack: { timeoutMs: 3_600_000 } })], extensions: [createScheduleExtension({ now: clock.now }), questions.extension] });
  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(await openNodeSqliteStorage(path), { registry, models: reportingModels(requests), now: clock.now }, context);
  t.after(async () => { await harness.close(context).catch(() => {}); rmSync(directory, { recursive: true, force: true }); });
  const conversation = await harness.conversation(dump.rows.conversations[0].id, context);
  assert.ok(conversation, 'the stored conversation is found');
  harness.resume();
  return { harness, conversation, clock, requests, questions };
}

const records = async harness => (await harness.inspect(context)).tasks.map(task => task.record);
const finalText = async conversation => {
  const messages = (await conversation.entries({ order: 'ascending' }, 100, undefined, context)).items.flatMap(entry => entry.model ?? []);
  return messages.filter(message => message.role === 'assistant').flatMap(message => message.content.filter(part => part.type === 'text').map(part => part.text)).at(-1);
};
const assistantEntry = async conversation => (await conversation.entries({ order: 'ascending' }, 100, undefined, context)).items
  .find(entry => (entry.model ?? []).some(message => message.role === 'assistant' && message.content.some(part => part.type === 'toolCall')));

test('a store with pending waits written before Pi parked tools opens, parks each wait natively and settles every one', { timeout: 60000 }, async t => {
  const { harness, conversation, clock, requests, questions } = await reopen(t);

  await until('every waiting call and task is parked by Pi', async () => {
    const all = await records(harness);
    const waiting = all.filter(record => ['pi.tool', 'boring.schedule.deliver', 'boring.questions.wait'].includes(record.kind));
    return waiting.length === 6 && waiting.every(record => record.state.status === 'sleeping');
  });
  const sleeping = (await records(harness)).filter(record => record.state.status === 'sleeping');
  assert.deepEqual(sleeping.filter(record => record.kind === 'pi.tool').map(record => Object.keys(record.state).includes('until')).sort(), [false, false, true], 'ask_user and the browser task wait for a signal only; the view also has its deadline');
  assert.equal(sleeping.filter(record => record.kind !== 'pi.tool').every(record => typeof record.state.until === 'number'), true, 'schedules and the question sleep until their deadline');
  assert.deepEqual(requests, [], 'no model request while the person has not answered');

  const entry = await assistantEntry(conversation);
  assert.deepEqual(await answerUserQuestion(conversation, askUserQuestionId(entry.id, 'ask-1'), 'lake'), { kind: 'answered' });
  assert.deepEqual(await answerBrowserTask(conversation, MEASURE, 'measure-1', JSON.stringify({ kind: 'measured', width: 640 })), { kind: 'answered' });
  assert.deepEqual(await answerViewOpen(conversation, 'present-1', JSON.stringify({ kind: 'opened', instanceId: 'tab-1', subject: { task: 'D-201' } })), { kind: 'answered' });
  await until('the model continues with all three answers', async () => (await finalText(conversation))?.includes('present='));
  const text = await finalText(conversation);
  assert.match(text, /ask_user=\{"kind":"answered","answer":"lake"\}/);
  assert.match(text, /measure_page=\{"kind":"measured","width":640\}/);
  assert.match(text, /present=.*"opened":true.*"viewer":"tab-1"/);
  assert.deepEqual(requests, ['toolResult'], 'one request, after the answers');
  assert.deepEqual(await answerUserQuestion(conversation, askUserQuestionId(entry.id, 'ask-1'), 'lake'), { kind: 'answered' }, 'repeating the answer is idempotent');
  assert.equal((await answerUserQuestion(conversation, askUserQuestionId(entry.id, 'ask-1'), 'park')).kind, 'conflict');

  const key = questions.documentKey({ scopeId: 'cabinet', questionId: 'choose-format' });
  const { question } = await harness.snapshot(questions.documents, key, context);
  assert.equal(question.state.kind, 'pending');
  assert.deepEqual(await conversation.commit(tx => questions.resolve(tx, question.ref, { resolutionId: 'answer-one', answer: 'brief' }, context), context), { kind: 'resolved', answer: 'brief', resolutionId: 'answer-one' });
  assert.equal((await harness.waitForTask(question.ref.taskId, context)).state.outcome.result.answer, 'brief');

  const [water, prune] = await listSchedules(harness, conversation.id, context);
  assert.deepEqual([water.instruction, prune.instruction], ['Water the fictional fern', 'Prune the fictional rose']);
  assert.equal(await conversation.commit(tx => cancelSchedule(tx, conversation.id, prune.id), context), true);
  assert.equal((await harness.waitForTask(prune.taskId, context)).state.outcome.result.delivered, false, 'a cancelled schedule wakes at once and delivers nothing');
  const deliveries = () => conversation.commit(async tx => (await tx.scanEntries({ conversationId: conversation.id }, 100)).items.filter(item => item.kind === SCHEDULED_INPUT_KIND), context);
  assert.equal((await deliveries()).length, 0, 'not before its deadline');
  clock.at = water.runAt + 1;
  harness.resume();
  await until('the schedule is delivered at its deadline', async () => (await deliveries()).length === 1);
  assert.equal((await harness.waitForTask(water.taskId, context)).state.outcome.result.delivered, true);
});
