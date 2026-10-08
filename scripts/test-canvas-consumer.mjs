import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { prepareConsumerIsolation, assertConsumerTypeFiles, npmInstallFlags } from './consumer-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const remote = process.argv.includes('--remote');
const editor = remote || process.argv.includes('--editor');
assert.ok(process.argv.slice(2).every(value => ['--editor', '--remote'].includes(value)), 'Only --editor or --remote is supported');
const directory = mkdtempSync(join(tmpdir(), editor ? 'boring-canvas-editor-consumer-' : 'boring-canvas-consumer-'));
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
  for (const name of ['files', 'ui', ...(remote ? ['agent'] : [])]) {
    const packed = JSON.parse(run('npm', ['pack', join(root, 'packages', name), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0];
    archives.push(join(directory, 'packs', packed.filename));
  }
  const ui = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8'));
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const sourceLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const dependencies = Object.fromEntries(['@tldraw/editor', '@tldraw/store', 'react', 'react-dom'].map(name => [name, ui.peerDependencies[name]]));
  if (editor) dependencies.tldraw = ui.peerDependencies.tldraw;
  if (remote) for (const name of ['@earendil-works/pi-durable', '@earendil-works/pi-ai', '@earendil-works/chord', '@modelcontextprotocol/sdk', 'zod']) dependencies[name] = rootManifest.devDependencies[name];
  dependencies['@tldraw/tlschema'] = sourceLock.packages['node_modules/@tldraw/tlschema'].version;
  for (const name of ['typescript', '@types/react', '@types/react-dom', '@types/node', 'happy-dom', 'esbuild']) dependencies[name] = rootManifest.devDependencies[name];
  for (const [name, version] of Object.entries(dependencies)) assert.match(version, /^\d+\.\d+\.\d+$/, `Expected an exact dependency pin: ${name}`);
  const manifest = { name: 'isolated-canvas-consumer', version: '1.0.0', private: true, type: 'module', dependencies };
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
  for (const name of [...(remote ? [] : ['@earendil-works/pi-durable', '@earendil-works/chord', '@earendil-works/pi-ai', '@hachej/boring-agent']), '@hachej/boring-execution', 'marked', ...(editor ? [] : ['tldraw'])]) assert.equal(existsSync(join(directory, 'node_modules', name)), false, name);
  writeFileSync(join(directory, 'consumer.ts'), `import { createCanvasController, type CanvasController, type CanvasOptions, type CanvasProposal } from '@hachej/boring-ui-kit/canvas';
import { applyCanvasEdits, parseCanvasDocument, type CanvasEdit } from '@hachej/boring-ui-kit/canvas-document';
import type { TLStoreSchema, TLShape } from '@tldraw/tlschema';
declare const schema: TLStoreSchema;
declare const shape: TLShape;
const edit: CanvasEdit = { kind: 'update', record: shape };
const candidate = applyCanvasEdits(parseCanvasDocument({}, schema), [edit], schema);
// @ts-expect-error document edits cannot replace the document record
const invalid: CanvasEdit = { kind: 'update', record: { typeName: 'document' } };
import type { TLStore, TLStoreSnapshot } from '@tldraw/editor';
declare const options: CanvasOptions;
const controller: CanvasController = createCanvasController(options);
const proposals: readonly CanvasProposal[] = controller.getSnapshot().proposals;
const proposed = controller.actions.propose(controller.actions.selection(), [edit], 'Fictional edit');
void controller.tools.propose;
void controller.actions.accept('fictional-proposal');
controller.actions.reject('fictional-proposal');
const nativeStore: TLStore = controller.store;
const document: TLStoreSnapshot = controller.getSnapshot().document;
nativeStore.loadStoreSnapshot(document);
controller.flush(controller.actions.selection());
controller.actions.reconcile();
controller.actions.refresh();
controller.actions.discardToRemote();
const problem: string | null = controller.getSnapshot().problem;
controller.dispose();
${editor ? `import { CanvasEditor, type CanvasEditorProps, type CanvasMountedTools, type CanvasMountedSubject } from '@hachej/boring-ui-kit/canvas-editor';
import { createElement } from 'react';
declare const props: CanvasEditorProps;
createElement(CanvasEditor, props);
const withTools: CanvasEditorProps = { ...props, onMountedTools: tools => {
  if (!tools) return;
  const concrete: CanvasMountedTools = tools;
  const target = concrete.getTarget();
  if (!target) return;
  const subject: CanvasMountedSubject = target.subject;
  concrete.inspect.invoke(target, { expiresAt: Date.now() + 1000 }).then(result => {
    if (result.kind === 'applied') {
      const page = result.value.pageId;
      const shapes = result.value.shapes;
      const dirty: boolean = result.value.dirty;
    }
  });
  concrete.select.invoke(target, { expiresAt: Date.now() + 1000, shapeIds: [] });
  concrete.frame.invoke(target, { expiresAt: Date.now() + 1000, shapeIds: ['shape:fictional'] });
  // @ts-expect-error mounted canvas commands require shape IDs, not rich-text coordinates
  concrete.select.invoke(target, { expiresAt: 1000, selection: { anchor: 1, head: 2 } });
  // @ts-expect-error a save target without mount/page identity cannot address a renderer
  concrete.inspect.invoke(controller.actions.selection().target, { expiresAt: 1000 });
} };
createElement(CanvasEditor, withTools);` : ''}
`);
  if (remote) writeFileSync(join(directory, 'consumer.ts'), readFileSync(join(directory, 'consumer.ts'), 'utf8') + '\n' + readFileSync(join(root, 'test/fixtures/isolated-canvas-remote-consumer.ts'), 'utf8'));
  // The consumer recipe sets skipLibCheck, as tldraw apps do: the pinned SDK's own declarations do not check strictly
  // (@tldraw/utils imports lodash.* whose @types it lists only as devDependencies; tldraw's ArrowShapeUtil overrides break
  // under exactOptionalPropertyTypes). The consumer's own code is still checked strictly against our declarations.
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, skipLibCheck: true, noEmit: true, types: ['node'], lib: ['ES2023', 'DOM'] }, include: ['consumer.ts'] }));
  const declarations = runCaptured(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], { cwd: directory, timeout: 120000, env: isolated });
  process.stdout.write(declarations.stdout); process.stderr.write(declarations.stderr);
  assert.equal(declarations.status, 0, 'Canvas consumer type check failed');
  assertConsumerTypeFiles(declarations.stdout.split('\n').filter(isAbsolute).join('\n'), directory);
  // skipLibCheck must not hide errors in Boring's declarations: rerun with library checking and allow diagnostics only in tldraw's.
  const strict = runCaptured(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--skipLibCheck', 'false', '--pretty', 'false'], { cwd: directory, timeout: 120000, env: isolated });
  const located = strict.stdout.split('\n').filter(line => /^\S.*\(\d+,\d+\): error TS\d+/.test(line));
  const ours = located.filter(line => !/^node_modules\/(?:tldraw|@tldraw\/[\w-]+)\//.test(line));
  assert.deepEqual(ours, [], 'Strict library check reports errors outside the upstream tldraw declarations');
  assert.ok(strict.status === 0 || located.length > 0, `Strict library check failed without located diagnostics:\n${strict.stdout}${strict.stderr}`);
  if (located.length) console.log(`Upstream tldraw declaration diagnostics (skipLibCheck in the consumer recipe):\n${located.join('\n')}`);
  writeFileSync(join(directory, 'server-entry.js'), `import { parseCanvasDocument, applyCanvasEdits } from '@hachej/boring-ui-kit/canvas-document';
import { createTLSchema, DocumentRecordType, PageRecordType, TLDOCUMENT_ID } from '@tldraw/tlschema';
const schema = createTLSchema();
const records = [DocumentRecordType.create({ id: TLDOCUMENT_ID }), PageRecordType.create({ id: PageRecordType.createId('server'), name: 'Server', index: 'a1' })];
const document = parseCanvasDocument({ schema: schema.serialize(), store: Object.fromEntries(records.map(record => [record.id, record])) }, schema);
const shape = schema.types.shape.create({ id: 'shape:server', type: 'group', parentId: records[1].id, index: 'a1', props: {} });
if (applyCanvasEdits(document, [{ kind: 'create', record: shape }], schema).kind !== 'applied') throw new Error('Server edit failed');
console.log('server document import and validation completed without DOM or editor');
`);
  const server = runCaptured(process.execPath, ['server-entry.js'], { cwd: directory, timeout: 10000, env: isolated });
  assert.equal(server.status, 0, server.stderr || server.error?.message);
  assert.match(server.stdout, /validation completed/);
  run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'server-entry.js', '--bundle', '--platform=node', '--format=esm', '--outfile=server-bundle.mjs', '--metafile=server-meta.json'], isolated);
  const serverInputs = Object.keys(JSON.parse(readFileSync(join(directory, 'server-meta.json'), 'utf8')).inputs);
  assert.ok(serverInputs.every(path => !/\/(?:@tldraw\/editor|react|react-dom|@hachej\/boring-(?:agent|files))\//.test(path)), 'Document edits must not load an editor, React, agent or resource implementation');
  const tests = ['ui-canvas-document.test.mjs', 'ui-canvas-proposals.test.mjs', 'ui-canvas.test.mjs', 'ui-canvas-editor-lifecycle.test.mjs', ...(editor ? ['ui-canvas-editor.test.mjs'] : []), ...(remote ? ['files-request-guard.test.mjs'] : [])];
  // Tests are copied flat; their host (one SQLite workspace per scope, public @hachej/boring-files entries only) sits beside them.
  copyFileSync(join(root, 'examples/shared/sqlite-workspaces.mjs'), join(directory, 'sqlite-workspaces.mjs'));
  for (const name of tests) writeFileSync(join(directory, name), readFileSync(join(root, 'test/packages', name), 'utf8').replace("'../../examples/shared/sqlite-workspaces.mjs'", "'./sqlite-workspaces.mjs'"));
  run(process.execPath, ['--test', '--experimental-test-isolation=none', ...tests], isolated);
  if (remote) {
    const copied = ['examples/shared/canvas-transport-protocol.mjs', 'examples/shared/canvas-transport-server.mjs', 'examples/shared/canvas-transport-client.mjs',
      'test/compatibility/canvas-transport.test.mjs', 'test/compatibility/canvas-transport-protocol.test.mjs', 'test/fixtures/canvas-transport-crash-child.mjs', 'test/fixtures/native-document.mjs', 'test/compatibility/canvas-transport-client.test.mjs'];
    for (const path of copied) { mkdirSync(join(directory, path, '..'), { recursive: true }); copyFileSync(join(root, path), join(directory, path)); }
    run(process.execPath, ['--test', '--experimental-test-isolation=none', 'test/compatibility/canvas-transport.test.mjs', 'test/compatibility/canvas-transport-protocol.test.mjs', 'test/compatibility/canvas-transport-client.test.mjs'], isolated);
  }
  writeFileSync(join(directory, 'browser-entry.js'), `export { createCanvasController, canvasMediaType } from '@hachej/boring-ui-kit/canvas';\n${editor ? "export { CanvasEditor } from '@hachej/boring-ui-kit/canvas-editor';\nimport 'tldraw/tldraw.css';\n" : ''}${remote ? "export { connectCanvasPresentation } from './examples/shared/canvas-transport-client.mjs';\n" : ''}`);
  run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'browser-entry.js', '--bundle', '--platform=browser', '--format=esm', '--outfile=browser.js', '--metafile=browser-meta.json'], isolated);
  const inputs = Object.keys(JSON.parse(readFileSync(join(directory, 'browser-meta.json'), 'utf8')).inputs);
  assertConsumerTypeFiles(inputs.map(path => resolve(directory, path)).join('\n'), directory);
  assert.ok(inputs.some(path => path.includes('@tldraw/editor/')));
  assert.ok(inputs.every(path => !/pi-durable|@earendil-works|@hachej\/boring-(agent|execution)|sqlite|node:/.test(path)), 'browser bundle must exclude kernel and server filesystem');
  assert.ok(inputs.every(path => !/@hachej\/boring-ui-kit\/dist\/markdown(?:-editor|-parser)?\.js$|\/marked\//.test(path)), 'canvas must not load the Boring Markdown surface');
  if (editor) {
    assert.ok(inputs.some(path => /tldraw\/dist/.test(path)), 'renderer must bundle the actual native SDK');
    assert.ok(readFileSync(join(directory, 'browser.css'), 'utf8').length > 0, 'selected native CSS must build');
  }
  if (remote) console.log('PASS: copied remote canvas recipe through installed public APIs, native crash tests, typed native tool composition and browser bundle exclusions');
  console.log('PASS: isolated pinned registry dependencies, packed canvas, native store/publication tests and browser bundle; browser journeys, license, real fonts/assets and migrations remain unqualified');
  console.log('PASS: canvas declarations (strict consumer code; Boring declarations library-checked; upstream tldraw declarations need skipLibCheck)');
} finally { rmSync(directory, { recursive: true, force: true }); }
