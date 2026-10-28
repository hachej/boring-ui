// The opt-in acknowledgement of `present` (packages/agent/src/view-open.ts): a native tool waits, durably, for a page to confirm
// that its panel mounted the presented revision. Fictional workspace, fictional model, real chat transport.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, MemoryStorage, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { Type } from '@earendil-works/pi-ai';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createChatTransportHandler } from '@hachej/boring-agent/chat-transport';
import { defineAgent } from '@hachej/boring-agent/agents';
import { createPresentTool, answerViewOpen, VIEW_OPEN_TIMEOUT_MS } from '@hachej/boring-agent/artifacts';
import { browserTaskId } from '@hachej/boring-agent/browser-task';
import { createRemoteChat } from '@hachej/boring-ui-kit/remote-chat';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync as mkdirOut } from 'node:fs';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { blobRevision, createWorkspaceProvider } from '@hachej/boring-files/workspace';

const endpoint = 'https://fixture.invalid/chat';
const access = { principalId: 'agent', initiatorId: 'agent', scopeId: 'fictional-project' };
const encoder = new TextEncoder();
const text = '# Fictional report\n\nA paragraph.\n';
// A dashboard view an app registers as an artifact kind (`waitsForReady`): its file names the data, its renderer loads it.
const dashboardText = '{"title":"Fictional sales","query":"sales by month"}\n';
const until = async (label, check, ms = 8000) => { const deadline = Date.now() + ms; while (!(await check())) { assert.ok(Date.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 10)); } };
const parts = (message, type) => (message.content ?? []).filter(part => part.type === type);
const messages = view => view.entries.flatMap(entry => entry.model ?? []);
const view = async remote => (await remote.conversation.watch(remote.context)).value;
const finalText = v => messages(v).filter(m => m.role === 'assistant').flatMap(m => parts(m, 'text').map(p => p.text)).at(-1);
const resultOf = (v, callId) => messages(v).find(m => m.role === 'toolResult' && m.toolCallId === callId);
/** Pending `present` calls with their answer id, as the page derives them. */
const pending = v => {
  const answered = new Set(messages(v).filter(m => m.role === 'toolResult').map(m => m.toolCallId));
  return v.entries.flatMap(entry => (entry.model ?? []).filter(m => m.role === 'assistant').flatMap(m => parts(m, 'toolCall'))
    .filter(call => call.name === 'present' && !answered.has(call.id)).map(call => ({ ...call, answerId: browserTaskId(Number(entry.id), call.id) })));
};

/** A local model: the first request calls `present` with `args`; the request after the result replies with the result's text. */
function callingModel(args) {
  const model = { id: 'fictional-caller', name: 'Fictional caller', provider: 'fictional-caller-provider', api: 'fictional-caller-api', baseUrl: 'https://fixture.invalid',
    input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const requests = [];
  const stream = (_model, transcript) => {
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, timestamp: 1, stopReason: 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const result = [...transcript.messages].reverse().find(entry => entry.role === 'toolResult');
    requests.push(result ? 'after-result' : 'call');
    events.push({ type: 'start', partial: message });
    if (!result) {
      const toolCall = { type: 'toolCall', id: `present-${requests.length}`, name: 'present', arguments: args };
      message.content.push(toolCall); message.stopReason = 'toolUse';
      events.push({ type: 'toolcall_start', contentIndex: 0, partial: message }, { type: 'toolcall_end', contentIndex: 0, toolCall, partial: message }, { type: 'done', reason: 'toolUse', message });
    } else {
      const reply = `Got ${result.isError ? 'error ' : ''}${result.content[0].text}`;
      message.content.push({ type: 'text', text: reply });
      events.push({ type: 'text_start', contentIndex: 0, partial: message }, { type: 'text_delta', contentIndex: 0, delta: reply, partial: message },
        { type: 'text_end', contentIndex: 0, content: reply, partial: message }, { type: 'done', reason: 'stop', message });
    }
    events.end(message);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: model.provider, models: [model], auth: { apiKey: { name: 'Fictional keyless provider', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { models, model: { provider: model.provider, modelId: model.id }, requests };
}

/** A workspace with `doc.md` and a files provider over it: the same single provider the tools resolve. */
function workspace(directory) {
  const root = join(directory, 'workspace');
  mkdirSync(root);
  writeFileSync(join(root, 'doc.md'), text);
  writeFileSync(join(root, 'sales.dashboard.json'), dashboardText);
  const env = new NodeExecutionEnv({ cwd: root });
  const db = openNodeConnection(join(directory, 'journal.sqlite'));
  const files = createWorkspaceProvider({ identity: { providerId: 'fictional', instanceId: 'one', incarnation: 'one', viewId: 'published' }, fs: env, journal: createWorkspaceJournal(db) });
  return { files, root, env, db, workspace: { files, root }, resolveAccess: () => access };
}

async function open(storage, ws, { ack, args = { path: 'doc.md' }, noWorkspace = false } = {}) {
  const caller = callingModel(args);
  const agent = defineAgent({ id: 'view-open', model: caller.model, tools: [createPresentTool({ ...(noWorkspace ? {} : { workspace: ws.workspace, resolveAccess: ws.resolveAccess }), ...(ack === undefined ? {} : { ack }) })], instructions: 'Present, then report.' });
  const registry = createRegistry();
  agent.install(registry);
  const harness = await Harness.open(storage, { registry, models: caller.models }, context);
  return { agent, harness, caller };
}

function serve(harness, conversation) {
  const handler = createChatTransportHandler({ authenticate: async request => request.headers.get('authorization') === 'Bearer fictional-token'
    ? { conversation, context, abortSubmission: id => harness.abortSubmission(id, context, conversation.id), answer: (id, value) => answerViewOpen(conversation, id, value) } : null });
  return request => { const headers = new Headers(request.headers); headers.set('authorization', 'Bearer fictional-token'); return handler(new Request(request, { headers })); };
}

const REVISION = await blobRevision(encoder.encode(text));
const revision = () => REVISION;
const doc = (overrides = {}) => ({ kind: 'opened', instanceId: 'tab-1', path: 'doc.md', revision: undefined, ...overrides });

/** The page's real presents bookkeeping (registry/pi-artifacts/artifact.ts), bundled as a consumer would. */
async function loadPageAcks() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const out = `${root}.cache/view-open-page-test`;
  mkdirOut(out, { recursive: true });
  await build({ entryPoints: [`${root}registry/pi-artifacts/artifact.ts`], outfile: `${out}/artifact.mjs`, bundle: true, format: 'esm', platform: 'node', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(`${out}/artifact.mjs`).href);
}

/** The page acknowledges `call` the way AgentWorkspace does: it opens the file, and the viewer's mount report confirms the revision. */
async function acknowledge(f, call, { revision = REVISION, path = 'doc.md', instanceId = 'tab-1' } = {}) {
  const { createPresentAcks } = await loadPageAcks();
  const acks = createPresentAcks({ answer: (id, body) => f.remote.answer(id, body), open: () => true, instanceId });
  const context = { closedThisTurn: false, unsaved: false, narrow: false, autoOpen: true, showing: () => false };
  acks.consider([{ id: call.answerId, callId: call.id, path }], context);
  acks.shown({ path, revision });
}

async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-view-open-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const ws = workspace(directory);
  t.after(() => ws.db.close());
  const { agent, harness, caller } = await open(new MemoryStorage(), ws, options);
  t.after(() => harness.close(context).catch(() => {}));
  const conversation = await agent.createConversation(harness, context);
  const remote = await createRemoteChat({ endpoint, fetch: serve(harness, conversation), pollMs: 10 });
  const submit = () => remote.conversation.submit({ type: 'input', requestId: `r-${Math.random()}`, content: 'Present it.' }, remote.context);
  const waitPending = async () => { let found; await until('pending present', async () => (found = pending(await view(remote))[0])); return found; };
  // Raw answers wait for the record: the call is visible before the tool writes its view record. Acknowledgements use the real page bookkeeping.
  const answer = async (id, value) => {
    await new Promise(resolve => setTimeout(resolve, 200));
    return remote.answer(id, typeof value === 'string' ? value : JSON.stringify(value));
  };
  return { conversation, remote, harness, caller, submit, waitPending, answer };
}

test('without ack, present keeps the file and returns at once, exactly as before', async t => {
  const f = await fixture(t);
  await f.submit();
  await until('result', async () => finalText(await view(f.remote))?.startsWith('Got {"kind":"presented"'));
  const v = await view(f.remote);
  const result = JSON.parse(finalText(v).slice(4));
  assert.deepEqual(Object.keys(result).sort(), ['artifact', 'kind']);
  assert.equal(result.artifact.revision, revision());
  assert.deepEqual(f.caller.requests, ['call', 'after-result']);
});

test('ack: the page confirms the mounted revision and the result says opened with the viewer', async t => {
  const f = await fixture(t, { ack: { timeoutMs: 5000 } });
  await f.submit();
  const call = await f.waitPending();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(f.caller.requests, ['call'], 'no model request while the page has not confirmed');
  await acknowledge(f, call, { revision: revision() });
  await until('model continues', async () => finalText(await view(f.remote))?.startsWith('Got {"kind":"presented"'));
  const result = JSON.parse(finalText(await view(f.remote)).slice(4));
  assert.equal(result.opened, true);
  assert.equal(result.viewer, 'tab-1');
  assert.equal(result.artifact.revision, revision());
});

test('ack: a person who closed the panel on purpose refuses, with the reason and nothing more', async t => {
  const f = await fixture(t, { ack: { timeoutMs: 5000 } });
  await f.submit();
  const call = await f.waitPending();
  const { createPresentAcks } = await loadPageAcks();
  createPresentAcks({ answer: (id, body) => f.remote.answer(id, body), open: () => true, instanceId: 'tab-1' })
    .consider([{ id: call.answerId, callId: call.id, path: 'doc.md' }], { closedThisTurn: true, unsaved: false, narrow: false, autoOpen: true, showing: () => false });
  await until('model continues', async () => finalText(await view(f.remote))?.startsWith('Got {"kind":"presented"'));
  const result = JSON.parse(finalText(await view(f.remote)).slice(4));
  assert.equal(result.opened, false);
  assert.equal(result.refused, 'closed by user');
  assert.equal(result.artifact.revision, revision(), 'the file is kept and the card still shows it');
});

test('ack: no page attached (viewers says no) is viewer none at once, without waiting', async t => {
  const f = await fixture(t, { ack: { timeoutMs: 60000, viewers: () => false } });
  const started = Date.now();
  await f.submit();
  await until('result', async () => finalText(await view(f.remote))?.startsWith('Got {"kind":"presented"'), 5000);
  assert.ok(Date.now() - started < 5000, 'no wait for a timeout');
  const result = JSON.parse(finalText(await view(f.remote)).slice(4));
  assert.equal(result.opened, false);
  assert.equal(result.viewer, 'none');
  assert.deepEqual(pending(await view(f.remote)), [], 'nothing left pending');
});

test('ack: no answer in time is unconfirmed, not an error, and a late answer is refused', async t => {
  const f = await fixture(t, { ack: { timeoutMs: 200 } });
  await f.submit();
  const call = await f.waitPending();
  await until('unconfirmed result', async () => finalText(await view(f.remote))?.startsWith('Got {"kind":"presented"'), 5000);
  const v = await view(f.remote);
  const result = JSON.parse(finalText(v).slice(4));
  assert.equal(result.opened, 'unconfirmed');
  assert.equal(result.timeoutMs, 200);
  assert.ok(!finalText(v).startsWith('Got error'), 'not an error result');
  assert.equal(resultOf(v, call.id).isError ?? false, false);
  assert.equal((await f.answer(call.answerId, doc({ revision: revision() }))).kind, 'conflict', 'a late answer does not settle the call again');
});

test('ack: the first valid answer wins; a second answer from another tab gets conflict; a repeat is idempotent', async t => {
  const f = await fixture(t, { ack: { timeoutMs: 5000 } });
  await f.submit();
  const call = await f.waitPending();
  assert.deepEqual(await f.answer(call.answerId, doc({ instanceId: 'tab-1', revision: revision() })), { kind: 'answered' });
  assert.equal((await f.answer(call.answerId, doc({ instanceId: 'tab-2', revision: revision() }))).kind, 'conflict');
  assert.deepEqual(await f.answer(call.answerId, doc({ instanceId: 'tab-1', revision: revision() })), { kind: 'answered' });
  await until('model continues', async () => finalText(await view(f.remote))?.startsWith('Got {"kind":"presented"'));
  assert.equal(JSON.parse(finalText(await view(f.remote)).slice(4)).viewer, 'tab-1');
});

test('ack: an answer must name the presented file and revision; anything else is refused without settling', async t => {
  const f = await fixture(t, { ack: { timeoutMs: 5000 } });
  await f.submit();
  const call = await f.waitPending();
  for (const bad of ['not json', '[1]', JSON.stringify({ kind: 'opened', instanceId: 'tab-1', path: 'other.md', revision: revision() }),
    JSON.stringify({ kind: 'opened', instanceId: 'tab-1', path: 'doc.md', revision: 'sha-of-something-else' }),
    JSON.stringify({ kind: 'opened', instanceId: 'tab-1', path: 'doc.md', revision: revision(), extra: 1 }), JSON.stringify({ kind: 'refused', reason: '' })]) {
    assert.equal((await f.answer(call.answerId, bad)).kind, 'denied', bad);
  }
  assert.equal(pending(await view(f.remote)).length, 1, 'still pending');
  assert.equal((await f.answer('no-such-call', doc({ revision: revision() }))).kind, 'unknown-question');
  assert.deepEqual(await f.answer(call.answerId, doc({ revision: revision(), path: './doc.md' })), { kind: 'answered' }, 'a leading ./ names the same file');
});

test('ack: an answer for another tool name or a browser task is unknown-question, never a settle', async t => {
  const f = await fixture(t, { ack: { timeoutMs: 5000 } });
  await f.submit();
  const call = await f.waitPending();
  const conversation = f.conversation;
  assert.equal((await answerViewOpen(conversation, call.answerId, JSON.stringify(doc({ revision: revision() })), { tool: 'other_present' })).kind, 'unknown-question');
  assert.equal(pending(await view(f.remote)).length, 1);
});

test('ack: stopping the conversation cancels the pending view and refuses a later answer', async t => {
  const f = await fixture(t, { ack: { timeoutMs: 5000 } });
  await f.submit();
  const call = await f.waitPending();
  await f.conversation.abort(context);
  await f.conversation.waitForIdle(context);
  assert.deepEqual(pending(await view(f.remote)), []);
  assert.notEqual((await f.answer(call.answerId, doc({ revision: revision() }))).kind, 'answered');
  assert.deepEqual(f.caller.requests.filter(request => request === 'after-result'), []);
});

test('ack: a restart keeps the original deadline, so replay cannot extend the wait', { timeout: 60000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-view-open-restart-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const ws = workspace(directory);
  t.after(() => ws.db.close());
  const file = join(directory, 'native.sqlite');
  const timeoutMs = 5000;
  let opened = await open(await openNodeSqliteStorage(file), ws, { ack: { timeoutMs } });
  const conversation = await opened.agent.createConversation(opened.harness, context);
  let remote = await createRemoteChat({ endpoint, fetch: serve(opened.harness, conversation), pollMs: 10 });
  await remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Present.' }, remote.context);
  await until('pending before close', async () => pending(await view(remote))[0]);
  // The call is visible before the tool has written its view record (after `keep`); let it settle before the harness closes.
  await new Promise(resolve => setTimeout(resolve, 500));
  await opened.harness.close(context);
  // The original deadline passes while the harness is closed.
  await new Promise(resolve => setTimeout(resolve, timeoutMs + 500));

  opened = await open(await openNodeSqliteStorage(file), ws, { ack: { timeoutMs } });
  t.after(() => opened.harness.close(context).catch(() => {}));
  const again = await opened.harness.conversation(conversation.id, context);
  opened.harness.resume();
  remote = await createRemoteChat({ endpoint, fetch: serve(opened.harness, again), pollMs: 10 });
  const reopenedAt = Date.now();
  await until('unconfirmed after restart', async () => finalText(await view(remote))?.startsWith('Got {"kind":"presented"'), 3 * timeoutMs);
  // A re-attach that restarted the deadline would end no earlier than a full timeout after reopening.
  assert.ok(Date.now() - reopenedAt < timeoutMs, 'the stored deadline ends the wait; a re-attach does not start a new full timeout');
  assert.equal(JSON.parse(finalText(await view(remote)).slice(4)).opened, 'unconfirmed');
});

test('ack: a replay after the file changed reports the revision that was acknowledged, not the current one', { timeout: 60000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-view-open-replay-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const ws = workspace(directory);
  t.after(() => ws.db.close());
  const file = join(directory, 'native.sqlite');
  let opened = await open(await openNodeSqliteStorage(file), ws, { ack: { timeoutMs: 8000 } });
  const conversation = await opened.agent.createConversation(opened.harness, context);
  let remote = await createRemoteChat({ endpoint, fetch: serve(opened.harness, conversation), pollMs: 10 });
  await remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Present.' }, remote.context);
  let call;
  await until('pending before acknowledgement', async () => (call = pending(await view(remote))[0]));
  // Acknowledge revision A, let the record settle, then close: the result may or may not be written before the close.
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(await remote.answer(call.answerId, JSON.stringify({ kind: 'opened', instanceId: 'tab-1', path: 'doc.md', revision: REVISION })), { kind: 'answered' });
  await opened.harness.close(context);

  // The file becomes revision B before the replay.
  writeFileSync(join(ws.root, 'doc.md'), 'A different revision, written after the acknowledgement.\n');
  opened = await open(await openNodeSqliteStorage(file), ws, { ack: { timeoutMs: 8000 } });
  t.after(() => opened.harness.close(context).catch(() => {}));
  const again = await opened.harness.conversation(conversation.id, context);
  opened.harness.resume();
  remote = await createRemoteChat({ endpoint, fetch: serve(opened.harness, again), pollMs: 10 });
  await until('result after replay', async () => finalText(await view(remote))?.startsWith('Got {"kind":"presented"'), 15000);
  const result = JSON.parse(finalText(await view(remote)).slice(4));
  assert.equal(result.opened, true, 'the acknowledged revision is still the one that was opened');
  assert.equal(result.artifact.revision, REVISION, 'the result names the acknowledged revision A, not the current B');
});

test('ack: a replay answered before the tool resumes writes no result until resume, then reports the acknowledged revision', { timeout: 60000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-view-open-forced-replay-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const ws = workspace(directory);
  t.after(() => ws.db.close());
  const file = join(directory, 'native.sqlite');
  let opened = await open(await openNodeSqliteStorage(file), ws, { ack: { timeoutMs: 8000 } });
  const conversation = await opened.agent.createConversation(opened.harness, context);
  const remote = await createRemoteChat({ endpoint, fetch: serve(opened.harness, conversation), pollMs: 10 });
  await remote.conversation.submit({ type: 'input', requestId: 'r1', content: 'Present.' }, remote.context);
  let call;
  await until('pending before close', async () => (call = pending(await view(remote))[0]));
  // The call is visible before the tool has written its view record: let it settle, then close while the call still waits.
  await new Promise(resolve => setTimeout(resolve, 500));
  await opened.harness.close(context);

  // The file becomes revision B while the harness is closed.
  writeFileSync(join(ws.root, 'doc.md'), 'A different revision, written after the close.\n');
  opened = await open(await openNodeSqliteStorage(file), ws, { ack: { timeoutMs: 8000 } });
  t.after(() => opened.harness.close(context).catch(() => {}));
  const again = await opened.harness.conversation(conversation.id, context);
  // The page acknowledges revision A before the tool is resumed: the answer settles the record, but no result is written yet.
  assert.deepEqual(await answerViewOpen(again, call.answerId, JSON.stringify({ kind: 'opened', instanceId: 'tab-1', path: 'doc.md', revision: REVISION })), { kind: 'answered' });
  const replayed = await createRemoteChat({ endpoint, fetch: serve(opened.harness, again), pollMs: 10 });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(resultOf(await view(replayed), call.id), undefined, 'no tool result before the harness resumes');

  opened.harness.resume();
  await until('result after resume', async () => finalText(await view(replayed))?.startsWith('Got {"kind":"presented"'), 15000);
  const result = JSON.parse(finalText(await view(replayed)).slice(4));
  assert.equal(result.opened, true, 'the acknowledged view is reported as opened');
  assert.equal(result.artifact.revision, REVISION, 'the result names the acknowledged revision A, not the current B');
});

test('ack: the default timeout is 15 seconds', () => {
  assert.equal(VIEW_OPEN_TIMEOUT_MS, 15_000);
});

test('ack: a dashboard view (an app kind that waits for ready) is opened only once it is ready, and refused with the reason when it fails', async t => {
  const { createPresentAcks } = await loadPageAcks();
  const pageContext = { closedThisTurn: false, unsaved: false, narrow: false, autoOpen: true, showing: () => false };
  const path = 'sales.dashboard.json';
  const dashboardRevision = await blobRevision(encoder.encode(dashboardText));
  // Ready: the panel's mount report for a `waitsForReady` kind comes after the renderer's onReady (test/packages/ui-present-ack.impl.mjs).
  const f = await fixture(t, { ack: { timeoutMs: 5000 }, args: { path } });
  await f.submit();
  const call = await f.waitPending();
  const acks = createPresentAcks({ answer: (id, body) => f.remote.answer(id, body), open: () => true, instanceId: 'tab-1' });
  acks.consider([{ id: call.answerId, callId: call.id, path }], pageContext);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(f.caller.requests, ['call'], 'opening the panel alone does not answer: the dashboard is not ready yet');
  acks.shown({ path, revision: dashboardRevision });
  await until('model continues', async () => finalText(await view(f.remote))?.startsWith('Got {"kind":"presented"'));
  const opened = JSON.parse(finalText(await view(f.remote)).slice(4));
  assert.equal(opened.opened, true);
  assert.equal(opened.artifact.target.resource.path, path);

  // Failed: the kind's onFailed (or a renderer that throws) refuses the call with the reason the agent reads.
  const g = await fixture(t, { ack: { timeoutMs: 5000 }, args: { path } });
  await g.submit();
  const failing = await g.waitPending();
  const page = createPresentAcks({ answer: (id, body) => g.remote.answer(id, body), open: () => true, instanceId: 'tab-1' });
  page.consider([{ id: failing.answerId, callId: failing.id, path }], pageContext);
  page.failed({ path, reason: 'the sales query failed' });
  await until('model continues', async () => finalText(await view(g.remote))?.startsWith('Got {"kind":"presented"'));
  const refused = JSON.parse(finalText(await view(g.remote)).slice(4));
  assert.equal(refused.opened, false);
  assert.equal(refused.refused, 'the sales query failed');
});


test('host task references and filtered lists present through the native tool without a workspace', async t => {
  for (const args of [{ task: 'D-201' }, { tasks: { filter: 'mine' } }, { tasks: { filter: 'waiting-on-me' } }, { tasks: { filter: 'all' } }]) {
    const f = await fixture(t, { args, noWorkspace: true });
    await f.submit();
    await until('native task present result', async () => finalText(await view(f.remote))?.startsWith('Got '));
    const message = finalText(await view(f.remote));
    assert.ok(!message.startsWith('Got error'), message);
    const result = JSON.parse(message.slice(4));
    assert.equal(result.kind, 'presented');
    assert.equal(result.artifact.schema, 'boring.task');
    assert.deepEqual(result.artifact.subject, args);
    assert.equal(result.artifact.target, undefined, 'a task is not a fake workspace file');
    assert.equal(result.artifact.revision, undefined, 'presenting a record claims no saved revision');
  }
});

test('task present acknowledgement requires the exact mounted subject through the real chat transport', async t => {
  const subject = { task: 'D-201' };
  const f = await fixture(t, { args: subject, noWorkspace: true, ack: { timeoutMs: 5000 } });
  await f.submit();
  const call = await f.waitPending();
  const { createPresentAcks, pendingPresents } = await loadPageAcks();
  const calls = pendingPresents(await view(f.remote));
  assert.deepEqual(calls, [{ id: call.answerId, callId: call.id, subject }]);
  const page = createPresentAcks({ answer: (id, body) => f.remote.answer(id, body), open: () => { throw new Error('a record must not open as a file'); }, instanceId: 'host-task-viewer' });
  page.consider(calls, { closedThisTurn: false, unsaved: false, narrow: false, autoOpen: false, showing: () => false });
  assert.deepEqual(f.caller.requests, ['call'], 'a descriptor or open intent does not confirm a mount');
  const other = await f.answer(call.answerId, { kind: 'opened', instanceId: 'host-task-viewer', subject: { task: 'D-202' } });
  assert.equal(other.kind, 'denied', 'another task cannot confirm the original subject');
  const file = await f.answer(call.answerId, { kind: 'opened', instanceId: 'host-task-viewer', path: 'D-201', revision: 'fictional' });
  assert.equal(file.kind, 'denied', 'a file-shaped report cannot confirm a task');
  page.shown({ subject });
  await until('model continues after exact task mount', async () => finalText(await view(f.remote))?.startsWith('Got {'));
  const result = JSON.parse(finalText(await view(f.remote)).slice(4));
  assert.deepEqual(result.artifact.subject, subject);
  assert.equal(result.opened, true);
  assert.equal(result.viewer, 'host-task-viewer');
  const changedRepeat = await f.answer(call.answerId, { kind: 'opened', instanceId: 'host-task-viewer', subject: { task: 'D-202' } });
  assert.equal(changedRepeat.kind, 'denied', 'a repeat from the same viewer cannot claim a different task was shown');
});

test('task list failures refuse the native wait and missing viewers or mounts stay honest', async t => {
  const subject = { tasks: { filter: 'waiting-on-me' } };
  const f = await fixture(t, { args: subject, noWorkspace: true, ack: { timeoutMs: 5000 } });
  await f.submit();
  await f.waitPending();
  const { createPresentAcks, pendingPresents } = await loadPageAcks();
  const page = createPresentAcks({ answer: (id, body) => f.remote.answer(id, body), open: () => false, instanceId: 'host-task-viewer' });
  page.consider(pendingPresents(await view(f.remote)), { closedThisTurn: false, unsaved: false, narrow: false, autoOpen: false, showing: () => false });
  page.failed({ subject, reason: 'Access to this task list was revoked' });
  await until('task refusal result', async () => finalText(await view(f.remote))?.startsWith('Got {'));
  assert.equal(JSON.parse(finalText(await view(f.remote)).slice(4)).refused, 'Access to this task list was revoked');
  for (const ack of [{ timeoutMs: 30 }, { viewers: () => false }]) {
    const g = await fixture(t, { args: subject, noWorkspace: true, ack });
    await g.submit();
    await until('unmounted task result', async () => finalText(await view(g.remote))?.startsWith('Got {'));
    const result = JSON.parse(finalText(await view(g.remote)).slice(4));
    if (ack.viewers) assert.equal(result.viewer, 'none'); else assert.equal(result.opened, 'unconfirmed');
  }
});


test('native present refuses ambiguous file/task inputs before reading a workspace', async t => {
  const f = await fixture(t, { args: { path: 'doc.md', task: 'D-201' }, noWorkspace: true });
  await f.submit();
  await until('ambiguous subject result', async () => finalText(await view(f.remote))?.startsWith('Got {'));
  const result = JSON.parse(finalText(await view(f.remote)).slice(4));
  assert.equal(result.kind, 'denied');
  assert.match(result.reason, /exactly one/);
  assert.equal(result.artifact, undefined);
});

test('task presentation survives native SQLite reopen and acknowledges only its retained reference', { timeout: 60000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-task-view-restart-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'native.sqlite'), subject = { task: 'D-201' };
  let opened = await open(await openNodeSqliteStorage(file), {}, { args: subject, noWorkspace: true, ack: { timeoutMs: 15000 } });
  t.after(() => opened.harness.close(context).catch(() => {}));
  const conversation = await opened.agent.createConversation(opened.harness, context);
  let remote = await createRemoteChat({ endpoint, fetch: serve(opened.harness, conversation), pollMs: 10 });
  await remote.conversation.submit({ type: 'input', requestId: 'task-view-restart', content: 'Present this task.' }, remote.context);
  let call;
  await until('task wait before close', async () => (call = pending(await view(remote))[0]));
  await new Promise(resolve => setTimeout(resolve, 200));
  await opened.harness.close(context);
  opened = await open(await openNodeSqliteStorage(file), {}, { args: { task: 'D-202' }, noWorkspace: true, ack: { timeoutMs: 15000 } });
  const again = await opened.harness.conversation(conversation.id, context);
  assert.equal((await answerViewOpen(again, call.answerId, JSON.stringify({ kind: 'opened', instanceId: 'host-after-restart', subject: { task: 'D-202' } }))).kind, 'denied');
  assert.deepEqual(await answerViewOpen(again, call.answerId, JSON.stringify({ kind: 'opened', instanceId: 'host-after-restart', subject })), { kind: 'answered' });
  remote = await createRemoteChat({ endpoint, fetch: serve(opened.harness, again), pollMs: 10 });
  opened.harness.resume();
  await until('task result after native reopen', async () => finalText(await view(remote))?.startsWith('Got {'), 15000);
  const result = JSON.parse(finalText(await view(remote)).slice(4));
  assert.equal(result.opened, true);
  assert.equal(result.viewer, 'host-after-restart');
  assert.deepEqual(result.artifact.subject, subject);
});
