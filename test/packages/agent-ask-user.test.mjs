import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, createRegistry, defineExtension, defineDocFamily, AssistantEntry, ToolTask } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { answerUserQuestion, createAskUserTool } from '@hachej/boring-agent/ask-user';
import { defineAgent } from '@hachej/boring-agent/agents';
import { admitDocumentTool, documentToolResult } from '../fixtures/native-document.mjs';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';

const endpoint = 'https://fixture.invalid/chat';
const json = { 'content-type': 'application/json' };
const until = async (label, check) => { const deadline = Date.now() + 8000; while (!(await check())) { assert.ok(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 10)); } };
const texts = (message, type) => (message.content ?? []).filter(part => part.type === type);

/** A local model: the first request asks `args`; a request after the tool result replies with the answer it received. */
function askingModel(args) {
  const model = { id: 'fictional-asker', name: 'Fictional asker', provider: 'fictional-asker-provider', api: 'fictional-asker-api', baseUrl: 'https://fixture.invalid',
    input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const requests = [];
  const stream = (_model, transcript) => {
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const result = [...transcript.messages].reverse().find(entry => entry.role === 'toolResult');
    requests.push(result ? 'after-answer' : 'ask');
    events.push({ type: 'start', partial: message });
    if (!result) {
      const toolCall = { type: 'toolCall', id: `call-${requests.length}`, name: 'ask_user', arguments: args };
      message.content.push(toolCall); message.stopReason = 'toolUse';
      events.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
      events.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
      events.push({ type: 'done', reason: 'toolUse', message });
    } else {
      const text = `Plan uses ${result.content[0].text}`;
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

async function open(storage, asker) {
  const agent = defineAgent({ id: 'ask', model: asker.model, tools: [createAskUserTool()], instructions: 'Ask, then plan.' });
  const registry = createRegistry();
  agent.install(registry);
  return { agent, harness: await Harness.open(storage, { registry, models: asker.models }, context) };
}

function serve(t, harness, conversation, access = {}) {
  const handler = createChatTransportHandler({ authenticate: async request => request.headers.get('authorization') === 'Bearer fictional-token'
    ? { conversation, context, abortSubmission: id => harness.abortSubmission(id, context, conversation.id), answer: (callId, answer) => answerUserQuestion(conversation, callId, answer), ...access } : null });
  const fetch = request => { const headers = new Headers(request.headers); headers.set('authorization', 'Bearer fictional-token'); return handler(new Request(request, { headers })); };
  return { handler, fetch };
}

async function fixture(t, args = { question: 'Where do we picnic?', options: ['park', 'lake'] }, access = {}) {
  const asker = askingModel(args);
  const { agent, harness } = await open(new MemoryStorage(), asker);
  t.after(() => harness.close(context).catch(() => {}));
  const conversation = await agent.createConversation(harness, context);
  const served = serve(t, harness, conversation, access);
  const remote = await createRemoteChat({ endpoint, fetch: served.fetch, pollMs: 10 });
  return { asker, harness, conversation, remote, ...served };
}

const view = async remote => (await remote.conversation.watch(remote.context)).value;
const messages = v => v.entries.flatMap(entry => entry.model ?? []);
/** Tool calls of the transcript that have no result yet. */
const pending = v => {
  const answered = new Set(messages(v).filter(m => m.role === 'toolResult').map(m => m.toolCallId));
  return messages(v).filter(m => m.role === 'assistant').flatMap(m => texts(m, 'toolCall')).filter(call => call.name === 'ask_user' && !answered.has(call.id));
};
const waitPending = async (remote, label = 'pending ask_user call') => { let found; await until(label, async () => (found = pending(await view(remote))[0])); return found; };
const finalText = v => messages(v).filter(m => m.role === 'assistant').flatMap(m => texts(m, 'text').map(p => p.text)).at(-1);

test('a pending ask_user call is visible and a valid answer resumes the model', async t => {
  const f = await fixture(t);
  await f.remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Plan a picnic.' }, f.remote.context);
  const call = await waitPending(f.remote);
  assert.deepEqual(call.arguments, { question: 'Where do we picnic?', options: ['park', 'lake'] });
  assert.deepEqual(f.asker.requests, ['ask']);
  assert.deepEqual(await f.remote.answer(call.id, 'lake'), { kind: 'answered' });
  await until('model continues', async () => finalText(await view(f.remote)) === 'Plan uses {"kind":"answered","answer":"lake"}');
  assert.deepEqual(pending(await view(f.remote)), []);
  assert.deepEqual(f.asker.requests, ['ask', 'after-answer']);
});

test('answers outside the options are denied, one answer wins and the same answer is idempotent', async t => {
  const f = await fixture(t);
  await f.remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Plan a picnic.' }, f.remote.context);
  const call = await waitPending(f.remote);
  assert.equal((await f.remote.answer(call.id, 'moon')).kind, 'denied');
  assert.equal((await f.remote.answer(call.id, '   ')).kind, 'denied');
  assert.equal((await f.remote.answer(call.id, 'x'.repeat(2001))).kind, 'denied');
  assert.equal(pending(await view(f.remote)).length, 1, 'still pending');
  assert.equal((await f.remote.answer('no-such-call', 'park')).kind, 'unknown-question');
  assert.deepEqual(await f.remote.answer(call.id, 'park'), { kind: 'answered' });
  assert.equal((await f.remote.answer(call.id, 'lake')).kind, 'conflict');
  assert.deepEqual(await f.remote.answer(call.id, 'park'), { kind: 'answered' });
  await until('model continues', async () => finalText(await view(f.remote))?.includes('park'));
  assert.ok(!JSON.stringify(await view(f.remote)).includes('no-such-call'), 'unknown IDs leave no record');
});

test('free text is accepted only when allowed', async t => {
  const f = await fixture(t, { question: 'Any dietary note?', allowFreeText: true });
  await f.remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Plan a picnic.' }, f.remote.context);
  const call = await waitPending(f.remote);
  assert.deepEqual(await f.remote.answer(call.id, 'No nuts, please'), { kind: 'answered' });
  await until('model continues', async () => finalText(await view(f.remote))?.includes('No nuts, please'));
  const strict = await fixture(t, { question: 'Where?', options: ['park', 'lake'] });
  await strict.remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Plan.' }, strict.remote.context);
  assert.equal((await strict.remote.answer((await waitPending(strict.remote)).id, 'No nuts, please')).kind, 'denied');
});

test('malformed questions fail without suspending', async t => {
  const f = await fixture(t, { question: 'Neither options nor free text' });
  await f.remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Plan.' }, f.remote.context);
  await until('error result', async () => messages(await view(f.remote)).some(m => m.role === 'toolResult' && m.isError));
  assert.deepEqual(pending(await view(f.remote)), []);
});

test('stopping the conversation cancels the pending question and refuses a later answer', async t => {
  const f = await fixture(t);
  await f.remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Plan a picnic.' }, f.remote.context);
  const call = await waitPending(f.remote);
  await f.conversation.abort(context);
  await f.conversation.waitForIdle(context);
  const settled = await view(f.remote);
  assert.deepEqual(pending(settled), [], 'the aborted call ends with a result');
  assert.ok(messages(settled).some(m => m.role === 'toolResult' && m.toolCallId === call.id));
  assert.notEqual((await f.remote.answer(call.id, 'park')).kind, 'answered');
  assert.deepEqual(f.asker.requests.filter(request => request === 'after-answer'), []);
});

test('a pending question survives closing and reopening the harness on the same storage', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-ask-user-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'native.sqlite');
  const first = askingModel({ question: 'Where?', options: ['park', 'lake'] });
  let opened = await open(await openNodeSqliteStorage(file), first);
  const conversation = await opened.agent.createConversation(opened.harness, context);
  let served = serve(t, opened.harness, conversation);
  let remote = await createRemoteChat({ endpoint, fetch: served.fetch, pollMs: 10 });
  await remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Plan a picnic.' }, remote.context);
  const call = await waitPending(remote);
  await opened.harness.close(context);

  const second = askingModel({ question: 'Where?', options: ['park', 'lake'] });
  opened = await open(await openNodeSqliteStorage(file), second);
  t.after(() => opened.harness.close(context).catch(() => {}));
  const again = await opened.harness.conversation(conversation.id, context);
  opened.harness.resume();
  served = serve(t, opened.harness, again);
  remote = await createRemoteChat({ endpoint, fetch: served.fetch, pollMs: 10 });
  assert.equal((await waitPending(remote, 'pending after reopen')).id, call.id);
  assert.deepEqual(second.requests, [], 'recovery does not call the model while the question is pending');
  assert.deepEqual(await remote.answer(call.id, 'lake'), { kind: 'answered' });
  await until('model continues after reopen', async () => finalText(await view(remote)) === 'Plan uses {"kind":"answered","answer":"lake"}');
});

test('withdraw removes a queued follow-up and reports messages that already ran', async t => {
  const f = await fixture(t);
  const first = await f.remote.conversation.submit({ type: 'input', requestId: 'first', content: 'Plan a picnic.' }, f.remote.context);
  const call = await waitPending(f.remote);
  const queued = await f.remote.conversation.submit({ type: 'input', requestId: 'later', content: 'Also bring games.', whenBusy: 'followUp' }, f.remote.context);
  const inbox = async () => (await view(f.remote)).docs['pi.inbox']?.items ?? [];
  await until('queued', async () => (await inbox()).some(item => item.id === queued.id));
  assert.equal(await queued.abort(f.remote.context), 'aborted');
  assert.deepEqual((await inbox()).filter(item => item.id === queued.id), []);
  assert.equal((await f.conversation.commit(tx => tx.submissionByRequest(f.conversation.id, 'later'), context)).status, 'unanswered');
  assert.equal(await f.remote.withdraw(queued.id), 'settled', 'a second withdraw is too late');
  assert.equal(await first.abort(f.remote.context), 'already_placed');
  await f.remote.answer(call.id, 'park');
  await until('first run done', async () => (await f.conversation.commit(tx => tx.submissionByRequest(f.conversation.id, 'first'), context)).status === 'done');
  assert.equal(await first.abort(f.remote.context), 'settled');
  assert.equal(await f.remote.withdraw(first.id), 'settled');
  assert.ok(!JSON.stringify(await view(f.remote)).includes('Also bring games'), 'the withdrawn message never ran');
});

test('answer and withdraw need authentication, the allow policy and a host answerer', async t => {
  const allowed = [];
  const f = await fixture(t, undefined, { allow: operation => { allowed.push(operation); return operation !== 'answer' && operation !== 'withdraw'; } });
  const post = (op, body) => f.fetch(new Request(`${endpoint}?op=${op}`, { method: 'POST', headers: json, body: JSON.stringify(body) }));
  for (const op of ['answer', 'withdraw']) assert.equal((await f.handler(new Request(`${endpoint}?op=${op}`, { method: 'POST', headers: json, body: '{}' }))).status, 401);
  assert.equal((await post('answer', { callId: 'c', answer: 'park' })).status, 403);
  assert.equal((await post('withdraw', { submissionId: 1 })).status, 403);
  assert.deepEqual(allowed, ['answer', 'withdraw']);
  const open = await fixture(t);
  assert.equal((await open.fetch(new Request(`${endpoint}?op=answer`, { method: 'POST', headers: json, body: '{"callId":1}' }))).status, 400);
  assert.equal((await open.fetch(new Request(`${endpoint}?op=withdraw`, { method: 'POST', headers: json, body: '{}' }))).status, 400);
  const bare = await fixture(t, undefined, { answer: undefined });
  assert.equal((await bare.fetch(new Request(`${endpoint}?op=answer`, { method: 'POST', headers: json, body: '{"callId":"c","answer":"park"}' }))).status, 404);
});

// ---- requireApproval: a gated change tool waits for the person, through the same question mechanism ------------------------
const { requireApproval, isApprovalGated, APPROVAL_DETAILS, APPROVE, DENY, DENIED_PREFIX } = await import('@hachej/boring-agent/approval');
const { defineTool } = await import('@earendil-works/pi-durable');
const { Type } = await import('@earendil-works/pi-ai');

/** A model that reads on "read", changes on "change <note>", and echoes the tool result it receives. */
function changingModel() {
  const model = { id: 'fictional-changer', name: 'Fictional changer', provider: 'fictional-changer-provider', api: 'fictional-changer-api', baseUrl: 'https://fixture.invalid',
    input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let count = 0;
  const stream = (_model, transcript) => {
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const last = [...transcript.messages].reverse().find(entry => entry.role !== 'system');
    events.push({ type: 'start', partial: message });
    if (last.role === 'user') {
      const text = typeof last.content === 'string' ? last.content : last.content.map(part => part.text).join('');
      const toolCall = text.startsWith('read') ? { type: 'toolCall', id: `call-${++count}`, name: 'read_note', arguments: {} } : { type: 'toolCall', id: `call-${++count}`, name: 'change_note', arguments: { note: text.slice(7) } };
      message.content.push(toolCall); message.stopReason = 'toolUse';
      events.push({ type: 'toolcall_start', contentIndex: 0, partial: message }, { type: 'toolcall_end', contentIndex: 0, toolCall, partial: message }, { type: 'done', reason: 'toolUse', message });
    } else {
      const text = `Result: ${last.content[0].text}`;
      message.content.push({ type: 'text', text });
      events.push({ type: 'text_start', contentIndex: 0, partial: message }, { type: 'text_delta', contentIndex: 0, delta: text, partial: message },
        { type: 'text_end', contentIndex: 0, content: text, partial: message }, { type: 'done', reason: 'stop', message });
    }
    events.end(message);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: 'Fictional keyless provider', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { models, model: { provider: model.provider, modelId: model.id } };
}

function changeTools(changes) {
  const read = defineTool({ name: 'read_note', description: 'Read the note.', parameters: Type.Object({}), execute: async () => ({ content: [{ type: 'text', text: `notes: ${changes.join(',') || 'none'}` }] }) });
  const change = defineTool({ name: 'change_note', description: 'Change the note.', parameters: Type.Object({ note: Type.String() }), execute: async ({ note }) => { changes.push(note); return { content: [{ type: 'text', text: `changed ${note}` }] }; } });
  return { read, change, gated: requireApproval(change, { summarize: args => `Add "${args.note}"` }) };
}

async function openChanging(storage, changes) {
  const tools = changeTools(changes), changer = changingModel();
  const agent = defineAgent({ id: 'change', model: changer.model, tools: [tools.read, tools.gated], instructions: 'Change notes.' });
  const registry = createRegistry();
  agent.install(registry);
  return { agent, tools, harness: await Harness.open(storage, { registry, models: changer.models }, context) };
}
const pendingCalls = v => { const answered = new Set(messages(v).filter(m => m.role === 'toolResult').map(m => m.toolCallId)); return messages(v).filter(m => m.role === 'assistant').flatMap(m => texts(m, 'toolCall')).filter(call => !answered.has(call.id)); };
const waitCall = async (remote, name) => { let found; await until(`pending ${name}`, async () => (found = pendingCalls(await view(remote)).find(call => call.name === name))); return found; };

test('a gated change tool waits for approval: reads are free, Deny changes nothing, Approve runs it once', async t => {
  const changes = [];
  const { agent, tools, harness } = await openChanging(new MemoryStorage(), changes);
  t.after(() => harness.close(context).catch(() => {}));
  assert.equal(isApprovalGated(tools.gated), true);
  assert.equal(isApprovalGated(tools.change), false);
  assert.equal(isApprovalGated(tools.read), false);
  assert.equal(tools.gated.name, 'change_note');
  const conversation = await agent.createConversation(harness, context);
  const served = serve(t, harness, conversation);
  const remote = await createRemoteChat({ endpoint, fetch: served.fetch, pollMs: 10 });
  await remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'read it' }, remote.context);
  await until('read finished without asking', async () => finalText(await view(remote)) === 'Result: notes: none');
  assert.deepEqual(pendingCalls(await view(remote)), []);

  await remote.conversation.submit({ type: 'input', requestId: 'r2', content: 'change first' }, remote.context);
  const denied = await waitCall(remote, 'change_note');
  assert.deepEqual(changes, [], 'nothing runs before the person decides');
  await until('summary published with the waiting call', async () => (await view(remote)).docs['pi.live']?.tools?.some(slot => slot.callId === denied.id && slot.details?.[APPROVAL_DETAILS]?.summary === 'Add "first"'));
  assert.equal((await remote.answer(denied.id, 'sure')).kind, 'denied', 'only Approve or Deny is accepted');
  assert.deepEqual(await remote.answer(denied.id, DENY), { kind: 'answered' });
  await until('denial reaches the model', async () => finalText(await view(remote))?.startsWith(`Result: ${DENIED_PREFIX}`));
  assert.deepEqual(changes, []);
  const result = messages(await view(remote)).find(m => m.role === 'toolResult' && m.toolCallId === denied.id);
  assert.equal(result.isError, true);

  await remote.conversation.submit({ type: 'input', requestId: 'r3', content: 'change second' }, remote.context);
  const approved = await waitCall(remote, 'change_note');
  assert.deepEqual(changes, []);
  assert.deepEqual(await remote.answer(approved.id, APPROVE), { kind: 'answered' });
  await until('approved change ran', async () => finalText(await view(remote)) === 'Result: changed second');
  assert.deepEqual(changes, ['second']);
  assert.deepEqual(await remote.answer(approved.id, APPROVE), { kind: 'answered' }, 'repeating the decision is idempotent');
  assert.deepEqual(changes, ['second'], 'and never runs the change again');
});

test('a pending approval survives reopening the harness and the change still runs once', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-approval-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'native.sqlite');
  const changes = [];
  let opened = await openChanging(await openNodeSqliteStorage(file), changes);
  const conversation = await opened.agent.createConversation(opened.harness, context);
  let remote = await createRemoteChat({ endpoint, fetch: serve(t, opened.harness, conversation).fetch, pollMs: 10 });
  await remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'change kept' }, remote.context);
  const call = await waitCall(remote, 'change_note');
  await opened.harness.close(context);

  opened = await openChanging(await openNodeSqliteStorage(file), changes);
  t.after(() => opened.harness.close(context).catch(() => {}));
  const again = await opened.harness.conversation(conversation.id, context);
  opened.harness.resume();
  remote = await createRemoteChat({ endpoint, fetch: serve(t, opened.harness, again).fetch, pollMs: 10 });
  assert.equal((await waitCall(remote, 'change_note')).id, call.id);
  assert.deepEqual(changes, [], 'recovery does not run the change while approval is pending');
  assert.deepEqual(await remote.answer(call.id, APPROVE), { kind: 'answered' });
  await until('change ran after reopen', async () => finalText(await view(remote)) === 'Result: changed kept');
  assert.deepEqual(changes, ['kept']);
});

test('createApprovalExtension gates any native tool by name, opt-in per conversation, with a rule that can let calls through and no double asking', async t => {
  const { createApprovalExtension } = await import('@hachej/boring-agent/approval');
  const changes = [];
  const tools = changeTools(changes), changer = changingModel();
  // The agent's own change tool is ungated; the extension adds the gate only where a conversation selects it.
  const agent = defineAgent({ id: 'composed', model: changer.model, tools: [tools.read, tools.change], instructions: 'Change notes.' });
  const asked = [];
  const approvals = createApprovalExtension({ tools: { change_note: { summarize: (args, call) => { asked.push(call); return `Add "${args.note}"`; }, when: args => args.note !== 'free' } } });
  const alsoGated = createApprovalExtension({ name: 'fixture.second-approval', tools: { change_note: true } });
  const registry = createRegistry();
  agent.install(registry); registry.install(approvals); registry.install(alsoGated);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: changer.models }, context);
  t.after(() => harness.close(context).catch(() => {}));
  const conversation = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: agent.agent }, context);
  const served = serve(t, harness, conversation);
  const remote = await createRemoteChat({ endpoint, fetch: served.fetch, pollMs: 10 });
  const say = (id, text) => remote.conversation.submit({ type: 'input', requestId: id, content: text }, remote.context);

  await say('c1', 'change plain');
  await until('not selected: the change runs at once', async () => finalText(await view(remote)) === 'Result: changed plain');

  await conversation.configure({ extensions: { add: [approvals, alsoGated] } }, context);
  await say('c2', 'change gated');
  const waiting = await waitCall(remote, 'change_note');
  assert.deepEqual(changes, ['plain'], 'selected: the stock tool now waits for the person');
  await until('summary from the rule', async () => (await view(remote)).docs['pi.live']?.tools?.some(slot => slot.callId === waiting.id && slot.details?.[APPROVAL_DETAILS]?.summary === 'Add "gated"'));
  assert.deepEqual(await remote.answer(waiting.id, APPROVE), { kind: 'answered' });
  await until('approved once runs, although two approval extensions wrap the tool', async () => finalText(await view(remote)) === 'Result: changed gated');
  assert.deepEqual(changes, ['plain', 'gated']);
  assert.deepEqual(asked.map(call => [String(call.conversationId), call.toolName]), [[String(conversation.id), 'change_note']], 'the rule is told the call\'s conversation (a host can name its site)');

  await say('c3', 'change free');
  await until('the rule lets this call through without a question', async () => finalText(await view(remote)) === 'Result: changed free');

  await conversation.configure({ extensions: { remove: [approvals, alsoGated] } }, context);
  await say('c4', 'change again');
  await until('deselected: no gate again', async () => finalText(await view(remote)) === 'Result: changed again');
  assert.deepEqual(changes, ['plain', 'gated', 'free', 'again']);
});

test('reused model call IDs cannot inherit or redirect a human answer across native tasks', { timeout: 10000 }, async t => {
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fictional.ask', tools: [createAskUserTool()] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  harness.resume();
  const first = await admitDocumentTool(conversation, { question: 'First?', options: ['park', 'lake'] }, 'ask_user');
  const firstTask = await harness.getTask(first, context);
  const firstId = JSON.stringify([firstTask.input.assistant, 'fixture-call']);
  await until('first question admitted', async () => (await answerUserQuestion(conversation, firstId, 'park')).kind === 'answered');
  assert.equal((await documentToolResult(harness, conversation, first)).result.answer, 'park');
  const second = await admitDocumentTool(conversation, { question: 'Second?', options: ['red', 'blue'] }, 'ask_user');
  const secondTask = await harness.getTask(second, context);
  const secondId = JSON.stringify([secondTask.input.assistant, 'fixture-call']);
  await until('second question admitted', async () => (await answerUserQuestion(conversation, secondId, 'park')).kind === 'denied');
  assert.equal((await answerUserQuestion(conversation, 'fixture-call', 'blue')).kind, 'conflict', 'an ambiguous legacy ID is refused');
  assert.equal((await answerUserQuestion(conversation, firstId, 'park')).kind, 'answered', 'a stale retry only acknowledges the original question');
  assert.notEqual((await harness.getTask(second, context)).state.status, 'terminal', 'second question still needs its own answer');
  assert.equal((await answerUserQuestion(conversation, secondId, 'blue')).kind, 'answered');
  assert.equal((await documentToolResult(harness, conversation, second)).result.answer, 'blue');
});


test('an opaque raw call ID cannot impersonate another question scoped ID', { timeout: 10000 }, async t => {
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fictional.ask', tools: [createAskUserTool()] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  harness.resume();
  const first = await admitDocumentTool(conversation, { question: 'First?', options: ['park', 'lake'] }, 'ask_user');
  const firstTask = await harness.getTask(first, context);
  const firstId = JSON.stringify([firstTask.input.assistant, 'fixture-call']);
  await until('first question admitted', async () => (await answerUserQuestion(conversation, firstId, 'park')).kind === 'answered');
  await documentToolResult(harness, conversation, first);
  const second = await conversation.commit(async tx => {
    const firstEntry = await tx.entry(firstTask.input.assistant);
    const entry = await tx.appendEntry(AssistantEntry, conversation.id, { model: [{ ...firstEntry.model[0], content: [{ type: 'toolCall', id: firstId, name: 'ask_user', arguments: { question: 'Second?', options: ['red', 'blue'] } }] }] });
    return tx.createTask(ToolTask, { assistant: entry.id, callId: firstId }, { ownership: { kind: 'conversation' } });
  }, context);
  const secondTask = await harness.getTask(second, context);
  const secondId = JSON.stringify([secondTask.input.assistant, firstId]);
  await until('second question admitted', async () => (await answerUserQuestion(conversation, secondId, 'park')).kind === 'denied');
  assert.equal((await answerUserQuestion(conversation, firstId, 'park')).kind, 'conflict', 'ambiguous scoped/raw namespace must not acknowledge the wrong question');
  assert.equal((await answerUserQuestion(conversation, secondId, 'blue')).kind, 'answered');
  assert.equal((await documentToolResult(harness, conversation, second)).result.answer, 'blue');
});


test('a legacy pending question resumes only under its original native task', { timeout: 10000 }, async t => {
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fictional.ask', tools: [createAskUserTool()] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  const taskId = await admitDocumentTool(conversation, { question: 'Original?', options: ['park', 'lake'] }, 'ask_user');
  const legacy = defineDocFamily({ kind: 'boring.ask-user.question', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', family: true, initial: () => ({ question: null }) });
  await conversation.commit(async tx => {
    const doc = await tx.doc(legacy, conversation.id, 'fixture-call', null);
    doc.question = { prompt: 'Original?', options: ['park', 'lake'], allowFreeText: false, taskId, state: { kind: 'pending' } };
  }, context);
  harness.resume();
  await until('legacy pending question attached', async () => (await answerUserQuestion(conversation, 'fixture-call', 'lake')).kind === 'answered');
  assert.equal((await documentToolResult(harness, conversation, taskId)).result.answer, 'lake');
  const next = await admitDocumentTool(conversation, { question: 'New?', options: ['red', 'blue'] }, 'ask_user');
  const record = await harness.getTask(next, context);
  const questionId = JSON.stringify([record.input.assistant, 'fixture-call']);
  await until('new task never borrows legacy answer', async () => (await answerUserQuestion(conversation, questionId, 'lake')).kind === 'denied');
  assert.equal((await answerUserQuestion(conversation, questionId, 'red')).kind, 'answered');
  assert.equal((await documentToolResult(harness, conversation, next)).result.answer, 'red');
});


test('a completed legacy question retains idempotent answer retries after upgrade', { timeout: 10000 }, async t => {
  const legacy = defineDocFamily({ kind: 'boring.ask-user.question', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', family: true, initial: () => ({ question: null }) });
  const registry = createRegistry();
  const oldTool = { ...createAskUserTool(), execute: async (args, api, ctx) => {
    await api.commit(async tx => {
      const doc = await tx.doc(legacy, api.conversationId, api.callId, null);
      doc.question = { prompt: args.question, options: args.options, allowFreeText: false, taskId: api.taskId, state: { kind: 'answered', answer: 'park' } };
    }, ctx);
    return { content: [{ type: 'text', text: JSON.stringify({ kind: 'answered', answer: 'park' }) }] };
  } };
  registry.install(defineExtension({ name: 'fictional.legacy-ask', tools: [oldTool] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  const taskId = await admitDocumentTool(conversation, { question: 'Original?', options: ['park', 'lake'] }, 'ask_user');
  assert.equal((await documentToolResult(harness, conversation, taskId)).result.answer, 'park');
  const task = await harness.getTask(taskId, context);
  const scopedId = JSON.stringify([task.input.assistant, 'fixture-call']);
  assert.equal(await harness.snapshot(legacy, conversation.id, scopedId, context), undefined, 'the old completed task wrote only its raw ID record');
  assert.equal((await answerUserQuestion(conversation, scopedId, 'park')).kind, 'answered');
  assert.equal((await answerUserQuestion(conversation, 'fixture-call', 'park')).kind, 'answered');
  assert.equal((await answerUserQuestion(conversation, scopedId, 'lake')).kind, 'conflict');
});
