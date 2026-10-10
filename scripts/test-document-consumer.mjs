import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { prepareConsumerIsolation, assertConsumerTypeFiles, npmInstallFlags } from './consumer-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'boring-document-consumer-'));
const cache = process.env.npm_config_cache;
assert.ok(cache, 'Set npm_config_cache to a writable npm cache (npm run sets it)');
function run(command, args, env) {
  const result = runCaptured(command, args, { cwd: directory, timeout: 120000, ...(env ? { env } : {}) });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} failed: ${result.error?.message ?? result.signal ?? result.status}`);
  return result.stdout;
}
try {
  const isolated = prepareConsumerIsolation(directory);
  mkdirSync(join(directory, 'packs'));
  const archives = [];
  for (const name of ['files', 'ui']) {
    const packed = JSON.parse(run('npm', ['pack', join(root, 'packages', name), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0];
    archives.push(join(directory, 'packs', packed.filename));
  }
  const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  // The SQLite workspace loads Pi's portable env entry (results, errors, line scanning) at runtime; nothing else of Pi.
  const piDurable = JSON.parse(readFileSync(join(root, 'packages/files/package.json'), 'utf8')).peerDependencies['@earendil-works/pi-durable'];
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'isolated-document-consumer', private: true, type: 'module' }));
  run('npm', ['install', ...npmInstallFlags(cache), ...archives, `typescript@${source.devDependencies.typescript}`, `esbuild@${source.devDependencies.esbuild}`, `@earendil-works/pi-durable@${piDurable}`]);
  for (const name of ['@hachej/boring-agent', '@hachej/boring-execution', 'react']) assert.equal(existsSync(join(directory, 'node_modules', name)), false, name);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', lib: ['ES2023', 'DOM'], strict: true, exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: true, types: [] }, include: ['consumer.ts'] }));
  for (const extension of ['mjs', 'ts']) copyFileSync(join(root, `test/fixtures/isolated-document-consumer.${extension}`), join(directory, `consumer.${extension}`));
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  run(process.execPath, ['consumer.mjs'], isolated);
  mkdirSync(join(directory, 'test/packages'), { recursive: true });
  mkdirSync(join(directory, 'test/fixtures'), { recursive: true });
  mkdirSync(join(directory, 'examples/shared'), { recursive: true });
  // files.test.mjs is not copied: it drives the workspace provider over Pi's environments, which this consumer must not install.
  const publicTests = ['files-remote.test.mjs', 'ui.test.mjs', 'ui-html.test.mjs', 'ui-remote-save.test.mjs', 'ui-text-drafts.test.mjs'].map(name => 'test/packages/' + name);
  for (const path of [...publicTests, 'examples/shared/sqlite-workspaces.mjs', 'test/fixtures/text-draft-sqlite.mjs', 'test/fixtures/text-draft-sqlite-crash-child.mjs']) copyFileSync(join(root, path), join(directory, path));
  run(process.execPath, ['--test', '--experimental-test-isolation=none', ...publicTests], isolated);
  writeFileSync(join(directory, 'browser.mjs'), "export { createResourceClient } from '@hachej/boring-files/remote';\n");
  run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'browser.mjs', '--bundle', '--platform=browser', '--format=esm', '--outfile=browser.js', '--metafile=browser-meta.json'], isolated);
  const inputs = Object.keys(JSON.parse(readFileSync(join(directory, 'browser-meta.json'), 'utf8')).inputs);
  assert.ok(inputs.some(path => path.endsWith('/remote.js')));
  for (const path of inputs) {
    assert.ok(realpathSync(join(directory, path)).startsWith(realpathSync(directory) + '/'), path);
    assert.doesNotMatch(path, /pi-durable|chord|react|sqlite|git\.js|@hachej\/boring-agent|node:|@hachej\/boring-execution/u);
  }
  console.log('PASS: installed document and remote resource tarballs, strict declarations, the SQLite workspace provider behind an authenticated controller journey and isolated browser bundle; Pi only as the optional env peer, no agent or React, no Pi in the browser bundle');
} finally { rmSync(directory, { recursive: true, force: true }); }
