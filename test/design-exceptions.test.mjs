import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = process.env.DESIGN_BIN ?? join(root, 'packages/ui/bin/boring-ui-blocks.mjs');
const hit = '<div className="bg-[#fff]" />';

// An app with 3 design-color hits in a.tsx and 1 in b.tsx (when `withB`); every case spawns the real bin.
function app(t, { withB = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-exc-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'web/src'), { recursive: true });
  writeFileSync(join(dir, 'web/src/a.tsx'), `export const A = () => (\n  <>\n    ${hit}\n    ${hit}\n    ${hit}\n  </>\n);\n`);
  if (withB) writeFileSync(join(dir, 'web/src/b.tsx'), `export const B = () => ${hit};\n`);
  return dir;
}
const list = (dir, value) => writeFileSync(join(dir, 'web/src/design.exceptions.json'), JSON.stringify(value));
const design = (dir, ...args) => {
  const result = spawnSync(process.execPath, [bin, 'design', 'web/src', ...args], { cwd: dir, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json: result.stdout.trim().startsWith('{') ? JSON.parse(result.stdout) : null };
};

test('hits up to the listed count are excepted (excepted: true) and do not fail', t => {
  const dir = app(t);
  list(dir, { 'design-color': { 'a.tsx': 3 } });
  const { status, json } = design(dir, '--json');
  assert.equal(status, 0);
  assert.equal(json.errors, 0);
  assert.equal(json.excepted, 3);
  assert.deepEqual(json.findings.map(finding => [finding.rule, finding.excepted, finding.level]), Array(3).fill(['design-color', true, 'error']));
});

test('a hit above the listed count fails at its level, the ones within it are excepted', t => {
  const dir = app(t);
  list(dir, { 'design-color': { 'a.tsx': 2 } });
  const { status, json } = design(dir, '--json');
  assert.equal(status, 1);
  assert.equal(json.errors, 1);
  assert.deepEqual(json.findings.map(finding => finding.excepted === true), [true, true, false]);
});

test('a hit in an unlisted file fails', t => {
  const dir = app(t, { withB: true });
  list(dir, { 'design-color': { 'a.tsx': 3 } });
  const { status, json } = design(dir, '--json');
  assert.equal(status, 1);
  assert.deepEqual(json.findings.filter(finding => !finding.excepted).map(finding => finding.file.split('/').pop()), ['b.tsx']);
});

test('a count above the real count, and a listed rule or file with no hits, give design-exceptions-shrink', t => {
  const dir = app(t);
  list(dir, { 'design-color': { 'a.tsx': 5, 'gone.tsx': 1 }, 'design-no-important': { 'a.tsx': 2 } });
  const { status, json } = design(dir, '--json');
  assert.equal(status, 1);
  const shrink = json.findings.filter(finding => finding.rule === 'design-exceptions-shrink');
  assert.equal(shrink.length, 3);
  assert.ok(shrink.every(finding => finding.level === 'error' && finding.file.endsWith('design.exceptions.json')));
  assert.ok(shrink.some(finding => /design-color in a\.tsx: 3 hits left, lower the list to 3/.test(finding.message)));
  assert.ok(shrink.some(finding => /design-color in gone\.tsx: 0 hits left, lower the list to 0/.test(finding.message)));
  assert.ok(shrink.some(finding => /design-no-important in a\.tsx: 0 hits left/.test(finding.message)));
  assert.equal(json.findings.filter(finding => finding.excepted).length, 3);
});

test('--baseline prints the list for the current hits, writes nothing, and feeding it back (--exceptions) gives 0 errors and 0 shrink', t => {
  const dir = app(t, { withB: true });
  const baseline = design(dir, '--baseline');
  assert.equal(baseline.status, 0);
  assert.deepEqual(JSON.parse(baseline.stdout), { 'design-color': { 'a.tsx': 3, 'b.tsx': 1 } });
  assert.equal(design(dir, '--json').status, 1, 'nothing was written: the app still fails');
  writeFileSync(join(dir, 'round-trip.json'), baseline.stdout);
  const back = design(dir, '--exceptions', 'round-trip.json', '--json');
  assert.equal(back.status, 0);
  assert.equal(back.json.errors, 0);
  assert.equal(back.json.findings.filter(finding => finding.rule === 'design-exceptions-shrink').length, 0);
  assert.equal(back.json.excepted, 4);
});

test('a missing --exceptions file is a usage error and a malformed count is a fatal error', t => {
  const dir = app(t);
  assert.equal(design(dir, '--exceptions', 'nope.json').status, 2);
  list(dir, { 'design-color': { 'a.tsx': 0 } });
  const bad = design(dir, '--json');
  assert.equal(bad.status, 1);
  assert.match(bad.json.error, /positive integer/);
});
