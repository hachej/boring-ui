import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATED_CSS_MARK, blocksCss, writeBlocksCss } from '../packages/ui/bin/boring-ui-blocks.mjs';

// `boring-ui-blocks design` does not read installed kit parts (generated copies); an edited one is one finding. Every case spawns the real bin
// on an app built in a temp dir from the real registry items (public/r).
const root = fileURLToPath(new URL('../', import.meta.url));
const bin = join(root, 'packages/ui/bin/boring-ui-blocks.mjs');
const registryItem = name => JSON.parse(readFileSync(join(root, 'public/r', `${name}.json`), 'utf8'));
const KIT_ITEMS = ['inline-question', 'space-card'];
const BLOCK_FILE = 'components/inline-question/inline-question.tsx';
const HIT = 'export const Hit = () => <div className="bg-[#fff]" />;\n';

// An app under dir/web whose kit is installed one level up (node_modules/@hachej/boring-ui-kit): two blocks copied as shadcn writes them, the
// blocks' CSS in the marked file, one shadcn file recorded in the manifest, and the app's own App.tsx (one hit).
function kitApp(t) {
  const dir = mkdtempSync(join(tmpdir(), 'boring-design-kit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const kit = join(dir, 'node_modules/@hachej/boring-ui-kit'), src = join(dir, 'web/src');
  mkdirSync(join(kit, 'r'), { recursive: true });
  writeFileSync(join(kit, 'package.json'), JSON.stringify({ name: '@hachej/boring-ui-kit', version: '0.5.0' }));
  for (const name of KIT_ITEMS) {
    const item = registryItem(name);
    writeFileSync(join(kit, 'r', `${name}.json`), JSON.stringify(item));
    for (const file of item.files) {
      mkdirSync(dirname(join(src, file.target)), { recursive: true });
      writeFileSync(join(src, file.target), file.content);
    }
  }
  writeFileSync(join(src, 'kit-blocks.css'), `${blocksCss(KIT_ITEMS.map(registryItem))}\n`);
  mkdirSync(join(src, 'components/ui'), { recursive: true });
  writeFileSync(join(src, 'components/ui/card.tsx'), HIT);
  writeFileSync(join(dir, 'web/components.json'), JSON.stringify({ aliases: { components: '@/components', ui: '@/components/ui' } }));
  writeFileSync(join(src, 'App.tsx'), HIT);
  assert.equal(spawnSync(process.execPath, [bin, 'manifest', '--cwd', join(dir, 'web')], { encoding: 'utf8' }).status, 0);
  return dir;
}
const design = (dir, ...args) => {
  const result = spawnSync(process.execPath, [bin, 'design', 'web/src', ...args, '--json'], { cwd: dir, encoding: 'utf8' });
  return { status: result.status, ...JSON.parse(result.stdout) };
};
const edit = (dir, file, change) => {
  const path = join(dir, 'web/src', file);
  writeFileSync(path, change(readFileSync(path, 'utf8')));
};

test('an unedited installed block, a manifest-recorded shadcn file and the marked blocks CSS are not read; the app\'s own files still are', t => {
  const dir = kitApp(t);
  const report = design(dir);
  assert.deepEqual(report.findings.map(finding => [finding.rule, finding.file]), [['design-color', 'web/src/App.tsx']]);
  assert.equal(report.status, 1);
  // The control: the same files with no kit to compare against (no node_modules, no manifest) are read as the app's, and report.
  const alone = mkdtempSync(join(tmpdir(), 'boring-design-kit-'));
  t.after(() => rmSync(alone, { recursive: true, force: true }));
  cpSync(join(dir, 'web'), join(alone, 'web'), { recursive: true });
  rmSync(join(alone, 'web/SHADCN-GENERATED.json'));
  const files = new Set(design(alone).findings.map(finding => finding.file));
  for (const file of [BLOCK_FILE, 'components/ui/card.tsx']) assert.ok(files.has(`web/src/${file}`), `${file} is read when it is not known as a kit part`);
});

test('an edited block file, shadcn file or blocks CSS is one finding (kit-part-edited), not its own findings', t => {
  const dir = kitApp(t);
  edit(dir, BLOCK_FILE, text => `${text}\n${HIT}`);
  edit(dir, 'components/ui/card.tsx', text => `${text}${HIT.replace('Hit', 'More')}`);
  edit(dir, 'kit-blocks.css', text => `${text}\n.mine { color: #123456; }\n`);
  const report = design(dir);
  const edited = report.findings.filter(finding => finding.rule === 'kit-part-edited');
  assert.deepEqual(edited.map(finding => finding.file).sort(), ['web/src/components/inline-question/inline-question.tsx', 'web/src/components/ui/card.tsx', 'web/src/kit-blocks.css']);
  assert.deepEqual(report.findings.filter(finding => finding.rule !== 'kit-part-edited').map(finding => finding.file), ['web/src/App.tsx']);
  assert.ok(edited.every(finding => finding.level === 'error' && /undo the edit/.test(finding.message)));
  assert.match(edited.find(finding => /kit-blocks/.test(finding.file)).message, /blocks CSS file/);
  assert.match(edited.find(finding => /inline-question/.test(finding.file)).message, /kit block "inline-question"/);
  assert.match(edited.find(finding => /card/.test(finding.file)).message, /SHADCN-GENERATED\.json/);
});

test('a CSS file without the marker, and a shadcn file the manifest does not record, are the app\'s and are read', t => {
  const dir = kitApp(t);
  writeFileSync(join(dir, 'web/src/own.css'), '.mine { color: #123456; }\n');
  edit(dir, 'kit-blocks.css', text => text.replace(/^[^\n]*\n/, ''));
  writeFileSync(join(dir, 'web/src/components/ui/own-part.tsx'), HIT);
  const found = design(dir).findings.map(finding => `${finding.rule} ${finding.file}`);
  assert.ok(found.includes('design-color web/src/own.css'));
  assert.ok(found.includes('design-color web/src/components/ui/own-part.tsx'));
  assert.ok(!found.some(entry => entry.startsWith('kit-part-edited')), 'a file without the marker is not a kit part');
});

test('without components.json the parts under <dir>/components are found through the nearest installed kit', t => {
  const dir = kitApp(t);
  rmSync(join(dir, 'web/components.json'));
  rmSync(join(dir, 'web/SHADCN-GENERATED.json'));
  assert.deepEqual(design(dir).findings.map(finding => finding.file).sort(), ['web/src/App.tsx', 'web/src/components/ui/card.tsx']);
  edit(dir, BLOCK_FILE, text => `${text}\n// changed\n`);
  assert.ok(design(dir).findings.some(finding => finding.rule === 'kit-part-edited' && /inline-question/.test(finding.file)));
});

test('--manifest names the manifest; blocksCss and writeBlocksCss write the marker line and one section per item', t => {
  const dir = kitApp(t);
  renameSync(join(dir, 'web/SHADCN-GENERATED.json'), join(dir, 'web/recorded.json'));
  assert.ok(design(dir).findings.some(finding => finding.file === 'web/src/components/ui/card.tsx'), 'the default manifest is gone: card.tsx is the app\'s');
  assert.deepEqual(design(dir, '--manifest', 'recorded.json').findings.map(finding => finding.file), ['web/src/App.tsx']);
  const css = blocksCss(KIT_ITEMS.map(registryItem));
  assert.equal(css.split('\n')[0], GENERATED_CSS_MARK);
  assert.deepEqual([...css.matchAll(/^\/\* ([\w-]+) \*\/$/gm)].map(match => match[1]), KIT_ITEMS);
  const file = join(dir, 'web/src/generated/blocks.css');
  assert.equal(writeBlocksCss(file, KIT_ITEMS.map(registryItem)), file);
  assert.equal(readFileSync(file, 'utf8'), css);
  assert.deepEqual(design(dir, '--manifest', 'recorded.json').findings.map(finding => finding.file), ['web/src/App.tsx']);
});

test('a registry item whose files have no target is ignored, and a blocks CSS written for every item with css (css-only ones too) is recognised', t => {
  const dir = kitApp(t);
  const kitR = join(dir, 'node_modules/@hachej/boring-ui-kit/r');
  writeFileSync(join(kitR, 'ui-button.json'), JSON.stringify({ name: 'ui-button', type: 'registry:ui', files: [{ path: 'ui/button.tsx', type: 'registry:ui', content: HIT }] }));
  writeFileSync(join(kitR, 'touch-floor.json'), JSON.stringify(registryItem('touch-floor')));
  const withCss = [...KIT_ITEMS, 'touch-floor'].map(registryItem);
  assert.ok(withCss.every(item => item.css), 'touch-floor is css-only');
  writeBlocksCss(join(dir, 'web/src/kit-blocks.css'), withCss);
  const report = design(dir);
  assert.equal(report.error, undefined);
  assert.deepEqual(report.findings.map(finding => [finding.rule, finding.file]), [['design-color', 'web/src/App.tsx']]);
  assert.deepEqual([...readFileSync(join(dir, 'web/src/kit-blocks.css'), 'utf8').matchAll(/^\/\* ([\w-]+) \*\/$/gm)].map(match => match[1]), [...KIT_ITEMS, 'touch-floor']);
  const check = spawnSync(process.execPath, [bin, 'check', '--cwd', join(dir, 'web')], { encoding: 'utf8' });
  assert.ok(!/TypeError|Cannot read/.test(check.stderr), check.stderr);
});

test('an exceptions list that still names kit files fails once per file and says what to delete; the app\'s own entries stay valid', t => {
  const dir = kitApp(t);
  writeFileSync(join(dir, 'web/src/design.exceptions.json'), JSON.stringify({
    'design-color': { 'App.tsx': 1, 'components/ui/card.tsx': 1 },
    'line-length': { [BLOCK_FILE]: 3 },
    'component-length': { [BLOCK_FILE]: 1 },
  }));
  const report = design(dir);
  const shrink = report.findings.filter(finding => finding.rule === 'design-exceptions-shrink');
  assert.equal(report.status, 1);
  assert.equal(shrink.length, 2);
  assert.ok(shrink.some(finding => finding.message === 'components/ui/card.tsx is a kit part (generated, no longer read): delete its 1 entry (design-color) from the list; --baseline prints the list for what is left'));
  assert.ok(shrink.some(finding => finding.message.startsWith(`${BLOCK_FILE} is a kit part`) && /delete its 2 entries \(line-length, component-length\)/.test(finding.message)));
  assert.equal(report.findings.filter(finding => finding.excepted).length, 1, 'App.tsx stays excepted');
  const baseline = spawnSync(process.execPath, [bin, 'design', 'web/src', '--baseline'], { cwd: dir, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(baseline.stdout), { 'design-color': { 'App.tsx': 1 } });
});
