import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry, defineExtension, defineTask } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createDocumentDelivery } from '@hachej/boring-agent/delivery';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

const actor = { principalId: 'fictional-editor', initiatorId: 'fictional-person', scopeId: 'fictional-scope' };
const target = { resource: { providerId: 'fictional', path: 'document.md' }, view: { kind: 'published' } };

for (const mismatch of ['resource', 'content', 'principal', 'resolver', 'none']) {
  test(`abort recovery validates the admitted delivery: ${mismatch}`, { timeout: 10000 }, async () => {
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional', authorize: () => true });
    const published = Promise.withResolvers(), release = Promise.withResolvers(), aborted = Promise.withResolvers();
    let attempted = false;
    const delivery = createDocumentDelivery({
      operationNamespace: 'fictional-delivery', validationVersion: 'v1', validate: () => [], lookup: provider.reconciliation,
      resolveAccess: () => attempted && mismatch === 'resolver' ? { ...actor, principalId: '' } : actor,
      publisher: { publish: async (request, access) => {
        const change = request.changes[0];
        const altered = { ...request, changes: [{ ...change,
          ...(mismatch === 'resource' ? { target: { ...target, resource: { ...target.resource, path: 'other.md' } } } : {}),
          ...(mismatch === 'content' ? { bytes: new TextEncoder().encode('Unrelated fictional output') } : {}),
        }] };
        const receipt = await provider.publication.publish(altered, mismatch === 'principal' ? { ...access, principalId: 'other-person' } : access);
        assert.equal(receipt.kind, 'committed');
        attempted = true;
        access.signal.addEventListener('abort', () => aborted.resolve(), { once: true });
        published.resolve();
        await release.promise;
        return receipt;
      } },
    });
    const producer = defineTask({ name: 'fictional.produce', version: 1, initial: () => ({ phase: 'run' }), phases: {
      run: async (_, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: '# Fictional' } }), ctx),
    } });
    const registry = createRegistry();
    registry.install(defineExtension({ name: 'fictional.producer', tasks: [producer] }));
    registry.install(delivery.extension);
    const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
    try {
      const conversation = await harness.root(context);
      const binding = await conversation.commit(tx => delivery.admit(tx,
        inner => inner.createTask(producer, {}, { ownership: { kind: 'conversation' } }),
        { kind: 'absent', target }, { ownership: { kind: 'conversation' } }, context), context);
      const waiting = harness.waitForTask(binding.delivery, context);
      waiting.catch(() => {});
      await published.promise;
      const stopping = harness.abortTask(binding.delivery, context);
      await aborted.promise;
      release.resolve();
      await stopping;
      const terminal = await waiting;
      assert.equal(terminal.state.outcome.status, 'completed');
      assert.equal(terminal.state.outcome.result.kind, mismatch === 'none' ? 'committed' : 'unknown');
      const read = await provider.read({ target, revision: { kind: 'latest' } }, actor);
      assert.equal(read.kind, mismatch === 'resource' ? 'missing' : 'available');
      if (mismatch === 'none') assert.equal(new TextDecoder().decode(read.snapshot.bytes), '# Fictional');
    } finally {
      release.resolve();
      await harness.close(context);
      provider.close();
    }
  });
}
