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
  const latest = await f.controller.upload({ path: 'docs/note.md', bytes: new TextEncoder().encode('New fictional version'), replace: ref, mediaType: 'text/markdown' });
  const latestRef = latest.state.result.receipt.changes[0].after;
  f.binding.history = async () => [
    { revision: latestRef.revision, savedAt: Date.now() - 120000, source: 'publish' },
    { revision: ref.revision, savedAt: Date.now() - 300000, source: 'agent' },
  ];
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
  const folderButton = directory.querySelector('.file-tree-row-button'); assert.ok(folderButton);
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
  const historyPanel = element.querySelector('section[aria-label="History of docs/note.md"]'); assert.ok(historyPanel);
  assert.match(historyPanel.textContent, /2 min ago/);
  assert.match(historyPanel.textContent, /You/);
  assert.match(historyPanel.textContent, /5 min ago/);
  assert.match(historyPanel.textContent, /Agent/);
  assert.doesNotMatch(historyPanel.textContent, new RegExp(`${ref.revision.slice(0, 8)}|${latestRef.revision.slice(0, 8)}`), 'revision hashes stay out of human version rows');
  const versions = historyPanel.querySelectorAll('button[aria-pressed]');
  assert.equal(versions.length, 2);
  assert.match(versions[0].textContent, /Current/);
  await act(async () => versions[1].click());
  assert.match(versions[1].textContent, /Current/, 'Current follows the displayed read-only revision, like the viewer version menu');
  assert.doesNotMatch(versions[0].textContent, /Current/);
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

// A binding whose listing, rename and delete reach the same fictional sqlite workspace, as `connectRevisionProvider` would.
function mutable(t, overrides = {}) {
  const listed = [];
  const f = fixture(t, {
    list: async request => { listed.push(request.directory ?? ''); return f.store.workspace('fictional').catalog.list(request, f.binding.identity); },
    rename: request => f.store.workspace('fictional').renaming.rename(request, f.binding.identity),
    delete: request => f.store.workspace('fictional').deletion.delete(request, f.binding.identity),
    ...overrides,
  });
  const text = async path => { const read = await f.binding.read({ target: f.binding.locate(path), revision: { kind: 'latest' } }); return read.kind === 'available' ? new TextDecoder().decode(read.snapshot.bytes) : read.kind; };
  const seed = async (path, value) => { const result = await f.controller.upload({ path, bytes: new TextEncoder().encode(value), mediaType: 'text/markdown' }); assert.equal(result.state.result.kind, 'committed'); return result.state.result.receipt.changes[0].after; };
  return { ...f, listed, text, seed };
}

test('file tree renames, moves and deletes files through the one client with the revision the row knows', async t => {
  assert.deepEqual(fixture(t).controller.actions, { rename: false, delete: false }, 'a client without rename/delete offers neither');
  const f = mutable(t);
  assert.deepEqual(f.controller.actions, { rename: true, delete: true });
  await f.seed('docs/a.md', 'Fictional note'); await f.seed('archive/keep.md', 'Fictional archive');
  f.listed.length = 0;
  const renamed = await f.controller.rename('docs/a.md', 'docs/b.md');
  assert.equal(renamed.kind, 'rename'); assert.equal(renamed.state.result.kind, 'committed');
  assert.equal(await f.text('docs/a.md'), 'missing'); assert.equal(await f.text('docs/b.md'), 'Fictional note');
  assert.ok(f.listed.includes('docs'), 'the renamed file\'s folder is listed again');
  f.listed.length = 0;
  const moved = await f.controller.move('docs/b.md', 'archive');
  assert.equal(moved.to, 'archive/b.md'); assert.equal(moved.state.result.kind, 'committed');
  assert.equal(await f.text('archive/b.md'), 'Fictional note');
  assert.ok(f.listed.includes('docs') && f.listed.includes('archive'), 'a move lists both folders again');
  assert.ok(f.controller.getSnapshot().expanded.has('archive'), 'the destination folder opens');
  const toRoot = await f.controller.move('archive/b.md', '');
  assert.equal(toRoot.to, 'b.md'); assert.equal(toRoot.state.result.kind, 'committed');
  const removed = await f.controller.remove('b.md');
  assert.equal(removed.kind, 'delete'); assert.equal(removed.state.result.kind, 'committed'); assert.equal(await f.text('b.md'), 'missing');
  await assert.rejects(f.controller.rename('archive/keep.md', 'archive/../escape.md'), TypeError);
  await assert.rejects(f.controller.rename('archive/keep.md', 'archive/keep.md'), TypeError);
  await assert.rejects(f.controller.rename('archive/keep.md', ' '), TypeError);
  assert.equal(await f.text('archive/keep.md'), 'Fictional archive', 'a refused name changes nothing');
});

test('a rename or delete against a changed file is refused on its row, and the tree is read again', async t => {
  const f = mutable(t);
  const base = await f.seed('stale.md', 'Fictional first');
  assert.equal(await f.controller.prepare('stale.md'), base.revision, 'the row learns the revision it shows');
  await f.binding.publish({ operationId: 'fictional-agent-edit', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: base, bytes: new TextEncoder().encode('Fictional agent edit'), mediaType: 'text/markdown' }] });
  f.listed.length = 0;
  const stale = await f.controller.rename('stale.md', 'fresh.md');
  assert.equal(stale.state.result.kind, 'conflict');
  assert.equal(await f.text('stale.md'), 'Fictional agent edit'); assert.equal(await f.text('fresh.md'), 'missing');
  assert.deepEqual(f.controller.getSnapshot().mutations.map(item => [item.path, item.state.kind, item.state.result?.kind]), [['stale.md', 'settled', 'conflict']]);
  assert.ok(f.listed.includes(''), 'a refusal reads the folder again');
  await f.controller.prepare('stale.md');
  const deleted = await f.controller.remove('stale.md');
  assert.equal(deleted.state.result.kind, 'committed');
  assert.deepEqual(f.controller.getSnapshot().mutations.map(item => item.path), ['stale.md'], 'one current outcome per row');
  f.controller.dismiss(deleted.operationId); assert.deepEqual(f.controller.getSnapshot().mutations, []);
  await f.seed('gone.md', 'Fictional gone');
  f.binding.delete = async request => { throw new PublicationNotDispatchedError(request.operationId); };
  assert.equal((await f.controller.remove('gone.md')).state.result.kind, 'unavailable', 'not sent is a known refusal');
  f.binding.delete = async () => { throw new Error('Fictional lost acknowledgement'); };
  assert.equal((await f.controller.remove('gone.md')).state.result.kind, 'unknown', 'a lost answer stays unconfirmed');
  assert.equal(await f.text('gone.md'), 'Fictional gone');
});

async function renderedTree(t) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: 'https://fictional.invalid/' });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Text', 'CustomEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { build } = await import('esbuild'); const { mkdirSync } = await import('node:fs');
  const out = new URL('../../.cache/file-tree-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('presentation-mutations.mjs', out);
  await build({ entryPoints: [new URL('../../registry/file-tree/file-tree.tsx', import.meta.url).pathname], outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external',
    plugins: [{ name: 'dom-without-css', setup(builder) { builder.onResolve({ filter: /\.css$/ }, () => ({ path: 'styles', namespace: 'empty-style' })); builder.onLoad({ filter: /.*/, namespace: 'empty-style' }, () => ({ contents: '', loader: 'js' })); } }] });
  const { FileTree } = await import(output.href);
  const element = window.document.createElement('div'); window.document.body.append(element); const root = createRoot(element);
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });
  const settle = async (done, tries = 100) => { for (let attempt = 0; attempt < tries && !done(); attempt++) await act(async () => new Promise(resolve => setTimeout(resolve, 10))); };
  const render = props => act(async () => root.render(createElement(FileTree, { variant: 'list', ...props })));
  const key = (node, value) => act(async () => node.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
  const row = path => element.querySelector(`[role=treeitem][data-path="${path}"]`);
  const menu = async path => { await key(row(path).querySelector('[data-file-more]'), 'ArrowDown'); return [...window.document.querySelectorAll('[role=menuitem]')]; };
  return { window, element, act, settle, render, key, row, menu };
}

test('rendered tree renames inline, deletes after confirmation and moves by drag or by picking a folder', async t => {
  const f = mutable(t);
  await f.seed('docs/a.md', 'Fictional note'); await f.seed('archive/keep.md', 'Fictional archive'); await f.seed('loose.md', 'Fictional loose');
  const ui = await renderedTree(t);
  const { window, element, act, settle, render, key, row, menu } = ui;
  await render({ revisionProvider: f.binding });
  await settle(() => row('docs'));
  await t.test('without effective capabilities no mutation is offered', async () => {
    const items = await menu('loose.md');
    assert.deepEqual(items.map(item => item.dataset.action).filter(id => ['rename', 'move', 'delete'].includes(id)), []);
    await key(items[0], 'Escape');
    await key(row('loose.md'), 'F2'); assert.equal(element.querySelector('[data-file-rename]'), null);
  });
  await render({ revisionProvider: f.binding, capabilities: { effective: ['read', 'rename'] } });
  const renameOnly = await menu('loose.md');
  assert.deepEqual(renameOnly.map(item => item.dataset.action).filter(id => ['rename', 'move', 'delete'].includes(id)), ['rename', 'move'], 'move is a rename; delete needs its own capability');
  await key(renameOnly[0], 'Escape');
  await render({ revisionProvider: f.binding, capabilities: { effective: ['read', 'rename', 'delete'] } });

  // Rename from the menu: an inline input in the row, Escape cancels, Enter commits.
  const items = await menu('loose.md');
  const rename = items.find(item => item.dataset.action === 'rename'); assert.equal(rename.textContent, 'Rename');
  assert.ok(items.find(item => item.dataset.action === 'delete')?.textContent.includes('Delete'));
  await act(async () => rename.click());
  let input = row('loose.md').querySelector('input[data-file-rename]');
  assert.ok(input); assert.equal(input.getAttribute('aria-label'), 'Rename loose.md'); assert.equal(input.value, 'loose.md');
  await key(input, 'Escape');
  assert.equal(row('loose.md').querySelector('input[data-file-rename]'), null); assert.equal(await f.text('loose.md'), 'Fictional loose');
  await key(row('loose.md'), 'F2');
  input = row('loose.md').querySelector('input[data-file-rename]'); assert.ok(input, 'F2 renames the focused row');
  input.value = 'renamed.md';
  await key(input, 'Enter');
  await settle(() => row('renamed.md') && !row('loose.md'));
  assert.ok(row('renamed.md')); assert.equal(row('loose.md'), null); assert.equal(await f.text('renamed.md'), 'Fictional loose');

  // Delete: the Delete key asks first; cancelling keeps the file.
  await key(row('renamed.md'), 'Delete');
  let dialog = window.document.querySelector('[role=alertdialog], [role=dialog]');
  assert.ok(dialog); assert.match(dialog.textContent, /Delete renamed\.md\?/);
  await act(async () => dialog.querySelector('[data-confirm=cancel]').click());
  await settle(() => !window.document.querySelector('[role=alertdialog], [role=dialog]'));
  assert.equal(await f.text('renamed.md'), 'Fictional loose');
  await act(async () => (await menu('renamed.md')).find(item => item.dataset.action === 'delete').click());
  dialog = window.document.querySelector('[role=alertdialog], [role=dialog]');
  await act(async () => dialog.querySelector('[data-confirm=delete]').click());
  await settle(() => !row('renamed.md'));
  assert.equal(row('renamed.md'), null); assert.equal(await f.text('renamed.md'), 'missing');

  // Move by drag: a file row dropped on a folder row; the folder shows it is a target while hovered.
  await key(row('docs'), 'ArrowRight'); await settle(() => row('docs/a.md'));
  const data = new Map();
  const transfer = { types: [], setData: (type, value) => { data.set(type, value); transfer.types = [...data.keys()]; }, getData: type => data.get(type) ?? '', effectAllowed: 'all', dropEffect: 'none', files: [] };
  const drag = (node, type) => { const event = new window.Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: transfer }); return act(async () => node.dispatchEvent(event)); };
  await drag(row('docs/a.md'), 'dragstart');
  await drag(row('archive'), 'dragenter'); await drag(row('archive'), 'dragover');
  assert.equal(row('archive').dataset.dropTarget, 'true');
  await drag(row('archive'), 'drop');
  await settle(() => row('archive/a.md'));
  assert.equal(await f.text('archive/a.md'), 'Fictional note'); assert.equal(await f.text('docs/a.md'), 'missing');
  assert.equal(row('archive').dataset.dropTarget, undefined);

  // Move to…: a dialog lists the folders; the current one is not offered.
  await act(async () => (await menu('archive/a.md')).find(item => item.dataset.action === 'move').click());
  dialog = window.document.querySelector('[role=dialog]');
  assert.match(dialog.textContent, /Move a\.md/);
  assert.equal(dialog.querySelector('[data-destination="archive"]')?.disabled, true, 'the current folder is not a destination');
  await act(async () => dialog.querySelector('[data-destination="docs"]').click());
  await settle(() => row('docs/a.md'));
  assert.equal(await f.text('docs/a.md'), 'Fictional note');

  // A stale rename is refused on its row, and the row keeps the file.
  const latest = await f.binding.read({ target: f.binding.locate('docs/a.md'), revision: { kind: 'latest' } });
  await key(row('docs/a.md'), 'F2');
  await f.binding.publish({ operationId: 'fictional-agent-edit-2', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: latest.snapshot.ref, bytes: new TextEncoder().encode('Fictional agent edit'), mediaType: 'text/markdown' }] });
  input = row('docs/a.md').querySelector('input[data-file-rename]'); input.value = 'late.md';
  await key(input, 'Enter');
  await settle(() => row('docs/a.md')?.querySelector('[data-mutation-error]'));
  assert.equal(row('docs/a.md').dataset.mutationState, 'failed');
  assert.ok(row('docs/a.md').querySelector('[data-mutation-error]').textContent.length > 0);
  assert.equal(await f.text('docs/a.md'), 'Fictional agent edit'); assert.equal(await f.text('docs/late.md'), 'missing');
  await act(async () => row('docs/a.md').querySelector('[data-mutation-dismiss]').click());
  assert.equal(row('docs/a.md').querySelector('[data-mutation-error]'), null);
});
