import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { prepareConsumerIsolation, assertConsumerTypeFiles, npmInstallFlags } from './consumer-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'boring-definitions-consumer-'));
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
  for (const name of ['files', 'agent', 'testing']) {
    const packed = JSON.parse(run('npm', ['pack', join(root, 'packages', name), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0];
    archives.push(join(directory, 'packs', packed.filename));
  }
  const agent = JSON.parse(readFileSync(join(root, 'packages/agent/package.json'), 'utf8'));
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const sourceLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const dependencies = Object.fromEntries(['@earendil-works/pi-durable', '@earendil-works/chord', '@earendil-works/pi-ai'].map(name => [name, agent.peerDependencies[name]]));
  for (const name of ['typescript', '@types/node', '@modelcontextprotocol/sdk']) dependencies[name] = rootManifest.devDependencies[name];
  // Native SDK declarations optionally import these names; keep resolution inside the installed fixture.
  for (const name of ['buffer', 'undici', 'undici-types']) dependencies[name] = sourceLock.packages['node_modules/' + name].version;
  const manifest = { name: 'isolated-definitions-consumer', version: '1.0.0', private: true, type: 'module', dependencies };
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
  for (const name of ['@hachej/boring-ui-kit', '@hachej/boring-execution', 'react', '@tiptap/core', '@tldraw/editor', 'tldraw']) assert.equal(existsSync(join(directory, 'node_modules', name)), false, name);
  writeFileSync(join(directory, 'consumer.ts'), `import { loadAgentDefinition, type AgentDefinitionOptions, type AgentDefinitionBinding } from '@hachej/boring-agent/definitions';
import type { Conversation, AgentChange, TaskId, Tx } from '@earendil-works/pi-durable';
import { createDocumentDelivery, type DocumentDeliveryOptions, type DocumentDeliveryTarget } from '@hachej/boring-agent/delivery';
import type { ResourceExpectation } from '@hachej/boring-files';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
declare const options: AgentDefinitionOptions;
declare const conversation: Conversation;
const loaded = await loadAgentDefinition(options);
const binding: AgentDefinitionBinding = loaded.binding;
const change: AgentChange = loaded.change;
await conversation.configure(change, context);
await loadAgentDefinition({ ...options, expectedBinding: binding });
declare const deliveryOptions: DocumentDeliveryOptions;
declare const target: ResourceExpectation;
declare const guards: readonly ResourceExpectation[];
declare const producer: (tx: Tx) => Promise<TaskId<string>>;
const delivery = createDocumentDelivery(deliveryOptions);
const guarded: DocumentDeliveryTarget = { ...target, preconditions: guards };
await conversation.commit(tx => delivery.admit(tx, producer, guarded, { ownership: { kind: 'conversation' } }, context), context);
await conversation.commit(tx => delivery.admit(tx, producer, target, { ownership: { kind: 'conversation' } }, context), context);
await conversation.commit(tx => delivery.admit(tx, producer, guarded, { ownership: { kind: 'conversation' } }, context,
  { principalId: 'fictional-editor', initiatorId: 'fictional-human', scopeId: 'fictional-team' }), context);
createDocumentDelivery({ ...deliveryOptions, resolveAccess: async (...args) => deliveryOptions.resolveAccess(...args) });
import { createOutputValidation, type OutputProposal, type NativeToolEvidence } from '@hachej/boring-agent/validation';
import type { Harness } from '@earendil-works/pi-durable';
declare const harness: Harness;
declare const proposed: TaskId<OutputProposal>;
const validation = createOutputValidation<{ total: number }>({ name: 'consumer.validate', version: 1,
  harness: () => harness, authorize: async (_owner, evidence: readonly NativeToolEvidence[]) => evidence.length > 0,
  validate: (_text, evidence) => ({ kind: 'valid', value: { total: evidence.length } }) });
await conversation.commit(tx => tx.createTask(validation.task, { producer: proposed }, { ownership: { kind: 'conversation' } }), context);
const checked = await validation.check({ text: '{}', evidence: [] }, proposed, context);
if (checked.kind === 'valid') { const total: number = checked.value.total; void total; }

`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: true, types: ['node'], lib: ['ES2023', 'DOM'] }, include: ['consumer.ts'] }));
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  for (const path of ['test/packages', 'test/fixtures', 'test/compatibility', 'test/contracts', 'examples/current-hub', 'examples/redaction', 'examples/validated-output', 'examples/shared']) mkdirSync(join(directory, path), { recursive: true });
  const tests = ['test/packages/agent-validation.test.mjs', 'test/compatibility/validated-output.test.mjs',
    'test/contracts/validation-repair-crash.test.mjs', 'test/packages/agent-definitions.test.mjs', 'test/packages/agent-definitions-native.test.mjs',
    'test/packages/agent.test.mjs', 'test/packages/agent-delivery.test.mjs', 'test/compatibility/current-hub.test.mjs',
    'test/compatibility/current-hub-definitions.test.mjs', 'test/compatibility/current-hub-crash.test.mjs',
    'test/compatibility/current-hub-handoff.test.mjs', 'test/compatibility/current-hub-handoff-crash.test.mjs',
    'test/contracts/delivery-guards-crash.test.mjs', 'test/contracts/delivery-crash.test.mjs',
    'test/compatibility/redaction.test.mjs', 'test/contracts/redaction-crash.test.mjs',
    'test/compatibility/redaction-proposals.test.mjs', 'test/compatibility/redaction-adoption.test.mjs', 'test/contracts/redaction-adoption-crash.test.mjs'];
  for (const path of [...tests, 'test/fixtures/native-document.mjs', 'test/fixtures/hub-retention.mjs',
    'test/fixtures/current-hub-crash-child.mjs', 'examples/current-hub/app.mjs', 'examples/current-hub/definition.mjs',
    'examples/current-hub/companion.mjs', 'examples/current-hub/change-path.mjs', 'examples/current-hub/change-tools.mjs',
    'test/fixtures/current-hub-handoff-crash-child.mjs', 'test/fixtures/delivery-guards-crash-child.mjs',
    'test/fixtures/delivery-crash-child.mjs', 'test/fixtures/redaction-crash-child.mjs',
    'examples/redaction/app.mjs', 'examples/redaction/bindings.mjs', 'examples/redaction/reservation.mjs',
    'examples/redaction/proposals.mjs', 'examples/redaction/scripted-model.mjs', 'examples/redaction/adoption.mjs',
    'examples/redaction/adoption-bindings.mjs', 'examples/redaction/corrections.mjs', 'test/fixtures/redaction-adoption-crash-child.mjs',
    'examples/validated-output/app.mjs', 'examples/validated-output/scripted-model.mjs', 'test/fixtures/validation-repair-crash-child.mjs',
    'examples/shared/sqlite-workspaces.mjs', 'test/fixtures/metering-crash-child.mjs']) copyFileSync(join(root, path), join(directory, path));
  writeFileSync(join(directory, 'pure-import.mjs'), `import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('@earendil-works/') || /^@hachej\\/boring-(ui-kit|execution)(\\/|$)/.test(specifier)) throw new Error('Unexpected runtime dependency: ' + specifier);
  return next(specifier, context);
} });
const { loadAgentDefinition } = await import('@hachej/boring-agent/definitions');
if (typeof loadAgentDefinition !== 'function') throw new Error('Missing public definition loader');
`);
  run(process.execPath, ['pure-import.mjs'], isolated);
  run(process.execPath, ['--test', '--experimental-test-isolation=none', ...tests], isolated);
  console.log('PASS: isolated files and agent archives, strict declarations, data-only import, exact definition loading and native configuration/publication/reopen, pinned current-hub execution, fictional redaction reservation/admission, typed proposals, stable item corrections and atomic record/letter adoption, structured validation/native repair, guarded delivery and actual SIGKILL recovery/version cases; no UI or execution packages installed');
} finally { rmSync(temporary, { recursive: true, force: true }); }
