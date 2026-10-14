import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

test('the item pins no shadcn style: bare built-in names, tokens and classes only', () => {
  assert.ok(item.registryDependencies.every(name => SHADCN_BUILTINS.includes(name) || name.startsWith('@boring-ui/')), 'no style URL in registryDependencies');
  for (const name of files) assert.doesNotMatch(source(name), /base-(?:nova|vega|lyra|maia|mira)|new-york|radix-(?:nova|vega|lyra)|styles\/[\w-]+\/(?:drawer|sidebar)/i, `${name} names a style`);
  const built = readFileSync(`${root}public/r/app-shell.json`, 'utf8');
  assert.doesNotMatch(built, /ui\.shadcn\.com\/r\/styles|base-nova|base-lyra/i, 'the built item names no style');
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
  // One bundle that holds the header store and the screen-active context together, so both see the same context object.
  if (name === 'header+context') {
    const entry = `${out}/header-context.ts`;
    writeFileSync(entry, `export * from '${root}${folder}/header.tsx';\nexport { ScreenActiveContext } from '${root}${folder}/agent-context.ts';\n`);
    return bundleEntry(entry, `${out}/header-context.mjs`, extra);
  }
  return bundleEntry(`${root}${folder}/${name}`, `${out}/${name.replace(/\.tsx?$/, '')}.mjs`, extra);
}
let freshModule = 0;
async function bundleEntry(entry, outfile, extra) {
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${root}examples/app-shell` }, logLevel: 'silent', ...extra });
  // A fresh module per call: the Back manager keeps its popstate listener on the window it first saw.
  return import(`${pathToFileURL(outfile).href}?${freshModule++}`);
}

test('text.ts has the same keys in English and French, and every word is filled', async () => {
  const { appShellText } = await bundle('text.ts');
  const en = appShellText('en'), fr = appShellText('fr');
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const [key, value] of [...Object.entries(en), ...Object.entries(fr)]) assert.ok(typeof value === 'string' && value.trim(), key);
  assert.equal(appShellText(undefined), en, 'English by default');
  assert.equal(fr.listening, 'J\'écoute…');
  assert.equal(fr.holdToTalk, 'Appuie et parle');
  assert.equal(fr.signOut, 'Se déconnecter');
  assert.equal(fr.more, 'Plus');
  assert.equal(fr.improve, 'Améliorer l\'app');
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

/** A happy-dom page for rendering hooks; restores the globals afterwards. */
function dom(t) {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'history', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name] });
  t.after(() => { for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  return window;
}

test('AppShellProps has exactly the seven props of the brief, and no label, locale or theme prop', () => {
  const program = ts.createProgram([`${root}${folder}/app-shell.tsx`], { allowImportingTsExtensions: true, jsx: ts.JsxEmit.ReactJSX, noEmit: true, skipLibCheck: true });
  const file = program.getSourceFile(`${root}${folder}/app-shell.tsx`);
  const props = file.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'AppShellProps');
  assert.deepEqual(props.members.map(member => member.name.text).sort(), ['account', 'agent', 'improve', 'layout', 'nav', 'route', 'title']);
});

test('splitNav: up to four screens are all tabs; more give three tabs plus « Plus »', async () => {
  const { splitNav } = await bundle('nav.tsx');
  const ids = count => Array.from({ length: count }, (_, index) => `n${index + 1}`);
  for (const count of [1, 2, 3, 4]) assert.deepEqual(splitNav(ids(count)), { tabs: ids(count), overflow: [] }, `${count} items`);
  assert.deepEqual(splitNav(ids(5)), { tabs: ['n1', 'n2', 'n3'], overflow: ['n4', 'n5'] });
  assert.deepEqual(splitNav(ids(6)), { tabs: ['n1', 'n2', 'n3'], overflow: ['n4', 'n5', 'n6'] });
});

test('initials: two letters from the name, one from a single word, a question mark from nothing', async () => {
  const { initials } = await bundle('account.tsx');
  assert.equal(initials('Camille Martin'), 'CM');
  assert.equal(initials('  éloïse   de la Tour '), 'ÉD');
  assert.equal(initials('camille'), 'C');
  assert.equal(initials(''), '?');
});

test('layout "chat" takes no agent: the page is the chat', async () => {
  const { AppShell } = await bundle('app-shell.tsx');
  assert.throws(() => AppShell({ layout: 'chat', title: 'Atelier', nav: [], agent: { controller: {} }, route: { id: 'a', onChange() {} } }), /layout "chat" takes no `agent`/);
});

test('listDetailView: both panes when expanded; when compact the detail if one is selected, else the list', async () => {
  const { listDetailView } = await bundle('list-detail.tsx');
  assert.equal(listDetailView(false, null), 'both');
  assert.equal(listDetailView(false, 'x'), 'both');
  assert.equal(listDetailView(true, null), 'list');
  assert.equal(listDetailView(true, 'x'), 'detail');
});

test('ListDetail: expanded shows a 20rem list and the detail with no history entry; compact keeps the list mounted, stacks the detail and Back clears it', async t => {
  const window = dom(t);
  const { ListDetail } = await bundle('list-detail.tsx');
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  const backs = [];
  const listeners = new Set();
  window.matchMedia = query => ({ matches: false, media: query, addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) });
  const render = async (width, detail) => {
    window.innerWidth = width;
    await act(async () => root.render(h(ListDetail, { list: h('ul', { 'data-testid': 'rows' }), detail, onBack: () => backs.push('back'), title: 'Consultation 12' })));
    await act(async () => { for (const listener of listeners) listener(); });
  };
  const pane = name => container.querySelector(`[data-testid=${name}-pane]`);
  const entries = () => window.history.length;
  const start = entries();

  await render(1280, null);
  assert.equal(container.firstChild.getAttribute('data-view'), 'both');
  assert.match(pane('list').className, /\bw-80\b/, 'the list pane is 20rem');
  assert.match(pane('list').className, /border-r/);
  assert.match(pane('detail').className, /bg-muted\/30/, 'an empty detail pane is muted');
  await render(1280, h('p', null, 'detail'));
  assert.equal(entries(), start, 'selecting a row when expanded adds no history entry');
  assert.equal(pane('list').hasAttribute('hidden') || pane('detail').hasAttribute('hidden'), false, 'both panes show');

  await render(390, null);
  assert.equal(container.firstChild.getAttribute('data-view'), 'list');
  assert.equal(pane('detail').hasAttribute('hidden'), true);
  assert.equal(entries(), start);
  const rows = container.querySelector('[data-testid=rows]');
  await render(390, h('p', null, 'detail'));
  assert.equal(container.firstChild.getAttribute('data-view'), 'detail');
  assert.equal(pane('list').hasAttribute('hidden'), true, 'the list is hidden, not unmounted');
  assert.equal(container.querySelector('[data-testid=rows]'), rows, 'the list keeps its element, so its scroll is kept');
  assert.equal(entries(), start + 1, 'a stack step is one history entry');
  assert.deepEqual(window.history.state, { appShell: 'stack' });
  window.dispatchEvent(new window.Event('popstate'));
  assert.deepEqual(backs, ['back'], 'Back calls onBack');
  await act(async () => root.unmount());
});

test('useScreenHeader: a deeper caller (a ListDetail) adds « ← » and a title and keeps the screen\'s actions', async t => {
  const window = dom(t);
  const { HeaderProvider, useScreenHeader, useTopHeader } = await bundle('header+context');
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const actions = [{ id: 'new', label: 'Nouvelle', icon: () => null, onSelect() {} }];
  const Outer = ({ children }) => { useScreenHeader({ title: 'Consultations', actions }); return children; };
  const Inner = ({ on }) => { useScreenHeader(on ? { back() {}, title: 'Détail' } : {}, { overlay: true }); return null; };
  const seen = [];
  const Probe = () => { const top = useTopHeader(); seen.push({ title: top?.spec.title, back: Boolean(top?.spec.back), actions: top?.spec.actions?.length ?? 0 }); return null; };
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  const render = on => act(async () => root.render(h(HeaderProvider, null, h(Probe), h(Outer, null, h(Inner, { on })))));
  await render(false);
  assert.deepEqual(seen.at(-1), { title: 'Consultations', back: false, actions: 1 });
  await render(true);
  assert.deepEqual(seen.at(-1), { title: 'Détail', back: true, actions: 1 });
  await render(false);
  assert.deepEqual(seen.at(-1), { title: 'Consultations', back: false, actions: 1 });
  await act(async () => root.unmount());
});

test('useScreenHeader: an ordinary later header replaces the earlier one whole, and a click reads the live callback', async t => {
  const window = dom(t);
  const { HeaderProvider, useScreenHeader, useTopHeader } = await bundle('header+context');
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const icon = () => null;
  const calls = [];
  const Screen = ({ title, actions, back }) => { useScreenHeader({ title, ...(actions ? { actions } : {}), ...(back ? { back } : {}) }); return null; };
  const Overlay = ({ on }) => { useScreenHeader(on ? { back() {}, title: 'Détail' } : {}, { overlay: true }); return null; };
  let top;
  const Probe = () => { top = useTopHeader(); return null; };
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  const render = (...children) => act(async () => root.render(h(HeaderProvider, null, h(Probe), ...children)));
  const action = tag => ({ id: 'go', label: 'Go', icon, onSelect: () => calls.push(tag) });
  await render(h(Screen, { key: 'a', title: 'A', actions: [action('a')], back() {} }), h(Screen, { key: 'b', title: 'B' }));
  assert.deepEqual([top.spec.title, top.spec.actions, top.spec.back], ['B', undefined, undefined], 'B replaces A whole');
  await render(h(Screen, { key: 'a', title: 'A', actions: [action('old')] }), h(Overlay, { key: 'o', on: true }));
  const held = top;
  await render(h(Screen, { key: 'a', title: 'A', actions: [action('new')] }), h(Overlay, { key: 'o', on: true }));
  held.spec.actions[0].onSelect();
  assert.deepEqual(calls, ['new'], 'the header held from before still calls the current callback');
  assert.equal(held.spec.title, 'Détail');
  await act(async () => root.unmount());
});

test('ListDetail: a reload on a compact detail adopts the stack entry that is already there', async t => {
  const window = dom(t);
  window.history.replaceState({ appShell: 'stack' }, '');
  const { ListDetail } = await bundle('list-detail.tsx');
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  window.innerWidth = 390;
  const listeners = new Set();
  window.matchMedia = query => ({ matches: false, media: query, addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) });
  const start = window.history.length;
  const backs = [];
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(h(ListDetail, { list: h('ul'), detail: h('p', null, 'detail'), onBack: () => backs.push('back') })));
  await act(async () => { for (const listener of listeners) listener(); });
  assert.equal(window.history.length, start, 'no second entry');
  window.dispatchEvent(new window.Event('popstate'));
  assert.deepEqual(backs, ['back'], 'Back still reaches onBack');
  await act(async () => root.unmount());
});

test('app-shell reaches pi-app only through the public agent-workspace export, and never by import', () => {
  for (const name of files) assert.doesNotMatch(source(name), /pi-app\/(?!agent-workspace)/, `${name} imports a pi-app internal`);
  assert.ok(!item.registryDependencies.includes('@boring-ui/pi-app'), 'the shell imports nothing from pi-app, so it does not install it');
});

test('useScreenHeader: the most recently mounted screen wins, unmounting restores the previous one, a hidden screen does not count', async t => {
  const window = dom(t);
  const { HeaderProvider, useScreenHeader, useTopHeader, ScreenActiveContext } = await bundle('header+context');
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const Screen = ({ title, actions }) => { useScreenHeader({ title, ...(actions ? { actions } : {}) }); return null; };
  const seen = [];
  const Probe = () => { const top = useTopHeader(); seen.push(top?.spec.title); return null; };
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  const render = async screens => act(async () => root.render(h(HeaderProvider, null, h(Probe), ...screens.map(({ active = true, ...props }) => h(ScreenActiveContext.Provider, { key: props.title, value: active }, h(Screen, props))))));
  await render([]);
  assert.equal(seen.at(-1), undefined, 'no screen, no header');
  await render([{ title: 'A' }]);
  assert.equal(seen.at(-1), 'A');
  await render([{ title: 'A' }, { title: 'B' }]);
  assert.equal(seen.at(-1), 'B', 'mount A, mount B: B');
  await render([{ title: 'A' }]);
  assert.equal(seen.at(-1), 'A', 'unmount B: A');
  await render([{ title: 'A' }, { title: 'B', active: false }]);
  assert.equal(seen.at(-1), 'A', 'a screen that is not on show never wins');
  await render([{ title: 'A', active: false }, { title: 'B' }]);
  assert.equal(seen.at(-1), 'B', 'B takes the screen');
  await render([{ title: 'A' }, { title: 'B', active: false }]);
  assert.equal(seen.at(-1), 'A', 'A is on show again');
  await act(async () => root.unmount());
});

test('useAgentContext: a screen that is not on show does not register its context', async t => {
  const window = dom(t);
  const { AgentContextProvider, useAgentContext, readAgentContext, ScreenActiveContext } = await bundle('agent-context.ts');
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const Screen = ({ name }) => { useAgentContext({ name, params: {} }); return null; };
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  const render = async screens => act(async () => root.render(h(AgentContextProvider, null, ...screens.map(({ active, name }) => h(ScreenActiveContext.Provider, { key: name, value: active }, h(Screen, { name }))))));
  await render([{ name: 'Jour', active: true }, { name: 'Progrès', active: false }]);
  assert.equal(readAgentContext()?.name, 'Jour');
  await render([{ name: 'Jour', active: false }, { name: 'Progrès', active: true }]);
  assert.equal(readAgentContext()?.name, 'Progrès');
  await act(async () => root.unmount());
});

test('useExclusiveSheet: opening a sheet closes every other open sheet', async t => {
  const window = dom(t);
  const { useExclusiveSheet } = await bundle('sheet.tsx');
  const { createElement: h, act, useState } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const log = [];
  let setA, setB;
  const Sheet = ({ name, expose }) => { const [open, setOpen] = useState(false); expose(setOpen); useExclusiveSheet(open, () => { log.push(`close ${name}`); setOpen(false); }); return h('i', { 'data-open': open }); };
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(h('div', null, h(Sheet, { name: 'account', expose: set => { setA = set; } }), h(Sheet, { name: 'more', expose: set => { setB = set; } }))));
  await act(async () => setA(true));
  assert.deepEqual(log, []);
  await act(async () => setB(true));
  assert.deepEqual(log, ['close account']);
  const open = () => [...container.querySelectorAll('i')].map(node => node.getAttribute('data-open'));
  assert.deepEqual(open(), ['false', 'true']);
  await act(async () => root.unmount());
});
