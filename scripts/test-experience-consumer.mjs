import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { prepareConsumerIsolation, assertConsumerTypeFiles, npmInstallFlags } from './consumer-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const morning = process.argv[2] === '--morning';
assert.ok(process.argv.length === 2 || process.argv.length === 3 && morning, 'Expected no options or --morning');
const directory = mkdtempSync(join(tmpdir(), 'boring-experience-consumer-'));
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
  let filesArchive;
  for (const name of ['files', 'ui']) {
    const packed = JSON.parse(run('npm', ['pack', join(root, 'packages', name), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0];
    const archive = join(directory, 'packs', packed.filename);
    if (name === 'files') filesArchive = archive; else archives.push(archive);
  }
  const ui = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8'));
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries(Object.entries(ui.peerDependencies).filter(([name]) => ['react', 'react-dom', '@json-render/core', '@json-render/react', 'zod'].includes(name)));
  for (const name of ['typescript', '@types/react', '@types/react-dom', 'happy-dom', 'esbuild']) dependencies[name] = rootManifest.devDependencies[name];
  const manifest = { name: 'isolated-experience-consumer', version: '1.0.0', private: true, type: 'module', dependencies };
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
  for (const name of ['@hachej/boring-files', '@earendil-works/pi-durable', '@earendil-works/chord', '@hachej/boring-agent', 'tldraw', '@tldraw/editor', '@tiptap/core', 'marked', '@hachej/boring-execution']) assert.equal(existsSync(join(directory, 'node_modules', name)), false, name);
  writeFileSync(join(directory, 'consumer.ts'), `import { Experience, type RenderedExperienceCell } from '@hachej/boring-ui-kit/experience';
import { composeExperience, validateExperience, type ExperienceDescriptor, type ExperienceCompositionOptions, type ExperienceCompositionSnapshot } from '@hachej/boring-ui-kit/experience/compose';
import { composeExperienceRegion, type ExperienceRegionCompositionOptions } from '@hachej/boring-ui-kit/experience/regions';
import type { Experimental_CompositionEvaluator } from '@json-render/core';
import { createElement } from 'react';
const cells: readonly RenderedExperienceCell[] = [{ ref: 'fictional/notes', kind: 'notes', version: 1, render: () => null }];
const canView = (ref: string): boolean => ref === 'fictional/notes';
declare const input: unknown;
const descriptor: ExperienceDescriptor = validateExperience(input, { cells, canView });
createElement(Experience, { descriptor, cells, canView });
declare const options: ExperienceCompositionOptions;
const evaluate: Experimental_CompositionEvaluator = options.evaluate;
const snapshots: AsyncGenerator<ExperienceCompositionSnapshot> = composeExperience({ ...options, evaluate });
declare const regionOptions: ExperienceRegionCompositionOptions;
const regionSnapshots: AsyncGenerator<ExperienceCompositionSnapshot> = composeExperienceRegion(regionOptions);
void regionSnapshots; void snapshots;
`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: true, types: [], lib: ['ES2023', 'DOM'] }, include: ['consumer.ts'] }));
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  const headlessTests = ['ui-experience.test.mjs', 'ui-experience-composition.test.mjs', 'ui-experience-regions.test.mjs'];
  for (const name of headlessTests) copyFileSync(join(root, 'test/packages', name), join(directory, name));
  run(process.execPath, ['--test', '--experimental-test-isolation=none', ...headlessTests], isolated);
  copyFileSync(join(root, 'examples/current-hub/fixed-view.mjs'), join(directory, 'fixed-view.mjs'));
  const bundles = [
    ['hub-view', "export { createFixtureHubView } from './fixed-view.mjs';\n"],
    ['browser', "export { Experience } from '@hachej/boring-ui-kit/experience';\nexport { composeExperience, validateExperience } from '@hachej/boring-ui-kit/experience/compose';\nexport { composeExperienceRegion } from '@hachej/boring-ui-kit/experience/regions';\n"],
    ['compose', "export { composeExperience, validateExperience } from '@hachej/boring-ui-kit/experience/compose';\nexport { composeExperienceRegion } from '@hachej/boring-ui-kit/experience/regions';\n"],
  ];
  for (const [name, source] of bundles) {
    writeFileSync(join(directory, name + '-entry.js'), source);
    run(process.execPath, ['node_modules/esbuild/bin/esbuild', name + '-entry.js', '--bundle', '--platform=browser', '--format=esm', '--outfile=' + name + '.js', '--metafile=' + name + '-meta.json'], isolated);
    const inputs = Object.keys(JSON.parse(readFileSync(join(directory, name + '-meta.json'), 'utf8')).inputs);
    assertConsumerTypeFiles(inputs.map(path => resolve(directory, path)).join('\n'), directory);
    assert.ok(inputs.some(path => path.endsWith('@hachej/boring-ui-kit/dist/experience-compose.js')));
    assert.ok(inputs.every(path => !/@earendil-works|@hachej\/boring-(files|agent|execution)|@tiptap|tldraw|marked|entities|sqlite|node:/.test(path)), 'Experience bundle must exclude unrelated libraries and server implementations');
    if (name === 'hub-view') assert.ok(inputs.some(path => path.endsWith('fixed-view.mjs')));
    if (name === 'compose') assert.ok(inputs.every(path => !/node_modules\/react(?:-dom)?\/|@json-render\/react\/dist\/index/.test(path)), 'Validation entry must not load the React runtime');
  }
  assert.ok(filesArchive);
  run('npm', ['install', ...npmInstallFlags(cache), filesArchive]);
  writeFileSync(join(directory, 'consumer.ts'), `import { createExperienceDocumentController, type ExperienceDocumentOptions, type ExperienceDocumentController } from '@hachej/boring-ui-kit/experience/document';
import { ExperienceDocument } from '@hachej/boring-ui-kit/experience/document-viewer';
import { createElement } from 'react';
declare const options: ExperienceDocumentOptions;
const controller: ExperienceDocumentController = createExperienceDocumentController(options);
const offered = controller.actions.propose(controller.actions.selection(), {});
if (offered.kind === 'proposed') {
  const adopted = controller.actions.adopt(offered.proposalId);
  if (adopted.kind === 'applied') controller.flush(adopted.value);
}
const request = controller.actions.beginRegion(controller.actions.selection(), 'main', 'request');
if (request.kind === 'applied') controller.actions.proposeRegion(request.value, {});
const pin = controller.getSnapshot().pin;
if (pin) controller.actions.pin(pin.selection);
controller.actions.reconcile();
const tools: undefined = controller.tools;
createElement(ExperienceDocument, { controller, cells: [], canView: () => false });
void tools;
`);
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  const resourceTests = ['ui-experience-viewer.test.mjs', 'ui-experience-document.test.mjs', 'ui-experience-document-viewer.test.mjs', 'ui-experience-composition-viewer.test.mjs', 'ui-experience-region-document.test.mjs', 'ui-experience-region-viewer.test.mjs'];
  // Tests are copied flat; their host (one SQLite workspace per scope, public @hachej/boring-files entries only) sits beside them.
  copyFileSync(join(root, 'examples/shared/sqlite-workspaces.mjs'), join(directory, 'sqlite-workspaces.mjs'));
  for (const name of resourceTests) writeFileSync(join(directory, name), readFileSync(join(root, 'test/packages', name), 'utf8').replace("'../../examples/shared/sqlite-workspaces.mjs'", "'./sqlite-workspaces.mjs'"));
  run(process.execPath, ['--test', '--experimental-test-isolation=none', ...resourceTests], isolated);
  writeFileSync(join(directory, 'resource-entry.js'), "export { ExperienceDocument } from '@hachej/boring-ui-kit/experience/document-viewer';\nexport { createExperienceDocumentController } from '@hachej/boring-ui-kit/experience/document';\n");
  run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'resource-entry.js', '--bundle', '--platform=browser', '--format=esm', '--outfile=resource.js', '--metafile=resource-meta.json'], isolated);
  const resourceInputs = Object.keys(JSON.parse(readFileSync(join(directory, 'resource-meta.json'), 'utf8')).inputs);
  assertConsumerTypeFiles(resourceInputs.map(path => resolve(directory, path)).join('\n'), directory);
  assert.ok(resourceInputs.some(path => path.endsWith('@hachej/boring-ui-kit/dist/experience-document.js')));
  assert.ok(resourceInputs.every(path => !/@earendil-works|@hachej\/boring-(agent|execution)|@tiptap|tldraw|marked|entities|sqlite|node:/.test(path)), 'Layout publication browser bundle must exclude native/server/unrelated viewer implementations');
  if (morning) {
    const installedManifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const installedLock = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'));
    const selected = Object.entries(ui.peerDependencies).filter(([name]) => name.startsWith('@tiptap/') || ['marked', '@earendil-works/pi-durable', '@earendil-works/pi-ai', '@earendil-works/chord'].includes(name));
    selected.push(['@modelcontextprotocol/sdk', rootManifest.devDependencies['@modelcontextprotocol/sdk']]);
    for (const [name, version] of selected) { installedManifest.dependencies[name] = version; include(name); }
    for (const [path, entry] of Object.entries(packages)) if (path && !installedLock.packages[path]) installedLock.packages[path] = entry;
    installedLock.packages[''].dependencies = installedManifest.dependencies;
    writeFileSync(join(directory, 'package.json'), JSON.stringify(installedManifest));
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(installedLock));
    run('npm', ['install', '--package-lock-only', ...npmInstallFlags(cache)]);
    run('npm', ['ci', ...npmInstallFlags(cache)]);
    for (const path of ['examples/morning', 'examples/shared', 'test/compatibility', 'test/fixtures', 'dist']) mkdirSync(join(directory, path), { recursive: true });
    for (const name of ['runtime.mjs', 'documents.mjs', 'fixtures.mjs', 'composition.mjs', 'view.jsx', 'client.mjs', 'server.mjs']) copyFileSync(join(root, 'examples/morning', name), join(directory, 'examples/morning', name));
    copyFileSync(join(root, 'examples/shared/sqlite-workspaces.mjs'), join(directory, 'examples/shared/sqlite-workspaces.mjs'));
    for (const name of ['morning.test.mjs', 'morning-composition.test.mjs']) copyFileSync(join(root, 'test/compatibility', name), join(directory, 'test/compatibility', name));
    for (const name of ['morning-crash-child.mjs', 'morning-dom.mjs', 'native-document.mjs']) copyFileSync(join(root, 'test/fixtures', name), join(directory, 'test/fixtures', name));
    run(process.execPath, ['--test', '--experimental-test-isolation=none', 'test/compatibility/morning.test.mjs', 'test/compatibility/morning-composition.test.mjs'], isolated);
    run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'examples/morning/view.jsx', '--bundle', '--packages=external', '--platform=node', '--format=esm', '--jsx=automatic', '--outfile=dist/morning-view.js'], isolated);
    run(process.execPath, ['--test', '--experimental-test-isolation=none', 'test/fixtures/morning-dom.mjs'], isolated);
    run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'examples/morning/view.jsx', '--bundle', '--platform=browser', '--format=esm', '--jsx=automatic', '--outfile=morning-browser.js', '--metafile=morning-browser-meta.json'], isolated);
    const inputs = Object.keys(JSON.parse(readFileSync(join(directory, 'morning-browser-meta.json'), 'utf8')).inputs);
    assertConsumerTypeFiles(inputs.map(path => resolve(directory, path)).join('\n'), directory);
    assert.ok(inputs.some(path => path.endsWith('examples/morning/view.jsx')));
    assert.ok(inputs.every(path => !/@earendil-works|@hachej\/boring-(agent|execution)|sqlite|node:|morning\/(runtime|server|fixtures)\.mjs/.test(path)), 'Morning UI must exclude native/server code');
    console.log('PASS: isolated morning native tasks, application receipts, SIGKILL recovery, composition privacy and real DOM controls; browser bundle only, not Chromium execution');
  }
  console.log('PASS: isolated experience declarations, public validation/native metadata and region composition without files, browser/server-safe bundles including the fixed hub view and native renderer/generated offers/conditional Keep and region Pin with borrowed SQLite document controllers; no browser journey claimed');
} finally { rmSync(directory, { recursive: true, force: true }); }
