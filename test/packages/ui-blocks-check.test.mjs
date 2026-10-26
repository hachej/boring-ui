// `boring-ui-blocks` (the kit's bin) run as an app runs it, against fictional consumer apps in a temp directory, offline: the installed kit's
// registry items are this repository's public/r. One command checks untouched blocks, the tokens-only design rule and generated shadcn ui.
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bin = join(root, 'packages/ui/bin/boring-ui-blocks.mjs');
const run = (app, args, env = {}) => spawnSync(process.execPath, [bin, ...args], { cwd: app, encoding: 'utf8', env: { ...process.env, ...env } });
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };

const BUTTON = `import { cn } from "@/lib/utils"
export function Button({ className, ...props }) {
  return <button className={cn("rounded-md border shadow-xs bg-primary text-primary-foreground dark:bg-input/30", className)} {...props} />
}
`;
const APP = `import { Button } from "@/components/ui/button"
import { PiChat } from "@/components/pi-chat/pi-chat"
export function App() {
  return <main className="grid min-h-dvh grid-cols-[18rem_1fr] gap-4 bg-background text-foreground">
    <section className="rounded-md border border-t shadow-md text-sm">Token-backed utilities</section>
    <Button className="min-h-[44px]">Fictional action</Button>
    <PiChat />
  </main>
}
`;
const THEME = `@import "tailwindcss";
:root {
  --background: oklch(1 0 0);
  --primary: #1f2937;
  --radius: 0.625rem;
}
.dark { --background: oklch(0.145 0 0); }
@theme inline { --radius-lg: 12px; --shadow-md: 0 1px 2px rgb(0 0 0 / 0.1); }
.card { border-radius: var(--radius); border: 1px solid var(--border); box-shadow: var(--shadow-md); }
`;

// The literals in the fixture's src/features/alert.{css,tsx}; the token-backed utilities and the :root token beside them pass.
const EXPECTED_DESIGN = [
  'design border-width src/features/alert.css:2:10 border-left: 3px solid var(--primary)',
  'design literal-value src/features/alert.css:2:49 border-radius: 999px',
  'design font src/features/alert.css:2:71 font: 13px/1.4 ui-monospace, monospace',
  'design color src/features/alert.tsx:2:66 #ff0000',
  'design arbitrary-value src/features/alert.tsx:3:19 rounded-[7px]',
  'design border-width src/features/alert.tsx:3:33 border-2',
  'design color src/features/alert.tsx:3:42 bg-red-500',
  'design dark src/features/alert.tsx:3:53 dark:text-muted-foreground',
];

/** A fictional Vite app with the kit installed (version 9.9.9, items from public/r), pi-chat copied as `shadcn add` writes it, and one shadcn file. */
function fixture(t, web = '.') {
  const repo = mkdtempSync(join(tmpdir(), 'kit-blocks-check-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const app = join(repo, web);
  const kit = join(app, 'node_modules/@hachej/boring-ui-kit');
  cpSync(join(root, 'public/r'), join(kit, 'r'), { recursive: true });
  write(join(kit, 'package.json'), JSON.stringify({ name: '@hachej/boring-ui-kit', version: '9.9.9' }));
  write(join(app, 'package.json'), JSON.stringify({ name: 'fictional-app', private: true }));
  write(join(app, 'components.json'), JSON.stringify({ style: 'base-nova', aliases: { components: '@/components', ui: '@/components/ui', utils: '@/lib/utils' } }));
  for (const file of JSON.parse(readFileSync(join(root, 'public/r/pi-chat.json'), 'utf8')).files) {
    // The CLI drops 'use client' in a non-RSC app; that is not an edit.
    write(join(app, 'src', file.target), file.content.replace(/^'use client';\n\n?/, ''));
  }
  write(join(app, 'src/components/ui/button.tsx'), BUTTON);
  write(join(app, 'src/App.tsx'), APP);
  write(join(app, 'src/index.css'), THEME);
  return app;
}

test('a clean app passes: blocks untouched, own code tokens-only, shadcn ui recorded', t => {
  const app = fixture(t);
  const manifest = run(app, ['manifest']);
  assert.equal(manifest.status, 0, manifest.stdout + manifest.stderr);
  assert.match(manifest.stdout, /^SHADCN-GENERATED\.json: 1 file\(s\)$/m);
  const recorded = JSON.parse(readFileSync(join(app, 'SHADCN-GENERATED.json'), 'utf8'));
  assert.equal(recorded.dir, 'src/components/ui');
  assert.match(recorded.files['button.tsx'], /^[0-9a-f]{64}$/);

  const clean = run(app, ['check', '--design', 'src']);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.equal(clean.stdout, 'ok @hachej/boring-ui-kit@9.9.9: 1 block(s), design src, SHADCN-GENERATED.json matches\n');
  // From another directory with --cwd, as machine output.
  const json = run(root, ['check', '--cwd', app, '--design', 'src', '--json']);
  assert.equal(json.status, 0, json.stdout + json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), { ok: true, kit: '@hachej/boring-ui-kit@9.9.9', version: '9.9.9', blocks: ['pi-chat'], violations: [] });
});

test('an edited block file fails with exit 1 and names the file and block', t => {
  const app = fixture(t);
  run(app, ['manifest']);
  const edited = join(app, 'src/components/pi-chat/labels.ts');
  const original = readFileSync(edited, 'utf8'), changed = original.replace("svg: 'SVG image'", "svg: 'SVG image', maquette: 'Maquette'");
  assert.notEqual(changed, original, 'the negative control must actually edit a shipped block');
  writeFileSync(edited, changed);
  const drift = run(app, ['check']);
  assert.equal(drift.status, 1, drift.stdout + drift.stderr);
  assert.deepEqual(drift.stdout.split('\n').filter(line => /^(blocks|design|ui) /.test(line)), ['blocks edited src/components/pi-chat/labels.ts pi-chat']);
  assert.match(drift.stdout, /^fail @hachej\/boring-ui-kit@9\.9\.9: 1 violation\(s\) \(blocks 1, design 0, ui 0\)/m);
});

test('--design passes token-backed utilities and lists literals in app code and CSS with file:line:column and rule', t => {
  const app = fixture(t);
  run(app, ['manifest']);
  write(join(app, 'src/features/alert.tsx'), `export function Alert() {
  return <div className="rounded-md border shadow-md text-sm bg-[#ff0000] p-4">
    <p className="rounded-[7px] border-2 bg-red-500 dark:text-muted-foreground">Fictional alert</p>
  </div>
}
`);
  write(join(app, 'src/features/alert.css'), `:root { --alert-edge: 3px; }
.alert { border-left: 3px solid var(--primary); border-radius: 999px; font: 13px/1.4 ui-monospace, monospace; }
`);
  // Without --design the app's own code is not checked.
  assert.equal(run(app, ['check']).status, 0);
  const result = run(app, ['check', '--design', 'src']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(result.stdout.split('\n').filter(line => line.startsWith('design ')), EXPECTED_DESIGN);
  const json = JSON.parse(run(app, ['check', '--design', 'src', '--json']).stdout);
  assert.equal(json.ok, false);
  assert.deepEqual(json.violations.map(v => `${v.check} ${v.rule} ${v.file}:${v.line}:${v.column} ${v.detail}`), EXPECTED_DESIGN);
});

test('a block copy as the shadcn CLI writes it (leading comment and use client dropped) counts as clean', t => {
  const app = fixture(t);
  run(app, ['manifest']);
  const item = JSON.parse(readFileSync(join(root, 'public/r/pi-chat.json'), 'utf8'));
  const commented = item.files.filter(file => /^(?:'use client';\s*)?\/[/*]/.test(file.content));
  assert.ok(commented.length > 0, 'pi-chat has files that start with a comment');
  for (const file of commented) write(join(app, 'src', file.target), file.content.replace(/^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/|'use client';))*\s*/, ''));
  const clean = run(app, ['check']);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
});

test('--manifest reads and rewrites an existing manifest elsewhere, keeping its own keys', t => {
  // A repository with the app in web/ and its manifest under scripts/verify/, in another format with the same `files` map.
  const app = fixture(t, 'web');
  const verify = join(app, '../scripts/verify/SHADCN-GENERATED.json');
  write(verify, JSON.stringify({ about: 'fictional app manifest', shadcn: '4.21.4', style: 'base-nova', files: {} }));
  assert.equal(run(app, ['check', '--manifest', '../scripts/verify/SHADCN-GENERATED.json']).status, 1);
  const written = run(app, ['manifest', '--manifest', '../scripts/verify/SHADCN-GENERATED.json']);
  assert.equal(written.status, 0, written.stdout + written.stderr);
  const kept = JSON.parse(readFileSync(verify, 'utf8'));
  assert.deepEqual([kept.about, kept.shadcn, kept.style, Object.keys(kept.files)], ['fictional app manifest', '4.21.4', 'base-nova', ['button.tsx']]);
  assert.equal(existsSync(join(app, 'SHADCN-GENERATED.json')), false, 'only the named manifest is written');
  const clean = run(app, ['check', '--manifest', '../scripts/verify/SHADCN-GENERATED.json']);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /\.\.\/scripts\/verify\/SHADCN-GENERATED\.json matches$/m);
});

test('a generated ui file edited by hand, added without the manifest or deleted fails with exit 1', t => {
  const app = fixture(t);
  run(app, ['manifest']);
  writeFileSync(join(app, 'src/components/ui/button.tsx'), BUTTON.replace('rounded-md', 'rounded-full'));
  write(join(app, 'src/components/ui/card.tsx'), 'export const Card = () => null\n');
  const edited = run(app, ['check']);
  assert.equal(edited.status, 1, edited.stdout + edited.stderr);
  assert.deepEqual(edited.stdout.split('\n').filter(line => line.startsWith('ui ')), [
    'ui edited src/components/ui/button.tsx SHADCN-GENERATED.json',
    'ui unrecorded src/components/ui/card.tsx SHADCN-GENERATED.json',
  ]);
  run(app, ['manifest']);
  unlinkSync(join(app, 'src/components/ui/card.tsx'));
  const deleted = run(app, ['check']);
  assert.equal(deleted.status, 1);
  assert.deepEqual(deleted.stdout.split('\n').filter(line => line.startsWith('ui ')), ['ui missing src/components/ui/card.tsx SHADCN-GENERATED.json']);
});

test('usage and configuration errors exit 2: no components.json, no installed kit, unknown flag', t => {
  const app = fixture(t);
  unlinkSync(join(app, 'components.json'));
  const noConfig = run(app, ['check']);
  assert.equal(noConfig.status, 2, noConfig.stdout + noConfig.stderr);
  assert.match(noConfig.stderr, /^error: no components\.json in /);
  assert.deepEqual(JSON.parse(run(app, ['check', '--json']).stdout).ok, false);

  const noKit = fixture(t);
  rmSync(join(noKit, 'node_modules'), { recursive: true });
  const unknown = run(noKit, ['check']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /@hachej\/boring-ui-kit is not installed .*node_modules\/@hachej\/boring-ui-kit\/package\.json/);
  assert.equal(run(noKit, ['check', '--dir', 'src']).status, 2);
  assert.equal(run(noKit, ['check', '--design']).status, 2);
  assert.equal(run(noKit, ['frobnicate']).status, 2);
});

test('help exits 0 and names every optional chat and viewer item of the registry (D-257)', () => {
  const help = run(root, ['help']);
  assert.equal(help.status, 0, help.stderr);
  assert.equal(run(root, ['--help']).stdout, help.stdout);
  const items = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8')).items.map(item => item.name).filter(name => /^(pi-chat-|viewer-)/.test(name) || name === 'pi-artifacts');
  assert.ok(items.length >= 15, items.join(' '));
  for (const name of [...items, 'pi-app', 'pi-chat']) assert.match(help.stdout, new RegExp(`(^|[\\s,])${name}[\\s,.]`), `help names ${name}`);
});

test('add runs the pinned shadcn CLI then records the manifest, so check passes; update --dry-run prints the reinstall', t => {
  const app = fixture(t);
  // A stand-in `npx` first on PATH: writes the file `shadcn add card` would write and records its arguments (offline).
  const fake = join(app, '.fake-bin');
  write(join(fake, 'npx'), `#!/bin/sh\necho "$@" > "${join(app, '.npx-args')}"\nmkdir -p src/components/ui\necho 'export const Card = () => null' > src/components/ui/card.tsx\n`);
  chmodSync(join(fake, 'npx'), 0o755);
  const env = { PATH: `${fake}${delimiter}${process.env.PATH}` };
  const added = run(app, ['add', 'card'], env);
  assert.equal(added.status, 0, added.stdout + added.stderr);
  assert.equal(readFileSync(join(app, '.npx-args'), 'utf8').trim(), '-y shadcn@4.21.5 add card --overwrite --yes');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(app, 'SHADCN-GENERATED.json'), 'utf8')).files), ['button.tsx', 'card.tsx']);
  const after = run(app, ['check', '--design', 'src']);
  assert.equal(after.status, 0, after.stdout + after.stderr);

  const update = run(app, ['update', '--version', '9.9.10', '--dry-run']);
  assert.equal(update.status, 0, update.stdout + update.stderr);
  assert.equal(update.stdout.trim(), 'npx -y shadcn@4.21.5 add https://cdn.jsdelivr.net/npm/@hachej/boring-ui-kit@9.9.10/r/pi-chat.json --overwrite --yes');
  const architecture = JSON.parse(readFileSync(join(root, 'ARCHITECTURE.json'), 'utf8'));
  assert.equal(architecture.sourceDistribution.format, 'shadcn@4.21.5', 'the command pins the CLI the registry is built for');
  const manifest = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8'));
  assert.equal(manifest.bin['boring-ui-blocks'], './bin/boring-ui-blocks.mjs', 'shipped as the kit\'s bin');
});

test('update keeps the app\'s exact dependency pins when the CLI\'s package manager rewrites them to ranges', t => {
  const app = fixture(t);
  const pins = { 'lucide-react': '1.8.0', 'class-variance-authority': '0.7.1' };
  const manifest = { name: 'fictional-app', private: true, dependencies: { ...pins }, devDependencies: { typescript: '5.9.3' } };
  write(join(app, 'package.json'), `${JSON.stringify(manifest, null, 4)}\n`);
  write(join(app, 'package-lock.json'), `${JSON.stringify({ name: 'fictional-app', lockfileVersion: 3, packages: { '': { name: 'fictional-app', dependencies: { ...pins }, devDependencies: { typescript: '5.9.3' } } } }, null, 2)}\n`);
  // A stand-in `npx` that does what `npm install <name>` does under shadcn: saves ^ ranges over the pins and adds a new dependency.
  const fake = join(app, '.fake-bin');
  write(join(fake, 'rewrite.mjs'), `import { readFileSync, writeFileSync } from 'node:fs';
for (const file of ['package.json', 'package-lock.json']) {
  const json = JSON.parse(readFileSync(file, 'utf8')), root = file === 'package.json' ? json : json.packages[''];
  for (const field of ['dependencies', 'devDependencies']) for (const name of Object.keys(root[field] ?? {})) root[field][name] = '^' + root[field][name];
  root.dependencies['new-dependency'] = '^2.0.0';
  writeFileSync(file, JSON.stringify(json, null, 2) + '\\n');
}
`);
  write(join(fake, 'npx'), `#!/bin/sh\n${JSON.stringify(process.execPath)} "${join(fake, 'rewrite.mjs')}"\n`);
  chmodSync(join(fake, 'npx'), 0o755);
  const updated = run(app, ['update', '--version', '9.9.9'], { PATH: `${fake}${delimiter}${process.env.PATH}` });
  assert.equal(updated.status, 0, updated.stdout + updated.stderr);
  const after = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
  assert.deepEqual(after.dependencies, { ...pins, 'new-dependency': '^2.0.0' }, 'exact pins stay exact; what the CLI added is kept');
  assert.deepEqual(after.devDependencies, { typescript: '5.9.3' });
  const lock = JSON.parse(readFileSync(join(app, 'package-lock.json'), 'utf8')).packages[''];
  assert.deepEqual(lock.dependencies, { ...pins, 'new-dependency': '^2.0.0' }, 'the lockfile root agrees with package.json');
  assert.match(updated.stdout, /kept the version specifiers of class-variance-authority, lucide-react, typescript/);
});
