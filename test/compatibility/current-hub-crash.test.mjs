import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { AssistantEntry, ToolResultEntry, ToolTask } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { fixtureActor, fixtureRequest, openFixtureApp, PRIVATE_MARKERS } from '../../examples/current-hub/app.mjs';
import { provisionFixtureDefinition } from '../../examples/current-hub/definition.mjs';
import { openFixtureCompanion } from '../../examples/current-hub/companion.mjs';
import { documentToolResult } from '../fixtures/native-document.mjs';

const script = fileURLToPath(new URL('../fixtures/current-hub-crash-child.mjs', import.meta.url));
const temporaryRoot = fileURLToPath(new URL('../../.cache/current-hub-crash/', import.meta.url));
async function taskIds(app) {
  const ids = []; let cursor;
  do {
    const page = await app.local.storage.scanTasks({}, 100, cursor, context);
    ids.push(...page.items.map(task => task.id)); cursor = page.next;
  } while (cursor !== undefined);
  return ids.sort((a, b) => a - b);
}

async function completedTaskIds(app, ref) {
  const page = await app.local.storage.scanTasks({}, 100, undefined, context);
  assert.equal(page.next, undefined); assert.equal(page.items.length, 3);
  const children = page.items.filter(task => task.kind === ToolTask.definition.name);
  assert.equal(children.length, 1); assert.equal(children[0].owner, ref.producer);
  assert.equal(children[0].state.outcome.status, 'completed');
  const ids = page.items.map(task => task.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [ref.producer, ref.delivery, children[0].id].sort((a, b) => a - b));
  return ids;
}

async function crashAfterAdmission(t, directory, appId, mode = 'app') {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [script, directory, appId, mode], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const terminal = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  terminal.catch(() => {});
  t.after(async () => {
    child.kill('SIGKILL'); await terminal.catch(() => {});
  });
  await Promise.race([
    terminal.then(result => { throw new Error(`Admission child exited before the crash boundary: ${JSON.stringify(result)}\n${output}`); }),
    (async () => {
      const deadline = Date.now() + 10000;
      while (!existsSync(join(directory, 'ready.json'))) {
        assert.ok(Date.now() < deadline, `Admission checkpoint timed out\n${output}`); await delay(10);
      }
    })(),
  ]);
  const ready = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
  assert.equal(child.kill('SIGKILL'), true); assert.deepEqual(await terminal, { code: null, signal: 'SIGKILL' });
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
  return ready;
}

for (const appId of ['amber', 'blue']) {
  test(`${appId} app reuses its original native binding after SIGKILL between committed admission and acknowledgement`, { timeout: 25000 }, async t => {
    mkdirSync(temporaryRoot, { recursive: true });
    const directory = mkdtempSync(join(temporaryRoot, appId + '-')), actor = fixtureActor(appId), request = fixtureRequest(appId);
    const access = { scopeId: actor.scopeId, principalId: actor.principalId, initiatorId: actor.initiatorId, authorizationRef: actor.installationId };
    const gate = Promise.withResolvers(); let app;
    t.after(async () => {
      gate.resolve(); if (app) await app.close(); rmSync(directory, { recursive: true, force: true });
    });
    const ready = await crashAfterAdmission(t, directory, appId);
    assert.equal(ready.phase, 'admitted-before-ack'); assert.equal(ready.publication, 'not-found');
    assert.equal(ready.ref.appId, appId); assert.equal(typeof ready.ref.instanceId, 'string'); assert.ok(ready.ref.instanceId.length > 0);
    assert.equal(ready.producer.id, ready.ref.producer); assert.equal(ready.delivery.id, ready.ref.delivery);
    assert.notEqual(ready.producer.status, 'terminal'); assert.notEqual(ready.delivery.status, 'terminal');

    const newerDefinition = await provisionFixtureDefinition({ directory: join(directory, 'app'), appId, expected: ready.definition.ref,
      instructions: 'Fictional later definition must not replace the admitted instructions.' });
    assert.notEqual(newerDefinition.revision, ready.definition.ref.revision);
    app = await openFixtureApp({ directory: join(directory, 'app'), appId, definitionRef: newerDefinition, beforeProduce: () => gate.promise });
    assert.deepEqual(await app.local.definitionBinding(), ready.definition);
    assert.equal((await app.local.conversation.agent(context)).instructions, ready.instructions);
    assert.ok(ready.instructions.includes(PRIVATE_MARKERS[appId].definition));
    const retried = await app.invoke(request, actor); assert.equal(retried.kind, 'admitted'); assert.deepEqual(retried.ref, ready.ref);
    assert.equal((await app.local.provider.reconciliation.lookup(ready.ref.operationId, access)).kind, 'not-found');
    const expectedTasks = [ready.ref.producer, ready.ref.delivery].sort((a, b) => a - b);
    assert.deepEqual(await taskIds(app), expectedTasks);
    const duplicates = await Promise.all(Array.from({ length: 3 }, () => app.invoke(fixtureRequest(appId), fixtureActor(appId))));
    for (const duplicate of duplicates) { assert.equal(duplicate.kind, 'admitted'); assert.deepEqual(duplicate.ref, ready.ref); }
    assert.equal((await app.invoke(fixtureRequest(appId, request.requestId, 2), actor)).kind, 'conflict');
    assert.equal((await app.invoke(request, { ...actor, initiatorId: 'other-fictional-requester' })).kind, 'denied');
    assert.deepEqual(await taskIds(app), expectedTasks);

    gate.resolve();
    const producer = await app.local.harness.waitForTask(ready.ref.producer, context);
    const delivery = await app.local.harness.waitForTask(ready.ref.delivery, context);
    assert.equal(producer.state.outcome.status, 'completed'); assert.equal(delivery.state.outcome.status, 'completed');
    const publication = await app.local.provider.reconciliation.lookup(ready.ref.operationId, access);
    assert.equal(publication.kind, 'committed'); assert.deepEqual(delivery.state.outcome.result, publication);
    assert.equal(publication.receipt.operationId, ready.ref.operationId); assert.equal(publication.receipt.changes.length, 1);
    const change = publication.receipt.changes[0]; assert.equal(change.kind, 'create'); assert.equal(change.before, null);
    const saved = await app.local.provider.read({ target: change.after, revision: { kind: 'exact', value: change.after.revision } }, access);
    assert.equal(saved.kind, 'available'); assert.deepEqual(saved.snapshot.ref, change.after);
    const savedText = new TextDecoder('utf-8', { ignoreBOM: true }).decode(saved.snapshot.bytes);
    assert.ok(savedText.includes(PRIVATE_MARKERS[appId].result)); assert.ok(savedText.includes(ready.instructions));
    assert.equal(savedText.includes('Fictional later definition'), false);
    const observed = await app.observe(ready.ref, actor); assert.equal(observed.kind, 'observed'); assert.deepEqual(observed.ref, ready.ref);
    assert.equal(observed.status, 'completed'); assert.equal(observed.publication, 'committed');
    const completedIds = await completedTaskIds(app, ready.ref);
    await app.close();

    app = await openFixtureApp({ directory: join(directory, 'app'), appId });
    assert.deepEqual(await app.local.definitionBinding(), ready.definition);
    assert.equal((await app.local.conversation.agent(context)).instructions, ready.instructions);
    const reopened = await app.invoke(request, actor); assert.equal(reopened.kind, 'admitted'); assert.deepEqual(reopened.ref, ready.ref);
    assert.equal((await app.invoke(fixtureRequest(appId, request.requestId, 2), actor)).kind, 'conflict');
    assert.deepEqual(await completedTaskIds(app, ready.ref), completedIds);
    assert.deepEqual(await app.local.provider.reconciliation.lookup(ready.ref.operationId, access), publication);
    const current = await app.local.provider.read({ target: change.after, revision: { kind: 'latest' } }, access);
    assert.equal(current.kind, 'available'); assert.deepEqual(current.snapshot.ref, saved.snapshot.ref); assert.deepEqual(current.snapshot.bytes, saved.snapshot.bytes);
    assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
  });
}

for (const scenario of ['changed actor', 'missing actor', 'revoked policy']) {
  test(`hub safe replay preserves its admitted app binding and returns unknown after SIGKILL with ${scenario}`, { timeout: 25000 }, async t => {
    mkdirSync(temporaryRoot, { recursive: true });
    const directory = mkdtempSync(join(temporaryRoot, 'hub-' + scenario.replaceAll(' ', '-') + '-'));
    const gate = Promise.withResolvers(); let amber, blue, hub, invocations = 0, allowed = scenario !== 'revoked policy';
    const expectedInvocations = scenario === 'revoked policy' ? 1 : 0;
    t.after(async () => {
      gate.resolve();
      if (hub) await hub.close();
      if (blue) await blue.close();
      if (amber) await amber.close();
      rmSync(directory, { recursive: true, force: true });
    });
    const ready = await crashAfterAdmission(t, directory, 'amber', 'hub');
    assert.equal(ready.phase, 'admitted-before-ack'); assert.equal(ready.publication, 'not-found');
    assert.ok(Number.isSafeInteger(ready.hubToolTask) && ready.hubToolTask > 0);
    const newerDefinition = await provisionFixtureDefinition({ directory: join(directory, 'app'), appId: 'amber', expected: ready.definition.ref,
      instructions: 'Fictional later definition must not replace the admitted instructions.' });
    assert.notEqual(newerDefinition.revision, ready.definition.ref.revision);
    amber = await openFixtureApp({ directory: join(directory, 'app'), appId: 'amber', definitionRef: newerDefinition, beforeProduce: () => gate.promise, policy: () => allowed });
    assert.deepEqual(await amber.local.definitionBinding(), ready.definition);
    assert.equal((await amber.local.conversation.agent(context)).instructions, ready.instructions);
    assert.ok(ready.instructions.includes(PRIVATE_MARKERS.amber.definition));
    blue = await openFixtureApp({ directory: join(directory, 'blue'), appId: 'blue' });
    const expectedTasks = [ready.ref.producer, ready.ref.delivery].sort((a, b) => a - b);
    assert.deepEqual(await taskIds(amber), expectedTasks); assert.deepEqual(await taskIds(blue), []);
    hub = await openFixtureCompanion({ directory: join(directory, 'hub'), apps: {
      amber: { ...amber, invoke: (...args) => { invocations++; return amber.invoke(...args); } }, blue,
    }, actorFor: appId => scenario === 'missing actor' ? null : scenario === 'changed actor'
      ? { ...fixtureActor(appId), initiatorId: 'changed-fictional-requester' } : fixtureActor(appId) });
    const replayed = await documentToolResult(hub.harness, hub.conversation, ready.hubToolTask);
    assert.deepEqual(replayed.result, { kind: 'unknown' });
    assert.deepEqual(replayed.entry.model[0].content, [{ type: 'text', text: '{"kind":"unknown"}' }]);
    assert.equal(invocations, expectedInvocations);
    assert.deepEqual(await taskIds(amber), expectedTasks); assert.deepEqual(await taskIds(blue), []);
    if (scenario === 'revoked policy') assert.deepEqual(await amber.observe(ready.ref, fixtureActor('amber')), { kind: 'denied' });
    allowed = true;
    const retained = await amber.invoke(fixtureRequest('amber'), fixtureActor('amber'));
    assert.equal(retained.kind, 'admitted'); assert.deepEqual(retained.ref, ready.ref);
    gate.resolve();
    const delivery = await amber.local.harness.waitForTask(ready.ref.delivery, context);
    assert.equal(delivery.state.outcome.status, 'completed');
    const actor = fixtureActor('amber');
    const publication = await amber.local.provider.reconciliation.lookup(ready.ref.operationId, {
      scopeId: actor.scopeId, principalId: actor.principalId, initiatorId: actor.initiatorId, authorizationRef: actor.installationId,
    });
    assert.equal(publication.kind, 'committed'); assert.deepEqual(publication, delivery.state.outcome.result);
    assert.equal(publication.receipt.operationId, ready.ref.operationId); assert.equal(publication.receipt.changes.length, 1);
    const saved = await amber.local.provider.read({ target: publication.receipt.changes[0].after, revision: { kind: 'latest' } }, {
      scopeId: actor.scopeId, principalId: actor.principalId, initiatorId: actor.initiatorId, authorizationRef: actor.installationId,
    });
    assert.equal(saved.kind, 'available');
    const savedText = new TextDecoder('utf-8', { ignoreBOM: true }).decode(saved.snapshot.bytes);
    assert.ok(savedText.includes(ready.instructions)); assert.equal(savedText.includes('Fictional later definition'), false);
    assert.deepEqual(await amber.local.definitionBinding(), ready.definition);
    const observed = await amber.observe(ready.ref, fixtureActor('amber'));
    assert.equal(observed.kind, 'observed'); assert.equal(observed.publication, 'committed');
    await completedTaskIds(amber, ready.ref); assert.equal(invocations, expectedInvocations);
    assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
  });
}

for (const revoked of [false, true]) {
  test(`native report execute recovery after SIGKILL ${revoked ? 'refuses revoked definition reads even under privileged resume' : 'uses its original definition after latest changes'}`, { timeout: 25000 }, async t => {
    mkdirSync(temporaryRoot, { recursive: true });
    const directory = mkdtempSync(join(temporaryRoot, 'tool-execute-'));
    let app, executions = 0;
    t.after(async () => { if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); });
    const ready = await crashAfterAdmission(t, directory, 'amber', 'tool');
    assert.equal(ready.phase, 'tool-execute'); assert.ok(Number.isSafeInteger(ready.toolTask));
    const newer = await provisionFixtureDefinition({ directory: join(directory, 'app'), appId: 'amber', expected: ready.definition.ref,
      instructions: 'Fictional later definition must not replace the executing report.' });
    assert.notEqual(newer.revision, ready.definition.ref.revision);
    app = await openFixtureApp({ directory: join(directory, 'app'), appId: 'amber', definitionRef: newer,
      policy: (_actor, action) => !revoked || action !== 'read-definition',
      beforeReport: async ({ requestId, taskId }) => {
        executions++; assert.equal(requestId, ready.ref.requestId); assert.equal(taskId, ready.toolTask);
      },
    });
    const expected = [ready.ref.producer, ready.ref.delivery, ready.toolTask].sort((a, b) => a - b);
    assert.deepEqual(await taskIds(app), expected); assert.deepEqual(await app.local.definitionBinding(), ready.definition);
    const interrupted = await app.local.harness.getTask(ready.toolTask, context);
    assert.equal(interrupted.owner, ready.ref.producer); assert.equal(interrupted.state.checkpoint.phase, 'execute');
    assert.equal((await app.local.conversation.agent(context)).instructions, ready.instructions);
    const actor = fixtureActor('amber');
    const access = { scopeId: actor.scopeId, principalId: actor.principalId, initiatorId: actor.initiatorId, authorizationRef: actor.installationId };
    const retry = await app.invoke(fixtureRequest('amber'), actor);
    if (revoked) {
      assert.deepEqual(retry, { kind: 'unavailable' }); assert.equal(executions, 0);
      assert.deepEqual(await taskIds(app), expected);
      assert.equal((await app.local.provider.reconciliation.lookup(ready.ref.operationId, access)).kind, 'not-found');
      app.local.harness.resume();
    } else {
      assert.equal(retry.kind, 'admitted'); assert.deepEqual(retry.ref, ready.ref);
    }
    const child = await app.local.harness.waitForTask(ready.toolTask, context);
    const producer = await app.local.harness.waitForTask(ready.ref.producer, context);
    const delivery = await app.local.harness.waitForTask(ready.ref.delivery, context);
    assert.equal(executions, 1); assert.deepEqual(await taskIds(app), expected);
    assert.equal(child.kind, ToolTask.definition.name); assert.equal(child.owner, ready.ref.producer);
    const entries = (await app.local.conversation.context(context)).entries;
    const calls = entries.filter(entry => entry.kind === AssistantEntry.kind);
    const results = entries.filter(entry => entry.kind === ToolResultEntry.kind);
    assert.equal(calls.length, 1); assert.equal(results.length, 1);
    assert.equal(results[0].byTaskId, ready.toolTask);
    assert.equal(results[0].model[0].toolName, 'prepare_report');
    assert.equal(delivery.state.outcome.status, 'completed');
    const publication = await app.local.provider.reconciliation.lookup(ready.ref.operationId, access);
    if (revoked) {
      assert.equal(child.state.outcome.status, 'failed'); assert.equal(producer.state.outcome.status, 'faulted');
      assert.equal(results[0].model[0].isError, true);
      assert.deepEqual(delivery.state.outcome.result, { kind: 'producer-failed', status: 'faulted' });
      assert.equal(publication.kind, 'not-found');
      const read = await app.local.provider.read({ target: { resource: { providerId: 'amber', path: `${ready.ref.instanceId}/${ready.ref.requestId}.md` },
        view: { kind: 'published' } }, revision: { kind: 'latest' } }, access);
      assert.equal(read.kind, 'missing');
    } else {
      assert.equal(child.state.outcome.status, 'completed'); assert.equal(producer.state.outcome.status, 'completed');
      assert.equal(results[0].model[0].isError, false);
      assert.equal(publication.kind, 'committed'); assert.deepEqual(delivery.state.outcome.result, publication);
      assert.equal(publication.receipt.changes.length, 1);
      const read = await app.local.provider.read({ target: publication.receipt.changes[0].after, revision: { kind: 'latest' } }, access);
      assert.equal(read.kind, 'available');
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(read.snapshot.bytes);
      assert.ok(text.includes(ready.instructions)); assert.equal(text.includes('Fictional later definition'), false);
    }
    assert.deepEqual(await app.local.definitionBinding(), ready.definition);
  });
}
