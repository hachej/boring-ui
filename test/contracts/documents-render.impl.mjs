import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';

// The `documents` item rendered in happy-dom, over a fictional SQLite-backed workspace (the same fixture the Library journey uses): the
// Library lists and opens a file; the Revisions panel lists the file's history and opens an old revision read-only; DocumentSheet opens one
// document over the app and Back closes it; `useShellLayer` opening closes the agent layer. Its own process: its DOM and bundles share no
// module or global state with the other source tests.
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/documents-render-test`;
const scopeId = 'fictional-team';
const access = { principalId: 'fictional-person', scopeId, initiatorId: 'fictional-person' };
const providerId = 'fictional-docs';
const locate = path => ({ resource: { providerId, path }, view: { kind: 'published' } });

// Every bundle is a fresh module graph: the shell's module state (the Back manager, the shell layer) belongs to one window.
let bundles = 0;
const cssEmpty = { name: 'css-empty', setup(b) {
  b.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'css-empty' }));
  b.onLoad({ filter: /.*/, namespace: 'css-empty' }, () => ({ contents: '', loader: 'js' }));
} };
async function load() {
  mkdirSync(out, { recursive: true });
  const entry = `${out}/entry-${++bundles}.tsx`, outfile = `${out}/entry-${bundles}.mjs`;
  writeFileSync(entry, [
    `export { AppShell } from '${root}registry/app-shell/app-shell.tsx';`,
    `export { useAgentLayer } from '${root}registry/app-shell/agent-layer.tsx';`,
    `export { useShellLayer } from '${root}registry/app-shell/shell-layer.ts';`,
    `export { Documents } from '${root}registry/documents/documents.tsx';`,
    `export { DocumentSheet } from '${root}registry/documents/document-sheet.tsx';`,
  ].join('\n'));
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', alias: { '@': `${root}examples/app-shell` }, plugins: [cssEmpty], logLevel: 'silent' });
  return import(`${pathToFileURL(outfile).href}?fresh=${bundles}`);
}

/** A happy-dom page for rendering; restores the globals afterwards. */
function dom(width) {
  const names = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'Text', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'MutationObserver', 'ResizeObserver', 'Event', 'CustomEvent', 'EventTarget', 'KeyboardEvent', 'PopStateEvent', 'MouseEvent', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: width < 768 ? width : 1280, height: 800, left: 0, right: width, top: 0, bottom: 800, x: 0, y: 0 });
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const restore = async () => {
    for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name];
    await window.happyDOM.close();
  };
  return { window, restore };
}

const Icon = () => null;
// An idle chat: the agent layer reads its spec on mount; nothing here sends.
const IDLE = Object.freeze({ identity: { runtimeId: 'app', scopeId, principalId: 'fictional-person', initiatorId: 'fictional-person' }, conversationId: 'fictional-conversation',
  connection: { kind: 'idle' }, send: { kind: 'idle' }, history: { kind: 'disabled' }, draft: { text: '', attachments: [] }, disposed: false, stop: 'idle', view: undefined });
const idleController = new Proxy({ getSnapshot: () => IDLE, subscribe: () => () => {} }, { get: (target, key) => key in target ? target[key] : () => Promise.resolve() });

/** A fictional workspace with one file of three saves (brief.txt) and one Markdown file, read through the workspace's public seams. */
async function fixture(t) {
  const store = openSqliteWorkspaces({ filename: ':memory:', providerId });
  t.after(() => store.close());
  const workspace = store.workspace(scopeId);
  const write = async (operationId, change) => {
    const result = await store.publication.publish({ operationId, atomicity: 'all-or-nothing', changes: [change] }, access);
    assert.equal(result.kind, 'committed', `seed ${operationId}: ${result.kind}`);
    return result.receipt.changes[0].after.revision;
  };
  const bytes = text => new TextEncoder().encode(text);
  const notes = await write('seed-notes', { kind: 'create', target: locate('notes.md'), expected: { kind: 'absent' }, bytes: bytes('# Fiche produit\n\nVersion initiale\n'), mediaType: 'text/markdown' });
  const first = await write('seed-brief-1', { kind: 'create', target: locate('brief.txt'), expected: { kind: 'absent' }, bytes: bytes('Premier jet\n'), mediaType: 'text/plain' });
  const second = await write('seed-brief-2', { kind: 'replace', target: { ...locate('brief.txt'), revision: first }, bytes: bytes('Deuxième jet\n'), mediaType: 'text/plain' });
  const last = await write('seed-brief-3', { kind: 'replace', target: { ...locate('brief.txt'), revision: second }, bytes: bytes('Version finale\n'), mediaType: 'text/plain' });
  const fiche1 = await write('seed-fiche-1', { kind: 'create', target: locate('fiche.md'), expected: { kind: 'absent' }, bytes: bytes('# Ancienne fiche\n'), mediaType: 'text/markdown' });
  const fiche2 = await write('seed-fiche-2', { kind: 'replace', target: { ...locate('fiche.md'), revision: fiche1 }, bytes: bytes('# Nouvelle fiche\n'), mediaType: 'text/markdown' });
  const pngA = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137]);
  const pngB = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 138]);
  const logo1 = await write('seed-logo-1', { kind: 'create', target: locate('logo.png'), expected: { kind: 'absent' }, bytes: pngA, mediaType: 'image/png' });
  const logo2 = await write('seed-logo-2', { kind: 'replace', target: { ...locate('logo.png'), revision: logo1 }, bytes: pngB, mediaType: 'image/png' });
  // The binding a host builds over its workspace: the same methods a remote `RevisionProvider` exposes, here over the fictional store.
  const provider = {
    identity: { scopeId, principalId: access.principalId, initiatorId: access.initiatorId },
    workspace: { providerId, instanceId: scopeId, incarnation: 'fictional', viewId: 'published' },
    locate,
    read: request => store.read(request, access),
    publish: request => store.publication.publish(request, access),
    lookup: id => store.reconciliation.lookup(id, access),
    list: request => workspace.catalog.list(request, access),
    search: request => workspace.catalog.search(request, access),
    history: path => workspace.catalog.history(path, access),
  };
  return { provider, notes, first, second, last, fiche: { first: fiche1, last: fiche2 }, logo: { first: logo1, last: logo2 } };
}

/**
 * Mounts a screen in a shell: the workspace layout, or the screen layout with `layout: 'screen'`. `screen(shell)` returns the render function
 * of the nav item, so a screen can use the shell's own exports. The page's globals are set before the bundle loads, and unmount runs first.
 */
async function mount(t, { width, screen, agent, improve, layout = 'workspace' }) {
  const { window, restore } = dom(width);
  const shell = await load();
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const reactRoot = createRoot(container);
  const nav = [{ id: 'docs', label: 'Documents', icon: Icon, render: screen(shell) }];
  const unmount = () => act(async () => reactRoot.unmount());
  // React may finish work scheduled by the unmount a macrotask later: the globals stay until it has.
  t.after(async () => { await unmount(); await new Promise(done => setTimeout(done, 50)); await restore(); });
  await act(async () => reactRoot.render(h(shell.AppShell, { layout, title: 'Fiches', nav, route: { id: 'docs', onChange() {} }, ...(agent ? { agent } : {}), ...(improve ? { improve } : {}) })));
  const q = selector => window.document.querySelector(selector);
  const settle = async ready => { for (let n = 0; n < 200 && !ready(); n++) await act(async () => new Promise(done => setTimeout(done, 10))); };
  const click = async element => act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  const back = async () => act(async () => window.dispatchEvent(new window.PopStateEvent('popstate')));
  return { window, q, settle, click, back, act };
}

for (const width of [1280, 390]) {
  test(`Documents at ${width}: the Library lists the workspace files and opens one in the viewer`, async t => {
    const f = await fixture(t);
    const { createElement: h } = await import('react');
    const view = await mount(t, { width, screen: shell => () => h(shell.Documents, { provider: f.provider }) });
    await view.settle(() => view.q('[role=treeitem][data-path="notes.md"] button'));
    assert.ok(view.q('[role=treeitem][data-path="notes.md"]'), 'the Library lists notes.md');
    assert.ok(view.q('[role=treeitem][data-path="brief.txt"]'), 'the Library lists brief.txt');
    await view.click(view.q('[role=treeitem][data-path="notes.md"] button'));
    await view.settle(() => view.q('[data-testid=file-viewer][data-path="notes.md"]'));
    assert.ok(view.q('[data-testid=file-viewer][data-path="notes.md"]'), 'the viewer shows the selected file');
  });
}

test('Revisions at 1280: the history lists every saved revision, and an old one opens read-only in the viewer', async t => {
  const f = await fixture(t);
  const { createElement: h } = await import('react');
  const view = await mount(t, { width: 1280, screen: shell => () => h(shell.Documents, { provider: f.provider }) });
  await view.settle(() => view.q('[role=treeitem][data-path="brief.txt"] button'));
  await view.click(view.q('[role=treeitem][data-path="brief.txt"] button'));
  await view.settle(() => view.q('[data-testid=file-viewer][data-path="brief.txt"]'));
  await view.settle(() => view.q('[data-testid=revision-item]'));
  const rows = [...view.window.document.querySelectorAll('[data-testid=revision-item]')];
  assert.deepEqual(rows.map(row => row.dataset.revision), [f.last, f.second, f.first], 'newest first, one row per saved revision');
  assert.ok(rows.every(row => row.textContent.trim().length > 0), 'each row says when it was saved and by whom');
  // The oldest revision: a read-only view of exactly that revision, not the latest.
  await view.click(rows[2]);
  await view.settle(() => view.q(`[data-testid=artifact-panel][data-artifact-revision="${f.first}"]`));
  assert.ok(view.q(`[data-testid=artifact-panel][data-artifact-revision="${f.first}"]`), 'the old revision is on show');
  await view.settle(() => /Premier jet/.test(view.q('[data-testid=artifact-body]')?.textContent ?? ''));
  const body = view.q('[data-testid=artifact-body]')?.textContent ?? '';
  assert.match(body, /Premier jet/, 'the old bytes are shown');
  assert.doesNotMatch(body, /Version finale/, 'not the latest bytes');
  assert.match(view.q('[data-testid=artifact-panel]')?.textContent ?? '', /Read-only/, 'marked read-only');
});

test('DocumentSheet at 390: one document opens over the app, « Toutes les fiches » is offered, and Back closes it', async t => {
  const f = await fixture(t);
  const { createElement: h, useState } = await import('react');
  const calls = [];
  const Host = shell => () => {
    const [path, setPath] = useState('notes.md');
    return h('div', null,
      h('button', { type: 'button', id: 'open-sheet', onClick: () => setPath('notes.md') }, 'Voir la fiche'),
      h(shell.DocumentSheet, { provider: f.provider, path, onClose: () => { calls.push('closed'); setPath(undefined); }, onShowAll: () => calls.push('all') }));
  };
  const view = await mount(t, { width: 390, screen: Host });
  await view.settle(() => view.q('[data-testid=document-sheet] [data-testid=file-viewer][data-path="notes.md"]'));
  assert.ok(view.q('[data-testid=document-sheet] [data-testid=file-viewer][data-path="notes.md"]'), 'the sheet shows the document');
  await view.click(view.q('[data-testid=document-sheet-all]'));
  await view.settle(() => calls.length === 2);
  assert.deepEqual(calls, ['closed', 'all'], '« Toutes les fiches » closes the sheet, then reports to the host');
  assert.equal(view.q('[data-testid=document-sheet]'), null, 'closed');
  await view.click(view.q('#open-sheet'));
  await view.settle(() => view.q('[data-testid=document-sheet]'));
  assert.ok(view.q('[data-testid=document-sheet]'), 'opened again');
  await view.back();
  await view.settle(() => !view.q('[data-testid=document-sheet]'));
  assert.equal(view.q('[data-testid=document-sheet]'), null, 'Back closes the sheet');
  assert.deepEqual(calls, ['closed', 'all', 'closed'], 'the host learns that it closed');
});

test('useShellLayer: opening a full-screen view closes the agent layer, and Back closes the view', async t => {
  const { createElement: h, useLayoutEffect } = await import('react');
  let agent, doc;
  const probe = shell => () => {
    const layer = shell.useAgentLayer();
    const docLayer = shell.useShellLayer('documents-test');
    useLayoutEffect(() => { agent = layer; doc = docLayer; });
    return null;
  };
  const view = await mount(t, { width: 1280, screen: probe, agent: { controller: idleController }, improve: { controller: idleController } });
  await view.act(async () => agent.open('agent', 'half'));
  assert.equal(agent.showing, 'agent', 'the agent layer shows');
  await view.act(async () => doc.open());
  assert.equal(doc.isOpen, true, 'the view is open');
  assert.equal(agent.state, 'closed', 'opening the view closes the agent layer');
  await view.act(async () => agent.open('improve', 'half'));
  assert.equal(doc.isOpen, false, 'opening a layer closes the view');
  await view.act(async () => doc.open());
  await view.back();
  assert.equal(doc.isOpen, false, 'Back closes the view first');
});

test('Revisions at 1280: the newest row opens its own revision read-only too, and « Back to editing » returns to the file', async t => {
  const f = await fixture(t);
  const { createElement: h } = await import('react');
  const view = await mount(t, { width: 1280, screen: shell => () => h(shell.Documents, { provider: f.provider }) });
  await view.settle(() => view.q('[role=treeitem][data-path="brief.txt"] button'));
  await view.click(view.q('[role=treeitem][data-path="brief.txt"] button'));
  await view.settle(() => view.q('[data-testid=revision-item]'));
  const newest = view.q(`[data-testid=revision-item][data-revision="${f.last}"]`);
  await view.click(newest);
  await view.settle(() => view.q('[data-testid=revision-view]'));
  assert.equal(view.q('[data-testid=revision-view]')?.dataset.revision, f.last, 'the newest row shows exactly its revision');
  assert.ok(view.q(`[data-testid=artifact-panel][data-artifact-revision="${f.last}"]`), 'read-only, not the editable file');
  await view.click(view.q('[data-testid=back-to-editing]'));
  await view.settle(() => view.q('[data-testid=file-viewer][data-path="brief.txt"]'));
  assert.equal(view.q('[data-testid=revision-view]'), null, 'back to the editable file');
});

const setText = (view, element, value) => {
  const setter = Object.getOwnPropertyDescriptor(view.window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(element, value);
  element.dispatchEvent(new view.window.Event('input', { bubbles: true }));
};

test('Documents at 1280: unsaved edits survive a visit to an older revision, and leaving the file with them asks first', async t => {
  const f = await fixture(t);
  const { createElement: h } = await import('react');
  const view = await mount(t, { width: 1280, screen: shell => () => h(shell.Documents, { provider: f.provider }) });
  await view.settle(() => view.q('[role=treeitem][data-path="fiche.md"] button'));
  await view.click(view.q('[role=treeitem][data-path="fiche.md"] button'));
  await view.settle(() => view.q('[data-testid$="-mode-source"]'));
  await view.click(view.q('[data-testid$="-mode-source"]'));
  await view.settle(() => view.q('[data-testid=file-viewer][data-path="fiche.md"] textarea'));
  const draft = 'Brouillon non enregistré';
  await view.act(async () => setText(view, view.q('[data-testid=file-viewer][data-path="fiche.md"] textarea'), draft));
  await view.settle(() => view.q(`[data-testid=revision-item][data-revision="${f.fiche.first}"]`));
  await view.click(view.q(`[data-testid=revision-item][data-revision="${f.fiche.first}"]`));
  await view.settle(() => view.q('[data-testid=revision-view]'));
  await view.click(view.q('[data-testid=back-to-editing]'));
  await view.settle(() => view.q('[data-testid=file-viewer][data-path="fiche.md"] textarea'));
  assert.equal(view.q('[data-testid=file-viewer][data-path="fiche.md"] textarea').value, draft, 'the draft is still in the editor');
  // Leaving with unsaved edits asks; declining keeps the file and the draft.
  view.window.confirm = () => false;
  await view.click(view.q('[role=treeitem][data-path="brief.txt"] button'));
  await view.act(async () => new Promise(done => setTimeout(done, 100)));
  assert.equal(view.q('[data-testid=file-viewer][data-path="fiche.md"] textarea')?.value, draft, 'declined: still here');
  // Accepting leaves the file.
  view.window.confirm = () => true;
  await view.click(view.q('[role=treeitem][data-path="brief.txt"] button'));
  await view.settle(() => view.q('[data-testid=file-viewer][data-path="brief.txt"]'));
  assert.ok(view.q('[data-testid=file-viewer][data-path="brief.txt"]'), 'accepted: the other file opens');
});

test('Documents at 1280: an older Markdown revision is read exactly, also after a reload', async t => {
  const f = await fixture(t);
  const { createElement: h } = await import('react');
  const view = await mount(t, { width: 1280, screen: shell => () => h(shell.Documents, { provider: f.provider }) });
  await view.settle(() => view.q('[role=treeitem][data-path="fiche.md"] button'));
  await view.click(view.q('[role=treeitem][data-path="fiche.md"] button'));
  await view.settle(() => view.q(`[data-testid=revision-item][data-revision="${f.fiche.first}"]`));
  await view.click(view.q(`[data-testid=revision-item][data-revision="${f.fiche.first}"]`));
  await view.settle(() => /Ancienne fiche/.test(view.q('[data-testid=revision-view]')?.textContent ?? ''));
  await view.click(view.q('[data-testid=artifact-more]'));
  await view.settle(() => view.q('[data-testid=artifact-refresh]'));
  await view.click(view.q('[data-testid=artifact-refresh]'));
  await view.act(async () => new Promise(done => setTimeout(done, 300)));
  const body = view.q('[data-testid=revision-view]')?.textContent ?? '';
  assert.match(body, /Ancienne fiche/, 'the reload re-reads the selected revision');
  assert.doesNotMatch(body, /Nouvelle fiche/, 'never the latest');
});

test('Documents at 1280: an image revision opens read-only in the image pane', async t => {
  const f = await fixture(t);
  const { createElement: h } = await import('react');
  const view = await mount(t, { width: 1280, screen: shell => () => h(shell.Documents, { provider: f.provider }) });
  await view.settle(() => view.q('[role=treeitem][data-path="logo.png"] button'));
  await view.click(view.q('[role=treeitem][data-path="logo.png"] button'));
  await view.settle(() => view.q(`[data-testid=revision-item][data-revision="${f.logo.first}"]`));
  await view.click(view.q(`[data-testid=revision-item][data-revision="${f.logo.first}"]`));
  await view.settle(() => view.q('[data-testid=revision-view][data-kind="image"]'));
  assert.ok(view.q('[data-testid=revision-view][data-kind="image"]'), 'the image revision has its own pane, not a note');
  assert.equal(view.q('[data-testid=revision-view]')?.dataset.revision, f.logo.first);
});

test('Documents at 1280 in French: the viewer bar and the revision view use the French words', async t => {
  const f = await fixture(t);
  const { createElement: h } = await import('react');
  const view = await mount(t, { width: 1280, screen: shell => () => h(shell.Documents, { provider: f.provider, locale: 'fr' }) });
  await view.settle(() => view.q('[role=treeitem][data-path="fiche.md"] button'));
  await view.click(view.q('[role=treeitem][data-path="fiche.md"] button'));
  await view.settle(() => view.q(`[data-testid=revision-item][data-revision="${f.fiche.first}"]`));
  await view.click(view.q(`[data-testid=revision-item][data-revision="${f.fiche.first}"]`));
  await view.settle(() => view.q('[data-testid=revision-view]'));
  assert.match(view.q('[data-testid=revision-view]')?.textContent ?? '', /Lecture seule/, 'the app words');
  assert.equal(view.q('[data-testid=revision-view] [data-testid$=-close]')?.getAttribute('aria-label'), 'Fermer', 'the viewer bar words');
  assert.equal(view.q('[data-testid=back-to-editing]')?.textContent.trim(), 'Revenir à la modification');
});

test('the all-documents button is 44px on a coarse pointer, tablets included (no fine-pointer-only size)', async () => {
  const { readFileSync: read } = await import('node:fs');
  const source = read(new URL('../../registry/documents/document-sheet.tsx', import.meta.url), 'utf8');
  assert.match(source, /import \{ Button \} from '@\/components\/ui\/button'/);
  assert.match(source, /className=\{cn\('app-shell /, 'the native control is inside the shell touch-target scope');
  const item = JSON.parse(read(new URL('../../registry.json', import.meta.url), 'utf8')).items.find(item => item.name === 'app-shell');
  assert.deepEqual(item.css['@layer utilities']['@media (max-width: 640px), (pointer: coarse)']['.app-shell :is([data-slot="button"], [data-slot="toggle"], [class~="group/button"], [class~="group/toggle"])'], { 'min-height': '2.75rem', 'min-width': '2.75rem' }, '44px minimum on coarse pointers, tablets included');
  assert.doesNotMatch(source, /md:min-h-8/, 'no md override that shrinks it on a tablet');
});

test('useShellLayer: one owner registers Back; an observer unmounting releases only its subscription', async t => {
  const shell = await load();
  const { createElement: h, useLayoutEffect, useState } = await import('react');
  let owner, observer, showObserver;
  const Observer = () => { observer = shell.useShellLayer('documents-test'); return null; };
  const page = () => {
    const [shown, setShown] = useState(true);
    showObserver = setShown;
    owner = shell.useShellLayer('documents-test');
    useLayoutEffect(() => {});
    return h('div', null, shown ? h(Observer) : null);
  };
  const view = await mount(t, { width: 1280, screen: () => page });
  await view.act(async () => observer.open());
  assert.equal(owner.isOpen, true, 'the owner sees the view open');
  assert.equal(observer.isOpen, true, 'the observer sees it too');
  await view.act(async () => showObserver(false));
  assert.equal(owner.isOpen, true, 'an observer leaving does not close the view');
  await view.back();
  assert.equal(owner.isOpen, false, 'Back closes it once, through the owner');
});

test('Revisions at 1280: switching the provider shows no history of the previous workspace while the new one is read', async t => {
  const f = await fixture(t);
  const { createElement: h, useState } = await import('react');
  // The same file in another workspace whose history has not arrived yet.
  const pending = { ...f.provider, history: () => new Promise(() => {}) };
  let switchTo;
  const Host = shell => () => {
    const [current, setCurrent] = useState(f.provider);
    switchTo = () => setCurrent(pending);
    return h('div', null, h(shell.Documents, { provider: current }));
  };
  const view = await mount(t, { width: 1280, screen: Host });
  await view.settle(() => view.q('[role=treeitem][data-path="brief.txt"] button'));
  await view.click(view.q('[role=treeitem][data-path="brief.txt"] button'));
  await view.settle(() => view.q('[data-testid=revision-item]'));
  assert.ok(view.q('[data-testid=revision-item]'), 'the first workspace shows its history');
  await view.act(async () => switchTo());
  await view.click(view.q('[role=treeitem][data-path="brief.txt"] button'));
  await view.act(async () => new Promise(done => setTimeout(done, 200)));
  assert.equal(view.q('[data-testid=revision-item]'), null, 'no row of the previous workspace');
  assert.match(view.q('[data-testid=revisions]')?.textContent ?? '', /Loading revisions|Chargement/, 'the new history is awaited');
});
