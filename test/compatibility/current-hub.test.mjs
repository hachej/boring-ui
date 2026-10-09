import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolResultEntry, ToolTask } from '@earendil-works/pi-durable';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { fixtureActor, fixtureRequest, PRIVATE_MARKERS, openFixtureApp } from '../../examples/current-hub/app.mjs';
import { provisionFixtureDefinition } from '../../examples/current-hub/definition.mjs';
import { openFixtureCompanion } from '../../examples/current-hub/companion.mjs';
import { admitDocumentTool, documentToolResult } from '../fixtures/native-document.mjs';
import { scanHubRetention } from '../fixtures/hub-retention.mjs';

const gate = () => Promise.withResolvers();
const request = (app, id = 'request-1', version = 1) => fixtureRequest(app, id, version);
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'boring-current-hub-'));
  const amberDefinition = await provisionFixtureDefinition({ directory: join(directory, 'amber'), appId: 'amber' });
  const blueDefinition = await provisionFixtureDefinition({ directory: join(directory, 'blue'), appId: 'blue' });
  const amber = await openFixtureApp({ directory: join(directory, 'amber'), appId: 'amber', definitionRef: amberDefinition, ...options.amber });
  const blue = await openFixtureApp({ directory: join(directory, 'blue'), appId: 'blue', definitionRef: blueDefinition, ...options.blue });
  const hubDirectory = join(directory, 'hub');
  const hub = await openFixtureCompanion({ directory: hubDirectory, apps: { amber, blue }, ...options.hub });
  t.after(async () => { await hub.close(); await amber.close(); await blue.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, hubDirectory, amber, blue, hub };
}
const result = async (hub, app, value) => (await documentToolResult(hub.harness, hub.conversation,
  await admitDocumentTool(hub.conversation, value, `invoke_${app}`))).result;
const markers = Object.values(PRIVATE_MARKERS).flatMap(value => Object.values(value));
async function nativeTaskCount(storage) {
  let count = 0, cursor;
  do {
    const page = await storage.scanTasks({}, 100, cursor, context);
    count += page.items.length;
    cursor = page.next;
  } while (cursor !== undefined);
  return count;
}
async function assertSinglePreparation(app, ref) {
  const page = await app.local.storage.scanTasks({}, 100, undefined, context);
  assert.equal(page.next, undefined); assert.equal(page.items.length, 3);
  const children = page.items.filter(task => task.kind === ToolTask.definition.name);
  assert.equal(children.length, 1); assert.equal(children[0].owner, ref.producer);
  assert.equal(children[0].state.outcome.status, 'completed');
  assert.deepEqual(page.items.map(task => task.id).sort((a, b) => a - b), [ref.producer, ref.delivery, children[0].id].sort((a, b) => a - b));
}

function scriptedModel() {
  const model = { id: 'fictional-hub', name: 'Fictional hub provider', provider: 'fictional-hub-provider', api: 'fictional-hub-api',
    baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 32768, maxTokens: 1024,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const prompts = [];
  const stream = (_model, transcript) => {
    prompts.push(structuredClone(transcript));
    const events = createAssistantMessageEventStream();
    const index = prompts.length;
    const message = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      timestamp: index, stopReason: index <= 2 ? 'toolUse' : 'stop',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    events.push({ type: 'start', partial: message });
    if (index <= 2) {
      const appId = index === 1 ? 'amber' : 'blue';
      const toolCall = { type: 'toolCall', id: `fictional-call-${index}`, name: `invoke_${appId}`,
        arguments: request(appId, `model-${appId}`) };
      message.content.push(toolCall);
      events.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
      events.push({ type: 'toolcall_delta', contentIndex: 0, delta: JSON.stringify(toolCall.arguments), partial: message });
      events.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
    } else {
      const content = { type: 'text', text: 'Both fictional capabilities returned references.' };
      message.content.push(content);
      events.push({ type: 'text_start', contentIndex: 0, partial: message });
      events.push({ type: 'text_delta', contentIndex: 0, delta: content.text, partial: message });
      events.push({ type: 'text_end', contentIndex: 0, content: content.text, partial: message });
    }
    events.push({ type: 'done', reason: message.stopReason, message });
    events.end(message);
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: 'Fictional keyless provider', resolve: async () => ({ auth: {} }) } },
    api: { stream, streamSimple: stream } }));
  return { models, model: { provider: model.provider, modelId: model.id }, prompts };
}

test('two native companion tools route exact requests to the owning apps and retain only references', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const amber = await result(f.hub, 'amber', request('amber', 'amber-one'));
  const blue = await result(f.hub, 'blue', request('blue', 'blue-one'));
  for (const [appId, admitted] of [['amber', amber], ['blue', blue]]) {
    assert.equal(admitted.kind, 'admitted');
    assert.equal(admitted.ref.appId, appId);
    assert.equal(admitted.ref.scopeId, fixtureActor(appId).scopeId);
    assert.equal(admitted.ref.principalId, fixtureActor(appId).principalId);
    assert.equal(admitted.ref.initiatorId, fixtureActor(appId).initiatorId);
    assert.equal(admitted.ref.installationId, fixtureActor(appId).installationId);
    assert.equal(typeof admitted.ref.instanceId, 'string');
    assert.equal(typeof admitted.ref.producer, 'number');
    assert.equal(typeof admitted.ref.delivery, 'number');
    assert.equal(typeof admitted.ref.operationId, 'string');
    for (const marker of markers) assert.equal(JSON.stringify(admitted).includes(marker), false);
    await f[appId].local.harness.waitForTask(admitted.ref.delivery, context);
    const observation = await f[appId].observe(admitted.ref, fixtureActor(appId));
    assert.equal(observation.status, 'completed');
    assert.equal(observation.publication, 'committed');
  }
  assert.notEqual(amber.ref.runtimeId, blue.ref.runtimeId);
  assert.equal((await result(f.hub, 'amber', request('amber', 'amber-one'))).ref.operationId, amber.ref.operationId);
  assert.equal((await result(f.hub, 'blue', request('blue', 'blue-one'))).ref.operationId, blue.ref.operationId);
  for (const appId of ['amber', 'blue']) {
    await assertSinglePreparation(f[appId], (appId === 'amber' ? amber : blue).ref);
    const other = appId === 'amber' ? 'blue' : 'amber';
    const retainedByApp = await scanHubRetention({ storages: { [appId]: f[appId].local.storage },
      directories: [join(f.directory, appId)], markers: PRIVATE_MARKERS });
    for (const field of ['input', 'result', 'definition']) assert.ok(retainedByApp.hits.some(hit => hit.marker === `${appId}.${field}`));
    assert.equal(retainedByApp.hits.some(hit => hit.marker.startsWith(`${other}.`)), false);
  }
  const retained = await scanHubRetention({ storages: { companion: f.hub.storage }, directories: [f.hubDirectory], markers: PRIVATE_MARKERS });
  assert.deepEqual(retained.hits, []);
  assert.ok(retained.surfaces.some(surface => surface.includes(':entries:')));
  assert.ok(retained.surfaces.some(surface => surface.includes(':documents:')));
  assert.ok(retained.surfaces.some(surface => surface.startsWith('file:')));
});

test('a real native conversation passes two reference-only tool results through a fake provider', { timeout: 20000 }, async t => {
  const fake = scriptedModel();
  const f = await fixture(t, { hub: { models: fake.models, model: fake.model } });
  const submission = await f.hub.conversation.submit({ type: 'input', content: 'Invoke the two fictional app capabilities.' }, context);
  await submission.wait(context);
  await f.hub.conversation.waitForIdle(context);
  assert.equal(fake.prompts.length, 3);
  const toolResults = fake.prompts[2].messages.filter(message => message.role === 'toolResult');
  assert.equal(toolResults.length, 2);
  assert.deepEqual(toolResults.map(message => {
    const admitted = JSON.parse(message.content[0].text);
    return [message.toolName, admitted.kind, admitted.ref.appId, admitted.ref.requestId];
  }), [
    ['invoke_amber', 'admitted', 'amber', 'model-amber'],
    ['invoke_blue', 'admitted', 'blue', 'model-blue'],
  ]);
  for (const prompt of fake.prompts) for (const marker of markers) assert.equal(JSON.stringify(prompt).includes(marker), false);
  const retained = await scanHubRetention({ storages: { companion: f.hub.storage }, directories: [f.hubDirectory],
    captures: fake.prompts, markers: PRIVATE_MARKERS });
  assert.deepEqual(retained.hits, []);
  assert.ok(retained.surfaces.some(surface => surface.startsWith('capture:')));
});

test('app request and actor bindings refuse changed body, wrong actor, version and cross-app reference', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const actor = fixtureActor('amber');
  const first = await f.amber.invoke(request('amber', 'stable'), actor);
  assert.equal(first.kind, 'admitted');
  assert.equal((await f.amber.invoke(request('amber', 'stable'), actor)).ref.operationId, first.ref.operationId);
  assert.equal((await f.amber.invoke(request('amber', 'stable', 2), actor)).kind, 'conflict');
  assert.equal((await f.amber.invoke({ ...request('amber', 'stable'), capabilityVersion: '2' }, actor)).kind, 'unsupported');
  assert.equal((await f.amber.invoke(request('amber', 'stable'), { ...actor, principalId: 'different-person' })).kind, 'denied');
  assert.equal((await f.blue.observe(first.ref, fixtureActor('blue'))).kind, 'denied');
  for (const altered of [
    { ...first.ref, producer: first.ref.producer + 1 },
    { ...first.ref, delivery: first.ref.delivery + 1 },
    { ...first.ref, scopeId: 'other-scope' },
    { ...first.ref, instanceId: 'replacement-storage' },
    { ...first.ref, capabilityVersion: '2' },
  ]) assert.equal((await f.amber.observe(altered, actor)).kind, 'denied');
});

test('initial denial and later revocation are checked at the app, including native companion calls', { timeout: 15000 }, async t => {
  let permitted = false, denyDuringObserve = false, observeChecks = 0;
  const f = await fixture(t, { amber: { policy: (_actor, action) => permitted
    && (action !== 'observe' || !denyDuringObserve || ++observeChecks === 1) } });
  const actor = fixtureActor('amber'), selected = request('amber', 'permission-change');
  const before = await nativeTaskCount(f.amber.local.storage);
  assert.equal((await f.amber.invoke(selected, actor)).kind, 'denied');
  assert.equal((await result(f.hub, 'amber', selected)).kind, 'denied');
  assert.equal(await nativeTaskCount(f.amber.local.storage), before);
  permitted = true;
  const admitted = await result(f.hub, 'amber', selected);
  assert.equal(admitted.kind, 'admitted');
  assert.equal((await f.amber.observe(admitted.ref, actor)).kind, 'observed');
  denyDuringObserve = true;
  observeChecks = 0;
  assert.deepEqual(await f.amber.observe(admitted.ref, actor), { kind: 'denied' });
  denyDuringObserve = false;
  permitted = false;
  assert.equal((await f.amber.observe(admitted.ref, actor)).kind, 'denied');
  const afterAdmission = await nativeTaskCount(f.amber.local.storage);
  assert.equal((await result(f.hub, 'amber', request('amber', 'later'))).kind, 'denied');
  assert.equal(await nativeTaskCount(f.amber.local.storage), afterAdmission);
});

test('companion strips unsolicited app fields and refuses a changed native instance binding', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const selected = request('amber', 'untrusted-output');
  const admitted = await f.amber.invoke(selected, fixtureActor('amber'));
  assert.equal(admitted.kind, 'admitted');
  const leaked = await openFixtureCompanion({ directory: join(f.directory, 'leaking-hub'), apps: {
    amber: { ...f.amber, invoke: async () => ({ kind: 'admitted', ref: {
      ...admitted.ref, privateResult: PRIVATE_MARKERS.amber.result } }) }, blue: f.blue,
  } });
  t.after(() => leaked.close());
  const filtered = await result(leaked, 'amber', selected);
  assert.equal(filtered.kind, 'admitted');
  assert.deepEqual(filtered.ref, admitted.ref);
  for (const marker of markers) assert.equal(JSON.stringify(filtered).includes(marker), false);
  const changed = await openFixtureCompanion({ directory: join(f.directory, 'changed-hub'), apps: {
    amber: { ...f.amber, invoke: async () => ({ kind: 'admitted', ref: {
      ...admitted.ref, instanceId: 'different-storage-incarnation' } }) }, blue: f.blue,
  } });
  t.after(() => changed.close());
  assert.equal((await result(changed, 'amber', selected)).kind, 'unknown');
});

test('closed app reports unavailable without companion inventing a terminal result', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const selected = request('amber', 'becomes-unavailable');
  const admitted = await result(f.hub, 'amber', selected);
  assert.equal(admitted.kind, 'admitted');
  await f.amber.close();
  assert.equal((await f.amber.observe(admitted.ref, fixtureActor('amber'))).kind, 'unavailable');
  assert.equal((await result(f.hub, 'amber', request('amber', 'after-close'))).kind, 'unavailable');
});

test('a lost admission response remains unknown, then exact retry finds one durable native binding', { timeout: 15000 }, async t => {
  let lose = true, committed;
  const f = await fixture(t, { amber: { afterAdmission: async ref => {
    committed = ref;
    if (lose) { lose = false; throw new Error('Fictional response lost after admission'); }
  } } });
  const selected = request('amber', 'lost-ack');
  const uncertain = await f.amber.invoke(selected, fixtureActor('amber'));
  assert.equal(uncertain.kind, 'unknown');
  assert.ok(committed);
  const retry = await f.amber.invoke(selected, fixtureActor('amber'));
  assert.equal(retry.kind, 'admitted');
  assert.deepEqual(retry.ref, committed);
  assert.equal((await f.amber.invoke(request('amber', 'lost-ack', 2), fixtureActor('amber'))).kind, 'conflict');
  assert.equal((await f.amber.observe(retry.ref, fixtureActor('amber'))).kind, 'observed');
});

test('authorization revoked after native admission reports unknown until an exact retry', { timeout: 15000 }, async t => {
  let permitted = true, committed, revokeOnce = true;
  const f = await fixture(t, { amber: { policy: () => permitted, afterAdmission: async ref => {
    committed = ref;
    if (revokeOnce) { revokeOnce = false; permitted = false; }
  } } });
  const selected = request('amber', 'revoked-after-admission');
  assert.equal((await f.amber.invoke(selected, fixtureActor('amber'))).kind, 'unknown');
  assert.ok(committed);
  permitted = true;
  const retry = await f.amber.invoke(selected, fixtureActor('amber'));
  assert.equal(retry.kind, 'admitted');
  assert.deepEqual(retry.ref, committed);
});

test('companion actor changed during an admitted native call reports uncertainty', { timeout: 15000 }, async t => {
  const reached = gate(), release = gate();
  let actor = fixtureActor('amber'), committed;
  const f = await fixture(t, { amber: { afterAdmission: async ref => {
    committed = ref;
    reached.resolve();
    await release.promise;
  } }, hub: { actorFor: appId => appId === 'amber' ? actor : fixtureActor(appId) } });
  const selected = request('amber', 'actor-changes-late');
  const pending = result(f.hub, 'amber', selected);
  await reached.promise;
  actor = { ...actor, principalId: 'different-person' };
  release.resolve();
  assert.equal((await pending).kind, 'unknown');
  assert.ok(committed);
  actor = fixtureActor('amber');
  assert.deepEqual((await f.amber.invoke(selected, actor)).ref, committed);
});

test('companion detaches without terminating app-owned native producer or delivery', { timeout: 15000 }, async t => {
  const producing = gate(), release = gate();
  const f = await fixture(t, { amber: { beforeProduce: async () => { producing.resolve(); await release.promise; } } });
  const admitted = await result(f.hub, 'amber', request('amber', 'survives-detach'));
  assert.equal(admitted.kind, 'admitted');
  await producing.promise;
  await f.hub.close();
  const pending = await f.amber.observe(admitted.ref, fixtureActor('amber'));
  assert.equal(pending.kind, 'observed');
  assert.notEqual(pending.status, 'cancelled');
  release.resolve();
  await f.amber.local.harness.waitForTask(admitted.ref.delivery, context);
  const completed = await f.amber.observe(admitted.ref, fixtureActor('amber'));
  assert.equal(completed.kind, 'observed');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.publication, 'committed');
  await assertSinglePreparation(f.amber, admitted.ref);
});

test('retention scanner catches a deliberately planted raw native tool result', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const clean = await scanHubRetention({ storages: { companion: f.hub.storage }, directories: [f.hubDirectory], markers: PRIVATE_MARKERS });
  assert.deepEqual(clean.hits, []);
  const planted = markers[0];
  await f.hub.conversation.commit(tx => tx.appendEntry(ToolResultEntry, f.hub.conversation.id, { model: [{
    role: 'toolResult', toolCallId: 'deliberately-leaking-fixture', toolName: 'leak_negative_control', isError: false,
    content: [{ type: 'text', text: planted }], timestamp: 1,
  }] }), context);
  const after = await scanHubRetention({ storages: { companion: f.hub.storage }, directories: [f.hubDirectory], markers: PRIVATE_MARKERS });
  assert.ok(after.hits.some(hit => hit.surface.includes(':entries:')));
  assert.ok(after.hits.some(hit => hit.surface.startsWith('file:')));
});
