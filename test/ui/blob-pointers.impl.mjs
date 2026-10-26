import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { DEFAULT_KINDS_ENTRY, withDefaultKinds } from '../helpers/default-kinds.mjs';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';
import { pointer } from '../fixtures/blob-bytes.mjs';

const later = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('blob pointers: Library rows, viewers from the blob URL, refused bases and large uploads through the host', async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { disableIframePageLoading: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'confirm', 'sessionStorage', 'ResizeObserver', 'File', 'Event'];
  const globals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) {
    const value = name === 'window' ? window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 1400, height: 800, left: 0, right: 1400, top: 0, bottom: 800, x: 0, y: 0 });
  const { createElement, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const out = new URL('../../.cache/blob-pointers-test/', import.meta.url); mkdirSync(out, { recursive: true });
  const output = new URL('workspace.mjs', out);
  await build({ stdin: DEFAULT_KINDS_ENTRY, tsconfig: new URL('../../tsconfig.json', import.meta.url).pathname, outfile: output.pathname, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' },
    plugins: [{ name: 'file-tree-css', setup(builder) { builder.onResolve({ filter: /^@hachej\/boring-ui-kit\/file-tree\.css$/ }, () => ({ path: new URL(import.meta.resolve('@hachej/boring-ui-kit/file-tree.css')).pathname, external: false })); } }] });
  const { AgentWorkspace } = withDefaultKinds(await import(output.href), createElement);
  const element = window.document.createElement('div'); window.document.body.append(element);
  const uncaught = [];
  const root = createRoot(element, { onUncaughtError: error => uncaught.push(error) });
  t.after(async () => {
    await act(async () => root.unmount()); await window.happyDOM.close();
    for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  });

  const locate = path => ({ resource: { providerId: 'fictional', path }, view: { kind: 'published' } });
  const identity = { scopeId: 'fictional', principalId: 'alice', initiatorId: 'alice' };
  const store = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional', authorize: () => true }); t.after(() => store.close());
  const sizes = new Map();
  const reads = [];
  let publishes = 0, lists = 0;
  /** The host's own write (what POST /_files does after storing the bytes): straight into the store, not through the page. */
  const hostWrite = async (path, text) => {
    const bytes = new TextEncoder().encode(text);
    await store.publication.publish({ operationId: `host-${path}-${sizes.size}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: locate(path), expected: { kind: 'absent' }, bytes, mediaType: 'application/vnd.boring.blob+json' }] }, identity);
    sizes.set(path, bytes.length);
  };
  const binding = { identity, workspace: { providerId: 'fictional', instanceId: 'one', incarnation: 'one', viewId: 'one' }, locate,
    read: request => { reads.push(request.target.resource.path); return store.read(request, identity); }, publish: request => { publishes++; return store.publication.publish(request, identity); }, lookup: id => store.reconciliation.lookup(id, identity),
    list: async ({ directory = '' }) => { lists++; return { entries: directory ? [] : [...sizes].map(([path, size]) => ({ path, kind: 'file', size })) }; }, search: async () => ({ entries: [] }), history: async () => [],
  };
  await hostWrite('harbour.png.blob.json', JSON.stringify(pointer({ id: 'img-01', type: 'image/png', name: 'harbour.png', size: 3_456_789 })));
  await hostWrite('report.pdf.blob.json', JSON.stringify(pointer({ id: 'pdf 02', type: 'application/pdf', name: 'report.pdf', size: 52_000_000 })));
  await hostWrite('budget.xlsx.blob.json', JSON.stringify(pointer({ id: 'xlsx-03', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name: 'budget.xlsx', size: 81_920 })));
  await hostWrite('future.blob.json', JSON.stringify({ 'boring:blob': 2, id: 'future-04' }));
  await hostWrite('broken.blob.json', JSON.stringify({ 'boring:blob': 1, id: 'broken-05' }));
  await hostWrite('colour.mp4.blob.json', JSON.stringify(pointer({ id: 'video 07', type: 'video/mp4', name: 'colour.mp4', size: 52_000_000 })));
  await hostWrite('unknown.blob.json', JSON.stringify(pointer({ id: 'video-08', type: 'video/webm', name: 'unknown', size: 4096 })));
  await hostWrite('direct.mp4', 'fictional unsupported video bytes');

  const q = selector => window.document.querySelector(selector);
  const settle = async ready => { for (let n = 0; n < 200 && !ready(); n++) await act(async () => new Promise(r => setTimeout(r, 10))); };
  const row = path => q(`[data-testid=workspace-library-side] [role=treeitem][data-path="${path}"]`);
  const render = extra => act(async () => root.render(createElement(AgentWorkspace, { controller: undefined, conversationId: undefined, revisionProvider: binding, libraryPlacement: 'side', storageKey: 'blob-proof', ...extra })));
  const openLibrary = async () => { if (q('[data-dock=library]')?.dataset.placement !== 'docked') await act(async () => q('[data-testid=workspace-library]').click()); await settle(() => row('harbour.png.blob.json')); };
  const open = async path => { await act(async () => row(path).querySelector('button').click()); await settle(() => q('[data-testid=file-viewer]')?.dataset.path === path && !q('[data-testid=file-viewer] [role=status]')?.textContent.includes('Loading')); };

  await t.test('the Library lists a pointer under its file name, real size and type', async () => {
    await render({ key: 'list' });
    await openLibrary();
    const harbour = row('harbour.png.blob.json');
    assert.match(harbour.querySelector('.file-tree-name').textContent, /^harbour\.png$/);
    assert.match(harbour.querySelector('[data-file-meta]').textContent, /Image · 3\.3 MB/);
    assert.equal(harbour.dataset.blobType, 'image/png');
    assert.match(row('report.pdf.blob.json').querySelector('[data-file-meta]').textContent, /PDF · 49\.6 MB/);
    assert.match(row('future.blob.json').querySelector('.file-tree-name').textContent, /^future\.blob\.json$/, 'an unsupported pointer is listed as its JSON file');
    assert.match(row('broken.blob.json').querySelector('.file-tree-name').textContent, /^broken\.blob\.json$/);
  });

  await t.test('an image pointer renders an <img> from the blob URL', async () => {
    await open('harbour.png.blob.json');
    await settle(() => q('[data-testid=file-viewer] img'));
    assert.equal(q('[data-testid=file-viewer] img').getAttribute('src'), '/_files/img-01');
    assert.equal(q('[data-testid=file-title]').textContent, 'harbour.png');
  });

  await t.test('a PDF pointer opens the PDF viewer from the URL', async () => {
    await open('report.pdf.blob.json');
    await settle(() => q('[data-testid=viewer-frame-pdf]'));
    assert.equal(q('[data-testid=viewer-frame-pdf]').getAttribute('src'), '/_files/pdf%2002#view=FitH', 'the browser loads the URL itself: no bytes in the page');
  });

  await t.test('an mp4 pointer streams in the public panel with native controls and a bar download', async () => {
    await render({ key: 'video-panel', opened: { kind: 'file', path: 'colour.mp4.blob.json' } });
    await settle(() => q('[data-testid=viewer-panel] video'));
    const video = q('[data-testid=viewer-panel] video');
    assert.ok(video, 'the artifact panel renders a video, not the generic download state');
    assert.equal(video.getAttribute('src'), '/_files/video%2007');
    assert.equal(video.controls, true);
    assert.equal(video.hasAttribute('playsinline'), true);
    assert.equal(video.getAttribute('preload'), 'metadata');
    assert.equal(video.hasAttribute('autoplay'), false);
    await act(async () => q('[data-testid=viewer-more]').click());
    assert.ok(q('[data-testid=viewer-download]'), 'the ViewerFrame keeps Download');
    await act(async () => window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  });

  await t.test('the Library routes video by MIME even without a video extension; error replaces the box with a download', async () => {
    await render({ key: 'video-library' });
    await openLibrary();
    await open('unknown.blob.json');
    await settle(() => q('[data-testid=file-viewer] video'));
    const video = q('[data-testid=file-viewer] video');
    assert.ok(video, 'video/* routes by pointer type');
    assert.equal(video.getAttribute('src'), '/_files/video-08');
    await act(async () => video.dispatchEvent(new window.Event('error')));
    assert.equal(q('[data-testid=file-viewer] video'), null, 'no broken video box remains');
    assert.equal(q('[data-testid=video-unplayable]').textContent, "This video can't be played here");
    const download = q('[data-testid=video-download]');
    assert.equal(download.getAttribute('href'), '/_files/video-08');
    assert.equal(download.getAttribute('download'), 'unknown');
    await act(async () => q('[data-testid=viewer-more]').click());
    assert.ok(q('[data-testid=viewer-download]'), 'the bar download also survives an error');
    await act(async () => window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await open('colour.mp4.blob.json');
    await settle(() => q('[data-testid=file-viewer] video'));
    assert.ok(q('[data-testid=file-viewer] video'), 'another source does not inherit the error');
  });

  await t.test('direct workspace video without a URL is not read as bytes or text', async () => {
    const before = reads.length;
    await open('direct.mp4');
    await settle(() => q('[data-testid=file-viewer] [role=status]'));
    assert.equal(q('[data-testid=file-viewer] video'), null);
    assert.match(q('[data-testid=file-viewer] [role=status]').textContent, /cannot be shown/);
    assert.ok(!reads.slice(before).includes('direct.mp4'), 'the byte-only resource client must not buffer video');
  });

  await t.test('another type shows a download action named after the file', async () => {
    await open('budget.xlsx.blob.json');
    await settle(() => q('[data-testid=blob-download]'));
    const link = q('[data-testid=blob-download]');
    assert.equal(link.tagName, 'A');
    assert.equal(link.getAttribute('href'), '/_files/xlsx-03');
    assert.equal(link.getAttribute('download'), 'budget.xlsx');
  });

  await t.test('a newer or invalid pointer shows as its JSON file, the newer one with a note; nothing crashes', async () => {
    await open('future.blob.json');
    await settle(() => q('[data-testid=file-preview]'));
    assert.match(q('[data-testid=file-preview]').textContent, /"boring:blob":2/);
    assert.ok(q('[data-testid=blob-newer-format]'), 'the newer format is named');
    await open('broken.blob.json');
    await settle(() => q('[data-testid=file-preview]')?.textContent.includes('broken-05'));
    assert.equal(q('[data-testid=blob-newer-format]'), null);
    assert.deepEqual(uncaught, []);
  });

  await t.test('a host base is used as given; a cross-origin or absolute base is refused', async () => {
    await render({ key: 'base', resources: { blobBase: '/fictional-blobs/' } });
    await openLibrary();
    await open('harbour.png.blob.json');
    await settle(() => q('[data-testid=file-viewer] img'));
    assert.equal(q('[data-testid=file-viewer] img').getAttribute('src'), '/fictional-blobs/img-01');
    for (const blobBase of ['https://cdn.fictional.invalid/', '//cdn.fictional.invalid/', 'blobs/']) {
      uncaught.length = 0;
      await assert.rejects(async () => { await render({ key: `refused-${blobBase}`, resources: { blobBase } }); }, error => error instanceof TypeError && /blobBase must be a same-origin path/.test(error.message), blobBase);
      assert.equal(q('[data-testid=file-viewer] img'), null, `${blobBase}: nothing is shown from it`);
    }
    uncaught.length = 0;
  });

  const choose = async file => {
    const input = q('[data-testid=workspace-library-side] input[type=file]');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); });
  };
  const large = name => new window.File(['fictional large bytes, more than the cap'], name, { type: 'application/octet-stream' });

  await t.test('without uploadBlob a file above the cap is refused with the existing message', async () => {
    await render({ key: 'no-blob', uploads: { maxBytes: 10 } });
    await openLibrary();
    const before = publishes;
    await choose(large('archive.bin'));
    await settle(() => q('[data-testid=workspace-library-side] [data-upload-error]'));
    assert.match(q('[data-testid=workspace-library-side] [data-upload-error]').textContent, /Larger than 10 bytes\. Not saved\./);
    assert.equal(publishes, before, 'nothing written');
  });

  await t.test('uploadBlob above the cap: progress, the host writes the pointer, the Library reloads, the page writes nothing', async () => {
    const calls = [];
    const uploadBlob = (file, options) => { const call = { file, options, ...later() }; calls.push(call); options.signal.addEventListener('abort', () => call.reject(new DOMException('Aborted', 'AbortError'))); return call.promise; };
    await render({ key: 'blob', uploads: { maxBytes: 10 }, resources: { uploadBlob } });
    await openLibrary();
    const before = publishes;
    await choose(large('drone.mov'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file.name, 'drone.mov');
    assert.ok(q('[data-blob-upload="drone.mov"]'), 'an upload row');
    await act(async () => calls[0].options.onProgress({ loaded: 30, total: 120 }));
    assert.equal(q('[data-blob-upload="drone.mov"]').dataset.progress, '25');
    const bar = q('[data-blob-upload="drone.mov"] [role=progressbar]');
    assert.ok(bar, 'the shadcn Progress');
    assert.equal(bar.getAttribute('aria-valuenow'), '25');
    await act(async () => calls[0].options.onProgress({ loaded: 90, total: 120 }));
    assert.equal(q('[data-blob-upload="drone.mov"] [role=progressbar]').getAttribute('aria-valuenow'), '75');
    const listed = lists;
    const written = pointer({ id: 'mov-06', type: 'video/quicktime', name: 'drone.mov', size: 98_000_000 });
    await hostWrite('drone.mov.blob.json', JSON.stringify(written));
    await act(async () => { calls[0].resolve(written); await calls[0].promise; });
    await settle(() => row('drone.mov.blob.json'));
    assert.equal(q('[data-blob-upload="drone.mov"]'), null, 'the row is gone');
    assert.ok(lists > listed, 'the listing was read again');
    assert.match(row('drone.mov.blob.json').querySelector('.file-tree-name').textContent, /^drone\.mov$/);
    assert.equal(publishes, before, 'no workspace write after uploadBlob');
    assert.equal(q('[data-testid=workspace-library-side] [role=alert]'), null);

    // Cancel: the signal aborts and no error is shown.
    await choose(large('second.mov'));
    assert.equal(calls.length, 2);
    await act(async () => q('[data-blob-upload="second.mov"] [data-blob-upload-cancel]').click());
    assert.equal(calls[1].options.signal.aborted, true);
    await settle(() => !q('[data-blob-upload="second.mov"]'));
    assert.equal(q('[data-testid=workspace-library-side] [role=alert]'), null, 'a cancel shows no error');
    assert.equal(q('[data-blob-upload-cancel]'), null);

    // A host refusal shows its message.
    await choose(large('huge.mov'));
    await act(async () => { calls[2].reject({ error: { code: 'too_large', message: 'Fictional host: files are limited to 100 MB.' } }); await calls[2].promise.catch(() => {}); });
    await settle(() => q('[data-testid=workspace-library-side] [role=alert]'));
    assert.equal(q('[data-testid=workspace-library-side] [role=alert]').textContent, 'Fictional host: files are limited to 100 MB.');

    // An invalid pointer from the host is a refusal too.
    await choose(large('odd.mov'));
    await act(async () => { calls[3].resolve({ 'boring:blob': 1, id: 'odd' }); await calls[3].promise; });
    await settle(() => /valid file pointer/.test(q('[data-testid=workspace-library-side] [role=alert]')?.textContent ?? ''));
    assert.match(q('[data-testid=workspace-library-side] [role=alert]').textContent, /odd\.mov: the upload did not return a valid file pointer/);
    assert.equal(publishes, before, 'still no workspace write');
  });
});
