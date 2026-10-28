// `boring-ui-blocks add` as CI and agents run it: stdin is not a terminal and nobody answers. Fictional app in a temp directory, a stand-in
// `npx` for the shadcn CLI (offline), the real bin through child_process.
import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bin = join(root, 'packages/ui/bin/boring-ui-blocks.mjs');
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const run = (app, args, env) => spawnSync(process.execPath, [bin, ...args], { cwd: app, encoding: 'utf8', env: { ...process.env, ...env } });

/** The bin with stdin an open pipe nobody writes to or closes (CI, an agent): a prompt would wait forever, so it is killed after `ms`. */
const runOpenStdin = (app, args, env, ms = 20000) => new Promise(resolve => {
  const child = spawn(process.execPath, [bin, ...args], { cwd: app, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', hung = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => { hung = true; child.kill('SIGKILL'); }, ms);
  child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr, hung }); });
});

const REGISTRY = 'export const Toggle = () => "registry"\n';
const EDITED = 'export const Toggle = () => "edited by the app"\n';

/** A fictional app with a button and a stand-in `npx` that, like `shadcn add toggle`, writes toggle.tsx and asks before replacing other content. */
function app(t) {
  const dir = mkdtempSync(join(tmpdir(), 'kit-blocks-add-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  write(join(dir, 'package.json'), JSON.stringify({ name: 'fictional-app', private: true }));
  write(join(dir, 'components.json'), JSON.stringify({ aliases: { components: '@/components', ui: '@/components/ui' } }));
  write(join(dir, 'src/components/ui/button.tsx'), 'export const Button = () => null\n');
  write(join(dir, '.registry-toggle'), REGISTRY);
  const fake = join(dir, '.fake-bin');
  write(join(fake, 'npx'), `#!/bin/sh
echo "$@" > "${join(dir, '.npx-args')}"
mkdir -p src/components/ui
target=src/components/ui/toggle.tsx
if [ -e $target ] && ! cmp -s $target "${join(dir, '.registry-toggle')}"; then
  case " $* " in *" --overwrite "*) ;; *) printf 'The file toggle.tsx already exists. Overwrite? (y/N) '; read answer || exit 1; [ "$answer" = y ] || exit 1;; esac
fi
cp "${join(dir, '.registry-toggle')}" $target
if [ -e "${join(dir, '.registry-extra')}" ]; then cp "${join(dir, '.registry-extra')}" src/components/ui/extra.tsx; fi
`);
  chmodSync(join(fake, 'npx'), 0o755);
  return { dir, env: { PATH: `${fake}${delimiter}${process.env.PATH}` }, toggle: join(dir, 'src/components/ui/toggle.tsx') };
}

test('add accepts --manifest, as its usage line says, and records the manifest there', t => {
  const { dir, env } = app(t);
  const added = run(dir, ['add', 'toggle', '--manifest', 'scripts/generated.json'], env);
  assert.equal(added.status, 0, added.stdout + added.stderr);
  assert.match(added.stdout, /^scripts\/generated\.json: 2 file\(s\)$/m);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'scripts/generated.json'), 'utf8')).files), ['button.tsx', 'toggle.tsx']);
  assert.equal(existsSync(join(dir, 'SHADCN-GENERATED.json')), false);
  assert.doesNotMatch(readFileSync(join(dir, '.npx-args'), 'utf8'), /manifest/, 'the flag is the bin\'s, not shadcn\'s');
});

test('add never waits on stdin: a differing file is kept and listed (exit 1)', async t => {
  const { dir, env, toggle } = app(t);
  write(toggle, EDITED);
  const kept = await runOpenStdin(dir, ['add', 'toggle'], env);
  assert.equal(kept.hung, false, `add waited for an answer on stdin: ${kept.stdout}`);
  assert.equal(kept.status, 1, kept.stdout + kept.stderr);
  assert.match(kept.stderr, /kept 1 existing file\(s\)[^\n]*\n  src\/components\/ui\/toggle\.tsx/);
  assert.equal(readFileSync(toggle, 'utf8'), EDITED);
  assert.equal(existsSync(join(dir, 'SHADCN-GENERATED.json')), false, 'no manifest records the app\'s edit as generated');
});

test('add --overwrite replaces a differing file, without a prompt', async t => {
  const { dir, env, toggle } = app(t);
  write(toggle, EDITED);
  const replaced = await runOpenStdin(dir, ['add', 'toggle', '--overwrite'], env);
  assert.equal(replaced.hung, false);
  assert.equal(replaced.status, 0, replaced.stdout + replaced.stderr);
  assert.equal(readFileSync(toggle, 'utf8'), REGISTRY);
  assert.equal(readFileSync(join(dir, '.npx-args'), 'utf8').trim(), '-y shadcn@4.23.0 add toggle --overwrite --yes');
});

test('add leaves a file with identical content alone and exits 0', async t => {
  const { dir, env, toggle } = app(t);
  write(toggle, REGISTRY);
  const same = await runOpenStdin(dir, ['add', 'toggle'], env);
  assert.equal(same.hung, false);
  assert.equal(same.status, 0, same.stdout + same.stderr);
  assert.equal(same.stderr, '');
  assert.equal(readFileSync(toggle, 'utf8'), REGISTRY);
});

test('add that keeps a differing file still records the files it created, so check does not call them unknown', async t => {
  const { dir, env, toggle } = app(t);
  write(join(dir, 'node_modules/@hachej/boring-ui-kit/package.json'), JSON.stringify({ name: '@hachej/boring-ui-kit', version: '9.9.9' }));
  write(join(dir, 'node_modules/@hachej/boring-ui-kit/r/registry.json'), '{}\n');
  write(join(dir, '.registry-extra'), 'export const Extra = () => "new"\n');
  write(toggle, EDITED);
  const kept = await runOpenStdin(dir, ['add', 'toggle'], env);
  assert.equal(kept.hung, false, `add waited for an answer on stdin: ${kept.stdout}`);
  assert.equal(kept.status, 1, kept.stdout + kept.stderr);
  const manifest = JSON.parse(readFileSync(join(dir, 'SHADCN-GENERATED.json'), 'utf8'));
  assert.ok('extra.tsx' in manifest.files, `the file add created is not recorded: ${JSON.stringify(manifest.files)}`);
  assert.equal('toggle.tsx' in manifest.files, false, 'the kept edit is recorded as generated');
  assert.equal(readFileSync(toggle, 'utf8'), EDITED);
  const checked = run(dir, ['check'], env);
  assert.doesNotMatch(checked.stdout, /extra\.tsx/, `check reports the file add created: ${checked.stdout}`);
});
