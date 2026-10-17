import assert from 'node:assert/strict';
import test from 'node:test';
import { designFailures } from '../scripts/test-design.mjs';

const config = mode => ({ groups: [{ id: '1', mode }] });
const samples = () => ['stock', 'brand'].flatMap(theme => ['light', 'dark'].flatMap(mode => [1440, 390].map(width => ({ surface: `${theme}-${mode}-${width}`, theme, mode, width, contrast: [{ foreground: 'foreground', background: 'background', ratio: 7, pass: true }], groups: [{ id: '1', elements: 1, checks: 6, violations: [] }] }))));

test('REPORT does not conceal failed role contrast', () => {
  const audits = samples();
  audits[0].contrast[0] = { foreground: 'foreground', background: 'background', ratio: 2, pass: false };
  assert.match(designFailures(audits, config('REPORT'))[0], /contrast 2.00 < 4.5/);
});

test('flipping a migrated group makes computed violations blocking', () => {
  const audits = samples();
  audits[0].groups[0].violations = [{ family: 'border-width', actual: '1px', expected: '2px' }];
  assert.deepEqual(designFailures(audits, config('REPORT')), []);
  assert.match(designFailures(audits, config('FAIL'))[0], /group 1: 1 computed-style violations/);
});

test('a migrated group needs actual samples in every theme, mode and viewport', () => {
  assert.deepEqual(designFailures(samples(), config('FAIL')), []);
  const audits = samples();
  audits[7].groups[0].elements = 0;
  assert.deepEqual(designFailures(audits, config('FAIL')), ['group 1: no coverage for brand/dark/390']);
  assert.equal(designFailures([], config('FAIL')).length, 8);
});
