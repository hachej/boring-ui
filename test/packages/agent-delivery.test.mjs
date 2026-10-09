import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry, defineExtension, defineTask } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createDocumentDelivery } from '@hachej/boring-agent/delivery';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { publicationDigest } from '@hachej/boring-files/publication';

const locator = { resource: { providerId: 'documents', path: 'report.md' }, view: { kind: 'published' } };
const identity = { principalId: 'editor', initiatorId: 'fictional-reviewer', scopeId: 'cabinet' };
async function fixture(t, options = {}) {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: options.authorize ?? (() => true) });
  let publishes = 0;
  const delivery = createDocumentDelivery({ operationNamespace: 'delivery-runtime', validationVersion: 'heading-v1',
    publisher: { publish: async (...args) => { publishes++; return provider.publication.publish(...args); } }, lookup: provider.reconciliation,
    resolveAccess: () => identity, validate: text => text.startsWith('# ') ? [] : ['A heading is required'], ...options.delivery });
  const producer = defineTask({ name: 'fixture.produce', version: 1, initial: () => ({ phase: 'produce' }), phases: {
    produce: async (running, runtime, ctx) => {
      if (options.beforeProduce) await options.beforeProduce(provider);
      await runtime.commit(() => ({ status: 'terminal', outcome: running.input.fail ? { status: 'failed', error: { name: 'FixtureFailure', message: 'Fictional producer failed' } }
        : { status: 'completed', result: running.input.text } }), ctx);
    },
  }, abort: async (_task, runtime, ctx) => runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx) });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.producer', tasks: [producer] }));
  registry.install(delivery.extension);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(async () => { await harness.close(context); provider.close(); });
  const conversation = await harness.root(context);
  const admit = (input, base = { kind: 'absent', target: locator }) => conversation.commit(tx => delivery.admit(tx,
    inner => inner.createTask(producer, input, { ownership: { kind: 'conversation' } }), base, { ownership: { kind: 'conversation' } }, context), context);
  const result = async binding => (await harness.waitForTask(binding.delivery, context)).state.outcome;
  return { provider, harness, conversation, delivery, producer, admit, result, publications: () => publishes };
}

test('native producer and delivery commit together, validate actual output and publish once without a browser', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const binding = await f.admit({ text: '# Fictional result' });
  const graph = await f.harness.inspect(context);
  assert.equal(graph.tasks.length, 2);
  const outcome = await f.result(binding);
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.result.kind, 'committed');
  assert.equal(outcome.result.receipt.operationId, binding.operationId);
  assert.equal(f.publications(), 1);
  const read = await f.provider.read({ target: locator, revision: { kind: 'latest' } }, identity);
  assert.equal(new TextDecoder().decode(read.snapshot.bytes), '# Fictional result');
  assert.deepEqual(await f.provider.reconciliation.lookup(binding.operationId, identity), outcome.result);
});

test('native delivery publishes producer text with leading Unicode scalar and astral character unchanged', { timeout: 10000 }, async t => {
  const text = '\uFEFF# Fictional \u{1F642}';
  let validated;
  const f = await fixture(t, { delivery: { validate: value => { validated = value; return value === text ? [] : ['Unexpected producer text']; } } });
  const outcome = await f.result(await f.admit({ text }));
  assert.equal(validated, text);
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.result.kind, 'committed');
  const read = await f.provider.read({ target: locator, revision: { kind: 'latest' } }, identity);
  assert.deepEqual(read.snapshot.bytes, new TextEncoder().encode(text));
});

test('failed producer and rejected validation never publish', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  for (const [input, expected] of [[{ fail: true }, 'producer-failed'], [{ text: 'missing heading' }, 'invalid'], [{ text: 42 }, 'invalid'], [{ text: '# lone \ud800' }, 'invalid']]) {
    assert.equal((await f.result(await f.admit(input))).result.kind, expected);
  }
  assert.equal(f.publications(), 0);
});

test('the pre-production document base protects intervening human edits', { timeout: 10000 }, async t => {
  const f = await fixture(t, { beforeProduce: provider => provider.publication.publish({ operationId: 'human-edit', atomicity: 'all-or-nothing', changes: [
    { kind: 'create', target: locator, expected: { kind: 'absent' }, bytes: new TextEncoder().encode('Human text'), mediaType: 'text/markdown' },
  ] }, identity) });
  assert.equal((await f.result(await f.admit({ text: '# Generated text' }))).result.kind, 'conflict');
  const read = await f.provider.read({ target: locator, revision: { kind: 'latest' } }, identity);
  assert.equal(new TextDecoder().decode(read.snapshot.bytes), 'Human text');
});

test('an exception after delivery admission rolls back both native obligations', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(f.conversation.commit(async tx => {
    await f.delivery.admit(tx, inner => inner.createTask(f.producer, { text: '# result' }, { ownership: { kind: 'conversation' } }),
      { kind: 'absent', target: locator }, { ownership: { kind: 'conversation' } }, context);
    throw new Error('Admission failed');
  }, context), /Admission failed/);
  assert.equal((await f.harness.inspect(context)).tasks.length, 0);
  assert.equal(f.publications(), 0);
});

test('revoked publication is denied and forged foreign receipts cannot mark delivery committed', { timeout: 10000 }, async t => {
  const denied = await fixture(t, { authorize: () => false });
  assert.equal((await denied.result(await denied.admit({ text: '# result' }))).result.kind, 'denied');
  const forged = await fixture(t, { delivery: { publisher: { publish: async () => ({ kind: 'committed', receipt: {} }) } } });
  assert.equal((await forged.result(await forged.admit({ text: '# result' }))).result.kind, 'unknown');
});

test('delivery accepts a receipt whose before and after revisions are equal', { timeout: 10000 }, async t => {
  const base = { ...locator, revision: 'unchanged-revision' };
  const publisher = { publish: async request => ({ kind: 'committed', receipt: {
    operationId: request.operationId, argumentDigest: await publicationDigest(request), ...identity,
    evidenceRef: 'fictional-evidence', changes: [{ kind: 'replace', before: base, after: base }],
  } }) };
  const f = await fixture(t, { delivery: { publisher } });
  const outcome = await f.result(await f.admit({ text: '# Same bytes' }, { kind: 'revision', target: base }));
  assert.equal(outcome.result.kind, 'committed');
  assert.equal(outcome.result.receipt.changes[0].after.revision, 'unchanged-revision');
});

test('malformed JavaScript validator results cannot admit publication', { timeout: 10000 }, async t => {
  for (const value of ['', true, {}, Promise.resolve([]), [false]]) {
    const f = await fixture(t, { delivery: { validate: () => value } });
    const outcome = await f.result(await f.admit({ text: '# Fictional unchecked output' }));
    assert.equal(outcome.status, 'completed');
    assert.deepEqual(outcome.result, { kind: 'invalid', errors: ['Validator must return an array of errors'] });
    assert.equal(f.publications(), 0);
  }
});

async function createGuard(provider, path) {
  const target = { ...locator, resource: { ...locator.resource, path } };
  const result = await provider.publication.publish({ operationId: `create-${path}`, atomicity: 'all-or-nothing', changes: [
    { kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode('generation-original'), mediaType: 'text/plain' },
  ] }, identity);
  assert.equal(result.kind, 'committed');
  return { kind: 'revision', target: result.receipt.changes[0].after };
}

async function advanceGuard(provider, guard) {
  const result = await provider.publication.publish({ operationId: `advance-${guard.target.resource.path}`, atomicity: 'all-or-nothing', changes: [
    { kind: 'replace', target: guard.target, bytes: new TextEncoder().encode('generation-new'), mediaType: 'text/plain' },
  ] }, identity);
  assert.equal(result.kind, 'committed');
  return result.receipt.changes[0].after;
}

test('delivery includes admitted guard and edit revisions in the actual publication receipt digest', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const guards = [await createGuard(f.provider, 'generation'), await createGuard(f.provider, 'human-edit')];
  const binding = await f.admit({ text: '# Guarded output' }, { kind: 'absent', target: locator, preconditions: guards });
  const result = (await f.result(binding)).result;
  assert.equal(result.kind, 'committed');
  assert.equal(result.receipt.argumentDigest, await publicationDigest({ operationId: binding.operationId, atomicity: 'all-or-nothing', preconditions: guards,
    changes: [{ kind: 'create', target: locator, expected: { kind: 'absent' }, bytes: new TextEncoder().encode('# Guarded output'), mediaType: 'text/markdown' }] }));
  const task = await f.harness.getTask(binding.delivery, context);
  assert.equal(task.version, 2);
  assert.deepEqual(task.input.preconditions, guards);
});

for (const changed of ['generation', 'human-edit']) {
  test(`delivery refuses a changed ${changed} guard without writing output or a receipt`, { timeout: 10000 }, async t => {
    let guards;
    const f = await fixture(t, { beforeProduce: provider => advanceGuard(provider, guards[changed === 'generation' ? 0 : 1]) });
    guards = [await createGuard(f.provider, 'generation'), await createGuard(f.provider, 'human-edit')];
    const binding = await f.admit({ text: '# Stale output' }, { kind: 'absent', target: locator, preconditions: guards });
    assert.equal((await f.result(binding)).result.kind, 'conflict');
    assert.equal((await f.provider.read({ target: locator, revision: { kind: 'latest' } }, identity)).kind, 'missing');
    assert.equal((await f.provider.reconciliation.lookup(binding.operationId, identity)).kind, 'not-found');
  });
}

test('delivery captures guards before an asynchronous producer creator can mutate admission arguments', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const original = await createGuard(f.provider, 'generation');
  const target = { kind: 'absent', target: structuredClone(locator), preconditions: [structuredClone(original)] };
  const binding = await f.conversation.commit(tx => f.delivery.admit(tx, async inner => {
    await Promise.resolve();
    target.target.resource.path = 'substituted.md';
    target.preconditions[0].target.revision = 'substituted-revision';
    target.preconditions.length = 0;
    return inner.createTask(f.producer, { text: '# Original binding' }, { ownership: { kind: 'conversation' } });
  }, target, { ownership: { kind: 'conversation' } }, context), context);
  const result = (await f.result(binding)).result;
  assert.equal(result.kind, 'committed');
  assert.equal(result.receipt.changes[0].after.resource.path, 'report.md');
  assert.deepEqual((await f.harness.getTask(binding.delivery, context)).input.preconditions, [original]);
});

test('malformed delivery preconditions refuse admission before producer creation', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  let called = 0;
  for (const preconditions of [null, {}, [null], Array(1), [{ kind: 'revision', target: locator }], [{ kind: 'latest', target: locator }]]) {
    await assert.rejects(f.conversation.commit(tx => f.delivery.admit(tx, async inner => {
      called++;
      return inner.createTask(f.producer, { text: '# Unchecked' }, { ownership: { kind: 'conversation' } });
    }, { kind: 'absent', target: locator, preconditions }, { ownership: { kind: 'conversation' } }, context), context), TypeError);
  }
  assert.equal(called, 0);
  assert.equal((await f.harness.inspect(context)).tasks.length, 0);
  assert.equal(f.publications(), 0);
});

test('independent subject guards allow a sibling delivery after one generation is superseded', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const a = await createGuard(f.provider, 'subject-a'), b = await createGuard(f.provider, 'subject-b');
  await advanceGuard(f.provider, a);
  const aBinding = await f.admit({ text: '# Obsolete A' }, { kind: 'absent', target: locator, preconditions: [a] });
  const bLocator = { ...locator, resource: { ...locator.resource, path: 'b.md' } };
  const bBinding = await f.admit({ text: '# Current B' }, { kind: 'absent', target: bLocator, preconditions: [b] });
  assert.equal((await f.result(bBinding)).result.kind, 'committed');
  assert.equal((await f.result(aBinding)).result.kind, 'conflict');
  const read = await f.provider.read({ target: bLocator, revision: { kind: 'latest' } }, identity);
  assert.equal(new TextDecoder().decode(read.snapshot.bytes), '# Current B');
});

test('explicit admission identity supports async native producer lookup and distinct original actors', { timeout: 10000 }, async t => {
  let f;
  const resolved = [];
  f = await fixture(t, { delivery: { resolveAccess: async (_target, id, ctx) => {
    const task = await f.harness.getTask(id, ctx);
    resolved.push(id);
    return task.input.actor;
  } } });
  for (const principalId of ['first-editor', 'second-editor']) {
    const actor = { ...identity, principalId };
    const originalActor = { ...actor };
    const binding = await f.conversation.commit(tx => f.delivery.admit(tx,
      async inner => {
        await Promise.resolve();
        actor.principalId = 'changed-during-admission';
        return inner.createTask(f.producer, { text: '# Original actor', actor: originalActor }, { ownership: { kind: 'conversation' } });
      },
      { kind: 'absent', target: { ...locator, resource: { ...locator.resource, path: `${principalId}.md` } } },
      { ownership: { kind: 'conversation' } }, context, actor), context);
    const outcome = await f.result(binding);
    assert.equal(outcome.result.kind, 'committed');
    assert.equal(outcome.result.receipt.principalId, principalId);
    assert.equal(outcome.result.receipt.initiatorId, identity.initiatorId);
    assert.equal(resolved.filter(id => id === binding.producer).length, 1);
  }
});

test('a rejected async admission resolver rolls back native producer creation', { timeout: 10000 }, async t => {
  const f = await fixture(t, { delivery: { resolveAccess: async () => { throw new Error('Identity unavailable'); } } });
  await assert.rejects(f.admit({ text: '# Not admitted' }), /Identity unavailable/);
  assert.equal((await f.harness.inspect(context)).tasks.length, 0);
  assert.equal(f.publications(), 0);
});

test('publisher mutation cannot change the admitted receipt digest', { timeout: 10000 }, async t => {
  let f;
  f = await fixture(t, { delivery: { publisher: { publish: async (request, access) => {
    request.changes[0].bytes.fill(88);
    return f.provider.publication.publish(request, access);
  } } } });
  const outcome = await f.result(await f.admit({ text: '# Approved' }));
  assert.equal(outcome.result.kind, 'unknown');
  const read = await f.provider.read({ target: locator, revision: { kind: 'latest' } }, identity);
  assert.equal(new TextDecoder().decode(read.snapshot.bytes), 'XXXXXXXXXX');
});
