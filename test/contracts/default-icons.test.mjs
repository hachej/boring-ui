import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArrowUpIcon, CheckIcon, CircleIcon, DotsThreeIcon, SparkleIcon, XIcon } from '@phosphor-icons/react';
import { CheckIcon as LucideCheck } from 'lucide-react';

const root = fileURLToPath(new URL('../../', import.meta.url));
const files = directory => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(`${directory}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${directory}/${entry.name}`] : []);
const parse = path => ts.createSourceFile(path, readFileSync(join(root, path), 'utf8'), ts.ScriptTarget.Latest, true);
const manifest = JSON.parse(readFileSync(join(root, 'registry.json'), 'utf8'));
const evidence = join(root, '.cache/evidence/phosphor-defaults/tests');
mkdirSync(evidence, { recursive: true });

async function bundle(contents, name) {
  const outfile = join(evidence, `${name}.mjs`);
  await build({ stdin: { contents, resolveDir: root, loader: 'tsx' }, outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@/components/ui': join(root, 'shadcn/ui') } });
  return import(pathToFileURL(outfile).href);
}

const publishedShared = JSON.parse(readFileSync(join(root, 'public/r/_shared.json'), 'utf8'));
mkdirSync(join(evidence, 'installed/components/_shared'), { recursive: true });
writeFileSync(join(evidence, 'installed/components/_shared/icons.ts'), publishedShared.files[0].content);
const installed = bundle(`export * from './.cache/evidence/phosphor-defaults/tests/installed/components/_shared/icons';`, 'installed-adapter');

const compiled = bundle(`
  export * as icons from './registry/_shared/icons';
  export { HeaderActions } from './registry/app-shell/header-actions';
  export { Button } from './shadcn/ui/button';
  export { Spinner } from './shadcn/ui/spinner';
  export { ChatTextProvider, useChatText, useMergedText } from './registry/pi-chat/labels';
`, 'render');

test('default icon imports use the single shared swap point, including bundled primitives', () => {
  const direct = [];
  for (const path of [...files('registry'), ...files('shadcn/ui')]) {
    for (const node of parse(path).statements) {
      if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
      if (/^(?:lucide-react|@phosphor-icons\/react)(?:\/|$)/.test(node.moduleSpecifier.text) && path !== 'registry/_shared/icons.ts') direct.push(path);
    }
  }
  assert.deepEqual(direct, []);
  assert.match(readFileSync(join(root, 'registry/_shared/icons.ts'), 'utf8'), /from '@phosphor-icons\/react'/);
});

test('published registry installs the exact Phosphor adapter and no automatic theme', () => {
  const shared = manifest.items.find(item => item.name === '_shared');
  assert.deepEqual(shared.dependencies, ['@phosphor-icons/react@2.1.10', 'react@^19.0.0']);
  for (const path of ['package.json', 'ARCHITECTURE.json', 'package-lock.json']) {
    const value = JSON.parse(readFileSync(join(root, path), 'utf8'));
    assert.equal((value.devDependencies ?? value.rootDevDependencies ?? value.packages[''].devDependencies)['@phosphor-icons/react'], '2.1.10', path);
  }
  assert.equal(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages['node_modules/@phosphor-icons/react'].version, '2.1.10');
  const built = JSON.parse(readFileSync(join(root, 'public/r/_shared.json'), 'utf8'));
  assert.deepEqual(built.dependencies, shared.dependencies);
  assert.equal(built.files[0].content, readFileSync(join(root, 'registry/_shared/icons.ts'), 'utf8'));
  for (const item of manifest.items) {
    assert.equal((item.dependencies ?? []).some(value => value.startsWith('lucide-react@')), item.name === 'file-tree', 'only the unchanged package-owned file-tree adapter still needs Lucide: ' + item.name);
    assert.ok(!(item.registryDependencies ?? []).includes('@boring-ui/theme'), item.name);
    if (item.name === '_shared') continue;
    if ((item.files ?? []).some(file => /from ['"]\.\.\/_shared\/icons['"]/.test(readFileSync(join(root, file.path), 'utf8')))) assert.ok(item.registryDependencies.includes('@boring-ui/_shared'), item.name);
  }
});

test('shared symbols render actual Phosphor SVG paths, aliases and native props', async () => {
  const { icons } = await compiled;
  const publishedIcons = await installed;
  for (const [symbol, Native] of Object.entries({ ArrowUpIcon, CheckIcon, XIcon, SparklesIcon: SparkleIcon, EllipsisIcon: DotsThreeIcon })) {
    assert.equal(typeof icons[symbol], 'object', symbol);
    const props = { size: 19, weight: 'bold', mirrored: true, color: 'currentColor', className: 'brand-icon', 'aria-label': symbol, 'data-icon': 'inline-start' };
    const actual = renderToStaticMarkup(React.createElement(icons[symbol], props));
    assert.equal(actual, renderToStaticMarkup(React.createElement(Native, props)), symbol);
    assert.equal(renderToStaticMarkup(React.createElement(publishedIcons[symbol], props)), actual, 'published copied-source SVG: ' + symbol);
    assert.match(actual, /viewBox="0 0 256 256"/);
    assert.match(actual, /<path /);
  }
  assert.equal(icons.ArrowUp, icons.ArrowUpIcon);
  assert.equal(icons.ChevronRight, icons.ChevronRightIcon);
  assert.equal(renderToStaticMarkup(React.createElement(icons.CircleIcon)), renderToStaticMarkup(React.createElement(CircleIcon, { weight: 'fill' })), 'status dots stay filled');
  for (const [symbol, Icon] of Object.entries(icons)) assert.match(renderToStaticMarkup(React.createElement(Icon)), /viewBox="0 0 256 256"/, symbol);
});

test('shell overflow, chat defaults, controls and explicit branded icons render through real components', async () => {
  const { HeaderActions, Button, Spinner, ChatTextProvider, useChatText, useMergedText } = await compiled;
  function CustomIcon(props) { return React.createElement('svg', { ...props, 'data-brand': 'custom', viewBox: '0 0 31 31' }, React.createElement('path', { d: 'M1 1h29v29H1z' })); }
  function ChatProbe({ custom }) {
    const value = useMergedText(undefined, custom ? { send: custom === 'lucide' ? LucideCheck : CustomIcon } : undefined);
    return React.createElement(ChatTextProvider, { value }, React.createElement(ChatControl));
  }
  function ChatControl() { const { icons } = useChatText(); return React.createElement(Button, null, React.createElement(icons.send, { 'data-icon': 'inline-start' }), 'Send'); }
  const actions = [1, 2, 3].map(id => ({ id: String(id), label: `Action ${id}`, icon: CustomIcon, onSelect() {} }));
  const shell = renderToStaticMarkup(React.createElement(HeaderActions, { actions, compact: false, text: { actions: 'More actions' }, prefix: 'shell', run() {} }));
  assert.match(shell, /shell-more/);
  assert.match(shell, /viewBox="0 0 256 256"/);
  assert.match(shell, /data-brand="custom"/);
  const chat = renderToStaticMarkup(React.createElement(ChatProbe));
  assert.match(chat, /viewBox="0 0 256 256"/);
  assert.match(chat, /data-icon="inline-start"/);
  assert.match(renderToStaticMarkup(React.createElement(ChatProbe, { custom: true })), /data-brand="custom"/);
  const legacy = renderToStaticMarkup(React.createElement(ChatProbe, { custom: 'lucide' }));
  assert.match(legacy, /viewBox="0 0 24 24"/);
  assert.match(legacy, /lucide-check/);
  assert.doesNotMatch(legacy, /viewBox="0 0 256 256"/);
  const spinner = renderToStaticMarkup(React.createElement(Spinner, { 'aria-label': 'Working', className: 'host-spinner' }));
  assert.match(spinner, /viewBox="0 0 256 256"/);
  assert.match(spinner, /host-spinner/);
  assert.match(spinner, /aria-label="Working"/);
  writeFileSync(join(evidence, 'representative-render.html'), shell + chat + spinner + renderToStaticMarkup(React.createElement(ChatProbe, { custom: true })));
});

test('shared native SVG refs, events and status-dot semantics survive mount and unmount', async () => {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of globals) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] });
  let ui;
  try {
    const { createRoot } = await import('react-dom/client');
    const { icons } = await compiled;
    const container = document.createElement('div'); document.body.append(container);
    ui = createRoot(container);
    const ref = React.createRef();
    let clicks = 0;
    await React.act(async () => ui.render(React.createElement(icons.CheckIcon, { ref, width: 21, height: 22, role: 'img', 'aria-label': 'Done', onClick: () => clicks++ })));
    assert.equal(ref.current, container.querySelector('svg'));
    assert.equal(ref.current.getAttribute('viewBox'), '0 0 256 256');
    assert.equal(ref.current.getAttribute('width'), '21');
    assert.equal(ref.current.getAttribute('height'), '22');
    await React.act(async () => ref.current.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
    assert.equal(clicks, 1);
    await React.act(async () => ui.render(React.createElement(icons.CircleIcon, { ref, className: 'fill-primary', strokeWidth: 0 })));
    assert.equal(ref.current, container.querySelector('svg'));
    assert.equal(ref.current.querySelector('path').getAttribute('d'), 'M232,128A104,104,0,1,1,128,24,104.13,104.13,0,0,1,232,128Z');
    await React.act(async () => ui.unmount()); ui = undefined;
    assert.equal(ref.current, null);
  } finally {
    if (ui) await React.act(async () => ui.unmount());
    await window.happyDOM.close();
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});

test('native SVG refs and old Lucide or custom components remain valid customization types', () => {
  const fixture = join(root, 'test/fixtures/themes/default-icons-types.tsx');
  const program = ts.createProgram([fixture], { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX, baseUrl: root, paths: { '@/components/ui/*': ['shadcn/ui/*'] } });
  // The focused fixture uses the actual public shared source and existing BlockIcon/ChatIcons contracts.
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: value => value, getNewLine: () => '\n' }), '');
});
