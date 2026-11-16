// The kit's own shadcn primitives (shadcn/ui/) as registry items of the npm package: every file shipped by exactly one item, the item's content
// the file with only the two unresolvable imports rewritten, and an app that installs them from the package's r/ folder, offline, passes
// `boring-ui-blocks manifest`, `check` and `design`. Fictional app in a temp directory; the installer below stands in for the shadcn CLI.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PACKAGE_PINS, REWRITES, UI_ALL, UI_FOLDER, installable, uiItems } from '../../scripts/ui-primitives.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bin = join(root, 'packages/ui/bin/boring-ui-blocks.mjs');
const run = (app, args) => spawnSync(process.execPath, [bin, ...args], { cwd: app, encoding: 'utf8' });
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const published = name => JSON.parse(readFileSync(join(root, 'public/r', `${name}.json`), 'utf8'));
const sources = readdirSync(join(root, UI_FOLDER)).filter(name => /\.tsx?$/.test(name));

test('every file of shadcn/ui/ is shipped by exactly one item, and the item is the file with only its two unresolvable imports rewritten', () => {
  const shippers = new Map(sources.map(file => [file, []]));
  for (const name of readdirSync(join(root, 'public/r')).filter(name => name.endsWith('.json') && name !== 'registry.json')) {
    for (const file of published(name.replace(/\.json$/, '')).files ?? []) if (file.path.startsWith(`${UI_FOLDER}/`)) shippers.get(basename(file.path))?.push({ item: name.replace(/\.json$/, ''), file });
  }
  for (const [file, owners] of shippers) {
    assert.deepEqual(owners.map(owner => owner.item), [`ui-${file.replace(/\.[^.]+$/, '')}`], `${file} is shipped by exactly one item, ui-<name>`);
    const [{ file: shipped }] = owners, source = readFileSync(join(root, UI_FOLDER, file), 'utf8');
    assert.equal(shipped.content, installable(source), `${file}: the item holds the file's content`);
    assert.equal(shipped.target, undefined, `${file}: no target, so the CLI writes it to the app's alias`);
    const changed = source.split('\n').flatMap((line, index) => line === shipped.content.split('\n')[index] ? [] : [line]);
    for (const line of changed) assert.ok(Object.keys(REWRITES).some(specifier => line.includes(`"${specifier}"`)), `${file}: only an import of ${Object.keys(REWRITES).join(' or ')} may change (${line})`);
    assert.doesNotMatch(shipped.content, /from\s*["'](?:cn|\.{1,2}\/)/, `${file}: no import an app cannot resolve`);
  }
  assert.deepEqual(published(UI_ALL).registryDependencies.map(url => basename(url, '.json')).sort(), sources.map(file => `ui-${file.replace(/\.[^.]+$/, '')}`).sort(), 'ui installs every primitive');
});

test('the primitive items of registry.json and public/r are what shadcn/ui/ derives (node scripts/ui-primitives.mjs --write, then the registry build)', () => {
  const registry = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
  assert.deepEqual(registry.items.filter(item => item.name === UI_ALL || item.name.startsWith('ui-')), uiItems(root));
  for (const item of uiItems(root)) {
    const built = published(item.name);
    assert.equal(built.type, item.type);
    assert.deepEqual(built.dependencies, item.dependencies);
    assert.equal(built.registryDependencies?.length ?? 0, item.registryDependencies?.length ?? 0);
  }
});

test('the primitives pin the packages the root tooling and the kit package already pin', () => {
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), ui = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8'));
  for (const name of ['@base-ui/react', 'class-variance-authority', '@shadcn/react']) assert.equal(PACKAGE_PINS[name], `${name}@${rootManifest.devDependencies?.[name] ?? rootManifest.dependencies?.[name]}`, name);
  assert.equal(PACKAGE_PINS.react, `react@${ui.peerDependencies.react}`);
});

/** A fictional Vite app with the kit installed (version 9.9.9, items from public/r) and no shadcn file yet. */
function fixture(t) {
  const app = mkdtempSync(join(tmpdir(), 'kit-ui-primitives-'));
  t.after(() => rmSync(app, { recursive: true, force: true }));
  const kit = join(app, 'node_modules/@hachej/boring-ui-kit');
  cpSync(join(root, 'public/r'), join(kit, 'r'), { recursive: true });
  write(join(kit, 'package.json'), JSON.stringify({ name: '@hachej/boring-ui-kit', version: '9.9.9' }));
  write(join(app, 'package.json'), JSON.stringify({ name: 'fictional-app', private: true }));
  write(join(app, 'components.json'), JSON.stringify({ style: 'base-nova', aliases: { components: '@/components', ui: '@/components/ui', hooks: '@/hooks', utils: '@/lib/utils' } }));
  write(join(app, 'src/index.css'), '@import "tailwindcss";\n:root { --background: oklch(1 0 0); }\n');
  return app;
}

/** What `shadcn add` does with an item of the package's r/ folder, offline: its registryDependencies first (by item name), then its files. */
function install(app, name, done = new Set()) {
  if (done.has(name)) return done;
  done.add(name);
  const item = JSON.parse(readFileSync(join(app, 'node_modules/@hachej/boring-ui-kit/r', `${name}.json`), 'utf8'));
  for (const dependency of item.registryDependencies ?? []) install(app, basename(dependency, '.json'), done);
  // A file with a target lands there; one without lands in the app's alias for its type (ui, or hooks).
  for (const file of item.files) write(join(app, 'src', file.target ?? join(file.type === 'registry:hook' ? 'hooks' : 'components/ui', basename(file.path))), file.content);
  return done;
}

const FIELD_FORM = `import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
export function SignIn() {
  return <form className="grid gap-4 p-4"><Field><FieldLabel htmlFor="email">Email</FieldLabel><Input id="email" type="email" /></Field><Button type="submit">Continue</Button></form>
}
`;

test('an app installs button, input, label and field from the package, offline: every import resolves, manifest and check pass, an edit is named', t => {
  const app = fixture(t);
  const installed = new Set();
  for (const name of ['ui-button', 'ui-input', 'ui-label', 'ui-field']) install(app, name, installed);
  assert.ok(['ui-button', 'ui-input', 'ui-label', 'ui-field', 'ui-separator', 'utils'].every(name => installed.has(name)), [...installed].join());
  assert.ok(!installed.has('ui-sidebar'), 'only what the four primitives import comes with them');
  write(join(app, 'src/features/sign-in.tsx'), FIELD_FORM);

  const resolves = specifier => ['', '.ts', '.tsx', '/index.ts'].some(ext => existsSync(join(app, 'src', specifier.slice(2) + ext)));
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  for (const file of walk(join(app, 'src')).filter(path => /\.tsx?$/.test(path))) {
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/\bfrom\s*["'](@\/[^"']+)["']/g)) assert.ok(resolves(specifier), `${file.slice(app.length)} imports ${specifier}, which the install did not write`);
  }

  const manifest = run(app, ['manifest']);
  assert.equal(manifest.status, 0, manifest.stdout + manifest.stderr);
  const recorded = JSON.parse(readFileSync(join(app, 'SHADCN-GENERATED.json'), 'utf8'));
  assert.deepEqual(Object.keys(recorded.files), ['button.tsx', 'field.tsx', 'input.tsx', 'label.tsx', 'separator.tsx']);
  const clean = JSON.parse(run(app, ['check', '--design', 'src', '--json']).stdout);
  assert.deepEqual(clean.violations, [], 'the primitives are generated ui files: recorded, not blocks and not app code');
  assert.deepEqual(clean.blocks, ['utils']);

  const edit = join(app, 'src/components/ui/button.tsx');
  writeFileSync(edit, `${readFileSync(edit, 'utf8')}\nexport const edited = true\n`);
  const drift = run(app, ['check']);
  assert.equal(drift.status, 1, drift.stdout + drift.stderr);
  assert.deepEqual(drift.stdout.split('\n').filter(line => /^(blocks|design|ui) /.test(line)), ['ui edited src/components/ui/button.tsx SHADCN-GENERATED.json']);
});

test('an app whose own shadcn button differs from the kit\'s is not reported as having an edited block', t => {
  const app = fixture(t);
  write(join(app, 'src/components/ui/button.tsx'), 'export const Button = (props) => <button {...props} />\n');
  assert.equal(run(app, ['manifest']).status, 0);
  const result = run(app, ['check']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^ok @hachej\/boring-ui-kit@9\.9\.9: 0 block\(s\)/);
});
