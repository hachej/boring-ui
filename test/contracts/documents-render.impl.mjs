import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

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
function dom(t, width) {
  const names = ['window', 'document', 'navigator', 'history', 'location', 'HTMLElement', 'Element', 'Node', 'Text', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'getSelection', 'MutationObserver', 'ResizeObserver', 'Event', 'CustomEvent', 'EventTarget', 'KeyboardEvent', 'PopStateEvent', 'MouseEvent', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: width < 768 ? width : 1280, height: 800, left: 0, right: width, top: 0, bottom: 800, x: 0, y: 0 });
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  t.after(async () => {
    for (const [name, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name];
    await window.happyDOM.close();
  });
  return window;
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
  return { provider, notes, first, second, last };
}

/** Mounts `page` in a shell: the workspace layout on a wide screen, the screen layout on a phone. */
async function mount(t, shell, { width, page, agent, improve }) {
  const window = dom(t, width);
  const { createElement: h, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const reactRoot = createRoot(container);
  const nav = [{ id: 'docs', label: 'Documents', icon: Icon, render: page }];
  await act(async () => reactRoot.render(h(shell.AppShell, { layout: 'workspace', title: 'Fiches', nav, route: { id: 'docs', onChange() {} }, ...(agent ? { agent } : {}), ...(improve ? { improve } : {}) })));
  const q = selector => window.document.querySelector(selector);
  const settle = async ready => { for (let n = 0; n < 200 && !ready(); n++) await act(async () => new Promise(done => setTimeout(done, 10))); };
  const click = async element => act(async () => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  const back = async () => act(async () => window.dispatchEvent(new window.PopStateEvent('popstate')));
  return { window, q, settle, click, back, act, unmount: () => act(async () => reactRoot.unmount()) };
}

for (const width of [1280, 390]) {
  test(`Documents at ${width}: the Library lists the workspace files and opens one in the viewer`, async t => {
    const shell = await load();
    const { Documents } = shell;
    const f = await fixture(t);
    const { createElement: h } = await import('react');
    const page = () => h(Documents, { provider: f.provider });
    const view = await mount(t, shell, { width, page });
    t.after(() => view.unmount());
    await view.settle(() => view.q('[role=treeitem][data-path="notes.md"] button'));
    assert.ok(view.q('[role=treeitem][data-path="notes.md"]'), 'the Library lists notes.md');
    assert.ok(view.q('[role=treeitem][data-path="brief.txt"]'), 'the Library lists brief.txt');
    await view.click(view.q('[role=treeitem][data-path="notes.md"] button'));
    await view.settle(() => view.q('[data-testid=file-viewer][data-path="notes.md"]'));
    assert.ok(view.q('[data-testid=file-viewer][data-path="notes.md"]'), 'the viewer shows the selected file');
  });
}

test('Revisions at 1280: the history lists every saved revision, and an old one opens read-only in the viewer', async t => {
  const shell = await load();
  const f = await fixture(t);
  const { createElement: h } = await import('react');
  const page = () => h(shell.Documents, { provider: f.provider });
  const view = await mount(t, shell, { width: 1280, page });
  t.after(() => view.unmount());
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
  const body = view.q('[data-testid=artifact-body]')?.textContent ?? '';
  assert.match(body, /Premier jet/, 'the old bytes are shown');
  assert.doesNotMatch(body, /Version finale/, 'not the latest bytes');
  assert.match(view.q('[data-testid=artifact-panel]')?.textContent ?? '', /Read-only/, 'marked read-only');
});

test('DocumentSheet at 390: one document opens over the app, « Toutes les fiches » is offered, and Back closes it', async t => {
  const shell = await load();
  const f = await fixture(t);
  const { createElement: h, useState } = await import('react');
  const calls = [];
  const Host = () => {
    const [path, setPath] = useState('notes.md');
    return h('div', null,
      h('button', { type: 'button', id: 'open-sheet', onClick: () => setPath('notes.md') }, 'Voir la fiche'),
      h(shell.DocumentSheet, { provider: f.provider, path, onClose: () => { calls.push('closed'); setPath(undefined); }, onShowAll: () => calls.push('all') }));
  };
  const view = await mount(t, shell, { width: 390, page: () => h(Host) });
  t.after(() => view.unmount());
  await view.settle(() => view.q('[data-testid=document-sheet] [data-testid=file-viewer][data-path="notes.md"]'));
  assert.ok(view.q('[data-testid=document-sheet] [data-testid=file-viewer][data-path="notes.md"]'), 'the sheet shows the document');
  await view.click(view.q('[data-testid=document-sheet-all]'));
  assert.deepEqual(calls, ['all', 'closed'], '« Toutes les fiches » reports to the host, and the sheet closes');
  assert.equal(view.q('[data-testid=document-sheet]'), null, 'closed');
  await view.click(view.q('#open-sheet'));
  await view.settle(() => view.q('[data-testid=document-sheet]'));
  assert.ok(view.q('[data-testid=document-sheet]'), 'opened again');
  await view.back();
  await view.settle(() => !view.q('[data-testid=document-sheet]'));
  assert.equal(view.q('[data-testid=document-sheet]'), null, 'Back closes the sheet');
  assert.deepEqual(calls, ['all', 'closed', 'closed'], 'the host learns that it closed');
});

test('useShellLayer: opening a full-screen view closes the agent layer, and Back closes the view', async t => {
  const shell = await load();
  const { createElement: h, useLayoutEffect } = await import('react');
  let agent, doc;
  const Probe = () => {
    const layer = shell.useAgentLayer();
    const docLayer = shell.useShellLayer('documents-test');
    useLayoutEffect(() => { agent = layer; doc = docLayer; });
    return null;
  };
  const view = await mount(t, shell, { width: 1280, page: () => h(Probe), agent: { controller: idleController }, improve: { controller: idleController } });
  t.after(() => view.unmount());
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
