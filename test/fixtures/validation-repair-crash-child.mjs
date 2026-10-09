import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openValidatedOutputFixture } from '../../examples/validated-output/app.mjs';

// Keep the event loop alive until the parent's SIGKILL; an empty loop makes Node exit with code 13 on the pending promises.
setInterval(() => {}, 1000);
const directory = process.argv[2];
const scenario = process.argv[3] ?? 'repair';
const app = await openValidatedOutputFixture({ directory, scenario, afterRepairDecision: async decision => {
  writeFileSync(join(directory, 'decision-committed.json'), JSON.stringify(decision));
  await new Promise(() => {});
  writeFileSync(join(directory, 'acknowledged.json'), JSON.stringify(decision));
} });
const admitted = await app.admit('request');
if (admitted.kind !== 'admitted') throw new Error(`Admission failed: ${admitted.kind}`);
writeFileSync(join(directory, 'admitted.json'), JSON.stringify(admitted.ref));
await new Promise(() => {});
