import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK_ITEMS, LEVELS } from '../packages/ui/bin/boring-ui-blocks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = join(root, 'packages/ui/bin/boring-ui-blocks.mjs');
const fixture = join(root, 'test/fixtures/design-app/web/src');

// Every assertion goes through the real command: the bin is spawned, as an app's verify does.
const run = (...args) => spawnSync(process.execPath, [bin, 'design', ...args], { cwd: root, encoding: 'utf8' });
const json = (...args) => { const result = run(...args, '--json'); return { status: result.status, ...JSON.parse(result.stdout) }; };

// The fixture bundle app (no components.json, no components/ui): one violation per rule, and clean.tsx.
const EXPECTED = {
  'raw-element': ['raw-element.tsx', 'error'],
  'kit-block': ['kit-block.tsx', 'warn'],
  'design-card-flat': ['card-flat.tsx', 'error'],
  'design-icons-phosphor': ['icons.tsx', 'warn'],
  'design-touch-target': ['touch-target.tsx', 'warn'],
  'design-button-raw-height': ['button-raw-height.tsx', 'warn'],
  'design-no-dark-overrides': ['dark.tsx', 'error'],
  'design-link-token': ['link-token.tsx', 'error'],
  'design-mono-for-code': ['mono.tsx', 'error'],
  'design-tokens-only': ['tokens-only.tsx', 'warn'],
  'design-color': ['color.tsx', 'warn'],
  'design-font-tokens': ['font.css', 'warn'],
  'design-no-kit-restyle': ['restyle.css', 'warn'],
  'design-no-important': ['important.css', 'warn'],
  'design-hand-touch-size': ['hand-touch.tsx', 'warn'],
};

const report = json(fixture);

for (const [rule, [file, level]] of Object.entries(EXPECTED)) test(`design ${rule} reports ${file} as ${level} with file:line and a fix`, () => {
  const found = report.findings.filter(finding => finding.rule === rule);
  assert.ok(found.length, `no ${rule} finding`);
  assert.ok(found.every(finding => finding.file.endsWith(`/${file}`) && finding.level === level && finding.line > 0 && finding.message.length > 20), JSON.stringify(found));
  assert.equal(LEVELS[rule], level, 'the LEVELS table is the one place a rule gets its level');
});

test('the fixture hits only its own rule, the clean file and the theme file report nothing, and a path-wide error fails the run', () => {
  assert.deepEqual(report.findings.filter(finding => /\/(?:clean\.tsx|theme\.core\.css)$/.test(finding.file)), []);
  for (const finding of report.findings) assert.equal(finding.file.endsWith(`/${EXPECTED[finding.rule]?.[0]}`), true, `${finding.rule} in ${finding.file}`);
  assert.equal(report.ok, false);
  assert.equal(report.status, 1);
  assert.equal(report.errors, report.findings.filter(finding => finding.level === 'error').length);
  assert.deepEqual(Object.keys(report.counts).sort(), Object.keys(EXPECTED).sort());
});

test('every rule in the level table has a fixture, and every error in the template stays an error', () => {
  assert.deepEqual(Object.keys(LEVELS).filter(rule => !(rule in EXPECTED) && !['line-length', 'component-length', 'file-length', 'design-border-width', 'design-literal-value', 'design-dark-variant', 'design-no-x-scroll'].includes(rule)), []);
  for (const rule of ['raw-element', 'design-card-flat', 'design-no-dark-overrides', 'design-link-token', 'design-mono-for-code']) assert.equal(LEVELS[rule], 'error');
});

test('text output is file:line rule message, warnings are prefixed, the exit code is 1 on an error', () => {
  const result = run(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^test\/fixtures\/design-app\/web\/src\/link-token\.tsx:1 design-link-token link <a> without text-link/m);
  assert.match(result.stdout, /^warning test\/fixtures\/design-app\/web\/src\/tokens-only\.tsx:1 design-tokens-only arbitrary value w-\[340px\]/m);
});

test('--changed limits the run to the listed files', () => {
  const only = json(fixture, '--changed', join(fixture, 'icons.tsx'));
  assert.deepEqual(only.findings.map(finding => finding.rule), ['design-icons-phosphor']);
  assert.equal(only.status, 0, 'a warning alone does not fail the run');
  const clean = json(fixture, '--changed', join(fixture, 'clean.tsx'), join(fixture, 'theme.core.css'));
  assert.deepEqual(clean.findings, []);
  assert.equal(clean.ok, true);
});

test('line, component and file length limits (ported from the template) fail the run', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'web/src'), { recursive: true });
  writeFileSync(join(dir, 'web/src/long-line.tsx'), `export const A = () => <div title="${'x'.repeat(210)}" />;\n`);
  writeFileSync(join(dir, 'web/src/long-component.tsx'), `export function B() {\n  return (\n    <div>\n${'      <span />\n'.repeat(151)}    </div>\n  );\n}\n`);
  writeFileSync(join(dir, 'web/src/long-file.tsx'), `export const C = 1;\n${'// filler\n'.repeat(401)}`);
  const result = spawnSync(process.execPath, [bin, 'design', 'web/src', '--json'], { cwd: dir, encoding: 'utf8' });
  const found = JSON.parse(result.stdout);
  assert.equal(result.status, 1);
  assert.deepEqual(found.findings.map(finding => finding.rule).sort(), ['component-length', 'file-length', 'line-length']);
});

test('structural arbitrary values and var() pass; platform-owned paths are skipped', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'web/src/platform'), { recursive: true });
  writeFileSync(join(dir, 'platform.json'), JSON.stringify({ paths: ['web/src/platform'] }));
  writeFileSync(join(dir, 'web/src/platform/owned.tsx'), 'export const O = () => <div className="w-[340px]" />;\n');
  writeFileSync(join(dir, 'web/src/ok.tsx'), 'export const K = () => <div className="grid-cols-[auto_1fr] aspect-[16/9] h-[var(--row-h)] [&>svg]:size-4 data-[state=open]:p-2" />;\n');
  const result = spawnSync(process.execPath, [bin, 'design', 'web/src', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result.stdout).findings, []);
  assert.equal(result.status, 0);
});

test('bad arguments exit 2 with the usage', () => {
  assert.equal(run().status, 2);
  assert.equal(run('no/such/dir').status, 2);
  assert.match(run(fixture, '--nope').stderr, /usage: boring-ui-blocks design/);
});

test('every block a kit-block hint names is an item of registry.json', () => {
  const items = new Set(JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).items.map(item => item.name));
  for (const [need, names] of Object.entries(BLOCK_ITEMS)) for (const name of names) assert.ok(items.has(name), `${need}: ${name}`);
  assert.match(report.findings.find(finding => finding.rule === 'kit-block').message, /FilePick/);
});
