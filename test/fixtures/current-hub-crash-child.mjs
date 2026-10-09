import assert from 'node:assert/strict';
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { fixtureActor, fixtureRequest, openFixtureApp } from '../../examples/current-hub/app.mjs';
import { provisionFixtureDefinition } from '../../examples/current-hub/definition.mjs';
import { openFixtureCompanion } from '../../examples/current-hub/companion.mjs';
import { admitDocumentTool, documentToolResult } from './native-document.mjs';

const [directory, appId, mode = 'app'] = process.argv.slice(2);
assert.ok(mode === 'app' || mode === 'hub' || mode === 'tool');
assert.ok(directory); assert.ok(appId === 'amber' || appId === 'blue');
const actor = fixtureActor(appId), request = fixtureRequest(appId);
const access = { scopeId: actor.scopeId, principalId: actor.principalId, initiatorId: actor.initiatorId, authorizationRef: actor.installationId };
const hold = new Promise(() => {}), keepAlive = setInterval(() => {}, 1000);
const hubTask = Promise.withResolvers(), admitted = Promise.withResolvers(); let hub, blue;
const definitionRef = await provisionFixtureDefinition({ directory: join(directory, 'app'), appId });
const app = await openFixtureApp({ directory: join(directory, 'app'), appId, definitionRef,
  beforeProduce: async () => { if (mode !== 'tool') await hold; },
  beforeReport: async ({ requestId, taskId }) => {
    if (mode !== 'tool') return;
    const ref = await admitted.promise;
    assert.equal(requestId, request.requestId);
    const task = await app.local.harness.getTask(taskId, context);
    assert.equal(task.owner, ref.producer);
    assert.equal(task.state.checkpoint.phase, 'execute'); assert.equal(task.state.checkpoint.replay, 'safe');
    const definition = await app.local.definitionBinding();
    assert.deepEqual(definition.ref, definitionRef);
    const instructions = (await app.local.conversation.agent(context)).instructions;
    assert.equal((await app.local.provider.reconciliation.lookup(ref.operationId, access)).kind, 'not-found');
    writeFileSync(join(directory, 'ready.tmp'), JSON.stringify({ phase: 'tool-execute', ref, toolTask: taskId, definition, instructions }));
    renameSync(join(directory, 'ready.tmp'), join(directory, 'ready.json'));
    await hold;
  },
  afterAdmission: async ref => {
    if (mode === 'tool') { admitted.resolve(ref); return; }
    const producer = await app.local.harness.getTask(ref.producer, context);
    const delivery = await app.local.harness.getTask(ref.delivery, context);
    assert.notEqual(producer.state.status, 'terminal'); assert.notEqual(delivery.state.status, 'terminal');
    const publication = await app.local.provider.reconciliation.lookup(ref.operationId, access);
    assert.equal(publication.kind, 'not-found');
    const hubToolTask = mode === 'hub' ? await hubTask.promise : undefined;
    if (hubToolTask !== undefined) assert.notEqual((await hub.harness.getTask(hubToolTask, context)).state.status, 'terminal');
    const definition = await app.local.definitionBinding();
    assert.ok(definition); assert.deepEqual(definition.ref, definitionRef);
    const instructions = (await app.local.conversation.agent(context)).instructions;
    writeFileSync(join(directory, 'ready.tmp'), JSON.stringify({ phase: 'admitted-before-ack', ref, hubToolTask, definition, instructions,
      producer: { id: producer.id, status: producer.state.status }, delivery: { id: delivery.id, status: delivery.state.status }, publication: publication.kind,
    }));
    renameSync(join(directory, 'ready.tmp'), join(directory, 'ready.json'));
    await hold;
  },
});
try {
  let result;
  if (mode === 'hub') {
    assert.equal(appId, 'amber');
    const blueDefinition = await provisionFixtureDefinition({ directory: join(directory, 'blue'), appId: 'blue' });
    blue = await openFixtureApp({ directory: join(directory, 'blue'), appId: 'blue', definitionRef: blueDefinition });
    hub = await openFixtureCompanion({ directory: join(directory, 'hub'), apps: { amber: app, blue } });
    const task = await admitDocumentTool(hub.conversation, request, 'invoke_amber');
    hubTask.resolve(task);
    ({ result } = await documentToolResult(hub.harness, hub.conversation, task));
  } else {
    result = await app.invoke(request, actor);
    if (mode === 'tool') {
      assert.equal(result.kind, 'admitted');
      await app.local.harness.waitForTask(result.ref.delivery, context);
    }
  }
  writeFileSync(join(directory, 'acknowledged.json'), JSON.stringify({ kind: result.kind }));
  throw new Error('Admission returned instead of holding before acknowledgement');
} finally {
  clearInterval(keepAlive);
  if (hub) await hub.close();
  if (blue) await blue.close();
  await app.close();
}
