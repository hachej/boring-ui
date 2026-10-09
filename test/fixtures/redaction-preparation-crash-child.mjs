import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRedactionBrowser } from '../../examples/redaction-browser/runtime.mjs';
import { redactionActor } from '../../examples/redaction/app.mjs';
const [directory, mode] = process.argv.slice(2), actor = redactionActor();
const keepAlive = setInterval(() => {}, 1000);
const pause = async value => { writeFileSync(join(directory, 'ready.json'), JSON.stringify(value)); await new Promise(() => {}); };
const runtime = await openRedactionBrowser({ directory, fixtureOptions: id => id !== 'first' ? {} : { preparation: {
  beforeProduce: () => ['reservation', 'admission'].includes(mode) ? new Promise(() => {}) : undefined,
  afterReservationCommit: value => mode === 'reservation' ? pause(value) : undefined,
  afterAdmission: ref => { writeFileSync(join(directory, 'ref.json'), JSON.stringify(ref)); return mode === 'admission' ? pause(ref) : undefined; },
  beforePublish: input => { appendFileSync(join(directory, 'attempts'), 'attempt\n'); return mode === 'missing' ? pause(input) : undefined; },
  afterCommit: result => pause(result),
} } });
const config = await runtime.configuration(actor), target = config.consultations[0].notesTarget, client = runtime.resourceClient('first', 'notes', actor);
const read = await client.read({ target, revision: { kind: 'latest' } });
const saved = await client.publish({ operationId: 'crash-notes', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: read.snapshot.ref, mediaType: 'text/markdown', bytes: new TextEncoder().encode('Fictional preparation crash input') }] });
const captured = await runtime.preparationCapture('first', { requestId: 'crash', source: saved.receipt.changes[0].after, saveOperationId: saved.receipt.operationId }, actor);
writeFileSync(join(directory, 'request.json'), JSON.stringify(captured.request));
await runtime.preparationAdmit('first', captured.request, actor);
await new Promise(() => {});
clearInterval(keepAlive);
