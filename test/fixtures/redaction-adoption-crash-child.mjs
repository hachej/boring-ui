import assert from 'node:assert/strict';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openRedactionFixture, redactionActor } from '../../examples/redaction/app.mjs';

const directory = process.argv[2];
const actor = redactionActor();
const hold = new Promise(() => {});
const keepAlive = setInterval(() => {}, 1000);
let request, admittedRef;
const app = await openRedactionFixture({ directory: join(directory, 'app'), afterAdoptionCommit: async result => {
  while (!admittedRef) await delay(5);
  const ready = { request, ref: admittedRef, result };
  writeFileSync(join(directory, 'ready.tmp'), JSON.stringify(ready));
  renameSync(join(directory, 'ready.tmp'), join(directory, 'ready.json'));
  await hold;
  writeFileSync(join(directory, 'acknowledged.json'), JSON.stringify(result));
} });
try {
  const paths = app.paths('A');
  const config = { format: 'fictional.redaction', version: 2, prefix: '# Fictional',
    proposal: { order: ['source', 'calculation'], maxRepairs: 1, scenario: 'repair' } };
  const seeded = await app.local.provider.publication.publish({ operationId: 'adoption-crash-inputs', atomicity: 'all-or-nothing', changes: [
    { kind: 'create', target: paths.source, expected: { kind: 'absent' }, bytes: new TextEncoder().encode('Invented redaction input.'), mediaType: 'text/markdown' },
    { kind: 'create', target: paths.config, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(JSON.stringify(config)), mediaType: 'application/json' },
  ] }, actor);
  assert.equal(seeded.kind, 'committed');
  const captured = await app.capture('A', 'proposal-first', actor);
  assert.equal(captured.kind, 'captured');
  const proposed = await app.admitProposal(captured.request, actor);
  assert.equal(proposed.kind, 'admitted');
  await app.local.harness.waitForTask(proposed.ref.validation, context);
  const view = await app.viewProposal(proposed.ref, actor);
  assert.equal(view.kind, 'ready');
  const adoption = await app.captureAdoption(proposed.ref, [
    { itemId: view.catalog.source, kind: 'proposed' }, { itemId: view.catalog.calculation, kind: 'proposed' },
  ], 'adopt-original', actor);
  assert.equal(adoption.kind, 'captured');
  request = adoption.request;
  const admitted = await app.adopt(request, actor);
  assert.equal(admitted.kind, 'admitted');
  admittedRef = admitted.ref;
  await app.local.harness.waitForTask(admitted.ref.taskId, context);
  writeFileSync(join(directory, 'returned.json'), JSON.stringify(admitted.ref));
} finally {
  clearInterval(keepAlive);
  await app.close();
}
