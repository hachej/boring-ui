import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
