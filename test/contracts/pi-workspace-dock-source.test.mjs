import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

// The docks live in the dock item (registry/dock/dock.tsx); pi-workspace keeps `pi-workspace/dock` as a re-export of it. Listed in the items, strict under the repository's settings, and the
// server-rendered structure a consumer gets. Pointer, keyboard and placement behaviour is proven in a browser by `npm run dock-app:journey`.
const root = fileURLToPath(new URL('../../', import.meta.url));
const file = 'registry/dock/dock.tsx';
const reexport = 'registry/pi-workspace/dock.tsx';
const manifest = JSON.parse(readFileSync(`${root}registry.json`, 'utf8'));
const item = manifest.items.find(entry => entry.name === 'dock');
const workspace = manifest.items.find(entry => entry.name === 'pi-workspace');

test('dock.tsx is the dock item and in the committed build', () => {
  assert.deepEqual(item.files, [{ path: file, type: 'registry:component', target: 'components/dock/dock.tsx' }]);
  assert.deepEqual(item.registryDependencies, ['@boring-ui/utils']);
  const built = JSON.parse(readFileSync(`${root}public/r/dock.json`, 'utf8'));
  assert.equal(built.files.find(entry => entry.path === file)?.content, readFileSync(`${root}${file}`, 'utf8'));
});

test('pi-workspace re-exports every export of the dock item and depends on it; app-shell depends on dock, not pi-workspace', async () => {
  assert.deepEqual(workspace.files.find(entry => entry.path === reexport), { path: reexport, type: 'registry:component', target: 'components/pi-workspace/dock.tsx' });
  assert.ok(workspace.registryDependencies.includes('@boring-ui/dock'));
  assert.equal(readFileSync(`${root}${reexport}`, 'utf8').replace(/^\/\/.*\n/gm, '').trim(), "export * from '../dock/dock';");
  const shell = manifest.items.find(entry => entry.name === 'app-shell');
  assert.ok(shell.registryDependencies.includes('@boring-ui/dock') && !shell.registryDependencies.includes('@boring-ui/pi-workspace'));
  const out = `${root}.cache/pi-workspace-dock-test`;
  mkdirSync(out, { recursive: true });
  for (const [name, entry] of [['reexport', reexport], ['origin', file]]) await build({ entryPoints: [`${root}${entry}`], outfile: `${out}/${name}.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const [viaWorkspace, viaDock] = await Promise.all([import(pathToFileURL(`${out}/reexport.mjs`).href), import(pathToFileURL(`${out}/origin.mjs`).href)]);
  assert.deepEqual(Object.keys(viaWorkspace).sort(), ['Dock', 'DockLayout', 'DockMain', 'useDock']);
  assert.deepEqual(Object.keys(viaWorkspace).sort(), Object.keys(viaDock).sort());
});

test('dock.tsx compiles under the repository strict settings and imports only React and its installed sibling', () => {
  const base = ts.readConfigFile(`${root}tsconfig.base.json`, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent({ ...base.config, compilerOptions: { ...base.config.compilerOptions, composite: false, declaration: false, declarationMap: false, noEmit: true,
    allowImportingTsExtensions: true, jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'Bundler' } }, ts.sys, root);
  const program = ts.createProgram([`${root}${file}`], options);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file?.fileName.startsWith(`${root}registry/`));
  assert.deepEqual(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
  const source = readFileSync(`${root}${file}`, 'utf8');
  assert.deepEqual([...new Set([...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1]))].sort(), ['../utils/persisted', '../utils/utils', 'react']);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|eval\s*\(|new Function|<script\b/);
});

test('docks render their placement, divider and content; useDock needs a layout', async () => {
  const out = `${root}.cache/pi-workspace-dock-test`;
  mkdirSync(out, { recursive: true });
  await build({ entryPoints: [`${root}${file}`], outfile: `${out}/dock.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  const { DockLayout, Dock, DockMain, useDock } = await import(pathToFileURL(`${out}/dock.mjs`).href);
  const { createElement: h } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(h(DockLayout, {}, h(Dock, { id: 'chat', side: 'left', labels: { region: 'Chat' } }, 'chat body'),
    h(DockMain, {}, 'the app'), h(Dock, { id: 'files', side: 'right', defaultOpen: false }, api => `files ${api.placement}`)));
  assert.match(html, /data-dock="chat"[^>]*data-placement="docked"/);
  assert.match(html, /<div role="separator"[^>]*data-testid="dock-divider-chat"/);
  assert.match(html, /data-dock="files"[^>]*data-placement="closed"/);
  assert.ok(!html.includes('dock-divider-files'), 'a closed dock has no divider');
  assert.ok(html.includes('chat body') && html.includes('the app') && html.includes('files closed'), 'children stay mounted in every placement');
  assert.throws(() => renderToStaticMarkup(h(() => (useDock('x'), null))), /inside a DockLayout/);
  // `contained`: a docked dock is the containing block of its content's fixed overlays; an uncontained one is not.
  const contained = renderToStaticMarkup(h(DockLayout, {}, h(Dock, { id: 'pm', side: 'left', contained: true }, api => `${typeof api.setWidth}`), h(DockMain, {}, 'app')));
  assert.match(contained, /data-dock="pm"[^>]*class="[^"]*\[contain:layout\]/);
  assert.ok(contained.includes('function'), 'the api offers setWidth');
  assert.doesNotMatch(html, /contain:layout/);
});
