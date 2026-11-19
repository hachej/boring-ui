import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';

test('onLibraryOpenChange reports each change of the Library open state once', async t => {
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
  const output = new URL('library-open-change.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-app/agent-workspace.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', plugins: [{ name: 'bundle-file-tree-css', setup(builder) { if (process.env.AGENT_PAGE_BEFORE) builder.onLoad({ filter: /registry\/pi-app\/agent-workspace\.tsx$/ }, args => ({ contents: readFileSync(process.env.AGENT_PAGE_BEFORE, 'utf8'), loader: 'tsx', resolveDir: new URL('../../registry/pi-app/', import.meta.url).pathname })); builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { AgentWorkspace, ConversationList } = await import(output.href);
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
  const render = extra => act(async () => root.render(createElement(AgentWorkspace, { controller: undefined, conversationId: undefined, revisionProvider: binding, conversations, libraryPlacement: 'side', ...extra })));
  const q = selector => window.document.querySelector(selector);
  const settle = async ready => { for (let n = 0; n < 100 && !ready(); n++) await act(async () => new Promise(r => setTimeout(r, 10))); };
  const column = () => q('[data-testid=workspace-library-side]');
  const dock = () => q('[data-dock=library]');
  const file = path => q(`[data-testid=workspace-library-side] [role=treeitem][data-path="${path}"] button`);

  const calls = [];
  const onLibraryOpenChange = open => calls.push(open);
  const paneButton = () => q('[data-testid=workspace-library]');
  const take = () => calls.splice(0);

  // Side column: not on mount; true then false from the buttons; once per change.
  await render({ key: 'side', storageKey: 'olc-side', onLibraryOpenChange });
  assert.deepEqual(take(), [], 'not called on mount');
  await act(async () => paneButton().click()); assert.deepEqual(take(), [true]);
  await settle(() => file('first.html'));
  await act(async () => file('first.html').click());
  assert.deepEqual(take(), [], 'opening a file from the open column changes nothing');
  await act(async () => q('[data-testid=viewer-library]').click()); assert.deepEqual(take(), [false]);
  await act(async () => q('[data-testid=viewer-library]').click()); assert.deepEqual(take(), [true]);
  await act(async () => q('[data-testid=workspace-library-side] button[aria-label="Close Library"]').click()); assert.deepEqual(take(), [false]);
  await render({ key: 'side', storageKey: 'olc-side', onLibraryOpenChange });
  assert.deepEqual(take(), [], 're-rendering with the same state does not call');

  // Panel (default): opening it is true; choosing a file (the viewer replaces the Library) is false.
  await render({ key: 'panel', storageKey: 'olc-panel', libraryPlacement: 'panel', onLibraryOpenChange });
  assert.deepEqual(take(), []);
  await act(async () => paneButton().click()); assert.deepEqual(take(), [true]);
  await settle(() => file('second.html'));
  await act(async () => file('second.html').click());
  assert.deepEqual(take(), [false], 'a file opened from the Library closes it');
  assert.equal(q('[data-testid=file-viewer]').dataset.path, 'second.html');
  await act(async () => paneButton().click()); assert.deepEqual(take(), [true]);
  await act(async () => paneButton().click()); assert.deepEqual(take(), [false]);

  // Center.
  await render({ key: 'center', storageKey: 'olc-center', libraryPlacement: 'center', onLibraryOpenChange });
  assert.deepEqual(take(), []);
  await act(async () => paneButton().click()); assert.deepEqual(take(), [true]);
  assert.equal(q('[data-testid=workspace-library-view]').parentElement.hidden, false);

  // Phone: the side placement is a sheet, the panel placement a drawer.
  measuredWidth = 390;
  await render({ key: 'phone-side', storageKey: 'olc-phone-side', onLibraryOpenChange });
  assert.deepEqual(take(), []);
  await act(async () => q('[data-testid=sessions-toggle]').click());
  await act(async () => paneButton().click()); assert.deepEqual(take(), [true]);
  assert.equal(dock().dataset.placement, 'sheet');
  await settle(() => file('second.html'));
  await act(async () => file('second.html').click()); assert.deepEqual(take(), [false], 'choosing a file closes the sheet');
  await render({ key: 'phone-panel', storageKey: 'olc-phone-panel', libraryPlacement: 'panel', onLibraryOpenChange });
  assert.deepEqual(take(), []);
  await act(async () => q('[data-testid=sessions-toggle]').click());
  await act(async () => paneButton().click()); assert.deepEqual(take(), [true]);
  assert.ok(q('[data-testid=workspace-library-side]'), 'the drawer shows the Library');
  await act(async () => q('[data-testid=workspace-library-side] button[aria-label="Close Library"]').click()); assert.deepEqual(take(), [false]);

  // A prop change that removes the Library reports it; the prop absent changes nothing.
  measuredWidth = 1400;
  await render({ key: 'prop', storageKey: 'olc-prop', onLibraryOpenChange });
  await act(async () => paneButton().click()); assert.deepEqual(take(), [true]);
  await render({ key: 'prop', storageKey: 'olc-prop', onLibraryOpenChange, revisionProvider: undefined });
  assert.deepEqual(take(), [false], 'the Library going away through props is reported');
  await render({ key: 'absent', storageKey: 'olc-absent' });
  await act(async () => paneButton().click());
  assert.equal(dock().dataset.placement, 'docked', 'works without the prop');
  assert.deepEqual(take(), []);
});
