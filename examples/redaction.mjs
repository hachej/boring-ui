import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openRedactionFixture, redactionActor } from './redaction/app.mjs';

const directory = mkdtempSync(join(tmpdir(), 'boring-fictional-redaction-'));
const app = await openRedactionFixture({ directory }), actor = redactionActor();
try {
  const paths = app.paths('A'), encode = value => new TextEncoder().encode(value);
  const seeded = await app.local.provider.publication.publish({ operationId: 'fictional-inputs', atomicity: 'all-or-nothing', changes: [
    { kind: 'create', target: paths.source, expected: { kind: 'absent' }, bytes: encode('Fictional source. No clinical data.'), mediaType: 'text/markdown' },
    { kind: 'create', target: paths.config, expected: { kind: 'absent' },
      bytes: encode(JSON.stringify({ format: 'fictional.redaction', version: 1, prefix: '# Fictional' })), mediaType: 'application/json' },
  ] }, actor);
  if (seeded.kind !== 'committed') throw new Error('Fixture input setup failed');
  const refs = [];
  for (const subject of ['A', 'B', 'C']) {
    const captured = await app.capture(subject, `fictional-${subject.toLowerCase()}`, actor);
    if (captured.kind !== 'captured') throw new Error('Input capture failed');
    const admitted = await app.admit(captured.request, actor);
    if (admitted.kind !== 'admitted') throw new Error('Admission failed');
    refs.push(admitted.ref);
  }
  for (const ref of refs) {
    const done = await app.local.harness.waitForTask(ref.delivery, context);
    if (done.state.outcome.status !== 'completed' || done.state.outcome.result.kind !== 'committed') throw new Error('Delivery did not commit');
    console.log(JSON.stringify({ subject: ref.subject, generationId: ref.generationId, producer: ref.producer,
      delivery: ref.delivery, result: done.state.outcome.result.kind, revision: done.state.outcome.result.receipt.changes[0].after.revision }));
  }
} finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
