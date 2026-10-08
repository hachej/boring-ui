import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as turn } from 'node:timers/promises';
import { Harness, MemoryStorage, AssistantEntry, ToolTask, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createPresentationTool } from '@hachej/boring-agent/presentation';
import { toolResultText } from '../fixtures/native-document.mjs';
import { createCanvasTransport } from '../../examples/shared/canvas-transport-server.mjs';
import { schema, version } from '../../examples/shared/canvas-transport-protocol.mjs';

const identity = { runtimeId: 'fictional-runtime', conversationId: 'fictional-conversation', scopeId: 'fictional-scope', principalId: 'fictional-person' };
const target = { instanceId: 'viewer', epoch: 'epoch', subject: { scopeId: identity.scopeId, base: { kind: 'absent', target: { resource: { providerId: 'fictional', path: 'board.tldraw' }, view: { kind: 'published' } } }, bufferVersion: 0, mountId: 'mount', pageId: 'page:one' } };
const header = { schema, version };
const input = () => ({ expiresAt: Date.now() + 5000, shapeIds: ['shape:one'] });
const request = (op, body, { connectionId, signal, actor, contentType = 'application/json' } = {}) => new Request(`https://fictional.test/canvas?op=${op}${connectionId ? `&connectionId=${connectionId}` : ''}`, {
  method: op === 'poll' ? 'GET' : 'POST', signal, headers: { 'content-type': contentType, ...(actor ? { actor } : {}) }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
async function fixture(t, options = {}) {
  const revoked = new AbortController();
  const host = createCanvasTransport({ timeoutMs: 1000, authenticate: async req => ({ identity: { ...identity, principalId: req.headers.get('actor') ?? identity.principalId }, revoked: revoked.signal }), authorize: () => true, ...options });
  t.after(() => host.close());
  const opened = await host.handle(request('open', { ...header, target }));
  assert.equal(opened.status, 200);
  const { connectionId } = await opened.json(), connection = host.getConnection(connectionId);
  const poll = async signal => {
    const response = host.handle(request('poll', undefined, { connectionId, signal }));
    await turn();
    return { response };
  };
  const reply = (envelope, result = { kind: 'applied' }, extra = {}) => host.handle(request('result', { ...header, connectionId, requestId: envelope.requestId, result }, extra));
  return { host, revoked, connectionId, connection, poll, reply };
}

test('selection delivers once to the exact receiver and preserves caller target and identity', async t => {
  const phases = [], f = await fixture(t, { authorize: details => { phases.push(structuredClone(details)); details.target.epoch = 'mutated'; details.identity.scopeId = 'mutated'; return true; } });
  const p = await f.poll();
  const captured = structuredClone(target), selected = input();
  const outcome = f.connection.select.invoke(captured, selected);
  captured.epoch = 'outside-change'; selected.shapeIds.push('shape:outside');
  const envelope = await (await p.response).json();
  assert.deepEqual(envelope.target, target);
  assert.deepEqual(envelope.input.shapeIds, ['shape:one']);
  let actualSelection = [];
  actualSelection = envelope.input.shapeIds;
  assert.equal((await f.reply(envelope)).status, 204);
  assert.equal((await outcome).kind, 'applied');
  assert.deepEqual(actualSelection, ['shape:one']);
  assert.deepEqual(phases.map(x => x.phase), ['open', 'invoke', 'delivery', 'result']);
  assert.ok(phases.every(x => x.identity.scopeId === identity.scopeId));
  assert.equal((await f.reply(envelope)).status, 409);
  assert.equal((await f.connection.select.invoke(target, input())).kind, 'unavailable');
});

test('proposal acknowledgement is exact-target bound and cannot accept a human proposal', async t => {
  const f = await fixture(t), p = await f.poll();
  const outcome = f.connection.propose.invoke(target, { expiresAt: Date.now() + 5000, summary: 'Fictional deletion proposal', edits: [{ kind: 'remove', id: 'shape:one' }] });
  const envelope = await (await p.response).json();
  assert.equal(envelope.command, 'propose');
  const wrong = structuredClone(target); wrong.subject.bufferVersion++;
  assert.equal((await f.reply(envelope, { kind: 'proposed', proposalId: 'proposal', base: wrong })).status, 400);
  assert.equal((await f.reply(envelope, { kind: 'applied' })).status, 400);
  assert.equal((await f.reply(envelope, { kind: 'proposed', proposalId: 'proposal', base: target })).status, 204);
  assert.deepEqual(await outcome, { kind: 'proposed', proposalId: 'proposal', base: target });
  assert.equal((await f.host.handle(request('accept', {}))).status, 405);
});

test('foreign actors, stale targets, oversized bodies and duplicate capacity cannot dispatch', async t => {
  const f = await fixture(t), p = await f.poll();
  assert.equal((await f.host.handle(request('poll', undefined, { connectionId: f.connectionId, actor: 'intruder' }))).status, 403);
  assert.equal((await f.host.handle(request('poll', undefined, { connectionId: f.connectionId }))).status, 409);
  assert.equal((await f.connection.select.invoke({ ...target, epoch: 'old' }, input())).kind, 'stale');
  assert.equal((await f.connection.select.invoke(target, { ...input(), shapeIds: Array(101).fill('shape:one') })).kind, 'denied');
  assert.equal((await f.host.handle(request('open', { ...header, target }, { contentType: 'text/plain' }))).status, 415);
  assert.equal((await f.host.handle(request('open', 'x'.repeat(65_537)))).status, 413);
  const outcome = f.connection.select.invoke(target, input());
  assert.equal((await f.connection.select.invoke(target, input())).kind, 'unavailable');
  const envelope = await (await p.response).json();
  assert.equal((await f.reply(envelope, { kind: 'applied' }, { actor: 'intruder' })).status, 403);
  assert.equal((await f.reply(envelope)).status, 204);
  assert.equal((await outcome).kind, 'applied');
});

for (const phase of ['invoke', 'delivery', 'result']) test(`revocation during ${phase} authorization fences the awaited continuation`, async t => {
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { authorize: details => details.phase !== phase || new Promise(resolve => { release = resolve; entered(); }) });
  const p = await f.poll(), outcome = f.connection.select.invoke(target, input());
  let resultResponse;
  if (phase === 'result') {
    const envelope = await (await p.response).json();
    resultResponse = f.reply(envelope);
  }
  await waiting;
  f.revoked.abort();
  const result = await outcome;
  assert.equal(result.kind, phase === 'result' ? 'unknown' : 'unavailable');
  release(true);
  if (resultResponse) assert.equal((await resultResponse).status, 409);
  else assert.equal((await p.response).status, 410);
  assert.equal(f.host.getConnection(f.connectionId), undefined);
});

test('lost result, disconnect and native cancellation never redeliver possible effects', async t => {
  for (const reason of ['disconnect', 'cancel', 'timeout']) {
    const f = await fixture(t, { timeoutMs: 40 }), transportAbort = new AbortController(), nativeAbort = new AbortController();
    const p = await f.poll(transportAbort.signal), outcome = f.connection.select.invoke(target, input(), nativeAbort.signal);
    const envelope = await (await p.response).json();
    const effect = [...envelope.input.shapeIds];
    if (reason === 'disconnect') transportAbort.abort();
    if (reason === 'cancel') nativeAbort.abort();
    assert.equal((await outcome).kind, 'unknown');
    assert.deepEqual(effect, ['shape:one']);
    assert.equal(f.host.getConnection(f.connectionId), undefined);
    assert.equal((await f.reply(envelope)).status, 410);
    assert.equal((await f.connection.select.invoke(target, input())).kind, 'unavailable');
  }
});

test('poll cancellation releases its connection and capacity; idle poll expires without an effect', async t => {
  const f = await fixture(t, { timeoutMs: 30, maxConnections: 1 });
  assert.equal((await f.host.handle(request('open', { ...header, target }))).status, 429);
  const idle = await f.poll();
  assert.equal((await idle.response).status, 204);
  const cancel = new AbortController(), p = await f.poll(cancel.signal);
  cancel.abort();
  assert.equal((await p.response).status, 410);
  assert.equal((await f.host.handle(request('open', { ...header, target }))).status, 200);
});

test('real native unsafe ToolTask receives the authenticated browser acknowledgement', async t => {
  const f = await fixture(t);
  const tool = createPresentationTool({ name: 'fixture_select', description: 'Fictional mounted selection', parameters: Type.Object({}), target,
    command: f.connection.select, prepareInput: input, authorize: () => true, formatResult: result => ({ content: [{ type: 'text', text: JSON.stringify(result) }] }) });
  assert.equal(tool.replay, 'unsafe');
  const registry = createRegistry(); registry.install(defineExtension({ name: 'fixture.canvas-transport', tools: [tool] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context), p = await f.poll();
  const task = await conversation.commit(async tx => {
    const entry = await tx.appendEntry(AssistantEntry, conversation.id, { model: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'select', name: tool.name, arguments: {} }], api: 'fixture', provider: 'fixture', model: 'fixture', timestamp: 1, stopReason: 'toolUse', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }] });
    return tx.createTask(ToolTask, { assistant: entry.id, callId: 'select' }, { ownership: { kind: 'conversation' } });
  }, context);
  const waiting = toolResultText(harness, conversation, task);
  const envelope = await (await p.response).json();
  assert.deepEqual(envelope.input.shapeIds, ['shape:one']);
  assert.equal((await f.reply(envelope)).status, 204);
  const result = await waiting;
  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.text), { kind: 'applied' });
});

test('SIGKILL after transport callback effect cannot replay through a fresh receiver on native SQLite recovery', { timeout: 20000 }, async t => {
  const { mkdtemp, readFile, rm, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const { spawn } = await import('node:child_process'), { once } = await import('node:events');
  const directory = await mkdtemp(join(tmpdir(), 'fictional-canvas-transport-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = phase => spawn(process.execPath, [new URL('../fixtures/canvas-transport-crash-child.mjs', import.meta.url).pathname, directory, phase], { stdio: ['ignore', 'ignore', 'pipe'] });
  const holding = child('hold'); let errors = ''; holding.stderr.on('data', data => { errors += data; });
  const exited = once(holding, 'exit'); t.after(() => holding.kill('SIGKILL'));
  const deadline = Date.now() + 10000;
  while (true) {
    try { await access(join(directory, 'ready')); await access(join(directory, 'task.json')); break; }
    catch { assert.equal(holding.exitCode, null, errors); assert.ok(Date.now() < deadline, 'transport callback was never reached'); await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  holding.kill('SIGKILL'); assert.deepEqual(await exited, [null, 'SIGKILL']);
  const recovering = child('recover'); recovering.stderr.on('data', data => { errors += data; }); t.after(() => recovering.kill('SIGKILL'));
  assert.deepEqual(await once(recovering, 'exit'), [0, null], errors);
  assert.equal(await readFile(join(directory, 'effects'), 'utf8'), '["shape:one"]\n');
  const terminal = JSON.parse(await readFile(join(directory, 'recovered.json'), 'utf8'));
  assert.equal(terminal.state.status, 'terminal'); assert.equal(terminal.state.outcome.status, 'failed');
  assert.match(JSON.stringify(terminal.state.outcome), /interrupt/i);
});

test('completed calls release request/native listeners but keep original idle revocation active', async t => {
  const { getEventListeners } = await import('node:events');
  const f = await fixture(t), native = new AbortController(), transport = new AbortController();
  const p = await f.poll(transport.signal), outcome = f.connection.select.invoke(target, input(), native.signal);
  const envelope = await (await p.response).json();
  await f.reply(envelope); await outcome;
  assert.equal(getEventListeners(native.signal, 'abort').length, 0);
  assert.equal(getEventListeners(f.revoked.signal, 'abort').length, 1);
  f.revoked.abort();
  assert.equal(f.host.getConnection(f.connectionId), undefined);
  assert.equal(getEventListeners(f.revoked.signal, 'abort').length, 0);
});

test('denied admission sends no envelope and a denied result preserves effect uncertainty', async t => {
  for (const denied of ['invoke', 'result']) {
    const f = await fixture(t, { authorize: details => details.phase !== denied });
    const abort = new AbortController(), p = await f.poll(abort.signal);
    const outcome = f.connection.select.invoke(target, input());
    if (denied === 'invoke') {
      assert.equal((await outcome).kind, 'denied');
      abort.abort();
      assert.equal((await p.response).status, 410);
    } else {
      const envelope = await (await p.response).json();
      assert.equal((await f.reply(envelope)).status, 403);
      assert.equal((await outcome).kind, 'unknown');
    }
  }
});

test('each authenticated identity field is bound to the original attachment', async t => {
  let current = { ...identity };
  const revocation = new AbortController();
  const f = await fixture(t, { authenticate: async () => ({ identity: current, revoked: revocation.signal }) });
  for (const key of Object.keys(identity)) {
    current = { ...identity, [key]: 'another-identity' };
    assert.equal((await f.host.handle(request('poll', undefined, { connectionId: f.connectionId }))).status, 403);
    assert.equal((await f.host.handle(request('close', undefined, { connectionId: f.connectionId }))).status, 403);
    assert.ok(f.host.getConnection(f.connectionId));
  }
  current = { ...identity };
  const p = await f.poll(), outcome = f.connection.select.invoke(target, input());
  const envelope = await (await p.response).json();
  await f.reply(envelope);
  assert.equal((await outcome).kind, 'applied');
});
