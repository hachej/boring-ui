import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, createRegistry, defineDoc } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { fixtureActor, fixtureRequest, PRIVATE_MARKERS, openFixtureApp } from '../../examples/current-hub/app.mjs';
import { provisionFixtureDefinition } from '../../examples/current-hub/definition.mjs';
import { openFixtureCompanion } from '../../examples/current-hub/companion.mjs';
import { admitDocumentTool, documentToolResult } from '../fixtures/native-document.mjs';
import { scanHubRetention } from '../fixtures/hub-retention.mjs';

const actor = fixtureActor('amber');
const request = id => fixtureRequest('amber', id);
const gate = () => Promise.withResolvers();
async function tasks(storage) {
  const found = []; let cursor;
  do {
    const page = await storage.scanTasks({}, 100, cursor, context);
    found.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);
  return found;
}
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'boring-hub-definition-'));
  const appDirectory = join(directory, 'amber');
  const definitionRef = options.definition === false ? undefined : await provisionFixtureDefinition({
    directory: appDirectory, appId: 'amber', ...(options.definition ?? {}),
  });
  let app = await openFixtureApp({ directory: appDirectory, appId: 'amber',
    ...(definitionRef === undefined ? {} : { definitionRef }), ...(options.app ?? {}) });
  t.after(async () => { await app?.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, appDirectory, definitionRef, get app() { return app; }, set app(value) { app = value; } };
}
async function published(app, ref) {
  await app.local.harness.waitForTask(ref.delivery, context);
  const observed = await app.observe(ref, actor);
  assert.equal(observed.kind, 'observed');
  const access = { scopeId: actor.scopeId, principalId: actor.principalId, initiatorId: actor.initiatorId,
    authorizationRef: actor.installationId };
  const outcome = await app.local.provider.reconciliation.lookup(ref.operationId, access);
  const saved = outcome.kind === 'committed'
    ? await app.local.provider.read({ target: outcome.receipt.changes[0].after, revision: { kind: 'latest' } }, access)
    : undefined;
  return { observed, outcome, saved };
}

test('a data definition configures an actual native ToolTask before the app publishes its private result', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const before = await tasks(f.app.local.storage);
  assert.equal(before.length, 0);
  const admitted = await f.app.invoke(request('configured'), actor);
  assert.equal(admitted.kind, 'admitted');
  const binding = await f.app.local.definitionBinding();
  assert.deepEqual(binding.ref, f.definitionRef);
  assert.deepEqual(binding.tools, [{ name: 'prepare_report', implementationVersion: 'prepare-report-v1' }]);
  assert.equal(binding.implementationVersion, 'fixture-app-v2');
  const result = await published(f.app, admitted.ref);
  assert.equal(result.observed.status, 'completed');
  assert.equal(result.observed.publication, 'committed');
  assert.equal(result.outcome.kind, 'committed');
  assert.equal(result.saved.kind, 'available');
  const output = new TextDecoder().decode(result.saved.snapshot.bytes);
  for (const marker of [PRIVATE_MARKERS.amber.definition, PRIVATE_MARKERS.amber.input, PRIVATE_MARKERS.amber.result]) {
    assert.ok(output.includes(marker));
  }
  const native = await tasks(f.app.local.storage);
  assert.equal(native.length, 3);
  assert.ok([admitted.ref.producer, admitted.ref.delivery].every(id => native.some(task => task.id === id)));
  const entries = (await f.app.local.conversation.context(context)).entries;
  assert.ok(entries.some(entry => entry.model?.some(message => Array.isArray(message.content)
    && message.content.some(block => block.type === 'toolCall' && block.name === 'prepare_report'))));
});

test('missing, refused and tool-free definitions admit no native work', { timeout: 15000 }, async t => {
  const missing = await fixture(t, { definition: false });
  assert.ok(['unavailable', 'unsupported'].includes((await missing.app.invoke(request('missing'), actor)).kind));
  assert.equal((await tasks(missing.app.local.storage)).length, 0);

  const refused = await fixture(t, { app: { policy: (_actor, action) => action !== 'read-definition' } });
  assert.ok(['unavailable', 'unsupported'].includes((await refused.app.invoke(request('refused'), actor)).kind));
  assert.equal((await tasks(refused.app.local.storage)).length, 0);

  const empty = await fixture(t, { definition: { tools: [] } });
  assert.ok(['unavailable', 'unsupported'].includes((await empty.app.invoke(request('no-tool'), actor)).kind));
  assert.equal((await tasks(empty.app.local.storage)).length, 0);
});

test('the first exact definition remains pinned when latest changes and a reopened caller supplies the newer ref', { timeout: 20000 }, async t => {
  const f = await fixture(t, { definition: { instructions: '# Pinned A fictional instructions' } });
  const first = await f.app.invoke(request('pinned-a'), actor);
  assert.equal(first.kind, 'admitted');
  assert.equal((await published(f.app, first.ref)).outcome.kind, 'committed');
  const original = await f.app.local.definitionBinding();
  await f.app.close();
  const newer = await provisionFixtureDefinition({ directory: f.appDirectory, appId: 'amber',
    instructions: '# Newer B fictional instructions', expected: f.definitionRef });
  f.app = await openFixtureApp({ directory: f.appDirectory, appId: 'amber', definitionRef: newer });
  assert.deepEqual(await f.app.local.definitionBinding(), original);
  const second = await f.app.invoke(request('still-pinned-a'), actor);
  assert.equal(second.kind, 'admitted');
  const result = await published(f.app, second.ref);
  assert.equal(result.outcome.kind, 'committed');
  const text = new TextDecoder().decode(result.saved.snapshot.bytes);
  assert.ok(text.includes('Pinned A fictional instructions'));
  assert.equal(text.includes('Newer B fictional instructions'), false);
  assert.deepEqual(await f.app.local.definitionBinding(), original);
});

test('changed host or tool implementation identity cannot replace an already bound definition', { timeout: 15000 }, async t => {
  for (const changed of [{ implementationVersion: 'fixture-app-v3' }, { toolImplementationVersion: 'prepare-report-v2' }]) {
    const f = await fixture(t);
    const first = await f.app.invoke(request('bind-once'), actor);
    assert.equal(first.kind, 'admitted');
    await f.app.local.harness.waitForTask(first.ref.delivery, context);
    await f.app.close();
    f.app = await openFixtureApp({ directory: f.appDirectory, appId: 'amber', definitionRef: f.definitionRef, ...changed });
    const before = await tasks(f.app.local.storage);
    const attempted = await f.app.invoke(request('must-refuse-new-version'), actor);
    assert.ok(['unavailable', 'unsupported'].includes(attempted.kind));
    assert.equal((await tasks(f.app.local.storage)).length, before.length);
  }
});

test('definition read and execution revocation block admitted work without publishing a result', { timeout: 20000 }, async t => {
  for (const revokedAction of ['read-definition', 'execute']) {
    const reached = gate(), release = gate();
    let allowed = true;
    const f = await fixture(t, { app: { policy: (_actor, action) => action !== revokedAction || allowed,
      beforeProduce: async () => { reached.resolve(); await release.promise; } } });
    const admitted = await f.app.invoke(request(`revoke-${revokedAction}`), actor);
    assert.equal(admitted.kind, 'admitted');
    await reached.promise;
    allowed = false;
    release.resolve();
    const result = await published(f.app, admitted.ref);
    assert.notEqual(result.outcome.kind, 'committed');
    assert.notEqual(result.observed.publication, 'committed');
  }
});

test('revocation queued during admission rolls back configuration and tasks', { timeout: 15000 }, async t => {
  for (const revokedAction of ['read-definition', 'execute']) {
    let executionChecks = 0, revoked = false;
    const f = await fixture(t, { app: { policy: (_actor, action) => {
      // Resolution and qualification precede the transaction's execution check.
      if (action === 'execute' && ++executionChecks === 3) queueMicrotask(() => { revoked = true; });
      return action !== revokedAction || !revoked;
    } } });
    const before = await f.app.local.conversation.agent(context);
    const attempted = await f.app.invoke(request(`admission-${revokedAction}`), actor);
    assert.equal(revoked, true);
    assert.equal(attempted.kind, 'unavailable');
    assert.equal((await tasks(f.app.local.storage)).length, 0);
    assert.equal(await f.app.local.definitionBinding(), null);
    const after = await f.app.local.conversation.agent(context);
    assert.equal(after.instructions, before.instructions);
    assert.deepEqual(after.tools, before.tools);
  }
});

test('definition read policy and output publication policy remain separate', { timeout: 15000 }, async t => {
  const f = await fixture(t, { app: { policy: (_actor, action) => action !== 'publish' } });
  const admitted = await f.app.invoke(request('publish-refused'), actor);
  assert.equal(admitted.kind, 'admitted');
  const result = await published(f.app, admitted.ref);
  assert.equal(result.observed.publication, 'denied');
  assert.notEqual(result.outcome.kind, 'committed');
  assert.equal((await f.app.local.definitionBinding()).ref.revision, f.definitionRef.revision);
});

test('duplicate requests retain one native definition binding and one producer graph', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const replies = await Promise.all(Array.from({ length: 4 }, () => f.app.invoke(request('duplicate-definition'), actor)));
  for (const reply of replies) { assert.equal(reply.kind, 'admitted'); assert.deepEqual(reply.ref, replies[0].ref); }
  await f.app.local.harness.waitForTask(replies[0].ref.delivery, context);
  assert.equal((await tasks(f.app.local.storage)).length, 3);
  assert.deepEqual((await f.app.local.definitionBinding()).ref, f.definitionRef);
});

test('native companion retains only references while definition and generated content remain in the app', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const blueDirectory = join(f.directory, 'blue');
  const blueRef = await provisionFixtureDefinition({ directory: blueDirectory, appId: 'blue' });
  const blue = await openFixtureApp({ directory: blueDirectory, appId: 'blue', definitionRef: blueRef });
  t.after(() => blue.close());
  const hubDirectory = join(f.directory, 'hub');
  const hub = await openFixtureCompanion({ directory: hubDirectory, apps: { amber: f.app, blue } });
  t.after(() => hub.close());
  const native = await documentToolResult(hub.harness, hub.conversation,
    await admitDocumentTool(hub.conversation, request('private-definition'), 'invoke_amber'));
  assert.equal(native.result.kind, 'admitted');
  assert.equal(JSON.stringify(native.result).includes(PRIVATE_MARKERS.amber.definition), false);
  assert.equal((await published(f.app, native.result.ref)).outcome.kind, 'committed');
  const appRetained = await scanHubRetention({ storages: { amber: f.app.local.storage }, directories: [f.appDirectory], markers: PRIVATE_MARKERS });
  for (const field of ['definition', 'input', 'result']) assert.ok(appRetained.hits.some(hit => hit.marker === `amber.${field}`));
  assert.equal(appRetained.hits.some(hit => hit.marker.startsWith('blue.')), false);
  const hubRetained = await scanHubRetention({ storages: { companion: hub.storage }, directories: [hubDirectory], markers: PRIVATE_MARKERS });
  assert.deepEqual(hubRetained.hits, []);
});

test('malformed or executable definition data creates no app admission', { timeout: 15000 }, async t => {
  const sentinel = '__fictional_definition_executed';
  for (const content of [
    JSON.stringify({ format: 'boring.agent', version: 1, instructions: 'Fictional', tools: ['prepare_report'], code: `globalThis.${sentinel} = true` }),
    `globalThis.${sentinel} = true; ({ format: 'boring.agent', version: 1 })`,
    JSON.stringify({ format: 'boring.agent', version: 1, instructions: { module: 'fictional-code' }, tools: ['prepare_report'] }),
  ]) {
    const f = await fixture(t);
    await f.app.close();
    const installer = openSqliteWorkspaces({ filename: join(f.appDirectory, 'resources.sqlite'), providerId: 'amber', authorize: () => true });
    let selected;
    try {
      const written = await installer.publication.publish({ operationId: 'malformed-definition', atomicity: 'all-or-nothing', changes: [
        { kind: 'replace', target: f.definitionRef, bytes: new TextEncoder().encode(content), mediaType: 'application/json' },
      ] }, { scopeId: actor.scopeId, principalId: 'fictional-installer', initiatorId: 'fictional-setup' });
      assert.equal(written.kind, 'committed'); selected = written.receipt.changes[0].after;
    } finally { installer.close(); }
    f.app = await openFixtureApp({ directory: f.appDirectory, appId: 'amber', definitionRef: selected });
    assert.deepEqual(await f.app.invoke(request('invalid-definition'), actor), { kind: 'unavailable' });
    assert.deepEqual(await tasks(f.app.local.storage), []);
    assert.equal(await f.app.local.definitionBinding(), null);
    assert.equal(globalThis[sentinel], undefined);
  }
});

test('native configuration drift refuses execution and later admission without restoring configuration implicitly', { timeout: 15000 }, async t => {
  const reached = gate(), release = gate();
  const f = await fixture(t, { app: { beforeProduce: async () => { reached.resolve(); await release.promise; } } });
  const admitted = await f.app.invoke(request('config-drift'), actor);
  assert.equal(admitted.kind, 'admitted'); await reached.promise;
  await f.app.local.conversation.configure({ instructions: 'Fictional changed native configuration' }, context);
  release.resolve();
  const result = await published(f.app, admitted.ref);
  assert.equal(result.outcome.kind, 'not-found');
  assert.equal(result.observed.publication, 'producer-failed');
  const before = await tasks(f.app.local.storage);
  assert.deepEqual(await f.app.invoke(request('after-config-drift'), actor), { kind: 'unavailable' });
  assert.equal((await tasks(f.app.local.storage)).length, before.length);
  assert.equal((await f.app.local.conversation.agent(context)).instructions, 'Fictional changed native configuration');
  assert.deepEqual((await f.app.local.definitionBinding()).ref, f.definitionRef);
});

test('native preparation preserves definition text beyond the default tool line limit', { timeout: 15000 }, async t => {
  const instructions = '\uFEFF' + 'Fictional instruction\n'.repeat(2500);
  const f = await fixture(t, { definition: { instructions } });
  const admitted = await f.app.invoke(request('long-instructions'), actor);
  assert.equal(admitted.kind, 'admitted');
  const result = await published(f.app, admitted.ref);
  assert.equal(result.outcome.kind, 'committed');
  const expected = `# Fictional amber\n${instructions}\n${PRIVATE_MARKERS.amber.input}:amber:input:v1\n${PRIVATE_MARKERS.amber.result}\n`;
  assert.equal(new TextDecoder().decode(result.saved.snapshot.bytes), expected);
});

test('previous fixture storage without a definition binding is explicitly refused', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'boring-hub-old-definition-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const oldIncarnation = defineDoc({ kind: 'fixture.hub.app-instance', version: 1, scope: 'session', initial: () => ({ instanceId: 'fictional-old-instance' }) });
  const storage = await openNodeSqliteStorage(join(directory, 'native.sqlite'));
  const harness = await Harness.open(storage, { registry: createRegistry(), models: createModels() }, context);
  try {
    const conversation = await harness.root(context);
    await conversation.commit(tx => tx.doc(oldIncarnation), context);
  } finally { await harness.close(context); }
  const definitionRef = await provisionFixtureDefinition({ directory, appId: 'amber' });
  await assert.rejects(openFixtureApp({ directory, appId: 'amber', definitionRef }), /Fixture v1 storage has no qualified definition binding/);
});

test('a directly created tool task cannot impersonate the request producer', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const admitted = await f.app.invoke(request('owned-report'), actor);
  assert.equal(admitted.kind, 'admitted');
  await f.app.local.harness.waitForTask(admitted.ref.delivery, context);
  const forged = await admitDocumentTool(f.app.local.conversation, { requestId: 'owned-report' }, 'prepare_report');
  const settled = await f.app.local.harness.waitForTask(forged, context);
  assert.equal(settled.state.outcome.status, 'failed');
  const entries = (await f.app.local.conversation.context(context)).entries.filter(entry => entry.byTaskId === forged);
  assert.ok(entries.length > 0);
  for (const marker of Object.values(PRIVATE_MARKERS.amber)) assert.equal(JSON.stringify(entries).includes(marker), false);
  assert.deepEqual((await f.app.invoke(request('owned-report'), actor)).ref, admitted.ref);
});
