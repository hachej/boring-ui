import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, AssistantEntry, ToolTask, ToolResultEntry, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createPresentationTool } from '@hachej/boring-agent/presentation';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';

const target = () => ({ instanceId: 'fictional-editor', epoch: 'mount-1', subject: { document: 'private-note' } });
const formatResult = result => ({ content: [{ type: 'text', text: JSON.stringify({ kind: result.kind }) }], isError: false });
const options = overrides => ({ name: 'viewer_command', description: 'Fictional viewer command', parameters: Type.Object({ text: Type.String() }, { additionalProperties: false }),
  command: { name: 'command', input: { parse: input => input }, invoke: async () => ({ kind: 'applied', value: undefined }) },
  target: target(), prepareInput: args => args, authorize: () => true, formatResult, ...overrides });

async function fixture(t, config) {
  const tool = createPresentationTool(config);
  assert.equal(tool.replay, 'unsafe');
  const registry = createRegistry(); registry.install(defineExtension({ name: 'fixture.presentation', tools: [tool] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  async function start(args = { text: 'fictional' }) {
    return conversation.commit(async tx => {
      const entry = await tx.appendEntry(AssistantEntry, conversation.id, { model: [{ role: 'assistant',
        content: [{ type: 'toolCall', id: 'call', name: config.name, arguments: args }], api: 'fixture', provider: 'fixture', model: 'fictional-no-model', timestamp: 1, stopReason: 'toolUse',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      }] });
      return tx.createTask(ToolTask, { assistant: entry.id, callId: 'call' }, { ownership: { kind: 'conversation' } });
    }, context);
  }
  async function result(id) {
    const terminal = await harness.waitForTask(id, context);
    const entry = await conversation.commit(tx => tx.entry(ToolResultEntry, terminal.state.outcome.result.entryId), context);
    return entry.model[0];
  }
  return { harness, conversation, start, result, run: async args => result(await start(args)) };
}

for (const kind of ['applied', 'proposed', 'stale', 'conflict', 'denied', 'unavailable', 'unknown']) {
  test(`native presentation tool preserves ${kind} and formatter cannot mask a refusal`, async t => {
    let seen;
    const outcome = kind === 'applied' ? { kind, value: { secret: 'never-retained' } }
      : kind === 'proposed' ? { kind, proposalId: 'proposal', base: target() } : { kind, reason: 'fictional refusal' };
    const f = await fixture(t, options({ command: { name: 'command', input: { parse: value => value }, invoke: async () => outcome },
      formatResult: result => { seen = result; return formatResult(result); } }));
    const message = await f.run();
    assert.deepEqual(seen, outcome);
    assert.equal(message.isError === true, !['applied', 'proposed'].includes(kind));
    assert.deepEqual(JSON.parse(message.content[0].text), { kind });
    assert.doesNotMatch(JSON.stringify(message), /never-retained|private-note/);
  });
}

test('authorization uses the native caller on every invocation and cannot redirect the captured target', async t => {
  const captured = target(); let allowedCaller, calls = 0; const invoked = [];
  const f = await fixture(t, options({ target: captured,
    authorize: (_input, selected, api) => { calls++; selected.subject.document = 'auth-redirect'; return api.conversationId === allowedCaller; },
    command: { name: 'command', input: { parse: value => value }, invoke: async selected => { invoked.push(structuredClone(selected)); selected.subject.document = 'command-redirect'; return { kind: 'applied', value: undefined }; } },
  }));
  captured.subject.document = 'outside-redirect';
  assert.equal((await f.run()).isError, true);
  allowedCaller = f.conversation.id;
  await f.run(); await f.run();
  assert.equal(calls, 3);
  assert.deepEqual(invoked, [target(), target()]);
});

test('native schema and command parser reject invalid inputs before authorization or invocation', async t => {
  let authorizations = 0, invocations = 0, parsed = 0;
  const f = await fixture(t, options({ authorize: () => { authorizations++; return true; }, prepareInput: args => ({ selected: args.text }),
    command: { name: 'command', input: { parse: value => { parsed++; assert.equal(value.selected, 'fictional'); throw new Error('private parser detail'); } },
      invoke: async () => { invocations++; return { kind: 'applied', value: undefined }; } } }));
  assert.equal((await f.run({ text: {} })).isError, true);
  assert.equal(parsed, 0);
  const message = await f.run();
  assert.equal(message.isError, true); assert.doesNotMatch(JSON.stringify(message), /private parser detail/);
  assert.equal(parsed, 1); assert.equal(authorizations, 0); assert.equal(invocations, 0);
});

test('native cancellation during asynchronous authorization prevents invocation', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let invoked = 0, signal;
  const f = await fixture(t, options({ authorize: async (_input, _target, _api, ctx) => { signal = ctx.abortSignal; entered.resolve(); await release.promise; return true; },
    command: { name: 'command', input: { parse: value => value }, invoke: async () => { invoked++; return { kind: 'applied', value: undefined }; } } }));
  const id = await f.start(); const waiting = f.harness.waitForTask(id, context); await entered.promise;
  const stopping = f.harness.abortTask(id, context);
  if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  release.resolve(); await stopping;
  await waiting;
  assert.equal(invoked, 0);
});

test('command receives the native cancellation signal', async t => {
  let authorizedSignal; const entered = Promise.withResolvers();
  const f = await fixture(t, options({ authorize: (_input, _target, _api, ctx) => { authorizedSignal = ctx.abortSignal; return true; },
    command: { name: 'command', input: { parse: value => value }, invoke: async (_target, _input, signal) => {
      assert.equal(signal, authorizedSignal); entered.resolve();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      return { kind: 'denied', reason: 'cancelled' };
    } } }));
  const id = await f.start(); const waiting = f.harness.waitForTask(id, context); await entered.promise; await f.harness.abortTask(id, context);
  await waiting; assert.equal(authorizedSignal.aborted, true);
});

test('real Markdown inspection shares the controller target and becomes stale after a human edit', async t => {
  const controller = createMarkdownController({ identity: { scopeId: 'fictional', principalId: 'editor', initiatorId: 'alice' },
    source: { kind: 'new', target: { resource: { providerId: 'fictional', path: 'note.md' }, view: { kind: 'published' } }, text: 'private manuscript' },
    client: { read: async () => { throw new Error('unexpected read'); }, publish: async () => { throw new Error('unexpected publish'); }, lookup: async () => { throw new Error('unexpected lookup'); } },
    instanceId: 'markdown', epoch: 'mount' });
  t.after(() => controller.dispose());
  let inspected;
  const f = await fixture(t, options({ command: controller.tools.inspect, target: controller.actions.selection().target,
    prepareInput: () => ({ expiresAt: Date.now() + 60_000 }), formatResult: result => { inspected = result; return formatResult(result); } }));
  const message = await f.run(); assert.equal(inspected.kind, 'applied'); assert.equal(inspected.value.text, 'private manuscript');
  assert.doesNotMatch(JSON.stringify(message), /private manuscript/);
  controller.actions.edit('human changed text');
  assert.equal((await f.run()).isError, true); assert.equal(inspected.kind, 'stale');
});

test('hard kill after a viewer effect does not replay the unsafe command on native recovery', { timeout: 20000 }, async t => {
  const { mkdtemp, readFile, rm, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { spawn } = await import('node:child_process'); const { once } = await import('node:events');
  const directory = await mkdtemp(join(tmpdir(), 'fictional-presentation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = phase => spawn(process.execPath, [new URL('../fixtures/presentation-crash-child.mjs', import.meta.url).pathname, directory, phase], { stdio: 'ignore' });
  const holding = child('hold'); const exited = once(holding, 'exit'); t.after(() => holding.kill('SIGKILL'));
  const deadline = Date.now() + 10000;
  while (true) {
    try { await access(join(directory, 'ready')); await access(join(directory, 'task.json')); break; }
    catch { assert.equal(holding.exitCode, null, 'child exited before effect'); assert.ok(Date.now() < deadline, 'effect never reached'); await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  holding.kill('SIGKILL'); assert.deepEqual(await exited, [null, 'SIGKILL']);
  const recovering = child('recover'); t.after(() => recovering.kill('SIGKILL'));
  assert.deepEqual(await once(recovering, 'exit'), [0, null]);
  assert.equal(await readFile(join(directory, 'effects'), 'utf8'), 'effect\n');
  const terminal = JSON.parse(await readFile(join(directory, 'recovered.json'), 'utf8'));
  assert.equal(terminal.state.status, 'terminal'); assert.notEqual(terminal.state.outcome.status, 'completed');
  assert.match(JSON.stringify(terminal.state.outcome), /interrupt/i);
});

test('a truthy non-boolean authorization answer cannot grant command access', async t => {
  let invoked = 0;
  const f = await fixture(t, options({ authorize: () => 'allowed',
    command: { name: 'command', input: { parse: value => value }, invoke: async () => { invoked++; return { kind: 'applied', value: undefined }; } } }));
  assert.equal((await f.run()).isError, true);
  assert.equal(invoked, 0);
});

test('authorization and caller mutation cannot change the parsed command input', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const parsed = { selected: { document: 'original' } }; let invoked;
  const f = await fixture(t, options({
    authorize: async input => { input.selected.document = 'policy-redirect'; entered.resolve(); await release.promise; return true; },
    command: { name: 'command', input: { parse: () => parsed }, invoke: async (_target, input) => { invoked = input; return { kind: 'applied', value: undefined }; } },
  }));
  const id = await f.start(); const waiting = f.result(id); await entered.promise;
  parsed.selected.document = 'caller-redirect'; release.resolve();
  assert.equal((await waiting).isError, false);
  assert.deepEqual(invoked, { selected: { document: 'original' } });
});

test('a command ignoring cancellation cannot format its late result as applied', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(); let nativeSignal; const formatted = [];
  const f = await fixture(t, options({
    command: { name: 'command', input: { parse: value => value }, invoke: async (_target, _input, signal) => {
      nativeSignal = signal; entered.resolve(); await release.promise; return { kind: 'applied', value: 'late effect' };
    } }, formatResult: result => { formatted.push(result); return formatResult(result); },
  }));
  const id = await f.start(); const waiting = f.harness.waitForTask(id, context); await entered.promise;
  const stopping = f.harness.abortTask(id, context);
  if (!nativeSignal.aborted) await new Promise(resolve => nativeSignal.addEventListener('abort', resolve, { once: true }));
  release.resolve(); await stopping; await waiting;
  assert.deepEqual(formatted, []);
});

test('non-cloneable target and input fail without authorization or invocation', async t => {
  assert.throws(() => createPresentationTool(options({ target: { ...target(), subject: { callback: () => {} } } })), { name: 'DataCloneError' });
  let authorized = 0, invoked = 0, formatted = 0;
  const f = await fixture(t, options({ authorize: () => { authorized++; return true; },
    command: { name: 'command', input: { parse: () => ({ callback: () => {} }) }, invoke: async () => { invoked++; return { kind: 'applied', value: undefined }; } },
    formatResult: result => { formatted++; return formatResult(result); },
  }));
  assert.equal((await f.run()).isError, true);
  assert.equal(authorized, 0); assert.equal(invoked, 0); assert.equal(formatted, 0);
});
