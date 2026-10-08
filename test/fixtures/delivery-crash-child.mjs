import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Harness, createRegistry, defineExtension, defineTask } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createDocumentDelivery } from '@hachej/boring-agent/delivery';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

const [directory, phase, mode] = process.argv.slice(2);
const access = { scopeId: phase === 'recover' && mode === 'changed-scope' ? 'other' : 'cabinet', principalId: 'editor', initiatorId: 'fictional-reviewer' };
const provider = openSqliteWorkspaces({ filename: join(directory, 'documents.sqlite'), providerId: 'documents', authorize: () => !(phase === 'recover' && mode === 'revoked') });
let publishes = 0;
let binding;
let harness;
async function hold(result) {
  const task = await harness.getTask(binding.delivery, context);
  writeFileSync(join(directory, 'ready.json'), JSON.stringify({ binding, task, result }));
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
const delivery = createDocumentDelivery({
  operationNamespace: phase === 'recover' && mode === 'changed-namespace' ? 'other' : 'delivery-runtime',
  validationVersion: phase === 'recover' && mode === 'changed-validator' ? 'v2' : 'v1',
  replay: ['safe-replay', 'safe-replay-mutable-actor'].includes(mode) ? 'safe' : 'reconcile-only',
  resolveAccess: async () => access, validate: text => text.startsWith('# ') ? [] : ['Heading required'],
  publisher: { publish: async (...args) => {
    publishes++;
    const result = await provider.publication.publish(...args);
    if (phase === 'hold') await hold(result);
    return result;
  } },
  lookup: { lookup: async (...args) => {
    if (phase === 'recover' && ['not-found', 'safe-replay', 'safe-replay-mutable-actor'].includes(mode)) {
      if (mode === 'safe-replay-mutable-actor') access.initiatorId = 'mutated-during-lookup';
      return { kind: 'not-found' };
    }
    return provider.reconciliation.lookup(...args);
  } },
});
const producer = defineTask({ name: 'fixture.delivery-producer', version: 1, initial: () => ({ phase: 'produce' }), phases: {
  produce: async (_task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: '# Fictional durable result' } }), ctx),
}, abort: async (_task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
const wrapped = defineTask({ ...delivery.task.definition, phases: { ...delivery.task.definition.phases, publish: async (...args) => {
  if (phase === 'hold' && mode === 'before-publication') await hold(null);
  await delivery.task.definition.phases.publish(...args);
} } });
const registry = createRegistry();
registry.install(defineExtension({ name: 'fixture.delivery', tasks: [producer, wrapped] }));
harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
const conversation = await harness.root(context);
binding = phase === 'hold' ? await conversation.commit(tx => delivery.admit(tx,
  inner => inner.createTask(producer, {}, { ownership: { kind: 'conversation' } }),
  { kind: 'absent', target: { resource: { providerId: 'documents', path: 'report.md' }, view: { kind: 'published' } } },
  { ownership: { kind: 'conversation' } }, context), context)
  : JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8')).binding;
const terminal = await harness.waitForTask(binding.delivery, context);
writeFileSync(join(directory, 'recovered.json'), JSON.stringify({ terminal, publishes }));
await harness.close(context);
provider.close();
