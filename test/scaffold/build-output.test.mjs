import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { runCaptured as spawnSync } from '../../scripts/run-captured.mjs';
import test from 'node:test';
import { build, cleanOutputs } from '../../scripts/build.mjs';

const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'boring-build-output-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packages/files/src'), { recursive: true });
  writeFileSync(join(root, 'ARCHITECTURE.json'), JSON.stringify({ packages: { files: {} } }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ files: [], references: [{ path: 'packages/files' }] }));
  const config = { compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', rootDir: 'src', outDir: 'dist', tsBuildInfoFile: 'dist/build.tsbuildinfo', composite: true, declaration: true, strict: true, types: [], noEmitOnError: true }, include: ['src/**/*.ts'] };
  writeFileSync(join(root, 'packages/files/tsconfig.json'), JSON.stringify(config));
  writeFileSync(join(root, 'packages/files/src/live.ts'), 'export const live = 1;');
  return { root, config };
}

test('clean build removes outputs of deleted sources; raw tsc --force reproduces the bug', { timeout: 30000 }, t => {
  const { root } = fixture(t);
  const removedSource = join(root, 'packages/files/src/removed.ts');
  const removedOutput = join(root, 'packages/files/dist/removed.js');
  writeFileSync(removedSource, 'export const removed = "do not ship";');
  assert.equal(build(root, { stdio: 'ignore' }), 0);
  assert.ok(existsSync(removedOutput));
  rmSync(removedSource);
  const oldCommand = spawnSync(process.execPath, [compiler, '--build', '--force', join(root, 'tsconfig.json')], { cwd: root, encoding: 'utf8' });
  assert.equal(oldCommand.status, 0, oldCommand.stderr + oldCommand.stdout);
  assert.ok(existsSync(removedOutput), 'negative control: raw force-build retains deleted-source output');
  assert.equal(build(root, { stdio: 'ignore' }), 0);
  assert.equal(existsSync(removedOutput), false);
  assert.equal(existsSync(join(root, 'packages/files/dist/removed.d.ts')), false);
  assert.ok(existsSync(join(root, 'packages/files/dist/live.d.ts')));
});

test('failed build does not leave the previous successful module as current output', { timeout: 30000 }, t => {
  const { root } = fixture(t);
  assert.equal(build(root, { stdio: 'ignore' }), 0);
  writeFileSync(join(root, 'packages/files/src/live.ts'), 'export const live: number = "bad";');
  assert.notEqual(build(root, { stdio: 'ignore' }), 0);
  assert.equal(existsSync(join(root, 'packages/files/dist/live.js')), false);
});

test('validate every configured output before deleting any output', t => {
  const { root, config } = fixture(t);
  mkdirSync(join(root, 'packages/files/dist'));
  writeFileSync(join(root, 'packages/files/dist/keep.txt'), 'unchanged');
  mkdirSync(join(root, 'packages/ui'), { recursive: true });
  writeFileSync(join(root, 'ARCHITECTURE.json'), JSON.stringify({ packages: { files: {}, ui: {} } }));
  writeFileSync(join(root, 'packages/ui/tsconfig.json'), JSON.stringify({ ...config, compilerOptions: { ...config.compilerOptions, outDir: '../../outside' } }));
  assert.throws(() => cleanOutputs(root), /Undeclared build outputs/);
  assert.equal(readFileSync(join(root, 'packages/files/dist/keep.txt'), 'utf8'), 'unchanged');
});

test('a symlinked output cannot make cleanup delete external files', t => {
  const { root } = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'boring-outside-output-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'keep.txt'), 'keep');
  symlinkSync(outside, join(root, 'packages/files/dist'), 'dir');
  assert.throws(() => cleanOutputs(root), /owned directory/);
  assert.equal(readFileSync(join(outside, 'keep.txt'), 'utf8'), 'keep');
});
