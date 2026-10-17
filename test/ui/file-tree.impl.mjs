import assert from 'node:assert/strict';
import test from 'node:test';
import { createFileTreeController } from '@hachej/boring-ui-kit/file-tree';
import { PublicationNotDispatchedError } from '@hachej/boring-files/publication';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';

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
  const settled = await f.controller.retry(first.operationId);
  assert.equal(settled.state.result.kind, 'committed'); assert.equal(f.publishes(), 1);
  assert.deepEqual((await f.binding.read({ target: f.binding.locate('lost.bin'), revision: { kind: 'latest' } })).snapshot.bytes, new Uint8Array([1]));
});

test('retry keeps captured bytes and the original revision condition', async t => {
  const f = fixture(t), publish = f.binding.publish;
  f.binding.publish = async () => ({ kind: 'unavailable', reason: 'Fictional temporary refusal' });
  const bytes = new Uint8Array([1, 2]);
  const refused = await f.controller.upload({ path: 'retry.bin', bytes }); bytes[0] = 99;
  f.binding.publish = publish;
  const saved = await f.controller.retry(refused.operationId);
  assert.equal(saved.state.result.kind, 'committed');
  const read = () => f.binding.read({ target: f.binding.locate('retry.bin'), revision: { kind: 'latest' } });
  assert.deepEqual((await read()).snapshot.bytes, new Uint8Array([1, 2]));
  const base = saved.state.result.receipt.changes[0].after;
  f.binding.publish = async () => ({ kind: 'unavailable', reason: 'Fictional replacement refusal' });
  const replacement = await f.controller.upload({ path: 'retry.bin', bytes: new Uint8Array([3]), replace: base });
  f.binding.publish = publish;
  await f.binding.publish({ operationId: 'fictional-intervening-write', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: base, bytes: new Uint8Array([4]), mediaType: 'application/octet-stream' }] });
  assert.equal((await f.controller.retry(replacement.operationId)).state.result.kind, 'conflict');
  assert.deepEqual((await read()).snapshot.bytes, new Uint8Array([4]), 'Retry never replaces an intervening edit');
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
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Text', 'CustomEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act, StrictMode } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { FileTree } = await import('@hachej/boring-ui-kit/file-tree-view');
  const { build } = await import('esbuild'); const { mkdirSync } = await import('node:fs');
  const out = new URL('../../.cache/file-tree-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('presentation.mjs', out);
  await build({ entryPoints: [new URL('../../registry/file-tree/file-tree.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external',
    plugins: [{ name: 'dom-without-css', setup(builder) { builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'styles', namespace: 'empty-style' })); builder.onLoad({ filter: /.*/, namespace: 'empty-style' }, () => ({ contents: '', loader: 'js' })); } }] });
  const { fileTreeComponents } = await import(output.href);
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
  await act(async () => root.render(createElement(StrictMode, null, createElement(FileTree, { components: fileTreeComponents, variant: 'list', revisionProvider: f.binding, onOpen: path => opened.push(path) }))));
  const directory = element.querySelector('[role=treeitem][data-path="docs"]');
  assert.ok(directory); assert.equal(directory.getAttribute('aria-expanded'), 'false');
  await t.test('folder rows do not repeat the generic kind as metadata', () => {
    assert.equal(Boolean(directory.querySelector('[data-file-meta]')), false);
  });
  await act(async () => directory.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  assert.equal(directory.getAttribute('aria-expanded'), 'true');
  await t.test('complete provider listings show the folder child count', () => {
    assert.equal(directory.querySelector(':scope > div [data-file-meta]')?.textContent, '1 item');
  });
  const folderButton = directory.querySelector('[data-slot=sidebar-menu-button]'); assert.ok(folderButton);
  await act(async () => folderButton.click());
  assert.equal(directory.getAttribute('aria-expanded'), 'false', 'the controlled shadcn trigger toggles exactly once');
  await act(async () => folderButton.click());
  assert.equal(directory.getAttribute('aria-expanded'), 'true');
  const file = element.querySelector('[role=treeitem][data-path="docs/note.md"]'); assert.ok(file);
  await act(async () => file.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  assert.deepEqual(opened, ['docs/note.md']);
  assert.match(file.querySelector('[data-file-meta]')?.textContent ?? '', /Markdown · 1 B/);
  assert.equal(file.querySelector('[aria-label="History of docs/note.md"]'), null, 'history is not an always-visible row button');
  await act(async () => file.querySelector('[aria-label="Actions for docs/note.md"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  const historyAction = window.document.querySelector('[role=menuitem][data-action=history]');
  assert.equal(historyAction?.textContent, 'Version history');
  await act(async () => historyAction.click());
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
  const read = f.binding.read;
  f.binding.read = async () => ({ kind: 'unavailable', reason: 'Fictional download refusal' });
  const download = async () => {
    await act(async () => file.querySelector('[data-file-more]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
    await act(async () => window.document.querySelector('[data-action=download]').click());
  };
  await download();
  assert.match(element.querySelector('p[role=alert]')?.textContent ?? '', /could not be downloaded/);
  const nextDownload = later(); f.binding.read = () => nextDownload.promise;
  await download();
  await t.test('a new download clears the previous error before its read settles', () => {
    assert.equal(Boolean(element.querySelector('p[role=alert]')), false);
  });
  await act(async () => nextDownload.resolve({ kind: 'unavailable', reason: 'Fictional second refusal' }));
  f.binding.read = read;
  const loading = later();
  f.binding.list = ({ directory }) => directory === 'empty' ? loading.promise : Promise.resolve({ entries: [{ path: 'empty', kind: 'directory', size: 0 }, entry('sibling.md')] });
  await act(async () => element.querySelector('[aria-label="Refresh"]').click());
  const empty = element.querySelector('[role=treeitem][data-path="empty"]'); assert.ok(empty);
  await act(async () => { empty.focus(); empty.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
  await act(async () => empty.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  assert.equal(window.document.activeElement, empty, 'Right stays on a loading folder');
  await act(async () => { loading.resolve({ entries: [] }); await loading.promise; });
  await act(async () => empty.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  assert.equal(window.document.activeElement, empty, 'Right stays on an empty folder');

  const uploaded = new Set();
  const publish = f.binding.publish;
  f.binding.publish = async request => { const result = await publish(request); if (result.kind === 'committed') uploaded.add(request.changes[0].target.resource.path); return result; };
  f.binding.list = async ({ directory }) => ({ entries: uploaded.size ? directory ? [...uploaded].map(entry) : [{ path: 'uploads', kind: 'directory', size: 0 }] : [] });
  await act(async () => element.querySelector('[aria-label="Refresh"]').click());
  assert.match(element.querySelector('.file-tree-empty').textContent, /No files yetUpload or ask the agent to create oneUpload/);
  assert.ok(element.querySelector('.file-tree-empty button'), 'empty state offers the same upload picker');
  const dropped = new File(['Fictional dropped document'], 'dropped.md', { type: 'text/markdown' });
  const drag = (type, file = dropped) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file] } });
    return event;
  };
  const panel = element.querySelector('[data-boring=file-tree]');
  await act(async () => panel.dispatchEvent(drag('dragenter')));
  assert.equal(panel.dataset.dropping, 'true');
  await act(async () => panel.dispatchEvent(drag('drop')));
  assert.equal(panel.dataset.dropping, undefined);
  for (let attempt = 0; attempt < 50 && !element.querySelector('[data-path="uploads/dropped.md"]:not([data-upload-state])'); attempt++) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  assert.ok(element.querySelector('[data-path="uploads/dropped.md"]:not([data-upload-state])'), 'drop updates the real tree after publication');
  const saved = await f.binding.read({ target: f.binding.locate('uploads/dropped.md'), revision: { kind: 'latest' } });
  assert.equal(new TextDecoder().decode(saved.snapshot.bytes), 'Fictional dropped document');
  assert.equal(f.publishes(), 3, 'two history seeds and one drop publication');
  await t.test('upload results are announced politely instead of displayed as log lines', () => {
    const live = element.querySelector('[aria-label="Uploads"]');
    assert.equal(live?.getAttribute('aria-live'), 'polite');
    assert.match(live.textContent, /dropped.md: Saved/);
    assert.equal(Boolean(element.querySelector('.file-tree-uploads')), false);
  });

  const gate = later(); let attempts = 0;
  f.binding.publish = async request => {
    attempts++;
    if (attempts === 1) return { kind: 'unavailable', reason: 'Fictional connection interrupted' };
    await gate.promise;
    const result = await publish(request); if (result.kind === 'committed') uploaded.add(request.changes[0].target.resource.path); return result;
  };
  const retryFile = new File(['Fictional retry document'], 'retry.md', { type: 'text/markdown' });
  await act(async () => panel.dispatchEvent(drag('drop', retryFile)));
  const retryRow = () => element.querySelector('[role=treeitem][data-path="uploads/retry.md"]');
  for (let attempt = 0; attempt < 50 && !retryRow()?.querySelector('[data-upload-error]'); attempt++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  assert.match(retryRow()?.textContent ?? '', /Fictional connection interrupted/);
  await act(async () => retryRow().querySelector('button[data-upload-retry]').click());
  for (let attempt = 0; attempt < 50 && retryRow()?.dataset.uploadState !== 'pending'; attempt++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  assert.equal(retryRow()?.dataset.uploadState, 'pending');
  assert.ok(retryRow().querySelector('[data-upload-spinner]'), 'pending upload progress belongs to its file row');
  await act(async () => gate.resolve());
  for (let attempt = 0; attempt < 50 && retryRow()?.dataset.uploadState; attempt++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  assert.equal(retryRow()?.dataset.uploadState, undefined);
  assert.equal(Boolean(retryRow()?.querySelector('[data-upload-spinner], [data-upload-error], [data-upload-retry]')), false);
  assert.equal(attempts, 2);
  const retried = await f.binding.read({ target: f.binding.locate('uploads/retry.md'), revision: { kind: 'latest' } });
  assert.equal(new TextDecoder().decode(retried.snapshot.bytes), 'Fictional retry document');

  const unreadable = new File(['Fictional readable retry'], 'unreadable.md', { type: 'text/markdown' });
  const readBytes = unreadable.arrayBuffer.bind(unreadable); let reads = 0;
  Object.defineProperty(unreadable, 'arrayBuffer', { value: () => ++reads === 1 ? Promise.reject(new Error('Fictional local read failure')) : readBytes() });
  await act(async () => panel.dispatchEvent(drag('drop', unreadable)));
  const unreadableRow = () => element.querySelector('[role=treeitem][data-path="uploads/unreadable.md"]');
  assert.match(unreadableRow()?.textContent ?? '', /Fictional local read failure/);
  await act(async () => unreadableRow().querySelector('[data-upload-retry]').click());
  for (let attempt = 0; attempt < 50 && !element.querySelector('[data-path="uploads/unreadable.md"]:not([data-upload-state])'); attempt++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  assert.equal(reads, 2);
  const reread = await f.binding.read({ target: f.binding.locate('uploads/unreadable.md'), revision: { kind: 'latest' } });
  assert.equal(new TextDecoder().decode(reread.snapshot.bytes), 'Fictional readable retry');

  f.binding.publish = async request => { const result = await publish(request); if (result.kind === 'committed') uploaded.add(request.changes[0].target.resource.path); throw new Error('Fictional acknowledgement lost'); };
  const uncertain = new File(['Fictional uncertain upload'], 'uncertain.md', { type: 'text/markdown' });
  await act(async () => panel.dispatchEvent(drag('drop', uncertain)));
  const uncertainRow = () => element.querySelector('[data-path="uploads/uncertain.md"]');
  for (let attempt = 0; attempt < 50 && uncertainRow()?.dataset.uploadState !== 'failed'; attempt++) await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  const check = uncertainRow().querySelector('[data-upload-retry]');
  await t.test('unconfirmed upload control has the same visible and accessible name', () => {
    assert.equal(check.textContent, 'Check upload status');
    assert.equal(check.textContent, check.getAttribute('aria-label'));
  });
  const published = f.publishes();
  await act(async () => check.click());
  assert.equal(f.publishes(), published, 'checking an unconfirmed upload does not republish');
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
  const results = await uploadRevisionAttachments(f.controller, [image, duplicate], signal, undefined, { inlineImages: true });
  assert.equal(results.length, 2); assert.match(results[0].path, /^uploads\/image-[0-9a-f]{8}\.png$/); assert.equal(results[0].name, 'image.png');
  assert.equal(results[0].image.mimeType, 'image/png'); assert.deepEqual(Buffer.from(results[0].image.data, 'base64'), Buffer.from([137, 80, 78, 71]));
  assert.match(results[1].path, /^uploads\/existing-[0-9a-f]{8}\.txt$/, 'an attachment never overwrites; a same-named one is saved beside it');
  assert.deepEqual((await f.binding.read({ target: f.binding.locate('uploads/existing.txt'), revision: { kind: 'latest' } })).snapshot.bytes, new Uint8Array([5]));
  const second = await uploadRevisionAttachments(f.controller, [new File([new Uint8Array([1, 2])], 'image.png', { type: 'image/png' })], signal);
  assert.equal(second.length, 1, 'a second pasted image.png is saved too'); assert.notEqual(second[0].path, results[0].path);
  const unreadable = new File(['gone'], 'unreadable.txt');
  Object.defineProperty(unreadable, 'arrayBuffer', { value: async () => { throw new Error('Local file is unavailable'); } });
  const failures = [];
  const partial = await uploadRevisionAttachments(f.controller, [new File(['ok'], 'another.txt'), unreadable], signal, (name, reason) => failures.push({ name, reason }));
  assert.equal(partial.length, 1); assert.match(partial[0].path, /^uploads\/another-[0-9a-f]{8}\.txt$/);
  assert.deepEqual(failures, [{ name: 'unreadable.txt', reason: 'Local file is unavailable' }]);
});

test('chat uploads are reference-only by default, whitespace-free, and refuse files over maxBytes before saving them', async t => {
  const { build } = await import('esbuild'); const { mkdirSync } = await import('node:fs');
  const out = new URL('../../.cache/file-tree-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('revision-files.mjs', out);
  await build({ entryPoints: [new URL('../../registry/pi-app/revision-files.ts', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', packages: 'external' });
  const { uploadRevisionAttachments, attachmentPath } = await import(output.href);
  const f = fixture(t); const signal = new AbortController().signal;
  const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'Screen shot  2026.png', { type: 'image/png' });
  const [reference] = await uploadRevisionAttachments(f.controller, [png()], signal);
  assert.equal(reference.image, undefined, 'no inline base64 unless inlineImages is set');
  assert.match(reference.path, /^uploads\/Screen_shot_2026-[0-9a-f]{8}\.png$/, 'a whitespace run becomes _ so a mention ends at the name');
  assert.doesNotMatch(attachmentPath('a\tb c.txt'), /\s/);
  assert.match(attachmentPath('no extension'), /^uploads\/no_extension-[0-9a-f]{8}$/);
  const before = f.controller.getSnapshot().uploads.length;
  const refused = [];
  await assert.rejects(uploadRevisionAttachments(f.controller, [new File(['0123456789'], 'big file.txt')], signal, (name, reason) => refused.push({ name, reason }), { maxBytes: 4, tooLarge: 'Larger than 4 bytes. Not saved.' }), /Larger than 4 bytes/);
  assert.deepEqual(refused, [{ name: 'big file.txt', reason: 'Larger than 4 bytes. Not saved.' }]);
  assert.equal(f.controller.getSnapshot().uploads.length, before, 'a refused file is never uploaded');
  const kept = await uploadRevisionAttachments(f.controller, [new File(['0123456789'], 'big file.txt'), new File(['ok'], 'small.txt')], signal, undefined, { maxBytes: 4 });
  assert.equal(kept.length, 1); assert.match(kept[0].path, /^uploads\/small-[0-9a-f]{8}\.txt$/, 'the file under the limit is still attached');
});

test('a concurrent upload of different bytes to the same path is refused, the same bytes share the first upload', async t => {
  const f = fixture(t); const publish = f.binding.publish; let release;
  f.binding.publish = async (...args) => { await new Promise(resolve => { release = resolve; }); return publish(...args); };
  const first = f.controller.upload({ path: 'n.txt', bytes: new Uint8Array([88]) });
  await new Promise(resolve => setTimeout(resolve, 20));
  await assert.rejects(f.controller.upload({ path: 'n.txt', bytes: new Uint8Array([89]) }), /already being uploaded/);
  const repeat = f.controller.upload({ path: 'n.txt', bytes: new Uint8Array([88]) });
  release();
  const [done, again] = await Promise.all([first, repeat]);
  assert.equal(done.state.result.kind, 'committed'); assert.equal(again.operationId, done.operationId);
  assert.deepEqual((await f.binding.read({ target: f.binding.locate('n.txt'), revision: { kind: 'latest' } })).snapshot.bytes, new Uint8Array([88]));
});
