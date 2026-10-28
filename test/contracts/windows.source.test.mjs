import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const files = ['registry/windows/windows.tsx', 'registry/utils/use-draggable.ts'];

test('windows ships its component and shared hook, depends only on utils (shadcn comes from the app); the shell uses that hook', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'registry.json'), 'utf8'));
  const item = manifest.items.find(entry => entry.name === 'windows'); assert.ok(item, 'windows registry item');
  assert.deepEqual(item.files, [{ path: files[0], type: 'registry:component', target: 'components/windows/windows.tsx' }]);
  assert.ok(manifest.items.find(entry => entry.name === 'utils').files.some(file => file.path === files[1] && file.type === 'registry:hook'));
  assert.deepEqual(item.registryDependencies, ['@boring-ui/utils']);
  assert.equal(item.cssVars, undefined); assert.equal(item.css, undefined);
  const artifact = JSON.parse(readFileSync(resolve(root, 'public/r/windows.json'), 'utf8'));
  assert.equal(artifact.files.find(entry => entry.path === files[0])?.content, readFileSync(resolve(root, files[0]), 'utf8'));
  const utils = JSON.parse(readFileSync(resolve(root, 'public/r/utils.json'), 'utf8'));
  assert.equal(utils.files.find(entry => entry.path === files[1])?.content, readFileSync(resolve(root, files[1]), 'utf8'));
  assert.ok(manifest.items.find(entry => entry.name === 'app-shell').registryDependencies.includes('@boring-ui/utils'));
  const shell = readFileSync(resolve(root, 'registry/app-shell/agent-layer.tsx'), 'utf8');
  assert.match(shell, /import \{ useDraggable \} from '\.\.\/utils\/use-draggable'/);
  assert.doesNotMatch(shell.slice(shell.indexOf('function DockPanel')), /setPointerCapture|dx:|dy:/);
});

test('windows and its hook compile under strict consumer settings without Pi or server imports', () => {
  for (const file of files) assert.ok(existsSync(resolve(root, file)), file);
  const base = ts.readConfigFile(resolve(root, 'tsconfig.base.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent({ ...base.config, compilerOptions: { ...base.config.compilerOptions, composite: false, declaration: false, declarationMap: false, noEmit: true,
    allowImportingTsExtensions: true, jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'Bundler', baseUrl: root, paths: { '@/*': ['examples/app-shell/*'] } } }, ts.sys, root);
  const program = ts.createProgram(files.map(file => resolve(root, file)), options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), []);
  for (const file of files) assert.doesNotMatch(readFileSync(resolve(root, file), 'utf8'), /@hachej\/boring-agent|pi-durable|node:|dangerouslySetInnerHTML|eval\s*\(|new Function/);
});
