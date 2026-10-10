import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { prepareConsumerIsolation, assertConsumerTypeFiles, npmInstallFlags } from './consumer-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.argv.length === 2 || process.argv.length === 3 && ['--html', '--redaction'].includes(process.argv[2]), 'Expected no option, --html or --redaction');
const html = process.argv[2] === '--html';
const redaction = process.argv[2] === '--redaction';
const directory = mkdtempSync(join(tmpdir(), 'boring-editor-consumer-'));
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
  const ui = JSON.parse(readFileSync(join(root, 'packages/ui/package.json'), 'utf8'));
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries(Object.entries(ui.peerDependencies).filter(([name]) => ['react', 'react-dom'].includes(name) || !html && (name.startsWith('@tiptap/') || name === 'marked')));
  for (const name of ['typescript', '@types/react', '@types/react-dom', 'happy-dom', 'esbuild']) dependencies[name] = rootManifest.devDependencies[name];
  // The SQLite workspace host loads Pi's portable env entry at runtime (the optional files peer); nothing else of Pi.
  dependencies['@earendil-works/pi-durable'] = JSON.parse(readFileSync(join(root, 'packages/files/package.json'), 'utf8')).peerDependencies['@earendil-works/pi-durable'];
  const manifest = { name: 'isolated-editor-consumer', version: '1.0.0', private: true, type: 'module', dependencies };
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
  for (const name of ['@hachej/boring-agent', 'tldraw', '@tldraw/editor', ...(html ? ['@tiptap/core', 'marked', '@hachej/boring-execution'] : [])]) assert.equal(existsSync(join(directory, 'node_modules', name)), false, name);
  writeFileSync(join(directory, 'consumer.ts'), html ? `import { HtmlViewer, type HtmlViewerProps } from '@hachej/boring-ui-kit/html-viewer';
import { createHtmlController, type HtmlController, type HtmlOptions } from '@hachej/boring-ui-kit/html';
import { createElement } from 'react';
declare const options: HtmlOptions;
const controller: HtmlController = createHtmlController(options);
const props: HtmlViewerProps = { controller, title: 'Fictional HTML document' };
createElement(HtmlViewer, props);
controller.flush(controller.actions.selection());
controller.actions.reconcile();
const tools: undefined = controller.tools;
void tools;
` : `import { MarkdownEditor, type MarkdownEditorProps } from '@hachej/boring-ui-kit/markdown-editor';
import type { MarkdownController } from '@hachej/boring-ui-kit/markdown';
import { createElement } from 'react';
declare const controller: MarkdownController;
const props: MarkdownEditorProps = { controller, title: 'Fictional document', onMountedTools: tools => {
  const target = tools?.getTarget();
  if (!tools || !target) return;
  const expiresAt = Date.now() + 1000;
  void tools.inspect.invoke(target, { expiresAt }).then(result => {
    if (result.kind === 'applied') { const dirty: boolean = result.value.dirty; void dirty; }
  });
  void tools.revealHeading.invoke(target, { expiresAt, index: 0 });
  void tools.select.invoke(target, { expiresAt, selection: { kind: 'rich', anchor: 1, head: 1 } });
  void tools.select.invoke(target, { expiresAt, selection: { kind: 'source', start: 0, end: 1, direction: 'backward' } });
} };
createElement(MarkdownEditor, props);
controller.flush(controller.actions.selection());
`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: true, types: [], lib: ['ES2023', 'DOM'] }, include: ['consumer.ts'] }));
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  const tests = html ? ['ui-html.test.mjs', 'ui-html-viewer.test.mjs'] : ['ui-markdown-editor.test.mjs', 'ui-markdown-navigation.test.mjs', 'ui-markdown-mounted.test.mjs', 'ui-markdown-proposals.test.mjs'];
  // Tests are copied flat; their host (one SQLite workspace per scope, public @hachej/boring-files entries only) sits beside them.
  copyFileSync(join(root, 'examples/shared/sqlite-workspaces.mjs'), join(directory, 'sqlite-workspaces.mjs'));
  for (const name of tests) writeFileSync(join(directory, name), readFileSync(join(root, 'test/packages', name), 'utf8').replace("'../../examples/shared/sqlite-workspaces.mjs'", "'./sqlite-workspaces.mjs'"));
  run(process.execPath, ['--test', '--experimental-test-isolation=none', ...tests], isolated);
  writeFileSync(join(directory, 'browser-entry.js'), html ? `export { HtmlViewer } from '@hachej/boring-ui-kit/html-viewer';\nexport { createHtmlController } from '@hachej/boring-ui-kit/html';\n` : `export { MarkdownEditor } from '@hachej/boring-ui-kit/markdown-editor';\nexport { createMarkdownController } from '@hachej/boring-ui-kit/markdown';\n`);
  run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'browser-entry.js', '--bundle', '--platform=browser', '--format=esm', '--outfile=browser.js', '--metafile=browser-meta.json'], isolated);
  const inputs = Object.keys(JSON.parse(readFileSync(join(directory, 'browser-meta.json'), 'utf8')).inputs);
  assertConsumerTypeFiles(inputs.map(path => resolve(directory, path)).join('\n'), directory);
  if (html) {
    assert.ok(inputs.some(path => path.endsWith('@hachej/boring-ui-kit/dist/html.js')));
    assert.ok(inputs.some(path => path.endsWith('@hachej/boring-ui-kit/dist/html-viewer.js')));
    assert.ok(inputs.every(path => !/@tiptap|tldraw|marked|entities|@hachej\/boring-execution/.test(path)));
  } else assert.ok(inputs.some(path => path.includes('@tiptap/')));
  assert.ok(inputs.every(path => !/pi-durable|@earendil-works|@hachej\/boring-agent|sqlite|node:/.test(path)), 'browser bundle must exclude kernel and server filesystem');
  if (redaction) {
    const installedManifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const installedLock = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'));
    for (const name of ['@earendil-works/pi-durable', '@earendil-works/pi-ai', '@earendil-works/chord', '@modelcontextprotocol/sdk', 'zod', '@json-render/core', '@json-render/react']) {
      installedManifest.dependencies[name] = rootManifest.devDependencies[name]; include(name);
    }
    for (const [path, entry] of Object.entries(packages)) if (path && !installedLock.packages[path]) installedLock.packages[path] = entry;
    installedLock.packages[''].dependencies = installedManifest.dependencies;
    writeFileSync(join(directory, 'package.json'), JSON.stringify(installedManifest));
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(installedLock));
    const packed = JSON.parse(run('npm', ['pack', join(root, 'packages/agent'), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0];
    run('npm', ['install', '--package-lock-only', ...npmInstallFlags(cache), join(directory, 'packs', packed.filename)]);
    run('npm', ['ci', ...npmInstallFlags(cache)]);
    for (const path of ['examples/redaction-browser', 'examples/redaction', 'examples/shared', 'test/compatibility', 'test/contracts', 'test/fixtures', 'dist']) mkdirSync(join(directory, path), { recursive: true });
    for (const name of ['runtime.mjs', 'server.mjs', 'fixtures.mjs', 'client.mjs', 'session.mjs', 'view.jsx', 'action-binding.mjs', 'preparation-composition.mjs', 'preparation-session.mjs', 'preparation-view.jsx']) copyFileSync(join(root, 'examples/redaction-browser', name), join(directory, 'examples/redaction-browser', name));
    for (const name of ['app.mjs', 'bindings.mjs', 'reservation.mjs', 'proposals.mjs', 'corrections.mjs', 'adoption.mjs', 'adoption-bindings.mjs', 'scripted-model.mjs', 'preparation.mjs', 'preparation-model.mjs', 'preparation-fixtures.mjs', 'preparation-schema.mjs']) copyFileSync(join(root, 'examples/redaction', name), join(directory, 'examples/redaction', name));
    copyFileSync(join(root, 'examples/shared/sqlite-workspaces.mjs'), join(directory, 'examples/shared/sqlite-workspaces.mjs'));
    const nativeTests = ['test/compatibility/redaction-preparation.test.mjs', 'test/compatibility/redaction-preparation-composition.test.mjs', 'test/compatibility/redaction-browser-runtime.test.mjs', 'test/compatibility/redaction.test.mjs', 'test/compatibility/redaction-proposals.test.mjs', 'test/compatibility/redaction-adoption.test.mjs', 'test/contracts/redaction-crash.test.mjs', 'test/contracts/redaction-adoption-crash.test.mjs'];
    for (const path of nativeTests) copyFileSync(join(root, path), join(directory, path));
    for (const name of ['redaction-browser-dom.mjs', 'redaction-preparation-dom.mjs', 'redaction-preparation-crash-child.mjs', 'redaction-crash-child.mjs', 'redaction-adoption-crash-child.mjs']) copyFileSync(join(root, 'test/fixtures', name), join(directory, 'test/fixtures', name));
    if (existsSync(join(root, 'test/fixtures/redaction-browser-crash-child.mjs'))) copyFileSync(join(root, 'test/fixtures/redaction-browser-crash-child.mjs'), join(directory, 'test/fixtures/redaction-browser-crash-child.mjs'));
    run(process.execPath, ['--test', '--experimental-test-isolation=none', ...nativeTests], isolated);
    run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'examples/redaction-browser/view.jsx', '--bundle', '--packages=external', '--platform=node', '--format=esm', '--jsx=automatic', '--outfile=dist/redaction-browser-view.js'], isolated);
    run(process.execPath, ['--test', '--experimental-test-isolation=none', 'test/fixtures/redaction-browser-dom.mjs', 'test/fixtures/redaction-preparation-dom.mjs'], isolated);
    run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'examples/redaction-browser/view.jsx', '--bundle', '--platform=browser', '--format=esm', '--jsx=automatic', '--outfile=redaction-browser.js', '--metafile=redaction-browser-meta.json'], isolated);
    const inputs = Object.keys(JSON.parse(readFileSync(join(directory, 'redaction-browser-meta.json'), 'utf8')).inputs);
    assertConsumerTypeFiles(inputs.map(path => resolve(directory, path)).join('\n'), directory);
    assert.ok(inputs.some(path => path.endsWith('examples/redaction-browser/view.jsx')));
    assert.ok(inputs.every(path => !/@earendil-works|@hachej\/boring-(agent|execution)|sqlite|node:|redaction-browser\/(runtime|server|fixtures)\.mjs|redaction\/(app|proposals|scripted-model|preparation|preparation-model|preparation-fixtures)\.mjs/.test(path)), 'Redaction UI must exclude native/server/private fixture code');
    console.log('PASS: isolated fictional redaction admission, exact flush, corrections/adoption, SIGKILL recovery and real DOM/dictation controls; browser bundle only, not Chromium execution');
  }
  console.log('PASS: isolated registry dependencies, packed ' + (html ? 'HTML viewer' : 'Markdown editor') + ', strict declarations, DOM controls and browser bundle; no browser journey claimed');
} finally { rmSync(directory, { recursive: true, force: true }); }
