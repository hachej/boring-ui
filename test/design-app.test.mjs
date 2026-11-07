import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK_ITEMS, CORE_ROLES, KIT_DERIVED, KIT_SLOTS, LEVELS } from '../packages/ui/bin/boring-ui-blocks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bin = join(root, 'packages/ui/bin/boring-ui-blocks.mjs');
const fixture = join(root, 'test/fixtures/design-app/web/src');

// Every assertion goes through the real command: the bin is spawned, as an app's verify does.
const run = (...args) => spawnSync(process.execPath, [bin, 'design', ...args], { cwd: root, encoding: 'utf8' });
const json = (...args) => { const result = run(...args, '--json'); return { status: result.status, ...JSON.parse(result.stdout) }; };

// The fixture bundle app (no components.json, no components/ui): one violation per rule, and clean.tsx.
const EXPECTED = {
  'raw-element': ['raw-element.tsx', 'error'],
  'kit-block': ['kit-block.tsx', 'error'],
  'design-card-flat': ['card-flat.tsx', 'error'],
  'design-icons-phosphor': ['icons.tsx', 'error'],
  'design-touch-target': ['touch-target.tsx', 'error'],
  'design-button-raw-height': ['button-raw-height.tsx', 'error'],
  'design-no-dark-overrides': ['dark.tsx', 'error'],
  'design-link-token': ['link-token.tsx', 'error'],
  'design-mono-for-code': ['mono.tsx', 'error'],
  'design-tokens-only': ['tokens-only.tsx', 'error'],
  'design-color': ['color.tsx', 'error'],
  'design-font-tokens': ['font.css', 'error'],
  'design-no-kit-restyle': ['restyle.css', 'error'],
  'design-no-important': ['important.css', 'error'],
  'design-hand-touch-size': ['hand-touch.tsx', 'error'],
  'design-border-width': ['border-width.tsx', 'error'],
  'design-literal-value': ['literal-value.css', 'error'],
  'design-dark-variant': ['dark-variant.tsx', 'error'],
  'design-no-x-scroll': ['x-scroll.tsx', 'error'],
  'design-overlay-has-title': ['overlay.tsx', 'error'],
};
// The rules with no file of their own in the fixture app: the length limits (a temp app below) and the theme rules (test/fixtures/design-theme).
const ELSEWHERE = ['line-length', 'component-length', 'file-length', 'design-theme-core-only', 'design-theme-roles-both-modes', 'design-theme-local-derived', 'design-exceptions-shrink'];

const report = json(fixture);

for (const [rule, [file, level]] of Object.entries(EXPECTED)) test(`design ${rule} reports ${file} as ${level} with file:line and a fix`, () => {
  const found = report.findings.filter(finding => finding.rule === rule);
  assert.ok(found.length, `no ${rule} finding`);
  assert.ok(found.every(finding => finding.file.endsWith(`/${file}`) && finding.level === level && finding.line > 0 && finding.message.length > 20), JSON.stringify(found));
  assert.equal(LEVELS[rule], level, 'the LEVELS table is the one place a rule gets its level');
});

test('the fixture hits only its own rule, the clean file and the theme file report nothing, and a path-wide error fails the run', () => {
  assert.deepEqual(report.findings.filter(finding => /\/(?:clean\.tsx|clean\.css|theme\.core\.css)$/.test(finding.file)), []);
  for (const finding of report.findings) assert.equal(finding.file.endsWith(`/${EXPECTED[finding.rule]?.[0]}`), true, `${finding.rule} in ${finding.file}`);
  assert.equal(report.ok, false);
  assert.equal(report.status, 1);
  assert.equal(report.errors, report.findings.filter(finding => finding.level === 'error').length);
  assert.deepEqual(Object.keys(report.counts).sort(), Object.keys(EXPECTED).sort());
});

test('every rule in the level table has a fixture, and every rule is an error (frozen by design-master)', () => {
  assert.deepEqual(Object.keys(LEVELS).filter(rule => !(rule in EXPECTED) && !ELSEWHERE.includes(rule)), []);
  for (const rule of Object.keys(LEVELS)) assert.equal(LEVELS[rule], 'error', rule);
});

test('text output is file:line rule message, no finding is a warning outside a legacy components/ui, the exit code is 1 on an error', () => {
  const result = run(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^test\/fixtures\/design-app\/web\/src\/link-token\.tsx:1 design-link-token link <a> without text-link/m);
  assert.match(result.stdout, /^test\/fixtures\/design-app\/web\/src\/tokens-only\.tsx:1 design-tokens-only arbitrary value w-\[340px\]/m);
});

test('--changed limits the run to the listed files', () => {
  const only = json(fixture, '--changed', join(fixture, 'icons.tsx'));
  assert.deepEqual(only.findings.map(finding => finding.rule), ['design-icons-phosphor']);
  assert.equal(only.status, 1);
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

// ---- Round 2: theme rules, one finding per hit, the breaker's cases ---------------------------------------------------------------

// The four rules at error (design-color, design-literal-value, design-dark-variant, design-font-tokens): what must not hit.
test('false-positive guard: a code sample, user text, a test file, an svg asset, url(#id), aspect/grid/z/calc values, dark: in a comment, var() fonts and @font-face in theme.core.css do not hit', () => {
  const report = json(join(root, 'test/fixtures/design-fp/web/src'));
  const four = ['design-color', 'design-literal-value', 'design-dark-variant', 'design-font-tokens', 'design-tokens-only'];
  assert.deepEqual(report.findings.filter(finding => four.includes(finding.rule)), []);
  assert.deepEqual(report.findings, [], 'the whole fixture is clean, design-no-dark-overrides and design-dark-variant included');
  assert.equal(report.status, 0);
  assert.equal(run(join(root, 'test/fixtures/design-fp/web/src')).status, 0);
});

test('round 7: an empty components/ui folder does not downgrade the rest of the app; only files inside it are warnings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  try {
    mkdirSync(join(dir, 'components/ui'), { recursive: true });
    writeFileSync(join(dir, 'a.tsx'), 'export const A = () => <div className="bg-[#fff]" />;\n');
    const report = json(dir);
    assert.ok(report.findings.length > 0);
    assert.ok(report.findings.every(finding => finding.level === 'error'), JSON.stringify(report.findings));
    assert.equal(report.status, 1);
    writeFileSync(join(dir, 'components/ui/b.tsx'), 'export const B = () => <div className="bg-[#fff]" />;\n');
    const both = json(dir);
    assert.ok(both.findings.filter(finding => finding.file.endsWith('/components/ui/b.tsx')).every(finding => finding.level === 'warn'));
    assert.ok(both.findings.filter(finding => finding.file.endsWith('/a.tsx')).every(finding => finding.level === 'error'));
    assert.equal(both.status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('round 7: a palette class name in a plain string is not design-color; in a class or a colour property it is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  try {
    writeFileSync(join(dir, 'sample.ts'), 'const example = "text-red-500";\nconst other = "bg-blue-600 is a palette class";\n');
    const sample = json(dir);
    assert.deepEqual(sample.findings.filter(finding => finding.rule === 'design-color'), []);
    assert.equal(sample.status, 0);
    writeFileSync(join(dir, 'real.tsx'), 'export const A = () => <div className="text-red-500" />;\n');
    const real = json(dir);
    assert.ok(real.findings.some(finding => finding.rule === 'design-color' && finding.file.endsWith('/real.tsx')));
    assert.equal(real.status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the four promoted rules are errors in LEVELS and a real hit of each fails the run', () => {
  for (const rule of ['design-color', 'design-literal-value', 'design-dark-variant', 'design-font-tokens']) assert.equal(LEVELS[rule], 'error');
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  try {
    writeFileSync(join(dir, 'a.tsx'), 'export const A = () => <div className="bg-[#fff] dark:p-2" style={{ color: "#ff0000", borderRadius: "9px", fontFamily: "Georgia" }} />;\n');
    const report = json(dir);
    for (const rule of ['design-color', 'design-literal-value', 'design-dark-variant', 'design-font-tokens']) assert.ok(report.findings.some(finding => finding.rule === rule && finding.level === 'error'), rule);
    assert.equal(report.status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const themeBad = json(join(root, 'test/fixtures/design-theme/bad/web/src'));
const themeFindings = (rule, file) => themeBad.findings.filter(finding => finding.rule === rule && finding.file.endsWith(`/${file}`)).map(finding => finding.line);

test('design-theme-core-only: a kit-derived name above the EXCEPTIONS comment is a hit (line 4, and again in .dark at 14); an app token (--pm-gold, --shadow-halo) and a core role are not', () => {
  const lines = themeFindings('design-theme-core-only', 'theme.core.css');
  assert.ok(lines.includes(4) && lines.includes(14));
  assert.ok(!lines.includes(5) && !lines.includes(6) && !lines.includes(2) && !lines.includes(3) && !lines.includes(7), `app tokens and core roles are never hits: ${lines}`);
  assert.deepEqual(themeFindings('design-theme-core-only', 'theme.derived.css'), [], 'theme.derived.css is reported once, by design-theme-local-derived');
  assert.deepEqual(themeFindings('design-theme-local-derived', 'theme.derived.css'), [1]);
  assert.ok(themeBad.findings.filter(finding => finding.rule.startsWith('design-theme')).every(finding => finding.level === 'error' && LEVELS[finding.rule] === 'error'));
});

test('design-theme-core-only: a token pinned below the comment with an entry in DESIGN.md exceptions is fine; two without an entry are ONE hit for the missing reason', () => {
  const lines = themeFindings('design-theme-core-only', 'theme.core.css');
  assert.deepEqual(lines, [4, 14, 20]);
  const missing = themeBad.findings.filter(finding => finding.rule === 'design-theme-core-only' && finding.line === 20);
  assert.equal(missing.length, 1);
  assert.match(missing[0].message, /2 token\(s\).*--link, --input/);
  assert.ok(!/--brand-teal/.test(missing[0].message));
});

test('KIT_DERIVED and CORE_ROLES do not overlap', () => {
  assert.deepEqual(KIT_DERIVED.filter(name => CORE_ROLES.includes(name)), []);
});

test('design-theme-roles-both-modes: a kit-defined colour role (core or pinned) in :root and not in .dark is reported, and the reverse; an app-own token (--cta, set in :root only) is never a hit; app tokens, non-colour roles and the exceptions are not', () => {
  assert.deepEqual(themeFindings('design-theme-roles-both-modes', 'theme.core.css'), [7, 20, 20], 'a kit role set in :root only, above or pinned below the comment');
  const messages = themeBad.findings.filter(finding => finding.rule === 'design-theme-roles-both-modes').map(finding => finding.message);
  assert.ok(messages.some(message => /--accent is set in :root but not in \.dark/.test(message)));
  assert.ok(!messages.some(message => /--radius|--brand-teal|--shadow-halo|--pm-gold|--cta/.test(message)));
});

test('round 8: a kit name pinned in one mode passes when every var() in its value follows to a both-modes token or a core role; a literal, a :root-only token, a missing token and a cycle fail', () => {
  const lines = (pinned, ...extra) => {
    const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
    try {
      mkdirSync(join(dir, 'web/src'), { recursive: true });
      const css = `:root {\n  --background: oklch(1 0 0);\n  --card: oklch(0.98 0 0);\n  ${extra.join('\n  ')}\n}\n.dark {\n  --background: oklch(0.1 0 0);\n  --card: oklch(0.2 0 0);\n}\n/* === EXCEPTIONS === */\n:root { ${pinned} }\n`;
      writeFileSync(join(dir, 'web/src/theme.core.css'), css);
      writeFileSync(join(dir, 'DESIGN.md'), '## Exceptions\n\n- `--popover` a reason\n- `--secondary` a reason\n');
      return json(join(dir, 'web/src')).findings.filter(finding => finding.rule === 'design-theme-roles-both-modes').length;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  assert.equal(lines('--popover: var(--card);'), 0, 'var of a both-modes token');
  assert.equal(lines('--popover: var(--background);'), 0, 'var of a core role');
  assert.equal(lines('--popover: color-mix(in oklch, var(--card) 50%, var(--background));'), 0);
  assert.equal(lines('--popover: #fff;'), 1, 'a literal in :root only');
  assert.equal(lines('--popover: var(--x);', '--x: oklch(0.5 0 0);'), 1, 'a var of a :root-only token');
  assert.equal(lines('--popover: var(--x);', '--x: var(--y);', '--y: oklch(0.5 0 0);'), 1, 'a chain that ends at a :root-only literal');
  assert.equal(lines('--popover: var(--x);', '--x: var(--card);'), 0, 'a chain that ends at a both-modes token');
  assert.equal(lines('--popover: var(--nowhere);'), 1, 'a missing token');
  assert.equal(lines('--popover: var(--x);', '--x: var(--popover);'), 1, 'a cycle');
  assert.equal(lines('--popover: var(--secondary); --secondary: var(--popover);'), 2, 'a cycle between two pins');
});

test('round 8: a DrawerContent whose {body} is bound in the same file passes when that binding holds the DrawerTitle, and fails when it holds none', () => {
  const count = (source) => {
    const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
    try {
      writeFileSync(join(dir, 'versions.tsx'), source);
      return json(dir).findings.filter(finding => finding.rule === 'design-overlay-has-title').length;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const head = "import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';\n";
  assert.equal(count(`${head}export function A() {\n  const body = <>\n    <DrawerTitle>Versions</DrawerTitle>\n    <p>x</p>\n  </>;\n  return <Drawer><DrawerContent>{body}</DrawerContent></Drawer>;\n}\n`), 0, 'const binding');
  assert.equal(count(`${head}export function A() {\n  const render = () => (\n    <div><DrawerTitle>V</DrawerTitle></div>\n  );\n  function body() {\n    return <DrawerTitle>V</DrawerTitle>;\n  }\n  return <Drawer><DrawerContent>{body()}</DrawerContent></Drawer>;\n}\n`), 0, 'function binding');
  assert.equal(count(`${head}export function A() {\n  const body = <p>no title</p>;\n  return <Drawer><DrawerContent>{body}</DrawerContent></Drawer>;\n}\n`), 1, 'a binding without a Title');
  assert.equal(count(`${head}export function A({ body }) {\n  return <Drawer><DrawerContent>{body}</DrawerContent></Drawer>;\n}\n`), 1, 'a prop is not bound in this file');
});

test('round 9: design-no-important is one hit per line, and reads stylesheets and class strings, not script string literals', () => {
  const count = (name, source) => {
    const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
    try {
      writeFileSync(join(dir, name), source);
      return json(dir).findings.filter(finding => finding.rule === 'design-no-important').length;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  assert.equal(count('a.css', '.a { color: red !important; margin: 0 !important; }\n.b { top: 0 !important; }\n'), 2, 'two on one line are one hit');
  assert.equal(count('pick-frame.ts', "export const f = (el: HTMLElement) => { el.textContent = 'html * { cursor: x !important }'; };\n"), 0, 'css injected from script');
  assert.equal(count('real.css', 'a { color: red !important; }\n'), 1, 'a stylesheet still fails');
});

test('a clean theme (both modes, core roles, app tokens, derived from var() and color-mix(), documented exceptions below the comment) reports nothing', () => {
  const report = json(join(root, 'test/fixtures/design-theme/clean/web/src'));
  assert.deepEqual(report.findings.filter(finding => finding.rule !== 'design-theme-local-derived'), []);
});

test('design-theme-local-derived: an app with its own theme.derived.css gets ONE hit, with the kit import order; an app without one gets none', () => {
  const report = json(join(root, 'test/fixtures/design-theme/clean/web/src'));
  const hits = report.findings.filter(finding => finding.rule === 'design-theme-local-derived');
  assert.equal(hits.length, 1);
  assert.match(hits[0].file, /theme\.derived\.css$/);
  assert.equal(hits[0].level, 'error');
  assert.match(hits[0].message, /delete it and import the kit's: app\.css, then @hachej\/boring-ui-kit\/theme\.derived\.css, then \.\/theme\.core\.css/);
  assert.equal(json(fixture).findings.filter(finding => finding.rule === 'design-theme-local-derived').length, 0);
});

test('design-overlay-has-title: a Dialog, Sheet, AlertDialog or Drawer content without its own *Title is reported; with it, or self-closing, it is not', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'web/src'), { recursive: true });
  const overlay = (name, title) => `export const ${name}A = () => <${name}Content>${title ? `<${name}Title>T</${name}Title>` : '<p />'}</${name}Content>;\n`;
  writeFileSync(join(dir, 'web/src/bad.tsx'), ['Dialog', 'Sheet', 'AlertDialog', 'Drawer'].map(name => overlay(name, false)).join(''));
  writeFileSync(join(dir, 'web/src/good.tsx'), ['Dialog', 'Sheet', 'AlertDialog', 'Drawer'].map(name => overlay(name, true)).join('') + 'export const W = (p) => <DialogContent {...p} />;\n');
  const found = JSON.parse(spawnSync(process.execPath, [bin, 'design', 'web/src', '--json'], { cwd: dir, encoding: 'utf8' }).stdout).findings;
  assert.deepEqual(found.map(finding => [finding.file, finding.line, finding.rule]), [1, 2, 3, 4].map(line => ['web/src/bad.tsx', line, 'design-overlay-has-title']));
});

test('D-1782: design-mono-for-code accepts a Textarea variant="code" and nothing else new', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'web/src'), { recursive: true });
  writeFileSync(join(dir, 'web/src/code.tsx'), 'export const A = () => <Textarea variant="code" />;\nexport const B = () => <Textarea variant={"code"} />;\nexport const C = () => <Input variant="code" />;\nexport const D = () => <Textarea className="font-mono" />;\nexport const E = () => <Textarea variant="default" className="font-mono" />;\nexport const F = () => <div data-mono="code" className="font-mono" />;\n');
  const found = JSON.parse(spawnSync(process.execPath, [bin, 'design', 'web/src', '--json'], { cwd: dir, encoding: 'utf8' }).stdout).findings.filter(finding => finding.rule === 'design-mono-for-code');
  assert.deepEqual(found.map(finding => finding.line), [4, 5, 6]);
});

test('bg-[#fff], p-[13px] and text-[#123456] each give exactly one finding (design-color, design-tokens-only, design-literal-value never double-report)', () => {
  const one = json(join(root, 'test/fixtures/design-one/web/src'));
  assert.deepEqual(one.findings.map(finding => [finding.line, finding.rule]), [[1, 'design-color'], [2, 'design-tokens-only'], [3, 'design-color']]);
  const result = run(join(root, 'test/fixtures/design-one/web/src'));
  assert.match(result.stdout, /^test\/fixtures\/design-one\/web\/src\/one-finding\.tsx:1 design-color colour literal or palette class: .* \(#fff\)$/m);
});

test('breaker 1: only <root>/components/ui is exempt; a nested components/ui folder is app code and a raw element there is an error', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'web/src/features/invoices/components/ui'), { recursive: true });
  writeFileSync(join(dir, 'web/src/features/invoices/components/ui/action.tsx'), 'export const A = () => <button />;\n');
  const nested = JSON.parse(spawnSync(process.execPath, [bin, 'design', 'web/src', '--json'], { cwd: dir, encoding: 'utf8' }).stdout);
  assert.deepEqual(nested.findings.map(finding => [finding.rule, finding.level]), [['raw-element', 'error']]);
  mkdirSync(join(dir, 'web/src/components/ui'), { recursive: true });
  writeFileSync(join(dir, 'web/src/components/ui/action.tsx'), 'export const A = () => <button />;\n');
  const own = JSON.parse(spawnSync(process.execPath, [bin, 'design', 'web/src', '--json'], { cwd: dir, encoding: 'utf8' }).stdout);
  assert.deepEqual(own.findings.filter(finding => finding.file.endsWith('/components/ui/action.tsx') && !finding.file.includes('features')), [], 'the root components/ui is the legacy exemption');
  assert.equal(own.findings.filter(finding => finding.file.includes('features')).length, 1);
});

test('breaker 2: dot folders are scanned, as the template does (only node_modules and platform-owned paths are skipped)', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'web/src/.hidden'), { recursive: true });
  mkdirSync(join(dir, 'web/src/node_modules/pkg'), { recursive: true });
  writeFileSync(join(dir, 'web/src/.hidden/action.tsx'), 'export const A = () => <button />;\n');
  writeFileSync(join(dir, 'web/src/node_modules/pkg/action.tsx'), 'export const A = () => <button />;\n');
  const found = JSON.parse(spawnSync(process.execPath, [bin, 'design', 'web/src', '--json'], { cwd: dir, encoding: 'utf8' }).stdout);
  assert.deepEqual(found.findings.map(finding => [finding.file, finding.rule]), [['web/src/.hidden/action.tsx', 'raw-element']]);
});

test('breaker 3: a dangling link, a looping folder link and a linked folder do not crash the walk; a fatal error is JSON with a non-zero exit', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  t.after(() => { chmodSync(join(dir, 'web/src/locked.tsx'), 0o644); rmSync(dir, { recursive: true, force: true }); });
  mkdirSync(join(dir, 'web/src'), { recursive: true });
  symlinkSync('missing.tsx', join(dir, 'web/src/dangling.tsx'));
  symlinkSync('.', join(dir, 'web/src/loop'));
  writeFileSync(join(dir, 'web/src/ok.tsx'), 'export const K = () => <div />;\n');
  const ok = spawnSync(process.execPath, [bin, 'design', 'web/src', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).findings, []);
  writeFileSync(join(dir, 'web/src/locked.tsx'), 'export const L = () => <div />;\n');
  chmodSync(join(dir, 'web/src/locked.tsx'), 0o000);
  const fatal = spawnSync(process.execPath, [bin, 'design', 'web/src', '--json'], { cwd: dir, encoding: 'utf8' });
  if (process.getuid?.() === 0) return; // root reads a locked file
  assert.notEqual(fatal.status, 0);
  assert.match(JSON.parse(fatal.stdout).error, /EACCES/);
});

test('breaker 4: no-kit-restyle matches only the kit\'s own data-slot values, from shadcn/ui and the registry; an app\'s own slot is its own', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'web/src'), { recursive: true });
  writeFileSync(join(dir, 'web/src/own.css'), '[data-slot=invoice-total]{display:flex}\n[data-slot="invoice-row"] .x{display:flex}\n');
  writeFileSync(join(dir, 'web/src/kit.css'), '[data-slot=button]{display:flex}\n[data-slot="dialog-content"]{display:flex}\n');
  writeFileSync(join(dir, 'web/src/own.tsx'), 'export const A = () => <div className="[&_[data-slot=invoice-total]]:flex" />;\n');
  writeFileSync(join(dir, 'web/src/kit.tsx'), 'export const A = () => <div className="[&_[data-slot=button]]:flex" />;\n');
  const found = JSON.parse(spawnSync(process.execPath, [bin, 'design', 'web/src', '--json'], { cwd: dir, encoding: 'utf8' }).stdout).findings.filter(finding => finding.rule === 'design-no-kit-restyle');
  assert.deepEqual(found.map(finding => `${finding.file}:${finding.line}`).sort(), ['web/src/kit.css:1', 'web/src/kit.css:2', 'web/src/kit.tsx:1']);
});

test('the embedded kit slot list equals the data-slot values of shadcn/ui and the registry (regenerate KIT_SLOTS when a slot is added)', () => {
  const slots = new Set();
  const walk = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    if (entry.isDirectory()) walk(join(dir, entry.name));
    else if (entry.name.endsWith('.tsx')) for (const m of readFileSync(join(dir, entry.name), 'utf8').matchAll(/data-slot=["']([a-z0-9-]+)["']/g)) slots.add(m[1]);
  } };
  walk(join(root, 'shadcn')); walk(join(root, 'registry'));
  assert.deepEqual([...KIT_SLOTS], [...slots].sort());
});

test('breaker 5: tokens-only reads class contexts only (className, class, cn, cva, clsx, tw); prose and other strings are not classes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'web/src'), { recursive: true });
  writeFileSync(join(dir, 'web/src/prose.tsx'), 'export const note = `Set w-[340px] here`;\nexport const hint = "use p-[13px] instead";\n');
  writeFileSync(join(dir, 'web/src/classes.tsx'), [
    'export const A = () => <div className="w-[340px]" />;',
    'export const B = () => <div className={cn("flex", on && "p-[13px]")} />;',
    'export const C = cva("h-[7px]", { variants: {} });',
    'export const D = clsx("m-[5px]");',
    'export const E = tw`gap-[9px]`;',
    'export const F = () => <div class="top-[3px]" />;',
    '',
  ].join('\n'));
  const found = JSON.parse(spawnSync(process.execPath, [bin, 'design', 'web/src', '--json'], { cwd: dir, encoding: 'utf8' }).stdout).findings.filter(finding => finding.rule === 'design-tokens-only');
  assert.deepEqual(found.map(finding => `${finding.file}:${finding.line}`), [1, 2, 3, 4, 5, 6].map(line => `web/src/classes.tsx:${line}`));
});

test('the length limits pass at the limit: a 200 character line, a 150 line component and a 400 line file are clean', t => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-app-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'web/src'), { recursive: true });
  writeFileSync(join(dir, 'web/src/line.tsx'), `export const A = () => <div title="${'x'.repeat(200 - 'export const A = () => <div title="" />;'.length)}" />;\n`);
  writeFileSync(join(dir, 'web/src/component.tsx'), `export function B() {\n  return (\n    <div>\n${'      <span />\n'.repeat(144)}    </div>\n  );\n}\n`);
  writeFileSync(join(dir, 'web/src/file.tsx'), `export const C = 1;\n${'// filler\n'.repeat(399)}`);
  const result = spawnSync(process.execPath, [bin, 'design', 'web/src', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result.stdout).findings, []);
});
