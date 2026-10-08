import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { prepareConsumerIsolation, assertConsumerTypeFiles, npmInstallFlags } from './consumer-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'boring-remote-shell-consumer-'));
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
  // The selected subpath reads request bodies through @hachej/boring-files/request-guard (their one owner), so a real consumer installs files too.
  for (const name of ['files', 'execution']) {
    const packed = JSON.parse(run('npm', ['pack', join(root, 'packages', name), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0];
    archives.push(join(directory, 'packs', packed.filename));
  }
  const execution = JSON.parse(readFileSync(join(root, 'packages/execution/package.json'), 'utf8'));
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const sourceLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const dependencies = Object.fromEntries(Object.entries(execution.peerDependencies).filter(([name]) => !execution.peerDependenciesMeta?.[name]?.optional));
  for (const name of ['typescript', '@types/node', '@modelcontextprotocol/sdk']) dependencies[name] = rootManifest.devDependencies[name];
  // undici-types imports "buffer"; pin it locally so ancestor node_modules cannot satisfy the isolated consumer.
  dependencies.buffer = sourceLock.packages['node_modules/buffer'].version;
  const manifest = { name: 'isolated-remote-shell-consumer', version: '1.0.0', private: true, type: 'module', dependencies };
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
  const packages = {};
  const include = (name, parent = '') => {
    let path = `${parent}/node_modules/${name}`.replace(/^\//, '');
    while (!sourceLock.packages[path] && parent) {
      const ancestor = parent.lastIndexOf('/node_modules/');
      parent = ancestor === -1 ? '' : parent.slice(0, ancestor);
      path = `${parent}/node_modules/${name}`.replace(/^\//, '');
    }
    if (packages[path]) return;
    const entry = sourceLock.packages[path];
    assert.ok(entry && !entry.link, `Missing registry lock entry: ${name}`);
    packages[path] = entry;
    for (const dependency of Object.keys(entry.dependencies ?? {})) include(dependency, path);
    for (const dependency of Object.keys(entry.optionalDependencies ?? {})) {
      if (sourceLock.packages[`node_modules/${dependency}`]) include(dependency, path);
    }
    for (const dependency of Object.keys(entry.peerDependencies ?? {})) if (!entry.peerDependenciesMeta?.[dependency]?.optional) include(dependency, path);
  };
  for (const name of Object.keys(dependencies)) include(name);
  packages[''] = { name: manifest.name, version: manifest.version, dependencies };
  writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages }));
  run('npm', ['install', '--package-lock-only', ...npmInstallFlags(cache), ...archives]);
  run('npm', ['ci', ...npmInstallFlags(cache)]);
  for (const name of ['@hachej/boring-ui-kit', '@hachej/boring-agent', 'just-bash', 'isomorphic-git']) assert.equal(existsSync(join(directory, 'node_modules', name)), false, name);
  writeFileSync(join(directory, 'consumer.ts'), `import { createRemoteShellHandler, createRemoteShellLease } from '@hachej/boring-execution/remote-shell';
import type { RemoteShellAccess } from '@hachej/boring-execution/remote-shell';
import type { Shell } from '@earendil-works/pi-durable/env';
import type { WorkspaceLease } from '@hachej/boring-execution/contracts';
declare const access: RemoteShellAccess;
const handler = createRemoteShellHandler({ authenticate: async () => access });
const lease: WorkspaceLease<Shell> = createRemoteShellLease({ identity: access.identity, endpoint: 'https://fictional.invalid/shell', fetch: handler });
await lease.environment.exec('printf fictional', { timeout: 0.05 }, access.context);
await lease.release(access.context);
`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: true, types: ['node'], lib: ['ES2023', 'DOM'] }, include: ['consumer.ts'] }));
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  for (const path of ['test/packages', 'test/fixtures']) mkdirSync(join(directory, path), { recursive: true });
  for (const path of ['test/packages/execution-remote-shell.test.mjs', 'test/fixtures/native-document.mjs']) copyFileSync(join(root, path), join(directory, path));
  run(process.execPath, ['--test', '--experimental-test-isolation=none', 'test/packages/execution-remote-shell.test.mjs'], isolated);
  console.log('PASS: packed native remote Shell, pinned registry dependencies, strict public declarations and actual native execution; with Boring files (request guard); no Boring UI/agent or virtual/Git peers installed');
} finally { rmSync(directory, { recursive: true, force: true }); }
