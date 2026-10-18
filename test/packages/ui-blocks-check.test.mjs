// `boring-ui-blocks` (the kit's bin) run as an app runs it, against fictional consumer apps in a temp directory, offline: the installed kit's
// registry items are this repository's public/r. One command checks untouched blocks, the tokens-only design rule and generated shadcn ui.
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
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
`;

/** A fictional Vite app with the kit installed (version 9.9.9, items from public/r), pi-chat copied as `shadcn add` writes it, and one shadcn file. */
function fixture(t) {
  const app = mkdtempSync(join(tmpdir(), 'kit-blocks-check-'));
  t.after(() => rmSync(app, { recursive: true, force: true }));
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
  const edited = join(app, 'src/components/pi-chat/artifact.ts');
  writeFileSync(edited, readFileSync(edited, 'utf8').replace("svg: 'SVG image'", "svg: 'SVG image', maquette: 'Maquette'"));
  const drift = run(app, ['check']);
  assert.equal(drift.status, 1, drift.stdout + drift.stderr);
  assert.deepEqual(drift.stdout.split('\n').filter(line => /^(blocks|design|ui) /.test(line)), ['blocks edited src/components/pi-chat/artifact.ts pi-chat']);
  assert.match(drift.stdout, /^fail @hachej\/boring-ui-kit@9\.9\.9: 1 violation\(s\) \(blocks 1, design 0, ui 0\)/m);
});

test('--design lists hard-coded colour, shadow step and dark: variant in the app code with file:line:column and rule', t => {
  const app = fixture(t);
  run(app, ['manifest']);
  write(join(app, 'src/features/alert.tsx'), `export function Alert() {
  return <div className="bg-[#ff0000] p-4">
    <p className="shadow-lg dark:text-muted-foreground">Fictional alert</p>
  </div>
}
`);
  // Without --design the app's own code is not checked.
  assert.equal(run(app, ['check']).status, 0);
  const result = run(app, ['check', '--design', 'src']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(result.stdout.split('\n').filter(line => line.startsWith('design ')), [
    'design color src/features/alert.tsx:2:30 #ff0000',
    'design shadow src/features/alert.tsx:3:19 shadow-lg',
    'design dark src/features/alert.tsx:3:29 dark:text-muted-foreground',
  ]);
  const json = JSON.parse(run(app, ['check', '--design', 'src', '--json']).stdout);
  assert.equal(json.ok, false);
  assert.deepEqual(json.violations.map(v => [v.check, v.rule, v.file, v.line]), [['design', 'color', 'src/features/alert.tsx', 2], ['design', 'shadow', 'src/features/alert.tsx', 3], ['design', 'dark', 'src/features/alert.tsx', 3]]);
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

test('add runs the pinned shadcn CLI then records the manifest, so check passes; update --dry-run prints the reinstall', t => {
  const app = fixture(t);
  // A stand-in `npx` first on PATH: writes the file `shadcn add card` would write and records its arguments (offline).
  const fake = join(app, '.fake-bin');
  write(join(fake, 'npx'), `#!/bin/sh\necho "$@" > "${join(app, '.npx-args')}"\nmkdir -p src/components/ui\necho 'export const Card = () => null' > src/components/ui/card.tsx\n`);
  chmodSync(join(fake, 'npx'), 0o755);
  const env = { PATH: `${fake}${delimiter}${process.env.PATH}` };
  const added = run(app, ['add', 'card'], env);
  assert.equal(added.status, 0, added.stdout + added.stderr);
  assert.equal(readFileSync(join(app, '.npx-args'), 'utf8').trim(), '-y shadcn@4.21.5 add card');
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
