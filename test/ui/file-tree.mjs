import assert from 'node:assert/strict';
import test from 'node:test';
import { createFileTreeController } from '@hachej/boring-ui-kit/file-tree';
import { PublicationNotDispatchedError } from '@hachej/boring-files/publication';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

const later = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const entry = path => ({ path, kind: 'file', size: 1 });
function fixture(t, overrides = {}) {
  const store = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional', authorize: () => true });
  const identity = { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' };
  const locate = path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } });
  let publishes = 0;
  const binding = {
    identity, workspace: { providerId: 'fictional', instanceId: 'one', incarnation: 'one', viewId: 'one' }, locate,
    read: request => store.read(request, identity),
    publish: request => { publishes++; return store.publication.publish(request, identity); },
    lookup: id => store.reconciliation.lookup(id, identity),
    list: async () => ({ entries: [] }), search: async () => ({ entries: [] }), history: async () => [],
    ...overrides,
  };
  const controller = createFileTreeController({ revisionProvider: binding });
  t.after(() => { controller.dispose(); store.close(); });
  return { controller, binding, store, publishes: () => publishes };
}

test('file tree fences overlapping directory/search requests and preserves errors instead of fake emptiness', async t => {
  const first = later(), second = later(); let calls = 0;
  const { controller } = fixture(t, { list: () => (++calls === 1 ? first : second).promise });
  const old = controller.refresh(), fresh = controller.refresh();
  second.resolve({ entries: [entry('new.md')], cursor: 'next' }); await fresh;
  first.resolve({ entries: [entry('old.md')] }); await old;
  assert.equal(controller.getSnapshot().directories.get('').entries[0].path, 'new.md');
  const q1 = later(), q2 = later();
  const other = fixture(t, { search: ({ query }) => (query === 'first' ? q1 : q2).promise }).controller;
  const a = other.search('first'), b = other.search('second');
  q2.resolve({ entries: [entry('second')] }); await b;
  q1.resolve({ entries: [entry('first')] }); await a;
  assert.equal(other.getSnapshot().search.entries[0].path, 'second');
  await other.search(''); assert.deepEqual(other.getSnapshot().search.entries, []);
  const failed = fixture(t, { list: async () => { throw new Error('Access revoked'); } }).controller;
  await failed.refresh(); assert.equal(failed.getSnapshot().directories.get('').kind, 'error');
  assert.match(failed.getSnapshot().directories.get('').reason, /revoked/);
});

test('file tree paginates, opens directories and publishes copied empty/binary bytes without overwriting', async t => {
  const listed = [];
  const f = fixture(t, { list: async request => { listed.push(request); return { entries: request.cursor ? [entry('b')] : [entry('a')], ...(request.cursor ? {} : { cursor: 'next' }) }; } });
  await f.controller.refresh(); await f.controller.more();
  assert.deepEqual(f.controller.getSnapshot().directories.get('').entries.map(item => item.path), ['a', 'b']);
  await f.controller.toggle('folder'); assert.equal(f.controller.getSnapshot().expanded.has('folder'), true);
  const bytes = new Uint8Array([0, 255, 2]);
  const pending = f.controller.upload({ path: 'uploads/deep/binary.bin', bytes }); bytes[0] = 99;
  const upload = await pending;
  assert.equal(upload.state.result.kind, 'committed');
  assert.deepEqual((await f.binding.read({ target: f.binding.locate('uploads/deep/binary.bin'), revision: { kind: 'latest' } })).snapshot.bytes, new Uint8Array([0, 255, 2]));
  assert.ok(listed.some(request => request.directory === 'uploads'));
  assert.ok(f.controller.getSnapshot().expanded.has('uploads/deep'));
  const conflict = await f.controller.upload({ path: 'uploads/deep/binary.bin', bytes: new Uint8Array() });
  assert.equal(conflict.state.result.kind, 'conflict');
  const empty = await f.controller.upload({ path: 'empty.bin', bytes: new Uint8Array() });
  assert.equal(empty.state.result.kind, 'committed');
  const ref = empty.state.result.receipt.changes[0].after;
  assert.equal((await f.controller.upload({ path: 'empty.bin', bytes: new Uint8Array([1]), replace: ref })).state.result.kind, 'committed');
  assert.equal((await f.controller.upload({ path: 'empty.bin', bytes: new Uint8Array([2]), replace: ref })).state.result.kind, 'conflict');
});

test('upload lost acknowledgement reconciles its original receipt and never automatically replays', async t => {
  const f = fixture(t); const publish = f.binding.publish;
  f.binding.publish = async request => { await publish(request); throw new Error('Lost acknowledgement'); };
  const first = await f.controller.upload({ path: 'lost.bin', bytes: new Uint8Array([1]) });
  assert.equal(first.state.result.kind, 'unknown');
  const again = await f.controller.upload({ path: 'lost.bin', bytes: new Uint8Array([2]) });
  assert.equal(again.operationId, first.operationId); assert.equal(f.publishes(), 1);
  const settled = await f.controller.reconcile(first.operationId);
  assert.equal(settled.state.result.kind, 'committed'); assert.equal(f.publishes(), 1);
  assert.deepEqual((await f.binding.read({ target: f.binding.locate('lost.bin'), revision: { kind: 'latest' } })).snapshot.bytes, new Uint8Array([1]));
});

test('upload cancellation before dispatch and non-dispatch errors are known refusals', async t => {
  const f = fixture(t); const abort = new AbortController(); abort.abort();
  const cancelled = await f.controller.upload({ path: 'cancel.bin', bytes: new Uint8Array(), signal: abort.signal });
  assert.equal(cancelled.state.result.kind, 'unavailable'); assert.equal(f.publishes(), 0);
  f.binding.publish = async request => { throw new PublicationNotDispatchedError(request.operationId); };
  const refused = await f.controller.upload({ path: 'unsent.bin', bytes: new Uint8Array() });
  assert.equal(refused.state.result.kind, 'unavailable');
});

test('upload rejects mismatched receipts, retains unknown after missing lookup and fences disposed state', async t => {
  const f = fixture(t); const publish = f.binding.publish;
  f.binding.publish = async request => { const result = await publish(request); return { ...result, receipt: { ...result.receipt, scopeId: 'someone-else' } }; };
  const result = await f.controller.upload({ path: 'bad.bin', bytes: new Uint8Array([1]) });
  assert.equal(result.state.result.kind, 'unknown');
  f.binding.lookup = async () => ({ kind: 'not-found' });
  assert.equal((await f.controller.reconcile(result.operationId)).state.result.kind, 'unknown');
  const slow = later(); f.binding.list = () => slow.promise;
  const pending = f.controller.refresh(); f.controller.dispose(); const disposed = f.controller.getSnapshot();
  slow.resolve({ entries: [entry('late')] }); await pending;
  assert.equal(f.controller.getSnapshot(), disposed);
  assert.equal((await f.binding.read({ target: f.binding.locate('bad.bin'), revision: { kind: 'latest' } })).kind, 'available', 'borrowed provider still usable');
});

test('file tree renders in StrictMode, expands by keyboard and reads history without changing the open file', async t => {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act, StrictMode } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { FileTree } = await import('@hachej/boring-ui-kit/file-tree-view');
  const opened = [];
  const f = fixture(t, { list: async ({ directory }) => ({ entries: directory ? [entry('docs/note.md')] : [{ path: 'docs', kind: 'directory', size: 0 }] }) });
  const seed = await f.controller.upload({ path: 'docs/note.md', bytes: new TextEncoder().encode('Original fictional version'), mediaType: 'text/markdown' });
  const ref = seed.state.result.receipt.changes[0].after;
  await f.controller.upload({ path: 'docs/note.md', bytes: new TextEncoder().encode('New fictional version'), replace: ref, mediaType: 'text/markdown' });
  f.binding.history = async () => [{ revision: ref.revision, savedAt: 1 }];
  const element = window.document.createElement('div'); window.document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  await act(async () => root.render(createElement(StrictMode, null, createElement(FileTree, { revisionProvider: f.binding, onOpen: path => opened.push(path) }))));
  const directory = element.querySelector('[role=treeitem][data-path="docs"]');
  assert.ok(directory); assert.equal(directory.getAttribute('aria-expanded'), 'false');
  await act(async () => directory.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  assert.equal(directory.getAttribute('aria-expanded'), 'true');
  const folderButton = directory.querySelector('[data-slot=sidebar-menu-button]'); assert.ok(folderButton);
  await act(async () => folderButton.click());
  assert.equal(directory.getAttribute('aria-expanded'), 'false', 'the controlled shadcn trigger toggles exactly once');
  await act(async () => folderButton.click());
  assert.equal(directory.getAttribute('aria-expanded'), 'true');
  const file = element.querySelector('[role=treeitem][data-path="docs/note.md"]'); assert.ok(file);
  await act(async () => file.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.deepEqual(opened, ['docs/note.md']);
  await act(async () => element.querySelector('[aria-label="History of docs/note.md"]').click());
  const version = element.querySelector('section[aria-label="History of docs/note.md"] button[aria-pressed]'); assert.ok(version);
  await act(async () => version.click());
  for (let attempt = 0; attempt < 100 && !element.querySelector('[data-testid=file-history-preview]'); attempt++) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  const preview = element.querySelector('[data-testid=file-history-preview]');
  assert.ok(preview, element.textContent);
  assert.match(preview.textContent, /Original fictional version/);
  assert.doesNotMatch(preview.textContent, /New fictional version/);
  assert.equal(preview.querySelector('textarea, [contenteditable=true]'), null);
  assert.deepEqual(opened, ['docs/note.md'], 'history did not retarget an open editor');
  const loading = later();
  f.binding.list = ({ directory }) => directory === 'empty' ? loading.promise : Promise.resolve({ entries: [{ path: 'empty', kind: 'directory', size: 0 }, entry('sibling.md')] });
  await act(async () => element.querySelector('button').click());
  const empty = element.querySelector('[role=treeitem][data-path="empty"]'); assert.ok(empty);
  await act(async () => { empty.focus(); empty.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
  await act(async () => empty.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  assert.equal(window.document.activeElement, empty, 'Right stays on a loading folder');
  await act(async () => { loading.resolve({ entries: [] }); await loading.promise; });
  await act(async () => empty.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  assert.equal(window.document.activeElement, empty, 'Right stays on an empty folder');

});

test('throwing file-tree subscribers cannot strand a publication before dispatch', async t => {
  const f = fixture(t); let notified = 0;
  f.controller.subscribe(() => { throw new Error('Broken presentation'); });
  f.controller.subscribe(() => { notified++; });
  const result = await f.controller.upload({ path: 'subscriber.txt', bytes: new Uint8Array([1]) });
  assert.equal(result.state.result.kind, 'committed'); assert.equal(f.publishes(), 1); assert.ok(notified >= 2);
  assert.equal(f.controller.getSnapshot().uploads[0].state.result.kind, 'committed');
});

test('revision attachments preserve image bytes and successful files beside a refused upload', async t => {
  const { build } = await import('esbuild'); const { mkdirSync } = await import('node:fs');
  const out = new URL('../../.cache/file-tree-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('revision-files.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-app/revision-files.ts', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', packages: 'external' });
  const { uploadRevisionAttachments } = await import(output.href);
  const f = fixture(t); const signal = new AbortController().signal;
  await f.controller.upload({ path: 'uploads/existing.txt', bytes: new Uint8Array([5]) });
  const image = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
  const duplicate = new File(['replacement'], 'existing.txt', { type: 'text/plain' });
  const results = await uploadRevisionAttachments(f.controller, [image, duplicate], signal);
  assert.equal(results.length, 1); assert.equal(results[0].path, 'uploads/image.png');
  assert.equal(results[0].image.mimeType, 'image/png'); assert.deepEqual(Buffer.from(results[0].image.data, 'base64'), Buffer.from([137, 80, 78, 71]));
  assert.equal(f.controller.getSnapshot().uploads.at(-1).state.result.kind, 'conflict');
  const unreadable = new File(['gone'], 'unreadable.txt');
  Object.defineProperty(unreadable, 'arrayBuffer', { value: async () => { throw new Error('Local file is unavailable'); } });
  const failures = [];
  const partial = await uploadRevisionAttachments(f.controller, [new File(['ok'], 'another.txt'), unreadable], signal, (name, reason) => failures.push({ name, reason }));
  assert.equal(partial.length, 1); assert.equal(partial[0].path, 'uploads/another.txt');
  assert.deepEqual(failures, [{ name: 'unreadable.txt', reason: 'Local file is unavailable' }]);
});
