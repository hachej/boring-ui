import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { prepareConsumerIsolation, assertConsumerTypeFiles, npmInstallFlags } from './consumer-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'boring-virtual-consumer-'));
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
  for (const name of ['files', 'execution']) {
    const packed = JSON.parse(run('npm', ['pack', join(root, 'packages', name), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0];
    archives.push(join(directory, 'packs', packed.filename));
  }
  const execution = JSON.parse(readFileSync(join(root, 'packages/execution/package.json'), 'utf8'));
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries(Object.entries(execution.peerDependencies).filter(([name]) => !name.startsWith('@hachej/boring-')));
  for (const name of ['typescript', '@types/node', '@modelcontextprotocol/sdk']) dependencies[name] = rootManifest.devDependencies[name];
  const manifest = { name: 'isolated-virtual-consumer', version: '1.0.0', private: true, type: 'module', dependencies };
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
  const sourceLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
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
  for (const name of ['@hachej/boring-ui-kit', '@hachej/boring-agent']) assert.equal(existsSync(join(directory, 'node_modules', name)), false, name);
  writeFileSync(join(directory, 'consumer.ts'), `import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { createVirtualGitFs, installVirtualGitCommand } from '@hachej/boring-execution/virtual-git';
import { createGitRepository } from '@hachej/boring-files/git';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
const workspace = createVirtualWorkspace({ providerId: 'fictional', files: { '/repo/note': 'hello' } });
const lease = await workspace.acquire({ operationId: 'fixture', input: { cwd: '/repo' } }, BACKGROUND_CONTEXT);
const native: ExecutionEnv = lease.environment;
await native.readTextFile('note', BACKGROUND_CONTEXT);
const fs = createVirtualGitFs(workspace.filesystem);
await fs.promises.readFile('/repo/note');
const repository = createGitRepository({ fs, directory: '/repo', author: { name: 'Fictional', email: 'fictional@example.invalid' }, authorize: () => true });
installVirtualGitCommand({ bash: workspace.createBash({ cwd: '/repo' }), repository });
await repository.diff({ kind: 'index' }, { kind: 'worktree' });
`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: true, types: ['node'], lib: ['ES2023', 'DOM'] }, include: ['consumer.ts'] }));
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  for (const path of ['test/packages', 'test/fixtures', 'scripts', 'examples/aws']) mkdirSync(join(directory, path), { recursive: true });
  for (const path of ['test/packages/execution.test.mjs', 'test/packages/files-git.test.mjs', 'test/packages/virtual-paths.test.mjs', 'test/fixtures/native-document.mjs', 'test/fixtures/virtual-no-fallback.mjs', 'scripts/run-captured.mjs', 'examples/aws/fake-code-interpreter.mjs']) copyFileSync(join(root, path), join(directory, path));
  run(process.execPath, ['--test', '--experimental-test-isolation=none', 'test/packages/execution.test.mjs', 'test/packages/files-git.test.mjs', 'test/packages/virtual-paths.test.mjs'], isolated);
  console.log('PASS: packed files and execution, pinned registry dependencies, strict public declarations, native ToolTasks and shared virtual Bash/Git; no Boring UI/agent installed');
  const agent = JSON.parse(run('npm', ['pack', join(root, 'packages/agent'), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0];
  run('npm', ['install', ...npmInstallFlags(cache), join(directory, 'packs', agent.filename)]);
  writeFileSync(join(directory, 'consumer.ts'), readFileSync(join(directory, 'consumer.ts'), 'utf8') + `
import { createGitTool } from '@hachej/boring-agent/git';
createGitTool(repository);
`);
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  copyFileSync(join(root, 'test/packages/agent-git.test.mjs'), join(directory, 'test/packages/agent-git.test.mjs'));
  run(process.execPath, ['--test', '--experimental-test-isolation=none', 'test/packages/agent-git.test.mjs'], isolated);
  assert.equal(existsSync(join(directory, 'node_modules/@hachej/boring-ui-kit')), false);
  console.log('PASS: optional installed agent Git tool shares the authorized repository with Bash and native ToolTasks');
} finally { rmSync(directory, { recursive: true, force: true }); }
