import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openValidatedOutputFixture } from './validated-output/app.mjs';

const directory = mkdtempSync(join(tmpdir(), 'boring-validated-output-'));
const app = await openValidatedOutputFixture({ directory });
try {
  const admitted = await app.admit('fictional-request');
  if (admitted.kind !== 'admitted') throw new Error(`Fictional admission failed: ${admitted.kind}`);
  const [producer, validation, delivery] = await Promise.all([
    app.harness.waitForTask(admitted.ref.producer, context),
    app.harness.waitForTask(admitted.ref.validation, context),
    app.harness.waitForTask(admitted.ref.delivery, context),
  ]);
  if (producer.state.outcome.status !== 'completed' || validation.state.outcome.status !== 'completed'
    || validation.state.outcome.result.kind !== 'valid' || delivery.state.outcome.status !== 'completed'
    || delivery.state.outcome.result.kind !== 'committed') throw new Error('Fictional validation or publication did not succeed');
  console.log(JSON.stringify({ generated: producer.state.outcome.result?.text,
    evidence: producer.state.outcome.result?.evidence,
    validation: validation.state.outcome.result?.kind,
    publication: delivery.state.outcome.result?.kind,
    modelCalls: app.fake.calls.length }, null, 2));
} finally {
  await app.close();
  rmSync(directory, { recursive: true, force: true });
}
