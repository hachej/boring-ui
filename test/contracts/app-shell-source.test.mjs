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
  assert.ok(item.registryDependencies.every(name => name.startsWith('@boring-ui/')), 'the app supplies sidebar, avatar, drawer and dropdown-menu; the item lists none');
});

test('the item compiles strictly against the pinned shadcn fixtures', () => {
  const base = ts.readConfigFile(`${root}tsconfig.base.json`, ts.sys.readFile);
  // The strict consumer settings (a copied item must compile in an app that sets them): unused locals and parameters, verbatim imports, erasable syntax only.
  const { options } = ts.parseJsonConfigFileContent({ ...base.config, compilerOptions: { ...base.config.compilerOptions, composite: false, declaration: false, declarationMap: false, noEmit: true,
    noUnusedLocals: true, noUnusedParameters: true, verbatimModuleSyntax: true, erasableSyntaxOnly: true, allowImportingTsExtensions: true, jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2023', 'DOM', 'DOM.Iterable'], baseUrl: root, paths: { '@/*': ['examples/app-shell/*'] } } }, ts.sys, root);
  const targets = readdirSync(`${root}registry/agent-target`).map(name => `${root}registry/agent-target/${name}`);
  const program = ts.createProgram([...files.map(name => `${root}${folder}/${name}`), ...targets], options);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file && (diagnostic.file.fileName.startsWith(`${root}registry/`) || diagnostic.file.fileName.startsWith(`${root}examples/app-shell/`)));
  assert.deepEqual(diagnostics.map(diagnostic => `${diagnostic.file.fileName.replace(root, '')}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`), []);
});

test('the shell root carries the app-shell class in every layout, so the scoped reset reaches its own header and nav buttons', () => {
  // One root for the three layouts (Shell renders it); the `.app-shell` reset is scoped to this class, so a host never wraps the shell to get it.
  const root = /<SidebarProvider\b[^>]*\bclassName="([^"]*)"/.exec(source('app-shell.tsx'));
  assert.ok(root, 'the root is the SidebarProvider');
  assert.match(root[1], /(?:^|\s)app-shell(?:\s|$)/, 'the root className names app-shell');
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

test('the item pins no shadcn style: kit items, tokens and classes only', () => {
  assert.ok(item.registryDependencies.every(name => name.startsWith('@boring-ui/')), 'no shadcn component or style URL in registryDependencies');
  for (const name of files) assert.doesNotMatch(source(name), /base-(?:nova|vega|lyra|maia|mira)|new-york|radix-(?:nova|vega|lyra)|styles\/[\w-]+\/(?:drawer|sidebar)/i, `${name} names a style`);
  const built = readFileSync(`${root}public/r/app-shell.json`, 'utf8');
  assert.doesNotMatch(built, /ui\.shadcn\.com\/r\/styles|base-nova|base-lyra/i, 'the built item names no style');
});

test('the item imports only React, its declared packages and the app setup shadcn components', () => {
  const allowed = new Set(['react', 'react-dom', 'lucide-react', '@base-ui/react/drawer', '@hachej/boring-feedback/page', '@hachej/boring-feedback/ui', '@hachej/boring-ui-kit/native-chat', '@hachej/boring-ui-kit/voice-capture', '@hachej/boring-ui-kit/chat-text', '@hachej/boring-ui-kit/chat-react/voice']);
  for (const name of files) {
    for (const [, imported] of source(name).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      if (imported.startsWith('./')) { assert.ok(files.some(file => file.replace(/\.tsx?$/, '') === imported.slice(2)), `${name} imports missing ${imported}`); continue; }
      if (/^\.\.\/(?:pi-chat(?:-[a-z]+)?|feedback|utils|dock|pm-panel)\//.test(imported)) continue;
      const ui = /^@\/components\/ui\/([\w-]+)$/.exec(imported);
      if (ui) { assert.ok(SHADCN_BUILTINS.includes(ui[1]), `${name}: ${imported} is not in the app setup`); continue; }
      if (imported === '@/hooks/use-mobile') { assert.ok(SHADCN_BUILTINS.includes('sidebar'), 'use-mobile comes with the sidebar'); continue; }
      assert.ok(allowed.has(imported), `${name} imports ${imported}`);
    }
  }
  // The neutral capture entry owns microphone access (feedback re-exports it); no shell file touches getUserMedia.
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
  // One bundle for the shell and the ListDetail, so both share the one Back manager.
  if (name === 'app-shell+list-detail') {
    const entry = `${out}/shell-list-detail.ts`;
    writeFileSync(entry, `export { AppShell } from '${root}${folder}/app-shell.tsx';\nexport { ListDetail } from '${root}${folder}/list-detail.tsx';\n`);
    return bundleEntry(entry, `${out}/shell-list-detail.mjs`, extra);
  }
  return bundleEntry(`${root}${folder}/${name}`, `${out}/${name.replace(/\.tsx?$/, '')}.mjs`, extra);
}
let freshModule = 0;
async function bundleEntry(entry, outfile, extra) {
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${root}examples/app-shell` }, logLevel: 'silent', ...extra });
  // A fresh module per call: the Back manager keeps its popstate listener on the window it first saw.
  return import(`${pathToFileURL(outfile).href}?${freshModule++}`);
}

test('parseAgentLink: known agents, defaults, invalid values and voice always full', async () => {
  const { parseAgentLink } = await bundle('index.ts');
  assert.equal(typeof parseAgentLink, 'function', 'the app-shell exports its URL parser');
  for (const agent of ['coach', 'agent', 'improve']) {
    assert.deepEqual(parseAgentLink(`?agent=${agent}&open=half&input=text`), { agent, open: 'half', input: 'text' });
    assert.deepEqual(parseAgentLink(`?agent=${agent}`), { agent, open: 'full', input: 'text' });
    assert.deepEqual(parseAgentLink(`?agent=${agent}&open=half&input=voice`), { agent, open: 'full', input: 'voice' });
  }
  for (const search of ['', '?open=full&input=text', '?agent=', '?agent=unknown', '?agent=COACH']) assert.equal(parseAgentLink(search), null, search);
  assert.deepEqual(parseAgentLink('?other=kept&agent=%63oach&open=unknown&input=unknown'), { agent: 'coach', open: 'full', input: 'text' });
});

test('agentLink: canonical shortcut query and parse/build round trips', async () => {
  const { agentLink, parseAgentLink } = await bundle('index.ts');
  assert.equal(typeof agentLink, 'function', 'the app-shell exports its shortcut builder');
  assert.equal(agentLink({ agent: 'coach', open: 'full', input: 'text' }), '?agent=coach&open=full&input=text');
  assert.equal(agentLink({ agent: 'agent' }), '?agent=agent&open=full&input=text');
  for (const agent of ['coach', 'agent', 'improve']) for (const open of ['half', 'full']) for (const input of ['text', 'voice']) {
    assert.deepEqual(parseAgentLink(agentLink({ agent, open, input })), { agent, open: input === 'voice' ? 'full' : open, input });
  }
});

test('text.ts has the same keys in English and French, and every word is filled', async () => {
  const { appShellText } = await bundle('text.ts');
  const en = appShellText('en'), fr = appShellText('fr');
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const [key, value] of [...Object.entries(en), ...Object.entries(fr)]) assert.ok(typeof value === 'string' && value.trim(), key);
  assert.equal(appShellText(undefined), en, 'English by default');
  assert.equal(fr.listening, 'J’écoute…');
  assert.equal(fr.holdToTalk, 'Appuie et parle');
  assert.equal(fr.signOut, 'Se déconnecter');
  assert.equal(fr.more, 'Plus');
  assert.equal(fr.improve, "Améliorer l'app");
});

test('the French words of the shell and of the chat and feedback labels use the typographic apostrophe, never ASCII', () => {
  // Every string literal of the French sources (the shell's `fr` table, pi-chat's labels-fr.ts, the feedback labels' French table) is checked: an ASCII ' in a value is a defect.
  const literals = (text, from) => { const found = []; const visit = node => { if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) found.push(node.text); ts.forEachChild(node, visit); }; visit(from); return found; };
  const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const frTable = (text, name) => parse(name, text).statements.flatMap(statement => ts.isVariableStatement(statement) ? statement.declarationList.declarations.filter(declaration => /fr/i.test(declaration.name.getText())) : []);
  const checked = [
    ...frTable(source('text.ts'), 'text.ts').flatMap(declaration => literals(source('text.ts'), declaration)),
    ...literals(readFileSync(`${root}registry/pi-chat/labels-fr.ts`, 'utf8'), parse('labels-fr.ts', readFileSync(`${root}registry/pi-chat/labels-fr.ts`, 'utf8'))),
    ...frTable(readFileSync(`${root}registry/feedback/feedback-labels.ts`, 'utf8'), 'feedback-labels.ts').flatMap(declaration => literals(readFileSync(`${root}registry/feedback/feedback-labels.ts`, 'utf8'), declaration)),
  ];
  assert.ok(checked.length > 100, 'the French tables are found');
  assert.deepEqual(checked.filter(value => value.includes("'")), [], 'an ASCII apostrophe in a French string');
});

test('nextSnapOnClose: a swipe, an outside press, a lost focus and Escape step down and never close; every other reason does', async () => {
  const { nextSnapOnClose } = await bundle('agent-layer.tsx');
  // Base UI's `details.reason` values for a drawer (reason-parts.js of @base-ui/react 1.8).
  for (const reason of ['swipe', 'outside-press', 'focus-out', 'escape-key']) {
    assert.equal(nextSnapOnClose(reason, true), 'peek', `${reason} with a peek`);
    assert.equal(nextSnapOnClose(reason, false), 'half', `${reason} without a peek`);
  }
  for (const reason of ['close-watcher', 'close-press', 'trigger-press', 'imperative-action', 'none']) {
    assert.equal(nextSnapOnClose(reason, true), 'close', `${reason} with a peek`);
    assert.equal(nextSnapOnClose(reason, false), 'close', `${reason} without a peek`);
  }
});

test('isOverlayEvent: a tap or focus inside a data-boring-overlay (the camera) is cancelled and changes no snap; anything else is the drawer\'s own', async t => {
  const { isOverlayEvent } = await bundle('agent-layer.tsx');
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'Element'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : window[name] });
  t.after(async () => { await window.happyDOM.close(); for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  window.document.body.innerHTML = '<div data-boring-overlay><button id="shutter" tabindex="0">Shoot</button></div><button id="page" tabindex="0">Page</button>';
  const shutter = window.document.getElementById('shutter'); const page = window.document.getElementById('page');
  page.focus();
  assert.equal(isOverlayEvent({ reason: 'outside-press', event: { target: shutter } }), true, 'a tap on the camera is an outside press of the drawer');
  assert.equal(isOverlayEvent({ reason: 'escape-key', event: { target: shutter } }), true);
  assert.equal(isOverlayEvent({ reason: 'focus-out', event: { target: page, relatedTarget: shutter } }), true, 'focus moving into the camera');
  assert.equal(isOverlayEvent({ reason: 'outside-press', event: { target: page } }), false, 'a tap on the page steps down as before');
  assert.equal(isOverlayEvent({ reason: 'focus-out', event: { target: shutter, relatedTarget: page } }), true, 'focus leaving the camera');
  assert.equal(isOverlayEvent({ reason: 'outside-press', event: undefined }), false, 'no event, focus elsewhere');
  shutter.focus();
  assert.equal(isOverlayEvent({ reason: 'focus-out', event: { target: page } }), true, 'the focused element is in the overlay');
  assert.equal(isOverlayEvent({ reason: 'swipe', event: { target: shutter } }), false, 'a swipe is not looked at');
  assert.equal(isOverlayEvent({ reason: 'close-press', event: { target: shutter } }), false, 'Close is never vetoed');
  page.focus();
  assert.equal(isOverlayEvent({ reason: 'escape-key', event: { target: page } }), false);
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
  const names = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'MutationObserver', 'ResizeObserver', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'FocusEvent', 'DOMRect', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : /^(?:getComputedStyle|requestAnimationFrame|cancelAnimationFrame|matchMedia|getSelection)$/.test(name) ? window[name].bind(window) : window[name] });
  t.after(() => { for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; window.close(); });
  return window;
}

test('AppShellProps has the shell props, optional rail, locale and URL opt-out, and no label or theme prop', () => {
  const program = ts.createProgram([`${root}${folder}/app-shell.tsx`], { allowImportingTsExtensions: true, jsx: ts.JsxEmit.ReactJSX, noEmit: true, skipLibCheck: true });
  const file = program.getSourceFile(`${root}${folder}/app-shell.tsx`);
  const props = file.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'AppShellProps');
  assert.deepEqual(props.members.map(member => member.name.text).sort(), ['account', 'agent', 'agentLink', 'compactNav', 'improve', 'layout', 'locale', 'nav', 'overlayBlur', 'rail', 'route', 'title']);
  const rail = props.members.find(member => member.name.text === 'rail');
  assert.ok(rail.questionToken, 'rail is optional');
  assert.equal(rail.type.getText(file), "'icon' | 'hover'");
  const agentLink = props.members.find(member => member.name.text === 'agentLink');
  assert.ok(agentLink.questionToken, 'agentLink is optional');
  assert.equal(agentLink.type.getText(file), 'false');
  const compactNav = props.members.find(member => member.name.text === 'compactNav');
  assert.ok(compactNav.questionToken, 'compactNav is optional');
  assert.equal(compactNav.type.getText(file), "'tabs' | 'sheet'");
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
  assert.equal(pane('list').nextElementSibling?.dataset.slot, 'separator', 'the host Separator divides the panes');
  assert.equal(pane('list').nextElementSibling?.getAttribute('aria-orientation') ?? pane('list').nextElementSibling?.dataset.orientation, 'vertical');
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

test('ListDetail collapsible: the list folds to railWidth with a toggle, controlled or not; compact and the default never fold', async t => {
  const window = dom(t);
  const { ListDetail } = await bundle('list-detail.tsx');
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  const listeners = new Set();
  window.matchMedia = query => ({ matches: false, media: query, addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) });
  window.innerWidth = 1280;
  const seen = [];
  const render = props => act(async () => root.render(h(ListDetail, { list: ({ collapsed }) => { seen.push(collapsed); return h('ul', { 'data-testid': 'rows' }, collapsed ? 'rail' : 'full'); }, detail: null, onBack() {}, ...props })));
  const pane = () => container.querySelector('[data-testid=list-pane]');
  const toggle = () => container.querySelector('[data-testid=list-toggle]');
  await render({});
  assert.ok(toggle() === null, 'not collapsible by default: no toggle, still 20rem');
  assert.match(pane().className, /\bw-80\b/);
  await render({ collapsible: true });
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');
  await act(async () => toggle().click());
  assert.equal(pane().style.width, '3rem', 'folds to the default rail');
  assert.equal(container.querySelector('[data-testid=rows]').textContent, 'rail', 'the list is told');
  assert.doesNotMatch(pane().className, /\bw-80\b/);
  assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  await act(async () => toggle().click());
  assert.equal(pane().style.width, '', 'and unfolds');
  const changes = [];
  await render({ collapsible: true, collapsed: true, railWidth: '4rem', onCollapsedChange: value => changes.push(value) });
  assert.equal(pane().style.width, '4rem', 'controlled: the prop wins');
  await act(async () => toggle().click());
  assert.deepEqual(changes, [false], 'and the toggle asks');
  assert.equal(pane().style.width, '4rem', 'a controlled pane waits for its owner');
  window.innerWidth = 390;
  await render({ collapsible: true, collapsed: true });
  await act(async () => { for (const listener of listeners) listener(); });
  assert.ok(toggle() === null, 'compact never folds');
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

test('AppShell: a nav choice from a compact detail keeps the URL the hash router replaced (the stack Back lands first)', async t => {
  const window = dom(t);
  const { AppShell, ListDetail } = await bundle('app-shell+list-detail');
  const { createElement: h, act, useState } = await import('react');
  const { createRoot } = await import('react-dom/client');
  window.innerWidth = 390;
  window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
  window.history.replaceState(null, '', '#consultations');
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  const App = () => {
    const [hash, setHash] = useState(() => window.location.hash.slice(1));
    // The hash router replaces the URL in the choice itself; the app knows nothing of the stack layer.
    const go = next => { window.history.replaceState(window.history.state, '', `#${next}`); setHash(next); };
    const selected = /^\d+$/.test(hash) ? hash : null;
    const nav = [
      { id: 'consultations', label: 'Consultations', icon: () => null, render: () => h(ListDetail, { list: h('button', { 'data-testid': 'open-3', onClick: () => go('3') }), detail: selected === null ? null : h('p', null, 'detail'), onBack: () => go('consultations') }) },
      { id: 'archives', label: 'Archives', icon: () => null, render: () => h('p', null, 'Archives') },
    ];
    return h(AppShell, { layout: 'workspace', title: 'Cabinet', nav, route: { id: selected === null ? hash : 'consultations', onChange: go } });
  };
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(h(App)));
  await act(async () => { container.querySelector('[data-testid=open-3]').click(); });
  await settle();
  assert.equal(container.querySelector('[data-testid=list-detail]').dataset.view, 'detail');
  assert.equal(window.location.hash, '#3');
  await act(async () => { container.querySelector('[data-testid=tab-archives]').click(); });
  await settle();
  assert.equal(window.location.hash, '#archives', 'the stack Back did not restore the detail URL');
  assert.equal(container.querySelector('[data-testid=screen-archives]').hasAttribute('hidden'), false, 'Archives stays on show');
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
  const { useExclusiveSheet } = await bundle('use-exclusive-sheet.ts');
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

test('agent-target registry source is listed and equals the shipped item', () => {
  const target = manifest.items.find(entry => entry.name === 'agent-target');
  const directory = 'registry/agent-target';
  assert.deepEqual(target.files.map(entry => entry.path.slice(directory.length + 1)).sort(), readdirSync(`${root}${directory}`).sort());
  const built = JSON.parse(readFileSync(`${root}public/r/agent-target.json`, 'utf8'));
  for (const entry of target.files) assert.equal(built.files.find(file => file.path === entry.path)?.content, readFileSync(`${root}${entry.path}`, 'utf8'), `${entry.path}: run npm run registry:build`);
});
