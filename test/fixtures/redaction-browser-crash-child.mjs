import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRedactionBrowser } from '../../examples/redaction-browser/runtime.mjs';
import { redactionActor } from '../../examples/redaction/app.mjs';
const [directory, boundary] = process.argv.slice(2), actor = redactionActor();
const keepAlive = setInterval(() => {}, 1000);
const pause = async value => { writeFileSync(join(directory, 'ready.json'), JSON.stringify(value)); await new Promise(() => {}); };
const runtime = await openRedactionBrowser({ directory, fixtureOptions: id => id !== 'first' ? {} : {
  beforeProduce: () => new Promise(() => {}),
  ...(boundary === 'reservation' ? { afterReservationCommit: pause } : { afterAdmission: pause }),
} });
const config = await runtime.configuration(actor), target = config.consultations[0].notesTarget;
const client = runtime.resourceClient('first', 'notes', actor), read = await client.read({ target, revision: { kind: 'latest' } });
const saved = await client.publish({ operationId: 'crash-notes-save', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: read.snapshot.ref, bytes: new TextEncoder().encode('Saved fictional crash input'), mediaType: 'text/markdown' }] });
const capture = await runtime.capture('first', { subject: 'A', requestId: 'crash-generation', source: saved.receipt.changes[0].after, saveOperationId: 'crash-notes-save' }, actor);
writeFileSync(join(directory, 'request.json'), JSON.stringify(capture.request));
await runtime.admit('first', capture.request, actor);
await runtime.close(); clearInterval(keepAlive);
