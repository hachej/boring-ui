import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDesign, designRoot, readDesignConfig, scanDesign } from '../scripts/check-design.mjs';

function fixture(t, source, dependencies = []) {
  const root = mkdtempSync(join(tmpdir(), 'boring-design-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
  const file = 'registry/button/button.tsx';
  write(file, source);
  write('registry.json', JSON.stringify({ items: [{ name: 'button', files: [{ path: file }], registryDependencies: dependencies }] }));
  const config = { version: 1, groups: [{ id: '1', name: 'buttons', mode: 'REPORT', folders: ['registry/'], selector: 'button' }], primitives: [] };
  const allowlist = { exceptions: [], allow: [] };
  return { root, config, allowlist, write };
}

for (const [rule, source] of [
  ['shadow', '<div className="shadow-sm hover:shadow-2xl" />'],
  ['radius', '<Button className="rounded-md rounded-full" />'],
  ['border-width', '<Button className="border border-2 border-[3px]" />'],
  ['color', '<div className="bg-[#facade] text-red-500" style={{ color: "rgb(1 2 3)" }} />'],
  ['font', '<div className="font-[Arial]" style={{ fontFamily: "Arial" }} />'],
  ['motion', '<div className="duration-150" /> .a {transition: color .12s}'],
  ['style', 'const style = "radix-nova";'],
  ['primitive', 'export function Popover() { return <button />; }'],
]) test(`design scanner detects ${rule} with a file and line`, () => {
  const findings = scanDesign('registry/button/button.tsx', `\n${source}`);
  assert.ok(findings.some(finding => finding.rule === rule && finding.line === 2 && finding.column > 0), JSON.stringify(findings));
});

test('token references and layout do not become visual literals', () => {
  assert.deepEqual(scanDesign('registry/button/button.tsx', '<div className="flex grid gap-2 w-full min-h-11 rounded-(--radius) shadow-(--shadow-sm) border-(length:--border-width)" />\n.x {border-width:var(--border-width);border-radius:var(--radius);box-shadow:var(--shadow-sm);font-family:var(--font-sans);color:var(--foreground);transition-duration:var(--duration-fast)}'), []);
});

test('REPORT inventory becomes blocking when its group flips to FAIL; new nested files are covered', t => {
  const f = fixture(t, '<div className="shadow-md" />');
  f.write('registry/button/nested/new.tsx', '<div className="rounded-full" />');
  const report = checkDesign(f.root, f);
  assert.equal(report.groups[0].count, 2);
  assert.equal(report.findings.filter(finding => finding.mode === 'FAIL').length, 0);
  f.config.groups[0].mode = 'FAIL';
  assert.equal(checkDesign(f.root, f).findings.filter(finding => finding.mode === 'FAIL').length, 2);
});

test('host primitives require both SHADCN_BUILTINS and the item dependency; owned imports are refused', t => {
  const f = fixture(t, 'import { Tooltip } from "@/components/ui/tooltip";');
  assert.ok(checkDesign(f.root, f).findings.some(finding => finding.rule === 'primitive-import'));
  f.write('registry.json', JSON.stringify({ items: [{ name: 'button', files: [{ path: 'registry/button/button.tsx' }], registryDependencies: ['tooltip'] }] }));
  assert.deepEqual(checkDesign(f.root, f).findings, []);
  f.write('registry/button/button.tsx', 'import { Tooltip } from "@/components/ui/made-up";');
  assert.ok(checkDesign(f.root, f).findings.some(finding => finding.rule === 'primitive-import'));
  f.write('registry/button/button.tsx', 'import { Button as Action } from "./home-made";');
  assert.ok(checkDesign(f.root, f).findings.some(finding => finding.rule === 'primitive-import'));
});

test('host shadcn components allow layout but not appearance overrides', t => {
  const f = fixture(t, 'import { Tooltip } from "@/components/ui/tooltip"; const a = <Tooltip className="flex gap-2 w-full" />;', ['tooltip']);
  assert.deepEqual(checkDesign(f.root, f).findings, []);
  f.write('registry/button/button.tsx', 'import { Tooltip as Tip } from "@/components/ui/tooltip"; const a = <Tip className="bg-primary h-8" />;');
  assert.ok(checkDesign(f.root, f).findings.some(finding => finding.rule === 'shadcn-restyle'));
});

test('primitive inventory names deletion and its shadcn replacement, not a restyle', t => {
  const f = fixture(t, 'export const marker = true;');
  f.config.primitives = [{ file: 'registry/button/button.tsx', replacement: '@/components/ui/button' }];
  assert.match(checkDesign(f.root, f).findings[0].value, /delete owned primitive.*@\/components\/ui\/button/);
});

test('allowances match exact file, rule and pattern with an owned reason', t => {
  const f = fixture(t, '<div className="shadow-md rounded-full" />');
  f.allowlist.exceptions.push({ id: 'fixture', reason: 'Synthetic checker test, not a production exemption.' });
  f.allowlist.allow.push({ file: 'registry/button/button.tsx', rules: ['shadow'], pattern: '^shadow-md$', exception: 'fixture' });
  const result = checkDesign(f.root, f);
  assert.equal(result.allowed.length, 1);
  assert.equal(result.findings.length, 1);
  f.allowlist.allow[0].exception = 'missing';
  assert.ok(checkDesign(f.root, f).errors.includes('Invalid design allowlist entry'));
});

test('shipped CSS objects are checked as declarations, not quoted JSON keys', t => {
  const f = fixture(t, 'export const marker = true;');
  f.write('registry.json', JSON.stringify({ items: [{ name: 'button', files: [{ path: 'registry/button/button.tsx' }], css: { '@layer components': { '.fixture': { 'border-width': '2px', 'border-radius': '0.5rem', 'box-shadow': '0 1px 5px black', 'font-family': 'Arial', 'transition-duration': '150ms' } } } }] }));
  const rules = new Set(checkDesign(f.root, f).findings.filter(finding => finding.file.endsWith('/@css')).map(finding => finding.rule));
  for (const rule of ['border-width', 'radius', 'shadow', 'font', 'motion']) assert.ok(rules.has(rule), `${rule} must inspect shipped CSS declarations`);
});

test('the committed inventory covers all source and every shipped CSS item, with no unowned group', () => {
  const result = checkDesign();
  assert.deepEqual(result.errors, []);
  assert.ok(result.files > 100);
  assert.ok(result.findings.some(finding => finding.file.endsWith('/@css')));
  assert.ok(result.allowed.length > 0, 'the optional theme definition is explicit');
  assert.deepEqual(readDesignConfig().groups.map(group => group.id), ['1', '2', '3', '4', '5', '6', '7']);
  assert.ok(result.findings.length > 0, 'group 0 cannot claim the existing custom components are conformant');
  const manifest = JSON.parse(readFileSync(join(designRoot, 'VERIFY.json'), 'utf8'));
  assert.deepEqual(manifest.invariants['BORING-UI-1'].verifiers.find(verifier => verifier.scope === 'runtime').command, ['npm', 'run', 'test:design']);
});
