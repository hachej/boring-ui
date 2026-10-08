import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { Type } from '@earendil-works/pi-ai';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { BROWSER_TASK_MAX_ANSWER, answerBrowserTask, browserTaskId, createBrowserTaskTool } from '@hachej/boring-agent/browser-task';
import { answerUserQuestion, createAskUserTool } from '@hachej/boring-agent/ask-user';
import { defineAgent } from '@hachej/boring-agent/agents';
import { BROWSER_PREVIEW_TOOL, answerBrowserPreview, createBrowserPreviewTool } from '@hachej/boring-feedback/agent';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';

const endpoint = 'https://fixture.invalid/chat';
const until = async (label, check) => { const deadline = Date.now() + 8000; while (!(await check())) { assert.ok(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 10)); } };
const parts = (message, type) => (message.content ?? []).filter(part => part.type === type);

/** A fictional browser task: the page "measures" something and answers `{ kind: 'measured', width }`. */
const MEASURE = {
  name: 'measure_page',
  description: 'Fictional: ask the page for a width.',
  parameters: Type.Object({ instructions: Type.String() }, { additionalProperties: false }),
  checkAnswer: answer => answer.kind === 'measured' && typeof answer.width === 'number' ? undefined : 'expected { kind: "measured", width }',
};

/** A local model: the first request calls `tool` with `args`; the request after the tool result replies with what it received. */
function callingModel(tool, args) {
  const model = { id: 'fictional-caller', name: 'Fictional caller', provider: 'fictional-caller-provider', api: 'fictional-caller-api', baseUrl: 'https://fixture.invalid',
    input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const requests = [];
  const stream = (_model, transcript) => {
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const result = [...transcript.messages].reverse().find(entry => entry.role === 'toolResult');
    requests.push(result ? 'after-answer' : 'call');
    events.push({ type: 'start', partial: message });
    if (!result) {
      const toolCall = { type: 'toolCall', id: `call-${requests.length}`, name: tool, arguments: args };
      message.content.push(toolCall); message.stopReason = 'toolUse';
      events.push({ type: 'toolcall_start', contentIndex: 0, partial: message }, { type: 'toolcall_end', contentIndex: 0, toolCall, partial: message }, { type: 'done', reason: 'toolUse', message });
    } else {
      const text = `Got ${result.isError ? 'error ' : ''}${result.content[0].text}`;
      message.content.push({ type: 'text', text });
      events.push({ type: 'text_start', contentIndex: 0, partial: message }, { type: 'text_delta', contentIndex: 0, delta: text, partial: message },
        { type: 'text_end', contentIndex: 0, content: text, partial: message }, { type: 'done', reason: 'stop', message });
    }
    events.end(message);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: 'Fictional keyless provider', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { models, model: { provider: model.provider, modelId: model.id }, requests };
}

async function open(storage, caller, tools) {
  const agent = defineAgent({ id: 'browser-task', model: caller.model, tools, instructions: 'Call, then report.' });
  const registry = createRegistry();
  agent.install(registry);
  return { agent, harness: await Harness.open(storage, { registry, models: caller.models }, context) };
}

function serve(harness, conversation, answer) {
  const handler = createChatTransportHandler({ authenticate: async request => request.headers.get('authorization') === 'Bearer fictional-token'
    ? { conversation, context, abortSubmission: id => harness.abortSubmission(id, context, conversation.id), answer } : null });
  return request => { const headers = new Headers(request.headers); headers.set('authorization', 'Bearer fictional-token'); return handler(new Request(request, { headers })); };
}

const view = async remote => (await remote.conversation.watch(remote.context)).value;
const messages = v => v.entries.flatMap(entry => entry.model ?? []);
/** Pending calls of `tool` with their answer id (`[assistantEntryId, callId]`), as the page derives them. */
const pending = (v, tool) => {
  const answered = new Set(messages(v).filter(m => m.role === 'toolResult').map(m => m.toolCallId));
  return v.entries.flatMap(entry => (entry.model ?? []).filter(m => m.role === 'assistant').flatMap(m => parts(m, 'toolCall'))
    .filter(call => call.name === tool && !answered.has(call.id)).map(call => ({ ...call, answerId: browserTaskId(Number(entry.id), call.id) })));
};
const finalText = v => messages(v).filter(m => m.role === 'assistant').flatMap(m => parts(m, 'text').map(p => p.text)).at(-1);

async function fixture(t, { tool = MEASURE, args = { instructions: 'Measure the header.' }, extra = [] } = {}) {
  const caller = callingModel(tool.name, args);
  const { agent, harness } = await open(new MemoryStorage(), caller, [createBrowserTaskTool(tool), ...extra]);
  t.after(() => harness.close(context).catch(() => {}));
  const conversation = await agent.createConversation(harness, context);
  const fetch = serve(harness, conversation, (id, answer) => answerBrowserTask(conversation, tool, id, answer));
  const remote = await createRemoteChat({ endpoint, fetch, pollMs: 10 });
  const wait = async () => { let found; await until(`pending ${tool.name}`, async () => (found = pending(await view(remote), tool.name)[0])); return found; };
  return { caller, harness, conversation, remote, wait };
}

test('a browser task waits without the model, and the page answer resumes it with the JSON', async t => {
  const f = await fixture(t);
  await f.remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Measure.' }, f.remote.context);
  const call = await f.wait();
  assert.deepEqual(call.arguments, { instructions: 'Measure the header.' });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(f.caller.requests, ['call'], 'no model request while the page has not answered');
  assert.deepEqual(await f.remote.answer(call.answerId, JSON.stringify({ kind: 'measured', width: 640 })), { kind: 'answered' });
  await until('model continues', async () => finalText(await view(f.remote)) === 'Got {"kind":"measured","width":640}');
  assert.deepEqual(f.caller.requests, ['call', 'after-answer']);
});

test('answers are checked: JSON object, size, the tool check; one answer wins and repeating it is idempotent', async t => {
  const f = await fixture(t);
  await f.remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Measure.' }, f.remote.context);
  const { answerId } = await f.wait();
  assert.equal((await f.remote.answer(answerId, 'not json')).kind, 'denied');
  assert.equal((await f.remote.answer(answerId, '[1,2]')).kind, 'denied');
  assert.equal((await f.remote.answer(answerId, JSON.stringify({ kind: 'guessed' }))).kind, 'denied');
  assert.equal((await f.remote.answer(answerId, JSON.stringify({ kind: 'measured', width: 1, pad: 'x'.repeat(BROWSER_TASK_MAX_ANSWER) }))).kind, 'denied');
  assert.equal((await f.remote.answer('no-such-call', JSON.stringify({ kind: 'measured', width: 1 }))).kind, 'unknown-question');
  assert.equal(pending(await view(f.remote), MEASURE.name).length, 1, 'still pending');
  assert.deepEqual(await f.remote.answer(answerId, JSON.stringify({ kind: 'measured', width: 320 })), { kind: 'answered' });
  assert.equal((await f.remote.answer(answerId, JSON.stringify({ kind: 'measured', width: 321 }))).kind, 'conflict');
  assert.deepEqual(await f.remote.answer(answerId, JSON.stringify({ kind: 'measured', width: 320 })), { kind: 'answered' });
  await until('model continues', async () => finalText(await view(f.remote))?.includes('320'));
  assert.ok(!JSON.stringify(await view(f.remote)).includes('no-such-call'), 'unknown IDs leave no record');
});

test('a browser task and an ask_user question cannot answer each other', async t => {
  const f = await fixture(t, { extra: [createAskUserTool()] });
  await f.remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Measure.' }, f.remote.context);
  const { answerId } = await f.wait();
  assert.equal((await answerUserQuestion(f.conversation, answerId, 'park')).kind, 'unknown-question', 'ask_user has no record for a browser task');
  assert.equal((await answerBrowserTask(f.conversation, { ...MEASURE, name: 'other_task' }, answerId, JSON.stringify({ kind: 'measured', width: 1 }))).kind, 'unknown-question', 'another browser task name is not this one');
  assert.equal(pending(await view(f.remote), MEASURE.name).length, 1);
});

test('stopping the conversation cancels the pending browser task and refuses a later answer', async t => {
  const f = await fixture(t);
  await f.remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Measure.' }, f.remote.context);
  const call = await f.wait();
  await f.conversation.abort(context);
  await f.conversation.waitForIdle(context);
  const settled = await view(f.remote);
  assert.deepEqual(pending(settled, MEASURE.name), []);
  assert.ok(messages(settled).some(m => m.role === 'toolResult' && m.toolCallId === call.id && m.isError));
  assert.notEqual((await f.remote.answer(call.answerId, JSON.stringify({ kind: 'measured', width: 1 }))).kind, 'answered');
  assert.deepEqual(f.caller.requests.filter(request => request === 'after-answer'), []);
});

test('a pending browser task survives closing and reopening the harness on the same storage', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-browser-task-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'native.sqlite');
  const first = callingModel(MEASURE.name, { instructions: 'Measure.' });
  let opened = await open(await openNodeSqliteStorage(file), first, [createBrowserTaskTool(MEASURE)]);
  const conversation = await opened.agent.createConversation(opened.harness, context);
  let remote = await createRemoteChat({ endpoint, fetch: serve(opened.harness, conversation, (id, answer) => answerBrowserTask(conversation, MEASURE, id, answer)), pollMs: 10 });
  await remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Measure.' }, remote.context);
  let found;
  await until('pending before close', async () => (found = pending(await view(remote), MEASURE.name)[0]));
  await opened.harness.close(context);

  const second = callingModel(MEASURE.name, { instructions: 'Measure.' });
  opened = await open(await openNodeSqliteStorage(file), second, [createBrowserTaskTool(MEASURE)]);
  t.after(() => opened.harness.close(context).catch(() => {}));
  const again = await opened.harness.conversation(conversation.id, context);
  opened.harness.resume();
  remote = await createRemoteChat({ endpoint, fetch: serve(opened.harness, again, (id, answer) => answerBrowserTask(again, MEASURE, id, answer)), pollMs: 10 });
  let reopened;
  await until('pending after reopen', async () => (reopened = pending(await view(remote), MEASURE.name)[0]));
  assert.equal(reopened.answerId, found.answerId);
  assert.deepEqual(second.requests, [], 'recovery does not call the model while the task is pending');
  assert.deepEqual(await remote.answer(found.answerId, JSON.stringify({ kind: 'measured', width: 800 })), { kind: 'answered' });
  await until('model continues after reopen', async () => finalText(await view(remote)) === 'Got {"kind":"measured","width":800}');
});

test('browser_preview (feedback preset): approved changes or discarded, nothing else', async t => {
  const tool = { name: BROWSER_PREVIEW_TOOL };
  const caller = callingModel(BROWSER_PREVIEW_TOOL, { instructions: 'make it green', feedback: 'fb_2222222222222222' });
  const { agent, harness } = await open(new MemoryStorage(), caller, [createBrowserPreviewTool()]);
  t.after(() => harness.close(context).catch(() => {}));
  const conversation = await agent.createConversation(harness, context);
  const remote = await createRemoteChat({ endpoint, fetch: serve(harness, conversation, (id, answer) => answerBrowserPreview(conversation, id, answer)), pollMs: 10 });
  await remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'preview' }, remote.context);
  let call;
  await until('pending preview', async () => (call = pending(await view(remote), tool.name)[0]));
  const change = { element: 'the «Save» button (Settings.jsx:12)', source: 'src/Settings.jsx:12', property: 'background-color', from: 'rgb(0, 0, 0)', to: '#2f9e44' };
  for (const bad of [{ kind: 'approved', changes: [] }, { kind: 'approved', summary: 's', changes: [{ ...change, text: true }] }, { kind: 'approved', summary: 's', changes: [{ ...change, property: 'url(x)' }] },
    { kind: 'discarded', changes: [] }, { kind: 'approved', summary: 's', changes: [change], extra: 1 }]) {
    assert.equal((await remote.answer(call.answerId, JSON.stringify(bad))).kind, 'denied', JSON.stringify(bad));
  }
  assert.deepEqual(await remote.answer(call.answerId, JSON.stringify({ kind: 'approved', summary: 'Made Save green.', changes: [change] })), { kind: 'answered' });
  await until('builder reads the approval', async () => finalText(await view(remote))?.includes('"to":"#2f9e44"'));
  const discarding = callingModel(BROWSER_PREVIEW_TOOL, { instructions: 'make it red' });
  const other = await open(new MemoryStorage(), discarding, [createBrowserPreviewTool()]);
  t.after(() => other.harness.close(context).catch(() => {}));
  const second = await other.agent.createConversation(other.harness, context);
  const remote2 = await createRemoteChat({ endpoint, fetch: serve(other.harness, second, (id, answer) => answerBrowserPreview(second, id, answer)), pollMs: 10 });
  await remote2.conversation.submit({ type: 'input', requestId: 'r1', content: 'preview' }, remote2.context);
  let call2;
  await until('pending preview 2', async () => (call2 = pending(await view(remote2), tool.name)[0]));
  assert.deepEqual(await remote2.answer(call2.answerId, '{"kind":"discarded"}'), { kind: 'answered' });
  await until('builder reads the discard', async () => finalText(await view(remote2)) === 'Got {"kind":"discarded"}');
});
