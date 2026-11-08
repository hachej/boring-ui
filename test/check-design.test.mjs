import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkDesign, designRoot, readDesignConfig, scanDesign } from '../scripts/check-design.mjs';
import { scanAppDesign } from '../packages/ui/bin/boring-ui-blocks.mjs';

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

test('a Card carries no border, shadow or ring: the flat card is the default', () => {
  const findings = scanDesign('registry/pi-chat/tool.tsx', '\n<Card className="gap-2 border shadow-sm" />\n<Card className="ring-1" />\n<Card className="gap-2 p-3" />');
  assert.deepEqual(findings.filter(finding => finding.rule === 'design-card-flat').map(finding => finding.line), [2, 3]);
  assert.equal(scanDesign('registry/pi-chat/tool.tsx', '<CardContent className="border" />').filter(finding => finding.rule === 'design-card-flat').length, 0);
});

test('no Card is nested inside another Card; a sibling or a render prop is not nesting', () => {
  const nested = '<Card>\n  <CardContent>\n    <Card className="p-2">x</Card>\n  </CardContent>\n</Card>';
  const findings = scanDesign('registry/feedback/feedback-list.tsx', nested).filter(finding => finding.rule === 'design-no-nested-card');
  assert.deepEqual(findings.map(finding => finding.line), [3]);
  const flat = '<Card><CardContent /></Card>\n<Card />\n<Collapsible render={<Card {...card} />}><Card>x</Card></Collapsible>';
  assert.deepEqual(scanDesign('registry/feedback/feedback-list.tsx', flat).filter(finding => finding.rule === 'design-no-nested-card'), []);
});

test('app code gets the same card rules through the app profile', () => {
  const text = '<Card className="shadow-md"><Card /></Card>';
  const rules = new Set(scanAppDesign('src/app/page.tsx', text).map(finding => finding.rule));
  assert.ok(rules.has('design-card-flat') && rules.has('design-no-nested-card'));
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

test('host primitives come from the app ui alias (SHADCN_BUILTINS, no item dependency); owned imports are refused', t => {
  const f = fixture(t, 'import { Tooltip } from "@/components/ui/tooltip";');
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

test('native controls stay in FAIL group 1 across later-group folders and permit only layout', t => {
  const f = fixture(t, '', ['button', 'toggle', 'switch']);
  f.config.groups = [{ id: '1', name: 'buttons', mode: 'FAIL', folders: [], selector: 'button' }, { id: '6', name: 'cards', mode: 'REPORT', folders: ['registry/'], selector: 'section' }];
  for (const component of ['Button', 'Toggle', 'Switch']) {
    const prefix = `import { ${component} as Control } from '@/components/ui/${component.toLowerCase()}'; `;
    f.write('registry/button/button.tsx', `${prefix}const a = <Control className="w-full gap-2 whitespace-normal text-left" />;`);
    assert.deepEqual(checkDesign(f.root, f).findings, []);
    for (const appearance of ['text-muted-foreground', 'font-mono', 'rounded-(--radius)', 'border-(length:--border-width)', 'shadow-(--shadow-sm)']) {
      f.write('registry/button/button.tsx', `${prefix}const a = <Control className="${appearance}" />;`);
      const result = checkDesign(f.root, f);
      assert.ok(result.findings.some(finding => finding.rule === 'shadcn-restyle' && finding.group === '1' && finding.mode === 'FAIL'), `${component}: ${appearance} must not disappear into group 6 REPORT`);
    }
    f.write('registry/button/button.tsx', `${prefix}const a = <Control className="h-auto whitespace-normal" />;`);
    assert.deepEqual(checkDesign(f.root, f).findings, [], 'content sizing is layout');
  }
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

test('the theme gives the type roles and the sidebar surface as tokens, bound to the Tailwind size and colour utilities', () => {
  const theme = JSON.parse(readFileSync(join(designRoot, 'registry.json'), 'utf8')).items.find(item => item.name === 'theme').cssVars;
  assert.equal(theme.light['text-body'], '0.75rem');
  assert.equal(theme.light['text-title'], '0.875rem');
  assert.equal(theme.theme['text-xs'], 'var(--text-body)');
  assert.equal(theme.theme['text-sm'], 'var(--text-title)');
  for (const mode of ['light', 'dark']) {
    // Defined in both modes: a .dark subtree redefines --background, so an inherited value would go stale.
    assert.equal(theme[mode].sidebar, 'var(--background)', `${mode}: sidebar is the canvas`);
    assert.equal(theme[mode]['sidebar-accent'], 'var(--accent)', `${mode}: active item is the accent`);
  }
  assert.equal(theme.theme['color-sidebar'], 'var(--sidebar)');
});

test('the committed inventory covers all source and every shipped CSS item, with no unowned group', () => {
  const result = checkDesign();
  assert.deepEqual(result.errors, []);
  assert.ok(result.files > 100);
  // Shipped registry CSS is scanned even without a source file: the theme item's own values are found (and allowed).
  assert.ok(result.allowed.some(entry => entry.file === 'registry.json#theme'));
  assert.ok(result.allowed.length > 0, 'the optional theme definition is explicit');
  assert.deepEqual(readDesignConfig().groups.map(group => group.id), ['1', '2', '3', '4', '5', '6', '7']);
  // Every group is migrated (group 3 was the last): all are enforced and the inventory is empty.
  assert.deepEqual(readDesignConfig().groups.filter(group => group.mode !== 'FAIL').map(group => group.id), []);
  assert.deepEqual(result.findings, []);
  const manifest = JSON.parse(readFileSync(join(designRoot, 'VERIFY.json'), 'utf8'));
  assert.deepEqual(manifest.invariants['BORING-UI-1'].verifiers.find(verifier => verifier.scope === 'runtime').command, ['npm', 'run', 'test:design']);
});

// D-1745: the host-control rule must not be evaded by member tags, descendant variants or a class held in a const.
const restyled = (f, source) => { f.write('registry/button/button.tsx', source); return checkDesign(f.root, f).findings.filter(finding => finding.rule === 'shadcn-restyle'); };

test('member-expression host controls cannot be restyled', t => {
  const f = fixture(t, '', ['textarea', 'button']);
  const textarea = 'import { Textarea } from "@/components/ui/textarea"; const editorControls = { textarea: Textarea };';
  assert.equal(restyled(f, `${textarea} const a = <editorControls.textarea className="bg-card" />;`).length, 1);
  assert.equal(restyled(f, 'import * as ui from "@/components/ui/button"; const a = <ui.Button className="rounded-full" />;').length, 1);
  assert.equal(restyled(f, `${textarea} const a = <editorControls.textarea className="w-full gap-2" />;`).length, 0, 'layout stays allowed');
  assert.equal(restyled(f, 'const a = <motion.div className="bg-card" />;').length, 0, 'not a host control');
});

test('arbitrary descendant variants cannot restyle a host control', t => {
  const f = fixture(t, '');
  assert.equal(restyled(f, 'const a = <form className="[&_[data-slot=input-group]]:bg-card" />;').length, 1);
  assert.equal(restyled(f, 'const a = <div className="flex [&_button]:bg-card" />;').length, 1);
  assert.equal(restyled(f, 'const a = <div className="[&_button]:size-11" />;').length, 0, '44px touch metric stays allowed');
  assert.equal(restyled(f, 'const a = <div className="[&_button]:w-full [&_svg]:size-4" />;').length, 0, 'layout and non-controls stay allowed');
});

test('a class held in a const is checked when passed to a host control', t => {
  const f = fixture(t, '');
  const button = 'import { Button } from "@/components/ui/button"; ';
  assert.equal(restyled(f, `${button}const cls = "bg-card px-4"; const a = <Button className={cls} />;`).length, 1);
  assert.equal(restyled(f, `${button}const cls = cn("w-full", "shadow-sm"); const a = <Button className={cls} />;`).length, 1);
  assert.equal(restyled(f, `${button}const cls = "w-full gap-2"; const a = <Button className={cls} />;`).length, 0);
  assert.equal(restyled(f, 'const cls = "bg-card"; const a = <div className={cls} />;').length, 0);
});

test('space-card skins its clickable Button through item css, never through classes on the Button (D-1745)', () => {
  const source = readFileSync(join(designRoot, 'registry/space-card/space-card.tsx'), 'utf8');
  const button = /<Button\b[^>]*>/.exec(source)[0];
  assert.match(button, /data-boring="space-card"/);
  assert.doesNotMatch(button, /className=\{cn\([^)]*(?:skin|hoverFill)/);
  assert.match(source, /const layout = '[^']*'/);
  assert.doesNotMatch(/const layout = '([^']*)'/.exec(source)[1], /(?<![\w-])(?:bg|rounded|border|shadow|ring|text-(?!left)|p[xytrbl]?)-|hover:/, 'the Button layout holds no appearance');
  const css = JSON.parse(readFileSync(join(designRoot, 'registry.json'), 'utf8')).items.find(item => item.name === 'space-card').css['@layer utilities'];
  const scope = '[data-slot="button"][data-boring="space-card"]';
  assert.deepEqual(Object.keys(css), [scope, `${scope}:hover`]);
  assert.deepEqual(css[scope], { 'background-color': 'var(--card)', color: 'var(--card-foreground)', 'border-radius': 'var(--radius)', padding: '0.75rem' });
  assert.equal(css[`${scope}:hover`]['background-color'], 'var(--accent)');
  assert.deepEqual(checkDesign().findings.filter(finding => finding.file.startsWith('registry/space-card/')), []);
});

// D-1767: size="inline" is the sanctioned way to a link label in a row; the h-auto p-0 min-h-0 override it replaces still fires.
test('Button size="inline" passes the host-control rule and the h-auto p-0 min-h-0 override still fires', t => {
  const f = fixture(t, '', ['button']);
  const button = 'import { Button } from "@/components/ui/button";';
  assert.equal(restyled(f, `${button} const a = <Button size="inline">Compte 706</Button>;`).length, 0);
  assert.equal(restyled(f, `${button} const a = <Button variant="link" size="inline" className="whitespace-nowrap">Compte 706</Button>;`).length, 0, 'layout stays allowed');
  assert.equal(restyled(f, `${button} const a = <Button variant="link" className="h-auto p-0 min-h-0">Compte 706</Button>;`).length, 1);
});

test('the design-system page (lab/design-system) is under the design gate: a palette colour there fails, a clean file does not', t => {
  const f = fixture(t, '<div className="flex" />');
  f.config.groups[0].folders.push('lab/design-system/');
  f.config.groups[0].mode = 'FAIL';
  f.write('lab/design-system/clean.jsx', 'export const A = () => <div className="flex gap-2 bg-background text-foreground" />;');
  assert.deepEqual(checkDesign(f.root, f).findings.filter(finding => finding.file.startsWith('lab/')), []);
  f.write('lab/design-system/dirty.jsx', 'export const B = () => <div className="bg-red-500" />;');
  const found = checkDesign(f.root, f).findings.filter(finding => finding.file === 'lab/design-system/dirty.jsx');
  assert.deepEqual(found.map(finding => [finding.rule, finding.mode]), [['color', 'FAIL']]);
  // The real repository: the page's own sources have no finding.
  assert.deepEqual(checkDesign(designRoot).findings.filter(finding => finding.file.startsWith('lab/design-system/')), []);
});
