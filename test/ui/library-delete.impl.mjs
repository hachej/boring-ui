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
import { connectRevisionProvider } from '@hachej/boring-files/revision';

// Delete in the Library of AgentWorkspace, through the public pi-app entry, over a real sqlite workspace and the revision handler:
// a revision provider's Library deletes after a confirmation and refuses a stale file; a Library over `resources` alone is read-only.
test('AgentWorkspace Library: Delete follows the person\'s right to write', { timeout: 120000 }, async t => {
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
  // The default kinds live in their own item; a revision without it has them built into pi-app (`defaultKinds` is then undefined).
  const kinds = existsSync(`${registry}pi-app-kinds/pi-app-kinds.ts`);
  await build({ stdin: { contents: `export * from './pi-app/agent-workspace.tsx';\n${slot ? "export { ScreenHeaderSlotContext } from './utils/screen-header-slot.ts';\n" : ''}${kinds ? "export { defaultKinds } from './pi-app-kinds/pi-app-kinds.ts';\n" : ''}`, resolveDir: registry, loader: 'ts' },
    outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', tsconfig: new URL('../../tsconfig.json', import.meta.url).pathname, loader: { '.css': 'empty' },
    plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { AgentWorkspace, ScreenHeaderSlotContext, defaultKinds } = await import(output.href);
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


  const seeded = await provider.publication.publish({ operationId: 'seed-stale', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: { resource: { providerId: 'workspace', path: 'stale.md' }, view: { kind: 'published' } }, expected: { kind: 'absent' }, bytes: new TextEncoder().encode('first'), mediaType: 'text/markdown' }] }, access);
  const text = async path => { const read = await provider.read({ target: { resource: { providerId: 'workspace', path }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, access); return read.kind === 'available' ? new TextDecoder().decode(read.snapshot.bytes) : 'missing'; };
  const revisionProvider = await connectRevisionProvider({ endpoint: new URL('https://fictional.invalid/files'), fetch: request => handler(request) });
  const openLibrary = async extra => {
    await render({ key: JSON.stringify(Object.keys(extra)) + Math.random(), ...extra });
    await settle(() => bar('library'));
    await act(async () => bar('library').click());
    await settle(() => q('[data-testid=workspace-library] [role=treeitem][data-path="notes.md"]'));
  };
  const row = path => q(`[data-testid=workspace-library] [role=treeitem][data-path="${path}"]`);
  const menu = async path => {
    await act(async () => row(path).querySelector('[data-file-more]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    await settle(() => document.querySelector('[role=menuitem]'));
    return [...document.querySelectorAll('[role=menuitem]')];
  };
  const close = items => act(async () => items[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  const dialog = () => document.querySelector('[data-boring=file-tree-dialog]');

  await t.test('a Library over resources alone is read-only: no Rename, Move or Delete (a client that could write is not a right to)', async () => {
    measured = 1440;
    await openLibrary({ resources });
    const items = await menu('notes.md');
    assert.deepEqual(items.map(item => item.dataset.action).filter(id => ['rename', 'move', 'delete'].includes(id)), []);
    assert.ok(items.some(item => item.dataset.action === 'open'));
    await close(items);
    assert.equal(await text('notes.md'), '# Fictional notes\n');
  });

  await t.test('a revision provider\'s Library offers Delete, asks first, then the file is gone', async () => {
    measured = 1440;
    await openLibrary({ revisionProvider });
    const items = await menu('flow.diagram.json');
    const remove = items.find(item => item.dataset.action === 'delete');
    assert.ok(remove?.textContent.includes('Delete'), 'Delete is in the menu');
    await act(async () => remove.click());
    await settle(dialog);
    assert.match(dialog().textContent, /Delete flow\.diagram\.json\?/);
    await act(async () => dialog().querySelector('[data-confirm=cancel]').click());
    await settle(() => !dialog());
    assert.ok(row('flow.diagram.json'), 'cancelling keeps the file');
    await act(async () => (await menu('flow.diagram.json')).find(item => item.dataset.action === 'delete').click());
    await settle(dialog);
    await act(async () => dialog().querySelector('[data-confirm=delete]').click());
    await settle(() => !row('flow.diagram.json'));
    assert.equal(row('flow.diagram.json'), null, 'the row is gone');
    assert.equal(await text('flow.diagram.json'), 'missing', 'the file is gone from the workspace');
  });

  await t.test('a file that changed while its Delete dialog was open is refused, the error shows and the file stays', async () => {
    measured = 1440;
    await openLibrary({ revisionProvider });
    // Asking learns the revision the person is looking at; an edit while the dialog is open makes the confirmation stale.
    await act(async () => (await menu('stale.md')).find(item => item.dataset.action === 'delete').click());
    await settle(dialog);
    await act(async () => new Promise(resolve => setTimeout(resolve, 100)));
    const changed = await provider.publication.publish({ operationId: 'change-stale', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: seeded.receipt.changes[0].after, bytes: new TextEncoder().encode('second'), mediaType: 'text/markdown' }] }, access);
    assert.equal(changed.kind, 'committed', JSON.stringify(changed));
    await act(async () => dialog().querySelector('[data-confirm=delete]').click());
    await settle(() => row('stale.md')?.querySelector('[data-mutation-error]'));
    assert.ok(row('stale.md')?.querySelector('[data-mutation-error]'), 'the refusal shows on its row');
    assert.equal(await text('stale.md'), 'second', 'the file is kept');
  });

  await t.test('a host that narrows the capabilities to read gets no Delete', async () => {
    measured = 1440;
    await openLibrary({ revisionProvider, fileTree: { capabilities: { effective: ['read'] } } });
    const items = await menu('notes.md');
    assert.equal(items.some(item => item.dataset.action === 'delete'), false);
    await close(items);
  });

  await t.test('at 390 px the more button and the Delete item are 44 px touch targets', async () => {
    measured = 390;
    await openLibrary({ revisionProvider });
    const more = row('notes.md').querySelector('[data-file-more]');
    assert.match(more.className, /max-sm:min-h-11/); assert.match(more.className, /max-sm:min-w-11/);
    const remove = (await menu('notes.md')).find(item => item.dataset.action === 'delete');
    assert.match(remove.className, /max-sm:min-h-11/);
  });
});
