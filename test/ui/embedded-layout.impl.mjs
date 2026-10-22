import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createRevisionHandler } from '@hachej/boring-files/revision-handler';

// AgentWorkspace `layout="embedded"` and the read-only Library of `resources` (no revision provider), through the public pi-app entry:
// no sessions column at 1440 or 390, History, Library and New in one bar, the Library listing the resources endpoint's files and opening
// a pick in the artifact panel, and the bar's controls inside a host header slot (the app shell's) instead of a second row.
test('AgentWorkspace embedded: one bar, no left column, and a Library over resources alone', { timeout: 120000 }, async t => {
  const access = { principalId: 'fictional-person', scopeId: 'fictional-scope', initiatorId: 'fictional-person' };
  const directory = mkdtempSync(join(tmpdir(), 'boring-embedded-'));
  const db = openNodeConnection(join(directory, 'files.sqlite'));
  const fs = openSqliteFileSystem({ connection: db, workspace: 'fictional', cwd: '/workspace' });
  const provider = createWorkspaceProvider({ fs, journal: createWorkspaceJournal(db), identity: { providerId: 'workspace', instanceId: 'fictional', incarnation: fs.incarnation, viewId: 'published' } });
  const handler = createRevisionHandler({ resolve: async () => ({ provider, access, release() {} }) });
  await provider.publication.publish({ operationId: 'seed-notes', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: { resource: { providerId: 'workspace', path: 'notes.md' }, view: { kind: 'published' } }, expected: { kind: 'absent' }, bytes: new TextEncoder().encode('# Fictional notes\n'), mediaType: 'text/markdown' }] }, access);

  // A maquette and a diagram beside the notes: the Library opens them in their viewers, not as raw JSON.
  for (const name of ['booking.maquette.json', 'booking.diagram.json']) {
    const path = name.replace('booking', 'flow');
    await provider.publication.publish({ operationId: `seed-${path}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, expected: { kind: 'absent' },
      bytes: readFileSync(new URL(`../fixtures/${name.split('.')[1]}/${name}`, import.meta.url)), mediaType: 'application/json' }] }, access);
  }

  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'sessionStorage', 'localStorage', 'matchMedia', 'IS_REACT_ACT_ENVIRONMENT', 'confirm'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  let measured = 1440;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: measured, height: 800, left: 0, right: measured, top: 0, bottom: 800, x: 0, y: 0 });
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/embedded-layout/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('embedded-layout.mjs', out);
  const registry = new URL('../../registry/', import.meta.url).pathname;
  // One bundle, so the page and the slot context share one module instance (as an installed app does).
  const slot = existsSync(`${registry}utils/screen-header-slot.ts`);
  await build({ stdin: { contents: `export * from './pi-app/agent-workspace.tsx';\n${slot ? "export { ScreenHeaderSlotContext } from './utils/screen-header-slot.ts';\n" : ''}`, resolveDir: registry, loader: 'ts' },
    outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', tsconfig: new URL('../../tsconfig.json', import.meta.url).pathname, loader: { '.css': 'empty' },
    plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { AgentWorkspace, ScreenHeaderSlotContext } = await import(output.href);
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    provider.close?.(); db.close(); rmSync(directory, { force: true, recursive: true });
  });

  const q = selector => document.querySelector(selector);
  const settle = async ready => { for (let n = 0; n < 200 && !ready(); n++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); };
  const conversations = { items: [{ id: 'one', title: 'Fictional plan' }, { id: 'two', title: 'Another fictional chat' }], activeId: 'one', onSelect() {}, onNew() {} };
  const resources = { endpoint: 'https://fictional.invalid/files', fetch: request => handler(request), identity: access };
  const render = (extra, wrap = node => node) => act(async () => root.render(wrap(createElement(AgentWorkspace, { controller: undefined, conversationId: 'one', conversations, resources, layout: 'embedded', storageKey: 'embedded-proof', ...extra }))));
  const bar = id => q(`[data-testid=workspace-bar-${id}]`);
  const noColumn = where => {
    assert.equal(q('[data-testid=conversations]'), null, `${where}: no sessions pane`);
    assert.equal(q('[data-testid=sessions-toggle]'), null, `${where}: no sessions toggle`);
    assert.equal(q('[data-boring=agent-workspace]').dataset.sessions, undefined, `${where}: no sessions state`);
  };

  await t.test('no sessions column at 1440 or 390; History, Library and New sit in one bar with the conversation title', async () => {
    for (const width of [1440, 390]) {
      measured = width;
      await render({ key: `width-${width}` });
      await settle(() => bar('library'));
      noColumn(String(width));
      assert.equal(q('[data-testid=workspace-bar-title]')?.textContent, 'Fictional plan', `${width}: the title`);
      for (const id of ['history', 'library', 'new']) {
        assert.ok(bar(id), `${width}: ${id} is reachable`);
        assert.ok(bar(id).closest('[data-testid=workspace-bar]'), `${width}: ${id} is in the bar`);
        assert.ok(bar(id).getAttribute('aria-label'), `${width}: ${id} has an accessible name`);
      }
      assert.equal(bar('history').classList.contains('size-11'), width === 390, `${width}: 44px touch targets on a phone only`);
    }
  });

  await t.test('History opens the conversation list; New starts a conversation', async () => {
    measured = 1440;
    let created = 0;
    await render({ key: 'history', conversations: { ...conversations, onNew() { created++; } } });
    await act(async () => bar('history').click());
    await settle(() => q('[data-testid=workspace-history] [data-testid=conversation-row]'));
    assert.equal(document.querySelectorAll('[data-testid=workspace-history] [data-testid=conversation-row]').length, 2);
    await act(async () => bar('new').click());
    assert.equal(created, 1);
  });

  await t.test('resources alone: the read-only Library lists the files and a pick opens the artifact panel', async () => {
    measured = 1440;
    await render({ key: 'library' });
    await settle(() => bar('library'));
    await act(async () => bar('library').click());
    const row = () => q('[data-testid=workspace-library] [role=treeitem][data-path="notes.md"] button');
    await settle(row);
    assert.ok(row(), 'the Library lists the resources endpoint\'s file');
    assert.equal(q('[data-testid=workspace-library] [data-file-upload]'), null, 'read-only: no Upload');
    await act(async () => row().click());
    await settle(() => q('[data-testid=file-viewer]'));
    assert.equal(q('[data-testid=file-viewer]')?.dataset.path, 'notes.md', 'the pick opens in the artifact panel');
    assert.equal(q('[data-testid=workspace-library]'), null, 'the Library closes on a pick');
  });

  const pickFromLibrary = async path => {
    await act(async () => bar('library').click());
    const row = () => q(`[data-testid=workspace-library] [role=treeitem][data-path="${path}"] button`);
    await settle(row);
    assert.ok(row(), `the Library lists ${path}`);
    await act(async () => row().click());
    await settle(() => q('[data-testid=file-viewer]'));
  };
  for (const [path, viewer] of [['flow.maquette.json', 'maquette-walk'], ['flow.diagram.json', 'diagram']]) {
    await t.test(`a ${path.split('.')[1]} opened from the Library draws its viewer, not raw JSON`, async () => {
      measured = 1440;
      await render({ key: `kind-${viewer}` });
      await settle(() => bar('library'));
      await pickFromLibrary(path);
      await settle(() => q(`[data-testid=${viewer}]`));
      assert.equal(q('[data-testid=file-viewer]').dataset.path, path);
      assert.ok(q(`[data-testid=${viewer}]`), `${viewer} is drawn`);
      assert.equal(q('[data-testid=file-preview]'), null, 'no raw text preview');
    });
  }

  await t.test('an app kind for *.maquette.json wins over the built-in one in the Library too', async () => {
    measured = 1440;
    const artifactKinds = [{ match: target => target.resource.path.endsWith('.maquette.json'), label: 'Fictional kind', renderer: ({ text }) => createElement('div', { 'data-testid': 'app-kind' }, `app:${text.length > 0}`) }];
    await render({ key: 'kind-app', artifactKinds });
    await settle(() => bar('library'));
    await pickFromLibrary('flow.maquette.json');
    await settle(() => q('[data-testid=app-kind]'));
    assert.equal(q('[data-testid=app-kind]')?.textContent, 'app:true');
    assert.equal(q('[data-testid=maquette-walk]'), null, 'the built-in maquette viewer is not used');
    assert.equal(q('[data-testid=artifact-panel-type]')?.textContent, 'Fictional kind');
  });

  await t.test('a fixed title stays when the conversation has one; the conversation title follows it, muted, and a phone leaves it to History', async () => {
    for (const width of [1440, 390]) {
      measured = width;
      await render({ key: `title-${width}`, title: 'Fictional app' });
      await settle(() => bar('library'));
      assert.equal(q('[data-testid=workspace-bar-title]')?.textContent, 'Fictional app', `${width}: the app title`);
      const conversation = q('[data-testid=workspace-bar-conversation]');
      assert.equal(conversation?.textContent, 'Fictional plan', `${width}: the conversation title follows`);
      assert.ok(conversation.classList.contains('text-muted-foreground'), `${width}: muted`);
      assert.equal(conversation.classList.contains('max-sm:hidden'), true, `${width}: hidden on a phone`);
    }
    measured = 1440;
    await render({ key: 'title-switch', title: 'Fictional app', conversationId: 'two' });
    assert.equal(q('[data-testid=workspace-bar-title]')?.textContent, 'Fictional app', 'switching conversation keeps the app title');
    assert.equal(q('[data-testid=workspace-bar-conversation]')?.textContent, 'Another fictional chat');
    await render({ key: 'title-untitled', title: 'Fictional app', conversations: { ...conversations, items: [{ id: 'one', title: '' }] } });
    assert.equal(q('[data-testid=workspace-bar-conversation]'), null, 'no conversation title, no second element');
  });

  await t.test('without the title prop the conversation title is the bar title, as before', async () => {
    measured = 1440;
    await render({ key: 'title-none' });
    await settle(() => bar('library'));
    assert.equal(q('[data-testid=workspace-bar-title]')?.textContent, 'Fictional plan');
    assert.equal(q('[data-testid=workspace-bar-conversation]'), null);
  });

  await t.test('barPanels: the host\'s own panels sit in the bar after Library and before New, open a popover (a sheet on a phone) and close from inside', async () => {
    for (const width of [1440, 390]) {
      measured = width;
      const picked = [];
      const Icon = props => createElement('svg', props);
      const barPanels = [{ id: 'comments', label: 'Fictional comments', icon: Icon,
        content: close => createElement('button', { 'data-testid': 'fictional-comment', onClick: () => { picked.push('one'); close(); } }, 'A fictional note') }];
      await render({ key: `panels-${width}`, barPanels });
      await settle(() => bar('comments'));
      const order = [...q('[data-testid=workspace-bar-tools]').querySelectorAll('[data-testid^=workspace-bar-]')].map(node => node.dataset.testid.replace('workspace-bar-', ''));
      assert.deepEqual(order.filter(id => ['history', 'library', 'comments', 'new'].includes(id)), ['history', 'library', 'comments', 'new'], `${width}: after Library, before New`);
      assert.equal(bar('comments').getAttribute('aria-label'), 'Fictional comments');
      await act(async () => bar('comments').click());
      await settle(() => q('[data-testid=workspace-comments] [data-testid=fictional-comment]'));
      assert.ok(q('[data-testid=workspace-comments] [data-testid=fictional-comment]'), `${width}: the panel shows the host content`);
      await act(async () => q('[data-testid=fictional-comment]').click());
      await settle(() => !q('[data-testid=fictional-comment]'));
      assert.deepEqual(picked, ['one']);
      assert.equal(q('[data-testid=fictional-comment]'), null, `${width}: close() closes the panel`);
    }
  });

  await t.test('panelWidth: the side panel opens at the host\'s width (a fraction of the workspace or pixels) until the person drags', async () => {
    measured = 1440;
    const opened = async (extra, key) => {
      sessionStorage.clear();
      await render({ key, ...extra });
      await settle(() => bar('library'));
      await pickFromLibrary('notes.md');
      await settle(() => q('[data-testid=workspace-divider]'));
      return Number(q('[data-testid=workspace-divider]').getAttribute('aria-valuenow'));
    };
    assert.equal(await opened({}, 'width-default'), 1440 - 420, 'without it: all but 420px of chat');
    assert.equal(await opened({ panelWidth: 0.55 }, 'width-fraction'), Math.round(1440 * 0.55), 'a fraction of the workspace');
    assert.equal(await opened({ panelWidth: 600 }, 'width-pixels'), 600, 'pixels');
  });

  await t.test('inside a host header slot (the app shell\'s), the bar\'s controls move there: one row', { skip: !slot && 'no header slot on this revision' }, async () => {
    measured = 1440;
    const header = document.createElement('div'); header.dataset.testid = 'host-header'; document.body.append(header);
    await render({ key: 'slot' }, node => createElement(ScreenHeaderSlotContext.Provider, { value: header }, node));
    await settle(() => header.querySelector('[data-testid=workspace-bar-library]'));
    for (const id of ['history', 'library', 'new']) assert.ok(header.querySelector(`[data-testid=workspace-bar-${id}]`), `${id} is in the host header`);
    assert.equal(q('[data-testid=workspace-bar]'), null, 'no second bar row');
    noColumn('slot');
  });
});
