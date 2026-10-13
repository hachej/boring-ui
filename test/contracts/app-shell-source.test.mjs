import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import ts from 'typescript';
import { SHADCN_BUILTINS } from '../../scripts/check-registry-blocks.mjs';

// The app-shell item (registry/app-shell): listed in the item and the committed build, strict under the repository's settings against the
// pinned shadcn fixtures (examples/app-shell), no raw colours, only declared shadcn built-ins, one set of words per language, the close
// rule of the drawer, and the screen-context store. Touch, snap points, keyboard, Back and push-to-talk are proven in a real browser by
// `npm run app-shell:journey`.
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = 'registry/app-shell';
const manifest = JSON.parse(readFileSync(`${root}registry.json`, 'utf8'));
const item = manifest.items.find(entry => entry.name === 'app-shell');
const files = readdirSync(`${root}${folder}`);
const source = name => readFileSync(`${root}${folder}/${name}`, 'utf8');

test('every file of registry/app-shell is listed in the item and equals the committed build', () => {
  assert.deepEqual(item.files.map(entry => entry.path.replace(`${folder}/`, '')).sort(), files.sort());
  const built = JSON.parse(readFileSync(`${root}public/r/app-shell.json`, 'utf8'));
  for (const entry of item.files) assert.equal(built.files.find(file => file.path === entry.path)?.content, readFileSync(`${root}${entry.path}`, 'utf8'), `${entry.path}: run npm run registry:build`);
  assert.deepEqual(['drawer', 'sidebar', 'avatar', 'dropdown-menu'].filter(name => !item.registryDependencies.includes(name)), [], 'the shadcn built-ins are declared by bare name');
});

test('the item compiles strictly against the pinned shadcn fixtures', () => {
  const base = ts.readConfigFile(`${root}tsconfig.base.json`, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent({ ...base.config, compilerOptions: { ...base.config.compilerOptions, composite: false, declaration: false, declarationMap: false, noEmit: true,
    allowImportingTsExtensions: true, jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2023', 'DOM', 'DOM.Iterable'], baseUrl: root, paths: { '@/*': ['examples/app-shell/*'] } } }, ts.sys, root);
  const program = ts.createProgram(files.map(name => `${root}${folder}/${name}`), options);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file && (diagnostic.file.fileName.startsWith(`${root}registry/`) || diagnostic.file.fileName.startsWith(`${root}examples/app-shell/`)));
  assert.deepEqual(diagnostics.map(diagnostic => `${diagnostic.file.fileName.replace(root, '')}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`), []);
});

test('colours come only from shadcn semantic utilities: no hex, rgb(, oklch( or text-[Npx]', () => {
  for (const name of files) {
    const text = source(name);
    assert.doesNotMatch(text, /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/, `${name}: hex colour`);
    assert.doesNotMatch(text, /\b(?:rgba?|oklch|hsla?)\(/, `${name}: raw colour function`);
    assert.doesNotMatch(text, /text-\[\d+(?:\.\d+)?px\]/, `${name}: pixel text size`);
    assert.doesNotMatch(text, /dangerouslySetInnerHTML|eval\s*\(|new Function|<script\b/, name);
  }
});

test('the item imports only React, its declared packages and the declared shadcn built-ins', () => {
  const allowed = new Set(['react', 'react-dom', 'lucide-react', '@base-ui/react/drawer', '@hachej/boring-feedback/page', '@hachej/boring-feedback/ui', '@hachej/boring-ui-kit/native-chat']);
  for (const name of files) {
    for (const [, imported] of source(name).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      if (imported.startsWith('./')) { assert.ok(files.some(file => file.replace(/\.tsx?$/, '') === imported.slice(2)), `${name} imports missing ${imported}`); continue; }
      if (/^\.\.\/(?:pi-chat|feedback|utils)\//.test(imported)) continue;
      const ui = /^@\/components\/ui\/([\w-]+)$/.exec(imported);
      if (ui) { assert.ok(SHADCN_BUILTINS.includes(ui[1]) && item.registryDependencies.includes(ui[1]), `${name}: ${imported} is not a declared shadcn built-in`); continue; }
      if (imported === '@/hooks/use-mobile') { assert.ok(item.registryDependencies.includes('sidebar'), 'use-mobile comes with the sidebar'); continue; }
      assert.ok(allowed.has(imported), `${name} imports ${imported}`);
    }
  }
  // Microphone capture is the feedback item's (`createVoiceCapture`): no other file touches getUserMedia.
  for (const name of files) assert.doesNotMatch(source(name), /getUserMedia/, name);
});

async function bundle(name, extra = {}) {
  const out = `${root}.cache/app-shell-source-test`;
  mkdirSync(out, { recursive: true });
  const outfile = `${out}/${name.replace(/\.tsx?$/, '')}.mjs`;
  await build({ entryPoints: [`${root}${folder}/${name}`], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${root}examples/app-shell` }, logLevel: 'silent', ...extra });
  return import(pathToFileURL(outfile).href);
}

test('text.ts has the same keys in English and French, and every word is filled', async () => {
  const { appShellText } = await bundle('text.ts');
  const en = appShellText('en'), fr = appShellText('fr');
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const [key, value] of [...Object.entries(en), ...Object.entries(fr)]) assert.ok(typeof value === 'string' && value.trim(), key);
  assert.equal(appShellText(undefined), en, 'English by default');
  assert.equal(fr.listening, 'J\'écoute…');
  assert.equal(fr.holdToTalk, 'Appuie et parle');
});

test('nextSnapOnClose: a swipe, an outside press and a lost focus never close; every other reason does', async () => {
  const { nextSnapOnClose } = await bundle('agent-layer.tsx');
  // Base UI's `details.reason` values for a drawer (reason-parts.js of @base-ui/react 1.8).
  for (const reason of ['swipe', 'outside-press', 'focus-out']) {
    assert.equal(nextSnapOnClose(reason, true), 'peek', `${reason} with a peek`);
    assert.equal(nextSnapOnClose(reason, false), 'half', `${reason} without a peek`);
  }
  for (const reason of ['escape-key', 'close-watcher', 'close-press', 'trigger-press', 'imperative-action', 'none']) {
    assert.equal(nextSnapOnClose(reason, true), 'close', `${reason} with a peek`);
    assert.equal(nextSnapOnClose(reason, false), 'close', `${reason} without a peek`);
  }
});

test('useAgentContext: the most recently mounted screen wins and unmounting restores the previous one', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] });
  t.after(() => { for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  const { AgentContextProvider, useAgentContext, readAgentContext } = await bundle('agent-context.ts');
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const Screen = ({ name, params }) => { useAgentContext({ name, params }); return null; };
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  const render = async screens => act(async () => root.render(h(AgentContextProvider, null, ...screens.map(screen => h(Screen, { key: screen.name, ...screen })))));
  assert.equal(readAgentContext(), undefined, 'nothing before a provider mounts a screen');
  await render([{ name: 'Jour', params: { day: 1 } }]);
  assert.deepEqual(readAgentContext(), { name: 'Jour', params: { day: 1 } });
  await render([{ name: 'Jour', params: { day: 1 } }, { name: 'Progrès', params: { range: 30 } }]);
  assert.deepEqual(readAgentContext(), { name: 'Progrès', params: { range: 30 } }, 'the latest mounted wins');
  await render([{ name: 'Jour', params: { day: 1 } }, { name: 'Progrès', params: { range: 7 } }]);
  assert.deepEqual(readAgentContext(), { name: 'Progrès', params: { range: 7 } }, 'new params replace the entry in place');
  await render([{ name: 'Jour', params: { day: 2 } }]);
  assert.deepEqual(readAgentContext(), { name: 'Jour', params: { day: 2 } }, 'unmounting restores the previous screen');
  await act(async () => root.unmount());
  assert.equal(readAgentContext(), undefined, 'unmounting the provider clears the context');
});
