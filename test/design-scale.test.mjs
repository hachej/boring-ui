import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The scale rules and the fast command an agent runs after an edit. Every assertion spawns the real bin on a fictional app.
const bin = fileURLToPath(new URL('../packages/ui/bin/boring-ui-blocks.mjs', import.meta.url));

const app = (t, files, { git = false } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-scale-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'web/src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"name":"fictional-app"}');
  writeFileSync(join(dir, 'DESIGN.md'), '# Design\n');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'web/src', name), text);
  if (git) for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'base']]) spawnSync('git', args, { cwd: dir });
  return dir;
};
const inApp = (dir, ...args) => spawnSync(process.execPath, [bin, 'design', 'web/src', ...args], { cwd: dir, encoding: 'utf8' });
const hits = (dir, ...args) => JSON.parse(inApp(dir, ...args, '--json').stdout).findings.map(finding => `${finding.rule}:${finding.file.split('/').pop()}:${finding.line}`);

test('design-z-index: a number, z-[n], a zIndex style and a css z-index fail; a named layer, var(--z-*), z-0 and z-auto pass', t => {
  const dir = app(t, {
    'bad.tsx': 'export const A = () => <div className="z-10 md:-z-20 z-[999]" style={{ zIndex: 5 }} />;\n',
    'bad.css': '.menu { position: fixed; z-index: 40; }\n',
    'good.tsx': 'export const B = () => <div className="z-sheet z-0 z-auto z-[var(--z-toast)] z-(--z-dropdown)" style={{ zIndex: \'var(--z-composer)\' }} />;\n',
    'good.css': '.menu { z-index: var(--z-dropdown, 30); } .reset { z-index: auto; } :root { --z-mine: 70; }\n',
  });
  assert.deepEqual(hits(dir).sort(), ['design-z-index:bad.css:1', ...Array(4).fill('design-z-index:bad.tsx:1')]);
  assert.equal(inApp(dir).status, 1);
});

test('design-type-scale: a step above the app scale fails, one its theme.core.css declares passes, colours and xs/sm pass', t => {
  const dir = app(t, { 'a.tsx': 'export const A = () => <div className="text-xs text-sm text-muted-foreground text-center"><h1 className="text-lg md:text-3xl" /></div>;\n' });
  assert.deepEqual(hits(dir), ['design-type-scale:a.tsx:1', 'design-type-scale:a.tsx:1']);
  writeFileSync(join(dir, 'web/src/theme.core.css'), ':root { --text-body: 0.75rem; --text-title: 0.875rem; --text-lg: 1.125rem; --text-lg--line-height: 1.4; }\n');
  assert.deepEqual(hits(dir), ['design-type-scale:a.tsx:1']);
  assert.match(JSON.parse(inApp(dir, '--json').stdout).findings[0].message, /text-3xl/);
});

test('design-gap-not-space: space-x-* and space-y-* in a class fail (variants and negatives too); gap and prose do not', t => {
  const dir = app(t, { 'a.tsx': 'export const A = () => <div className="space-y-2 md:space-x-4 -space-x-1"><p>use space-y-2 here</p></div>;\nexport const B = () => <div className="flex flex-col gap-2" />;\n' });
  assert.deepEqual(hits(dir), Array(3).fill('design-gap-not-space:a.tsx:1'));
});

test('design-screen-padding: p-, px- on ScreenBody, its direct child and a *Screen root fail; py-, p-0 and a deeper element pass', t => {
  const dir = app(t, {
    'bad.tsx': 'export const A = () => <ScreenBody><div className="p-4">x</div></ScreenBody>;\nexport const B = () => <ScreenBody className="px-3"><div>x</div></ScreenBody>;\nexport function ListScreen() {\n  return (\n    <section className="flex px-2">x</section>\n  );\n}\n',
    'good.tsx': 'export const C = () => <ScreenBody><div className="flex flex-col gap-4 py-2 p-0"><p className="p-4">deeper</p></div></ScreenBody>;\n',
  });
  assert.deepEqual(hits(dir), ['design-screen-padding:bad.tsx:1', 'design-screen-padding:bad.tsx:2', 'design-screen-padding:bad.tsx:5']);
});

test('design-has-design-md: an app root with a package.json and no DESIGN.md fails at DESIGN.md:1; a folder with no package.json is not an app', t => {
  const dir = app(t, { 'a.tsx': 'export const A = () => <div />;\n' });
  assert.deepEqual(hits(dir), []);
  rmSync(join(dir, 'DESIGN.md'));
  const result = inApp(dir, '--jsonl');
  assert.equal(result.status, 1);
  const line = JSON.parse(result.stdout.trim());
  assert.equal(line.file, 'DESIGN.md');
  assert.equal(line.rule, 'design-has-design-md');
  rmSync(join(dir, 'package.json'));
  assert.equal(inApp(dir).status, 0);
});

test('--changed with no files checks what git reports changed; --jsonl prints one {file,line,rule,fix} line per hit, nothing when clean', t => {
  const dir = app(t, { 'old.tsx': 'export const Old = () => <div className="space-y-2" />;\n', 'ok.tsx': 'export const Ok = () => <div className="flex gap-2" />;\n' }, { git: true });
  const clean = inApp(dir, '--changed', '--jsonl');
  assert.equal(clean.stdout, '');
  assert.equal(clean.status, 0);
  writeFileSync(join(dir, 'web/src/ok.tsx'), 'export const Ok = () => <div className="z-50 text-2xl" />;\n');
  writeFileSync(join(dir, 'web/src/new.tsx'), 'export const New = () => <div className="space-x-2" />;\n');
  const result = inApp(dir, '--changed', '--jsonl');
  assert.equal(result.status, 1);
  const lines = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(lines.map(line => `${line.rule}:${line.file.split('/').pop()}:${line.line}`).sort(), ['design-gap-not-space:new.tsx:1', 'design-type-scale:ok.tsx:1', 'design-z-index:ok.tsx:1']);
  for (const line of lines) assert.deepEqual(Object.keys(line).sort(), ['file', 'fix', 'level', 'line', 'rule']);
  assert.ok(lines.every(line => line.fix.length > 20));
});
