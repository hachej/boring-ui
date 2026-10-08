import assert from 'node:assert/strict';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Harness, createRegistry, defineExtension, defineTask } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createDocumentDelivery } from '@hachej/boring-agent/delivery';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

const [directory, phase, mode] = process.argv.slice(2);
assert.ok(directory && ['hold', 'recover', 'downgrade'].includes(phase)
  && ['after', 'before', 'v1-wait', 'v1-validate', 'v1-after', 'v1-malformed'].includes(mode));
const old = mode.startsWith('v1-');
const access = { scopeId: 'cabinet', principalId: 'editor', initiatorId: 'fictional-reviewer' };
const output = { resource: { providerId: 'documents', path: 'report.md' }, view: { kind: 'published' } };
const guard = { resource: { providerId: 'documents', path: 'approval.txt' }, view: { kind: 'published' } };
const namespace = old ? 'legacy\nnamespace' : 'guarded-delivery';
const validationVersion = old ? 'v'.repeat(1100) : 'heading-v1';
const provider = openSqliteWorkspaces({ filename: join(directory, 'documents.sqlite'), providerId: 'documents', authorize: () => true });
let harness, binding, publishes = 0;
const checkpoint = async result => {
  const task = await harness.getTask(binding.delivery, context);
  const marker = { binding, ...(old ? {} : { guard: JSON.parse(readFileSync(join(directory, 'guard.json'), 'utf8')) }), task, result };
  writeFileSync(join(directory, 'ready.tmp'), JSON.stringify(marker));
  renameSync(join(directory, 'ready.tmp'), join(directory, 'ready.json'));
  setInterval(() => {}, 1000);
  await new Promise(() => {});
};
const delivery = createDocumentDelivery({ operationNamespace: namespace, validationVersion,
  replay: 'reconcile-only', resolveAccess: () => access,
  validate: text => text.startsWith('# ') ? [] : ['Heading required'],
  publisher: { publish: async (...args) => {
    publishes++;
    const result = await provider.publication.publish(...args);
    if (phase === 'hold' && mode === 'after') await checkpoint(result);
    return result;
  } },
  lookup: provider.reconciliation,
});
const producer = defineTask({ name: 'fixture.guarded-producer', version: 1, initial: () => ({ phase: 'produce' }), phases: {
  produce: async (_task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: old ? '# Fictional unguarded result' : '# Fictional guarded result' } }), ctx),
}, abort: async (_task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
const legacy = defineTask({ name: 'boring.documents.deliver', version: 1,
  initial: () => ({ phase: 'wait' }),
  phases: {
    wait: async (...args) => {
      if (phase === 'hold' && ['v1-wait', 'v1-malformed'].includes(mode)) await checkpoint(null);
      await delivery.task.definition.phases.wait(...args);
    },
    validate: async (...args) => {
      if (phase === 'hold' && mode === 'v1-validate') await checkpoint(null);
      await delivery.task.definition.phases.validate(...args);
    },
    publish: async (running, runtime, ctx) => {
      const id = JSON.stringify([running.input.namespace, runtime.taskId]);
      const request = { operationId: id, atomicity: 'all-or-nothing', changes: [
        { kind: 'create', target: running.input.target.target, expected: { kind: 'absent' },
          bytes: new TextEncoder().encode(running.state.checkpoint.text), mediaType: 'text/markdown' },
      ] };
      await runtime.memo('boring.delivery.attempted.v1', true, ctx);
      const result = await provider.publication.publish(request, access);
      if (phase === 'hold' && mode === 'v1-after') await checkpoint(result);
      await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result } }), ctx);
    },
  },
  abort: async (_task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
const wrapped = defineTask({ ...delivery.task.definition, phases: { ...delivery.task.definition.phases, publish: async (...args) => {
  if (phase === 'hold' && mode === 'before') await checkpoint(null);
  await delivery.task.definition.phases.publish(...args);
} } });
const registry = createRegistry();
registry.install(defineExtension({ name: 'fixture.guarded-delivery', tasks: [producer, phase === 'downgrade' || phase === 'hold' && old ? legacy : wrapped] }));
try {
  if (phase === 'hold' && !old) {
    const created = await provider.publication.publish({ operationId: 'create-guard', atomicity: 'all-or-nothing', changes: [
      { kind: 'create', target: guard, expected: { kind: 'absent' }, bytes: new TextEncoder().encode('approved generation 1'), mediaType: 'text/plain' },
    ] }, access);
    assert.equal(created.kind, 'committed');
    writeFileSync(join(directory, 'guard.json'), JSON.stringify(created.receipt.changes[0].after));
  }
  harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
  const conversation = await harness.root(context);
  binding = phase === 'hold' ? old ? await conversation.commit(async tx => {
    const oldProducer = await tx.createTask(producer, {}, { ownership: { kind: 'conversation' } });
    const oldDelivery = await tx.createTask(legacy, { producer: oldProducer, target: { kind: 'absent', target: output },
      ...(mode === 'v1-malformed' ? { preconditions: [] } : {}),
      identity: { ...access, authorizationRef: null }, namespace, validationVersion },
    { ownership: { kind: 'conversation' } });
    return { producer: oldProducer, delivery: oldDelivery, operationId: JSON.stringify([namespace, oldDelivery]) };
  }, context) : await conversation.commit(tx => delivery.admit(tx,
    inner => inner.createTask(producer, {}, { ownership: { kind: 'conversation' } }),
    { kind: 'absent', target: output, preconditions: [{ kind: 'revision', target: JSON.parse(readFileSync(join(directory, 'guard.json'), 'utf8')) }] },
    { ownership: { kind: 'conversation' } }, context), context)
    : JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8')).binding;
  if (phase === 'downgrade') {
    harness.resume();
    const witnessId = await conversation.commit(tx => tx.createTask(producer, {}, { ownership: { kind: 'conversation' } }), context);
    const witness = await harness.waitForTask(witnessId, context);
    const inspection = await harness.inspect(context);
    writeFileSync(join(directory, 'downgrade.json'), JSON.stringify({ inspection, witness, task: await harness.getTask(binding.delivery, context) }));
  } else if (phase === 'recover' && mode === 'v1-malformed') {
    harness.resume();
    const deadline = Date.now() + 5000;
    let blocked;
    while (Date.now() < deadline) {
      const inspection = await harness.inspect(context);
      blocked = inspection.tasks.find(item => item.record.id === binding.delivery);
      if (blocked?.state.kind === 'blocked') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    writeFileSync(join(directory, 'migration.json'), JSON.stringify({ blocked, task: await harness.getTask(binding.delivery, context), publishes }));
  } else {
    const terminal = await harness.waitForTask(binding.delivery, context);
    writeFileSync(join(directory, 'recovered.json'), JSON.stringify({ terminal, publishes }));
  }
} finally {
  if (harness) await harness.close(context);
  provider.close();
}
