import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('Library is a right-side column by default: toggled from the viewer bar and the left pane, a sheet on a phone, center and pane unchanged', async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'confirm', 'sessionStorage', 'ResizeObserver'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  let measuredWidth = 1400;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: measuredWidth, height: 800, left: 0, right: measuredWidth, top: 0, bottom: 800, x: 0, y: 0 });
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/file-tree-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('library-side.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-app/agent-workspace.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', plugins: [{ name: 'bundle-file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { AgentWorkspace } = await import(output.href);
  const element = window.document.createElement('div'); window.document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });

  const locate = path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } });
  const identity = { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' };
  const store = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional', authorize: () => true }); t.after(() => store.close());
  const binding = { identity, workspace: { providerId: 'fictional', instanceId: 'one', incarnation: 'one', viewId: 'one' }, locate,
    read: request => store.read(request, identity), publish: request => store.publication.publish(request, identity), lookup: id => store.reconciliation.lookup(id, identity),
    list: async () => ({ entries: ['first.html', 'second.html'].map(path => ({ path, kind: 'file', size: 20 })) }), search: async () => ({ entries: [] }), history: async () => [],
  };
  for (const path of ['first.html', 'second.html']) await binding.publish({ operationId: path, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: locate(path), expected: { kind: 'absent' }, bytes: new TextEncoder().encode('<p>Original</p>'), mediaType: 'text/html' }] });
  const conversations = { items: [{ id: 'one', title: 'Fictional chat' }], activeId: 'one', onSelect() {}, onNew() {} };
  const render = extra => act(async () => root.render(createElement(AgentWorkspace, { controller: undefined, conversationId: undefined, revisionProvider: binding, conversations, ...extra })));
  const q = selector => element.querySelector(selector);
  const settle = async ready => { for (let n = 0; n < 100 && !ready(); n++) await act(async () => new Promise(r => setTimeout(r, 10))); };
  const column = () => q('[data-testid=workspace-library-side]');
  const dock = () => q('[data-dock=library]');
  const file = path => q(`[data-testid=workspace-library-side] [role=treeitem][data-path="${path}"] button`);

  // Default placement: a closed right dock, a Library button in the left pane, no center Library link behavior.
  await render({ key: 'side', storageKey: 'side-proof' });
  assert.ok(dock(), 'the default placement is the side column');
  assert.equal(dock().dataset.side, 'right'); assert.equal(dock().dataset.placement, 'closed');
  const paneButton = () => q('[data-testid=workspace-library]');
  assert.equal(paneButton().getAttribute('aria-pressed'), 'false');
  assert.equal(q('[data-testid=workspace-library-view]'), null, 'no center Library');

  // No file open: the column opens alone at the right edge; the chat stays.
  await act(async () => paneButton().click());
  assert.equal(dock().dataset.placement, 'docked'); assert.equal(paneButton().getAttribute('aria-pressed'), 'true');
  assert.equal(q('[data-testid=viewer-panel]'), null, 'no viewer yet');
  assert.equal(q('[data-testid=workspace-chat-surface]').hidden, false);
  await settle(() => file('first.html'));
  // Picking a file opens the viewer to the LEFT of the column and keeps the column open.
  await act(async () => file('first.html').click());
  assert.equal(q('[data-testid=file-viewer]').dataset.path, 'first.html');
  assert.equal(dock().dataset.placement, 'docked', 'the column stays open');
  const viewer = q('[data-testid=workspace-panel]');
  assert.ok(viewer.compareDocumentPosition(dock()) & window.Node.DOCUMENT_POSITION_FOLLOWING, 'the viewer comes before the Library column');

  // The viewer bar's button toggles the same state.
  const barButton = () => q('[data-testid=viewer-library]');
  assert.ok(barButton(), 'the viewer top bar has a Library button');
  assert.equal(barButton().getAttribute('aria-pressed'), 'true'); assert.equal(barButton().getAttribute('aria-label'), 'Library');
  await act(async () => barButton().click());
  assert.equal(dock().dataset.placement, 'closed'); assert.equal(paneButton().getAttribute('aria-pressed'), 'false');
  assert.equal(q('[data-testid=file-viewer]').dataset.path, 'first.html', 'toggling the Library leaves the viewer alone');
  await act(async () => barButton().click());
  assert.equal(dock().dataset.placement, 'docked'); assert.equal(paneButton().getAttribute('aria-pressed'), 'true');
  await act(async () => q('[data-testid=workspace-library-close]').click());
  assert.equal(dock().dataset.placement, 'closed');

  // Phone: a full-screen sheet; choosing a file closes it and shows the viewer.
  measuredWidth = 390;
  await render({ key: 'phone', storageKey: 'phone-proof' });
  assert.equal(dock().dataset.placement, 'closed');
  await act(async () => q('[data-testid=sessions-toggle]').click());
  await act(async () => paneButton().click());
  assert.equal(dock().dataset.placement, 'sheet', 'the Library is a sheet on a phone');
  assert.equal(q('[data-testid=conversations]'), null, 'opening the Library closes the drawer');
  await settle(() => file('second.html'));
  await act(async () => file('second.html').click());
  assert.equal(dock().dataset.placement, 'closed', 'choosing a file closes the sheet');
  assert.equal(q('[data-testid=file-viewer]').dataset.path, 'second.html');

  // 'center' and 'pane' keep their layouts.
  measuredWidth = 1400;
  await render({ key: 'center', storageKey: 'center-proof', libraryPlacement: 'center' });
  assert.equal(dock(), null); await act(async () => paneButton().click());
  assert.equal(q('[data-testid=workspace-library-view]').parentElement.hidden, false);
  await render({ key: 'pane', storageKey: 'pane-proof', libraryPlacement: 'pane' });
  assert.equal(dock(), null); assert.ok(q('[data-testid=sessions-tab-library]'));
});
