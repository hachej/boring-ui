import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { Harness, MemoryStorage, createRegistry, defineExtension, defineTask } from '@earendil-works/pi-durable';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { createModels } from '@earendil-works/pi-ai/models';

// These execute the actual pinned native package without a model call. They
// qualify our reuse assumptions, NOT an unimplemented Boring adapter/runtime.
test('native watches preserve async delivery, operations, close reasons and independent cleanup', { timeout: 15000 }, async () => {
  const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry: createRegistry() }, context);
  const watches = [];
  try {
    const conversation = await harness.root(context);
    const a = await conversation.watch(context), b = await conversation.watch(context);
    watches.push(a, b);
    const aFirst = Promise.withResolvers(), bFirst = Promise.withResolvers(), bSecond = Promise.withResolvers();
    const releaseFirst = Promise.withResolvers();
    let bCalls = 0;
    a.start(async (_value, ops) => { assert.ok(Array.isArray(ops)); aFirst.resolve(); });
    b.start(async (_value, ops, ctx) => {
      assert.ok(Array.isArray(ops)); assert.ok(ctx);
      bCalls++;
      if (bCalls === 1) { bFirst.resolve(); await releaseFirst.promise; }
      else bSecond.resolve();
    });
    await conversation.configure({ instructions: 'first' }, context);
    await Promise.all([aFirst.promise, bFirst.promise]);
    await conversation.configure({ instructions: 'second' }, context);
    // A slow listener owns one callback; subsequent frames must await it.
    assert.equal(bCalls, 1);
    assert.equal((await a.stop()).reason, 'stopped');
    assert.equal((await a.closed).reason, 'stopped');
    releaseFirst.resolve();
    await bSecond.promise;
    assert.ok(bCalls >= 2, 'stopping a must not stop b');
    const before = b.value;
    assert.ok(before);
    assert.equal((await b.stop()).reason, 'stopped');
    assert.equal((await b.closed).reason, 'stopped');
    await conversation.configure({ instructions: 'still usable after both observers stop' }, context);
    assert.ok(await conversation.agent(context));
  } finally {
    for (const watch of watches) await watch.stop();
    await harness.close(context);
  }
});

test('native env factory preserves per-conversation cwd, Context, async and no-environment cases', { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-native-env-audit-'));
  const a = join(directory, 'a'), b = join(directory, 'b');
  mkdirSync(a); mkdirSync(b);
  writeFileSync(join(a, 'identity.txt'), 'A'); writeFileSync(join(b, 'identity.txt'), 'B');
  const envs = [], calls = [];
  const registry = createRegistry();
  const inspect = defineTask({
    name: 'audit.inspect-environment', version: 1,
    initial: () => ({ phase: 'inspect' }),
    phases: {
      inspect: async (_task, runtime, ctx) => {
        const env = await runtime.env(ctx);
        let result = { namespace: null, text: null };
        if (env) {
          const read = await env.readTextFile('identity.txt', ctx);
          if (!read.ok) throw read.error;
          result = { namespace: env.id, text: read.value };
        }
        await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result } }), ctx);
      },
    },
    abort: async (_task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx),
  });
  registry.install(defineExtension({ name: 'audit.environment', tasks: [inspect] }));
  const harness = await Harness.open(new MemoryStorage(), {
    models: createModels(), registry,
    env: async (target, ctx) => {
      assert.ok(ctx); assert.equal(typeof target.read.snapshot, 'function');
      calls.push({ conversationId: target.conversationId, cwd: target.cwd });
      if (!target.cwd) return undefined;
      const env = new NodeExecutionEnv({ cwd: target.cwd }); envs.push(env); return env;
    },
  }, context);
  const run = async (conversation) => {
    const id = await conversation.commit(tx => tx.createTask(inspect, {}, { ownership: { kind: 'conversation' } }), context);
    const terminal = await harness.waitForTask(id, context);
    assert.equal(terminal.state.outcome.status, 'completed', JSON.stringify(terminal.state.outcome));
    return terminal.state.outcome.result;
  };
  try {
    const first = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { cwd: a } }, context);
    const second = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { cwd: b } }, context);
    const none = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
    const [one, two, absent] = await Promise.all([run(first), run(second), run(none)]);
    assert.equal(one.text, 'A'); assert.equal(two.text, 'B'); assert.equal(absent.text, null);
    assert.equal(one.namespace, two.namespace, 'cwd is not a different local namespace');
    await first.configure({ cwd: b }, context);
    assert.equal((await run(first)).text, 'B', 'factory must honor the current native cwd');
    assert.ok(calls.some(call => call.conversationId === none.id && call.cwd === undefined));
  } finally {
    await harness.close(context);
    for (const env of envs) await env.cleanup(context);
    rmSync(directory, { recursive: true, force: true });
  }
});
