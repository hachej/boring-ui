// Isolated consumer of @hachej/boring-testing: install the packed testing and agent archives (and their pinned registry peers) into a temporary
// app, type-check against the public declarations, then run the README's journey: an agent answered by the scripted model, driven in
// headless Chromium (CHROMIUM) behind the idle proxy.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { assertConsumerTypeFiles, prepareConsumerIsolation, npmInstallFlags } from './consumer-isolation.mjs';
import { writeLockedManifest } from './consumer-install.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = process.env.npm_config_cache;
assert.ok(cache, 'Set npm_config_cache to a writable npm cache (npm run sets it)');
assert.ok(process.env.CHROMIUM, 'Set CHROMIUM to a Chromium or chrome-headless-shell binary');
const temporary = mkdtempSync(join(tmpdir(), 'boring-testing-consumer-'));
// The pinned native SDK probes ten ancestor node_modules paths even when local types exist.
const directory = join(temporary, ...Array.from({ length: 12 }, () => 'nested'), 'consumer');
mkdirSync(directory, { recursive: true });
function run(command, args, env) {
  const result = runCaptured(command, args, { cwd: directory, timeout: 120000, ...(env ? { env } : {}) });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} failed: ${result.error?.message ?? result.signal ?? result.status}`);
  return result.stdout;
}
try {
  const isolated = prepareConsumerIsolation(directory);
  mkdirSync(join(directory, 'packs'));
  const archives = ['testing', 'agent'].map(name => {
    const packed = JSON.parse(run('npm', ['pack', join(root, 'packages', name), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0];
    return join(directory, 'packs', packed.filename);
  });
  const agent = JSON.parse(readFileSync(join(root, 'packages/agent/package.json'), 'utf8'));
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const sourceLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const dependencies = Object.fromEntries(['@earendil-works/pi-durable', '@earendil-works/chord', '@earendil-works/pi-ai'].map(name => [name, agent.peerDependencies[name]]));
  for (const name of ['typescript', '@types/node', '@modelcontextprotocol/sdk']) dependencies[name] = rootManifest.devDependencies[name];
  // Native SDK declarations optionally import these names; keep resolution inside the installed fixture.
  for (const name of ['buffer', 'undici', 'undici-types']) dependencies[name] = sourceLock.packages['node_modules/' + name].version;
  writeLockedManifest(root, directory, 'isolated-testing-consumer', dependencies);
  run('npm', ['install', '--package-lock-only', ...npmInstallFlags(cache), ...archives]);
  run('npm', ['ci', ...npmInstallFlags(cache)]);
  for (const name of ['@hachej/boring-ui-kit', '@hachej/boring-files', '@hachej/boring-execution', 'react']) assert.equal(existsSync(join(directory, 'node_modules', name)), false, name);
  writeFileSync(join(directory, 'consumer.ts'), `import { createScriptedModel, createFakeChatModel, launch, q, startIdleProxy, withSubmitFaults, type Turn, type Browser } from '@hachej/boring-testing';
import { defineAgent } from '@hachej/boring-agent/agents';
const turns: Turn[] = ['Done.', { tools: [{ name: 'read', args: { path: 'notes.md' } }], usage: { input: 1 } }, ctx => ctx.last?.text ?? 'none', { error: 'Fictional failure' }];
const scripted = createScriptedModel({ script: { 'Plan': turns }, models: [{ id: 'fictional', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }] });
defineAgent({ id: 'planner', model: scripted.model });
const fake = createFakeChatModel();
(await fake.nextCall()).respond('Fictional', { output: 1 });
const browser: Browser = await launch('about:blank', { evidence: '.' });
await browser.until('ready', q('body'));
await browser.emulate('phone');
const proxy = await startIdleProxy({ target: 'http://127.0.0.1:1', idleMs: 10 });
proxy.cut();
const { handler, faults } = withSubmitFaults(async () => new Response('ok'));
faults.refuse = 1; await handler(new Request('http://fictional.invalid/?op=submit'));
`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: true, types: ['node'], lib: ['ES2023', 'DOM'] }, include: ['consumer.ts'] }));
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  const readme = readFileSync(join(root, 'packages/testing/README.md'), 'utf8');
  writeFileSync(join(directory, 'journey.mjs'), /```js\n([\s\S]*?)```/.exec(readme)[1]);
  assert.match(run(process.execPath, ['journey.mjs'], isolated), /PASS: scripted answer shown through the proxy/);
  console.log('PASS: packed testing and agent archives, strict public declarations, and the README journey (scripted model, headless Chromium, idle proxy) in an isolated install; no UI, files or execution packages installed');
} finally { rmSync(temporary, { recursive: true, force: true }); }
