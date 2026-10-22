import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptured } from './run-captured.mjs';
import { prepareConsumerIsolation, assertConsumerTypeFiles, npmInstallFlags } from './consumer-isolation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'boring-artifact-viewer-consumer-'));
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
  const packed = JSON.parse(run('npm', ['pack', join(root, 'packages/ui'), '--json', '--ignore-scripts', '--pack-destination', join(directory, 'packs')]))[0];
  const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries(['react', 'react-dom', 'marked', 'typescript', '@types/react', '@types/react-dom', 'happy-dom', 'esbuild'].map(name => [name, rootManifest.devDependencies[name]]));
  const manifest = { name: 'isolated-artifact-viewer-consumer', version: '1.0.0', private: true, type: 'module', dependencies };
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
    for (const dependency of Object.keys(entry.optionalDependencies ?? {})) if (sourceLock.packages[`node_modules/${dependency}`]) include(dependency, path);
    for (const dependency of Object.keys(entry.peerDependencies ?? {})) if (!entry.peerDependenciesMeta?.[dependency]?.optional) include(dependency, path);
  };
  for (const name of Object.keys(dependencies)) include(name);
  packages[''] = { name: manifest.name, version: manifest.version, dependencies };
  writeFileSync(join(directory, 'package-lock.json'), JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages }));
  run('npm', ['install', '--package-lock-only', ...npmInstallFlags(cache), join(directory, 'packs', packed.filename)]);
  run('npm', ['ci', ...npmInstallFlags(cache)]);
  for (const name of ['@hachej/boring-files', '@hachej/boring-agent', '@hachej/boring-execution', '@earendil-works/pi-durable', '@tiptap/core', 'tldraw', '@tldraw/editor', 'pdfjs-dist']) assert.equal(existsSync(join(directory, 'node_modules', name)), false, name);
  writeFileSync(join(directory, 'consumer.ts'), `import { ArtifactViewer, type ArtifactViewerProps, type ArtifactPdfProps } from '@hachej/boring-ui-kit/artifact-viewer';
import { createElement } from 'react';
const props: ArtifactViewerProps = { name: 'fictional.md', mimeType: 'text/markdown', content: '# Fictional guide', className: 'host-artifact' };
createElement(ArtifactViewer, props);
createElement(ArtifactViewer, { name: 'fictional.pdf', mimeType: 'application/pdf', content: new Uint8Array([37, 80, 68, 70]), renderPdf: (pdf: ArtifactPdfProps) => createElement('span', null, pdf.name + pdf.url) });
`);
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: true, types: [], lib: ['ES2023', 'DOM'] }, include: ['consumer.ts'] }));
  assertConsumerTypeFiles(run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--listFiles'], isolated), directory);
  copyFileSync(join(root, 'test/packages/ui-artifact-viewer.test.mjs'), join(directory, 'ui-artifact-viewer.test.mjs'));
  run(process.execPath, ['--test', 'ui-artifact-viewer.test.mjs'], isolated);
  writeFileSync(join(directory, 'browser-entry.js'), "export { ArtifactViewer } from '@hachej/boring-ui-kit/artifact-viewer';\n");
  run(process.execPath, ['node_modules/esbuild/bin/esbuild', 'browser-entry.js', '--bundle', '--platform=browser', '--format=esm', '--minify', '--outfile=browser.js', '--metafile=browser-meta.json'], isolated);
  const inputs = Object.keys(JSON.parse(readFileSync(join(directory, 'browser-meta.json'), 'utf8')).inputs);
  assertConsumerTypeFiles(inputs.map(path => resolve(directory, path)).join('\n'), directory);
  assert.ok(inputs.every(path => !/@tiptap|tldraw|pdfjs|@hachej\/boring-(?:files|agent|execution)|@earendil-works|controller|resources\.js|text-buffer|node:/.test(path)));
  console.log('PASS: isolated packed ArtifactViewer, strict declarations, fictional DOM fixtures and browser bundle without files, controllers, editor, canvas, pdfjs or agent; no browser security or PDF rendering qualification claimed');
} finally { rmSync(directory, { recursive: true, force: true }); }
