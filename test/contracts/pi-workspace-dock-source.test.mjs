import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

// The docks of the pi-workspace item (registry/pi-workspace/dock.tsx): listed in the item, strict under the repository's settings, and the
// server-rendered structure a consumer gets. Pointer, keyboard and placement behaviour is proven in a browser by `npm run dock-app:journey`.
const root = fileURLToPath(new URL('../../', import.meta.url));
const file = 'registry/pi-workspace/dock.tsx';
const manifest = JSON.parse(readFileSync(`${root}registry.json`, 'utf8'));
const item = manifest.items.find(entry => entry.name === 'pi-workspace');

test('dock.tsx is part of the pi-workspace item and the committed build', () => {
  assert.deepEqual(item.files.find(entry => entry.path === file), { path: file, type: 'registry:component', target: 'components/pi-workspace/dock.tsx' });
  assert.match(item.description, /dock/i);
  const built = JSON.parse(readFileSync(`${root}public/r/pi-workspace.json`, 'utf8'));
  assert.equal(built.files.find(entry => entry.path === file)?.content, readFileSync(`${root}${file}`, 'utf8'));
});

test('dock.tsx compiles under the repository strict settings and imports only React and its installed sibling', () => {
  const base = ts.readConfigFile(`${root}tsconfig.base.json`, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent({ ...base.config, compilerOptions: { ...base.config.compilerOptions, composite: false, declaration: false, declarationMap: false, noEmit: true,
    allowImportingTsExtensions: true, jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'Bundler' } }, ts.sys, root);
  const program = ts.createProgram([`${root}${file}`], options);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file?.fileName.startsWith(`${root}registry/`));
  assert.deepEqual(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
  const source = readFileSync(`${root}${file}`, 'utf8');
  assert.deepEqual([...new Set([...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map(match => match[1]))].sort(), ['../utils/utils', 'react']);
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
