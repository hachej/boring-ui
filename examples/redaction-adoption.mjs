import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openRedactionFixture, redactionActor } from './redaction/app.mjs';
import { decode, encode } from './redaction/bindings.mjs';

const directory = mkdtempSync(join(tmpdir(), 'boring-fictional-redaction-adoption-'));
let app;
try {
  app = await openRedactionFixture({ directory });
  const actor = redactionActor();
  const subject = 'A';
  const sourceText = 'Fictional source. No clinical data.';
  const correctedText = 'Human corrected fictional source.';
  const paths = app.paths(subject);
  const seeded = await app.local.provider.publication.publish({ operationId: 'fictional-adoption-inputs',
    atomicity: 'all-or-nothing', changes: [
      { kind: 'create', target: paths.source, expected: { kind: 'absent' },
        bytes: encode(sourceText), mediaType: 'text/markdown' },
      { kind: 'create', target: paths.config, expected: { kind: 'absent' },
        bytes: encode({ format: 'fictional.redaction', version: 2, prefix: '# Fictional',
          proposal: { order: ['source', 'calculation'], maxRepairs: 1, scenario: 'repair' } }), mediaType: 'application/json' },
    ] }, actor);
  assert.equal(seeded.kind, 'committed');

  const captured = await app.capture(subject, 'fictional-proposal', actor);
  assert.equal(captured.kind, 'captured');
  const proposed = await app.admitProposal(captured.request, actor);
  assert.equal(proposed.kind, 'admitted');
  const validation = await app.local.harness.waitForTask(proposed.ref.validation, context);
  assert.equal(validation.state.outcome.status, 'completed');
  assert.equal(validation.state.outcome.result.kind, 'valid');
  const delivery = await app.local.harness.waitForTask(proposed.ref.delivery, context);
  assert.equal(delivery.state.outcome.status, 'completed');
  assert.equal(delivery.state.outcome.result.kind, 'committed');

  const view = await app.viewProposal(proposed.ref, actor);
  assert.equal(view.kind, 'ready');
  assert.deepEqual(view.value.items, [
    { itemId: view.catalog.source, text: sourceText },
    { itemId: view.catalog.calculation, text: '4' },
  ]);
  const sourceSlot = view.corrections.find(item => item.itemId === view.catalog.source);
  assert.equal(sourceSlot.value, null);
  const correction = await app.correctItem(proposed.ref, { requestId: 'fictional-source-correction',
    itemId: view.catalog.source, expected: sourceSlot.expected, text: correctedText }, actor);
  assert.equal(correction.kind, 'committed');

  const chosen = await app.captureAdoption(proposed.ref, [
    { itemId: view.catalog.source, kind: 'corrected' },
    { itemId: view.catalog.calculation, kind: 'proposed' },
  ], 'fictional-mixed-adoption', actor);
  assert.equal(chosen.kind, 'captured');
  const admitted = await app.adopt(chosen.request, actor);
  assert.equal(admitted.kind, 'admitted');
  const completed = await app.local.harness.waitForTask(admitted.ref.taskId, context);
  assert.equal(completed.state.outcome.status, 'completed');
  const result = await app.adoptionResult(admitted.ref, actor);
  assert.equal(result.kind, 'committed');
  assert.equal(result.receipt.changes.length, 2);
  const targets = app.domainPaths(subject);
  const [record, letter] = await Promise.all([targets.record, targets.letter].map(target =>
    app.local.provider.read({ target, revision: { kind: 'latest' } }, actor)));
  assert.equal(record.kind, 'available');
  assert.equal(letter.kind, 'available');
  assert.deepEqual(JSON.parse(decode(record.snapshot, 'application/json', 8192)), {
    format: 'fictional.redaction.record', version: 1, subject, proposal: proposed.ref.validation,
    items: [
      { itemId: view.catalog.source, text: correctedText, kind: 'corrected' },
      { itemId: view.catalog.calculation, text: '4', kind: 'proposed' },
    ],
  });
  const letterText = `# Fictional ${subject}\n${correctedText}\n4`;
  assert.equal(decode(letter.snapshot, 'text/markdown', 8192), letterText);
  assert.deepEqual(result.receipt.changes.map(change => change.after.revision),
    [record.snapshot.ref.revision, letter.snapshot.ref.revision]);
  console.log(JSON.stringify({ subject, proposal: proposed.ref.validation,
    adoption: admitted.ref.taskId, recordRevision: record.snapshot.ref.revision,
    letterRevision: letter.snapshot.ref.revision, letter: letterText }));
} finally {
  if (app) await app.close();
  rmSync(directory, { recursive: true, force: true });
}
