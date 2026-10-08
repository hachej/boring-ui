import assert from 'node:assert/strict';
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openRedactionFixture, redactionActor } from '../../examples/redaction/app.mjs';

const [directory, boundary] = process.argv.slice(2);
assert.ok(directory && ['reservation', 'admission', 'delivery'].includes(boundary));
const actor = redactionActor(), subject = 'A', requestId = 'original';
const hold = new Promise(() => {});
const keepAlive = setInterval(() => {}, 1000);
let app, request, admitted;
const checkpoint = async (phase, result) => {
  const ready = { phase, actor, request, ...(admitted ? { admitted } : {}), result };
  writeFileSync(join(directory, 'ready.tmp'), JSON.stringify(ready));
  renameSync(join(directory, 'ready.tmp'), join(directory, 'ready.json'));
  await hold;
};
app = await openRedactionFixture({ directory: join(directory, 'app'),
  beforeProduce: async () => { if (boundary === 'admission') await hold; },
  afterReservationCommit: async result => { if (boundary === 'reservation') await checkpoint('reservation-committed', result); },
  afterAdmission: async ref => {
    admitted = ref;
    if (boundary === 'admission') await checkpoint('native-admitted', ref);
  },
  afterDeliveryCommit: async result => { if (boundary === 'delivery') await checkpoint('output-committed', result); },
});
try {
  const paths = app.paths(subject), access = redactionActor();
  const seeded = await app.local.provider.publication.publish({ operationId: 'seed-original', atomicity: 'all-or-nothing', changes: [
    { kind: 'create', target: paths.source, expected: { kind: 'absent' }, bytes: new TextEncoder().encode('Invented redaction input.'), mediaType: 'text/markdown' },
    { kind: 'create', target: paths.config, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(JSON.stringify({ format: 'fictional.redaction', version: 1, prefix: '# Fictional' })), mediaType: 'application/json' },
  ] }, access);
  assert.equal(seeded.kind, 'committed');
  const captured = await app.capture(subject, requestId, actor);
  assert.equal(captured.kind, 'captured');
  request = captured.request;
  const result = await app.admit(request, actor);
  if (result.kind !== 'admitted') throw new Error(`Admission refused before ${boundary}: ${JSON.stringify(result)}`);
  if (boundary === 'delivery' && result.kind === 'admitted') {
    await app.local.harness.waitForTask(result.ref.delivery, context);
  }
  writeFileSync(join(directory, 'acknowledged.json'), JSON.stringify(result));
  throw new Error('Redaction returned instead of holding at the crash boundary');
} finally {
  clearInterval(keepAlive);
  await app.close();
}
