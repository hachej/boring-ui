import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { inboxViews } from '../../examples/workspace-app/requests-fixture.mjs';
mkdirSync('.cache/requests-test', { recursive: true });
await build({ entryPoints: ['registry/requests-board/requests.ts'], outfile: '.cache/requests-test/requests.mjs', bundle: true, format: 'esm', platform: 'node' });
const { compactRows, filterViews, requestCounts } = await import('../../.cache/requests-test/requests.mjs');

test('compact prioritizes questions, then versions to try, then most recently moved without mutating host views', () => {
  const before = structuredClone(inboxViews);
  assert.deepEqual(compactRows(inboxViews).map(view => view.number), ['D-902', 'D-901', 'D-908', 'D-904', 'D-912']);
  assert.deepEqual(inboxViews, before);
  assert.deepEqual(compactRows([]), []);
  assert.equal(compactRows(inboxViews.slice(0, 2)).length, 2);
});
test('filters, query and repository counts use the same scope', () => {
  assert.deepEqual(filterViews(inboxViews, 'yours', '').map(view => view.number), ['D-902', 'D-901']);
  assert.deepEqual(filterViews(inboxViews, 'active', ' DEVIS ').map(view => view.number), ['D-905', 'D-902', 'D-901']);
  assert.equal(filterViews(inboxViews, 'active', 'D-905', 'Atelier Exemple').length, 1);
  assert.equal(filterViews(inboxViews, 'active', 'devis', 'Atelier Exemple — vitrine').length, 0);
  assert.deepEqual(requestCounts(inboxViews), { yours: 2, active: 9, live: 2, abandoned: 1 });
  for (const [filter, count] of Object.entries(requestCounts(inboxViews, 'devis', 'Atelier Exemple'))) assert.equal(filterViews(inboxViews, filter, 'devis', 'Atelier Exemple').length, count);
});
