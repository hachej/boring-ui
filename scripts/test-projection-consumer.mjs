import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { prepareConsumerIsolation, assertConsumerTypeFiles, npmInstallFlags } from './consumer-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'boring-projection-consumer-'));
// The pinned native SDK probes ten ancestor node_modules paths even when local types exist.
const directory = join(temporary, ...Array.from({ length: 12 }, () => 'nested'), 'consumer');
mkdirSync(directory, { recursive: true });
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
  for (const name of ['agent']) {
    const packed = JSON.parse(run('npm', ['pack', join(root, 'packages', name), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0];
    archives.push(join(directory, 'packs', packed.filename));
  }
  const agent = JSON.parse(readFileSync(join(root, 'packages/agent/package.json'), 'utf8'));
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const sourceLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const dependencies = Object.fromEntries(['@earendil-works/pi-durable', '@earendil-works/chord', '@earendil-works/pi-ai'].map(name => [name, agent.peerDependencies[name]]));
  for (const name of ['typescript', '@types/node', '@modelcontextprotocol/sdk', 'esbuild']) dependencies[name] = rootManifest.devDependencies[name];
  // Native SDK declarations optionally import these names; keep resolution inside the installed fixture.
  for (const name of ['buffer', 'undici', 'undici-types']) dependencies[name] = sourceLock.packages['node_modules/' + name].version;
  const manifest = { name: 'isolated-projection-consumer', version: '1.0.0', private: true, type: 'module', dependencies };
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
  for (const name of ['@hachej/boring-files', '@hachej/boring-ui-kit', '@hachej/boring-execution', 'react', '@tiptap/core', '@tldraw/editor', 'tldraw']) assert.equal(existsSync(join(directory, 'node_modules', name)), false, name);
  writeFileSync(join(directory, 'consumer.ts'), `import { createConversationProjectionHandler, createConversationTextReceiver, type ConversationProjectionOptions, type ConversationTextSnapshot } from '@hachej/boring-agent/projection';
declare const options: ConversationProjectionOptions;
import type { ProjectionIdentity } from '@hachej/boring-agent/projection';
declare const identity: ProjectionIdentity;
const handler: (request: Request) => Promise<Response> = createConversationProjectionHandler(options);
const receiver = createConversationTextReceiver({ runtimeId: 'fictional', scopeId: 'fictional', principalId: 'fictional', conversationId: identity.conversationId });
const snapshot: ConversationTextSnapshot = receiver.read('{}');
receiver.reset();
void handler; void snapshot;
`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: true, types: ['node'], lib: ['ES2023', 'DOM'] }, include: ['consumer.ts'] }));
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  mkdirSync(join(directory, 'test/packages'), { recursive: true });
  const tests = ['test/packages/agent-projection.test.mjs', 'test/packages/agent-projection-bounds.test.mjs'];
  for (const path of tests) copyFileSync(join(root, path), join(directory, path));
  writeFileSync(join(directory, 'pure-import.mjs'), `import { registerHooks } from 'node:module';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const allowed = realpathSync(new URL('./node_modules/@hachej/boring-agent', import.meta.url)) + '/';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@earendil-works/') || /^@hachej\\/boring-(files|ui-kit|execution)(\\/|$)/.test(specifier)) throw new Error('Unexpected runtime dependency: ' + specifier);
  const resolved = next(specifier, context);
  if (resolved.url.startsWith('file:') && !realpathSync(fileURLToPath(resolved.url)).startsWith(allowed)) throw new Error('Unexpected projection runtime file');
  return resolved;
} });
if (process.argv[2]) await import(process.argv[2]);
const { createConversationTextReceiver, createConversationProjectionHandler } = await import('@hachej/boring-agent/projection');
if (typeof createConversationTextReceiver !== 'function' || typeof createConversationProjectionHandler !== 'function') throw new Error('Missing projection exports');
`);
  run(process.execPath, ['pure-import.mjs'], isolated);
  writeFileSync(join(directory, 'node_modules/@hachej/boring-agent/dist/guard-probe.mjs'), `import '../../../@earendil-works/pi-durable/dist/index.js';`);
  const forbidden = runCaptured(process.execPath, ['pure-import.mjs', './node_modules/@hachej/boring-agent/dist/guard-probe.mjs'], { cwd: directory, timeout: 30000, env: isolated });
  assert.notEqual(forbidden.status, 0);
  assert.match(forbidden.stderr, /Unexpected projection runtime file/);
  console.log('PASS: negative control rejects relative imports into native runtime');
  rmSync(join(directory, 'node_modules/@hachej/boring-agent/dist/guard-probe.mjs'));

  run(process.execPath, ['--test', '--experimental-test-isolation=none', ...tests], isolated);
  writeFileSync(join(directory, 'browser.mjs'), `export { createConversationTextReceiver } from '@hachej/boring-agent/projection';`);
  run('node_modules/.bin/esbuild', [ 'browser.mjs', '--bundle', '--platform=browser', '--format=esm', '--outfile=browser.js', '--metafile=browser-meta.json'], isolated);
  const inputs = Object.keys(JSON.parse(readFileSync(join(directory, 'browser-meta.json'), 'utf8')).inputs);
  assert.ok(inputs.every(path => path === 'browser.mjs' || path.startsWith('node_modules/@hachej/boring-agent/dist/')), inputs.join('\n'));
  console.log('PASS: isolated agent archive, strict declarations, actual native projection and receiver tests, browser bundle; no files/UI/execution package installed or native runtime import in projection');
} finally { rmSync(temporary, { recursive: true, force: true }); }
