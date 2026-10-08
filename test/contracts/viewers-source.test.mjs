import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

// Compiles the viewers registry source as a consumer would and drives it in a DOM environment (structure and behaviour, not browser
// geometry: the studio scenarios `docs-*` are the browser evidence).
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/viewers-test`;
mkdirSync(out, { recursive: true });
async function load(name) {
  await build({ entryPoints: [`${root}registry/viewers/${name}`], outfile: `${out}/${name.replace(/\.tsx?$/, '')}.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
  return import(`${pathToFileURL(`${out}/${name.replace(/\.tsx?$/, '')}.mjs`).href}?${Date.now()}`);
}

test('viewer frame, panes and share (DOM environment, not browser qualification)', async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'window' ? window : typeof window[name] === 'function' && /^[a-z]/.test(name) ? window[name].bind(window) : window[name] });
  }
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const frame = await load('viewer-frame.tsx');
  const sharing = await load('share.ts');
  const imagePane = await load('image-pane.tsx');
  const pdfPane = await load('pdf-pane.tsx');
  const markdownPane = await load('markdown-pane.tsx');
  const htmlPane = await load('html-pane.tsx');
  const { createMarkdownController } = await import('@hachej/boring-ui-kit/markdown');
  const { createHtmlController } = await import('@hachej/boring-ui-kit/html');
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const mount = async (t, element) => {
    const container = document.createElement('div'); document.body.append(container);
    const rootNode = createRoot(container);
    await act(async () => rootNode.render(element));
    t.after(async () => { await act(async () => rootNode.unmount()); container.remove(); });
    const q = selector => container.querySelector(selector);
    const click = async selector => { const node = q(selector); assert.ok(node, selector); await act(async () => node.click()); };
    return { container, q, click, render: async next => { await act(async () => rootNode.render(next)); } };
  };
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  // Waits for a controller's own signal (a save settled, a refresh reported) instead of a fixed delay: a store write can take longer on a busy machine.
  const until = (controller, done) => act(() => new Promise((resolve, reject) => {
    const failed = setTimeout(() => { stop(); reject(new Error('the controller never reached the expected state')); }, 10000);
    const check = () => { if (done(controller.getSnapshot())) { clearTimeout(failed); stop(); resolve(); } };
    const stop = controller.subscribe(check);
    check();
  }));
  const saved = controller => until(controller, state => state.save.kind === 'settled');
  const h = createElement;

  await t.test('the frame shows a standard action only when its handler is supplied', async t => {
    const none = await mount(t, h(frame.ViewerFrame, { title: 'notes.md' }, 'body'));
    assert.equal(none.q('[data-testid="viewer-bar"] h2').textContent, 'notes.md');
    for (const id of ['refresh', 'share', 'copy', 'download', 'open', 'close', 'more']) assert.equal(none.q(`[data-testid="viewer-${id}"]`) === null, true, id);
    const all = await mount(t, h(frame.ViewerFrame, { title: 'notes.md', onRefresh() {}, onShare() {}, onCopy() {}, onDownload() {}, onOpenInNewTab() {}, onClose() {} }, 'body'));
    for (const [id, label] of [['share', 'Share'], ['more', 'More actions'], ['close', 'Close']]) {
      const button = all.q(`[data-testid="viewer-${id}"]`);
      assert.equal(button.getAttribute('aria-label'), label); assert.equal(button.getAttribute('title'), label);
    }
    for (const id of ['refresh', 'copy', 'download', 'open']) assert.equal(all.q(`[data-testid="viewer-${id}"]`) === null, true, `${id} waits in the menu`);
    await all.click('[data-testid="viewer-more"]');
    assert.deepEqual([...all.container.querySelectorAll('[role="menuitem"]')].map(node => node.textContent), ['Reload', 'Copy', 'Download', 'Open in new tab']);
  });

  await t.test('Reload (in the menu) runs the handler and reports a failure instead of throwing', async t => {
    let calls = 0;
    const view = await mount(t, h(frame.ViewerFrame, { title: 'a', onRefresh: () => { calls++; return calls === 1 ? undefined : Promise.reject(new Error('fictional')); } }));
    await view.click('[data-testid="viewer-more"]'); await view.click('[data-testid="viewer-refresh"]'); await settle();
    assert.equal(calls, 1); assert.equal(view.q('[data-testid="viewer-notice"]') === null, true);
    await view.click('[data-testid="viewer-more"]'); await view.click('[data-testid="viewer-refresh"]'); await settle();
    assert.equal(view.q('[data-testid="viewer-notice"]').textContent, 'Refresh failed');
  });

  await t.test('the status is a dot only when something needs attention; read-only is a word in the subtitle', async t => {
    const saved = await mount(t, h(frame.ViewerFrame, { title: 'a', status: { label: 'Saved', tone: 'success' } }));
    assert.equal(saved.q('[data-testid="viewer-status"]') === null, true);
    const unsaved = await mount(t, h(frame.ViewerFrame, { title: 'a', status: { label: 'Unsaved', tone: 'warning' } }));
    assert.equal(unsaved.q('[data-testid="viewer-status"]').getAttribute('title'), 'Unsaved');
    const reading = await mount(t, h(frame.ViewerFrame, { title: 'a', subtitle: 'HTML page', status: { label: 'Read-only' } }));
    assert.equal(reading.q('[data-testid="viewer-status"]') === null, true);
    assert.equal(reading.q('[data-testid="viewer-subtitle"]').textContent, 'HTML page·Read-only');
  });

  await t.test('Share hands the host the title, target and revision; the default copies a link and says so, or uses the Web Share API', async t => {
    let seen;
    const link = request => { seen = request; return `https://fictional.invalid/?open=${request.target}`; };
    const written = [];
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { written.push(text); } } });
    const view = await mount(t, h(frame.ViewerFrame, { title: 'notes.md', target: '/workspace/notes.md', revision: 'r7', onShare: sharing.createLinkShare(link) }));
    await view.click('[data-testid="viewer-share"]'); await settle();
    assert.deepEqual(seen, { title: 'notes.md', target: '/workspace/notes.md', revision: 'r7' });
    assert.deepEqual(written, ['https://fictional.invalid/?open=/workspace/notes.md']);
    assert.equal(view.q('[data-testid="viewer-notice"]').textContent, 'Link copied');
    const shares = [];
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: async data => { shares.push(data); } });
    await view.click('[data-testid="viewer-share"]'); await settle();
    assert.equal(shares.length, 1); assert.equal(shares[0].title, 'notes.md'); assert.equal(written.length, 1, 'the share sheet replaces the clipboard');
    assert.equal(view.q('[data-testid="viewer-notice"]').textContent, 'Shared');
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: async () => { throw Object.assign(new Error('closed'), { name: 'AbortError' }); } });
    await view.click('[data-testid="viewer-share"]'); await settle();
    assert.equal(view.q('[data-testid="viewer-notice"]') === null, true, 'a cancelled share sheet is not an error');
    delete window.navigator.share;
  });

  await t.test('Copy, Download and Open live in the menu at any width and Share and Close stay on the bar', async t => {
    let copied = 0;
    const view = await mount(t, h(frame.ViewerFrame, { title: 'a', onRefresh() {}, onShare() {}, onCopy: () => { copied++; }, onDownload() {}, onClose() {} }));
    assert.equal(view.q('[data-testid="viewer-copy"]') === null, true);
    assert.ok(view.q('[data-testid="viewer-share"]') && view.q('[data-testid="viewer-close"]'));
    await view.click('[data-testid="viewer-more"]');
    assert.equal(view.q('[data-testid="viewer-more"]').getAttribute('aria-expanded'), 'true');
    assert.deepEqual([...view.container.querySelectorAll('[role="menuitem"]')].map(node => node.textContent), ['Reload', 'Copy', 'Download']);
    await view.click('[role="menuitem"][data-testid="viewer-copy"]'); await settle();
    assert.equal(copied, 1);
  });

  await t.test('the image viewer shows every type through an img from an object URL, fits first, zooms, and revokes its URLs', async t => {
    const revoked = [], created = [];
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    URL.createObjectURL = blob => { const url = create(blob); created.push(url); return url; };
    URL.revokeObjectURL = url => { revoked.push(url); revoke(url); };
    t.after(() => { URL.createObjectURL = create; URL.revokeObjectURL = revoke; });
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><script>alert(1)</script></svg>');
    const view = await mount(t, h(imagePane.ImagePane, { name: 'logo.svg', mediaType: 'image/svg+xml', bytes: svg }));
    const img = view.q('img[data-testid="viewer-image"]');
    assert.ok(img.getAttribute('src').startsWith('blob:'));
    assert.equal(view.q('script') === null && view.q('svg[width="40"]') === null, true, 'an SVG is never injected as markup');
    assert.equal(view.q('[data-testid="viewer-stage"]').dataset.zoom, 'fit');
    Object.defineProperty(img, 'naturalWidth', { value: 40 }); Object.defineProperty(img, 'naturalHeight', { value: 20 });
    await act(async () => img.dispatchEvent(new window.Event('load')));
    assert.match(view.q('[data-testid="viewer-subtitle"]').textContent, /SVG · 40 × 20 · 94 B/);
    await view.click('[data-testid="viewer-more"]'); await view.click('[data-testid="viewer-zoom-actual"]');
    assert.equal(view.q('[data-testid="viewer-stage"]').dataset.zoom, '1');
    assert.equal(view.q('img').style.width, '40px');
    await view.click('[data-testid="viewer-zoom-in"]');
    assert.equal(view.q('[data-testid="viewer-stage"]').dataset.zoom, '1.5');
    assert.equal(view.q('img').style.width, '60px');
    await view.click('[data-testid="viewer-zoom-out"]'); await view.click('[data-testid="viewer-zoom-out"]');
    assert.equal(view.q('[data-testid="viewer-stage"]').dataset.zoom, '0.75');
    await view.click('[data-testid="viewer-more"]'); await view.click('[data-testid="viewer-zoom-fit"]');
    assert.equal(view.q('[data-testid="viewer-stage"]').dataset.zoom, 'fit');
    // New bytes (a refresh) replace the object URL and revoke the old one.
    await view.render(h(imagePane.ImagePane, { name: 'logo.svg', mediaType: 'image/svg+xml', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>') }));
    assert.ok(revoked.includes(created[0]));
    const unsupported = await mount(t, h(imagePane.ImagePane, { name: 'a.bmp', mediaType: 'image/bmp', bytes: new Uint8Array(4), onShare() {} }));
    assert.match(unsupported.q('[role="alert"]').textContent, /cannot be shown/);
    assert.equal(unsupported.q('img') === null, true);
    await unsupported.click('[data-testid="viewer-more"]');
    assert.ok(unsupported.q('[data-testid="viewer-download"]'), 'a type that cannot be shown can still be downloaded');
  });

  await t.test('the PDF viewer uses the browser viewer over an object URL and falls back to Download where there is none', async t => {
    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
    const inline = await mount(t, h(pdfPane.PdfPane, { name: 'report.pdf', bytes: pdf, inline: true }));
    assert.ok(inline.q('iframe[data-testid="viewer-frame-pdf"]').getAttribute('src').startsWith('blob:'));
    assert.equal(inline.q('[data-testid="viewer-pdf-fallback"]') === null, true);
    assert.equal(inline.q('iframe').hasAttribute('sandbox'), false, 'the browser PDF viewer does not run inside a sandboxed frame');
    const fallback = await mount(t, h(pdfPane.PdfPane, { name: 'report.pdf', bytes: pdf, inline: false, onRefresh() {} }));
    assert.equal(fallback.q('iframe') === null, true);
    assert.match(fallback.q('[data-testid="viewer-pdf-fallback"]').textContent, /cannot show PDFs inline/);
    assert.ok(fallback.q('[data-testid="viewer-pdf-download"]'));
    assert.ok(fallback.q('[data-testid="viewer-more"]'));
    window.navigator.pdfViewerEnabled = false;
    assert.equal(pdfPane.browserShowsPdf(), false);
    delete window.navigator.pdfViewerEnabled;
  });

  async function documents(t, mediaType, initial) {
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-documents', authorize: () => true });
    const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
    const target = { resource: { providerId: 'fictional-documents', path: mediaType === 'text/html' ? 'page.html' : 'notes.md' }, view: { kind: 'published' } };
    const client = { read: request => provider.read(request, identity), publish: request => provider.publication.publish(request, identity), lookup: id => provider.reconciliation.lookup(id, identity) };
    const publish = (operationId, text, expected) => provider.publication.publish({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: expected ? 'replace' : 'create', target: expected ?? target, ...(expected ? {} : { expected: { kind: 'absent' } }), bytes: new TextEncoder().encode(text), mediaType }] }, identity);
    await publish('seed', initial);
    const read = async () => (await client.read({ target, revision: { kind: 'latest' } }));
    const create = mediaType === 'text/html' ? createHtmlController : createMarkdownController;
    const controller = create({ identity, client, instanceId: `pane-${Math.random()}`, epoch: 'page', source: { kind: 'saved', snapshot: (await read()).snapshot } });
    t.after(() => { controller.dispose(); provider.close(); });
    return { controller, client, read, publish, target };
  }

  await t.test('the Markdown pane puts mode, Save and status in the bar; Refresh never drops unsaved edits; unsafe documents stay in source', async t => {
    const d = await documents(t, 'text/markdown', '# Plan\n\n- [x] done\n');
    const view = await mount(t, h(markdownPane.MarkdownPane, { controller: d.controller, title: 'Plan', subtitle: 'Markdown', onShare() {} }));
    assert.equal(view.q('section[data-boring="markdown-editor"] > header') === null, true, 'the editor has no header of its own');
    assert.equal(view.q('[data-testid="viewer-status"]') === null, true, 'a clean document shows no status');
    assert.equal(view.q('[data-testid="viewer-save"]') === null, true, 'Save waits for an edit');
    assert.ok(view.q('[role="toolbar"][aria-label="Text formatting"] button[aria-label="Bold"] svg'), 'icon buttons');
    await view.click('[data-testid="viewer-mode-source"]');
    const area = view.q('textarea');
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(area, '# Plan\n\n- [x] done\n- [ ] local edit\n'); area.dispatchEvent(new window.Event('input', { bubbles: true })); });
    assert.equal(view.q('[data-testid="viewer-status"]').textContent, 'Unsaved');
    const base = d.controller.getSnapshot().base.target;
    await d.publish('elsewhere', '# Plan\n\nchanged by someone else\n', base);
    await view.click('[data-testid="viewer-more"]'); await view.click('[data-testid="viewer-refresh"]'); await until(d.controller, state => state.remote !== null);
    assert.equal(d.controller.getSnapshot().text, '# Plan\n\n- [x] done\n- [ ] local edit\n', 'Refresh kept the unsaved edit');
    assert.equal(view.q('[data-testid="viewer-status"]').textContent, 'Changed elsewhere');
    assert.match(view.container.textContent, /Your local text has been kept/);
    await view.click('[data-testid="viewer-save"]'); await saved(d.controller);
    // Unsupported constructs: rich is unavailable.
    const raw = await documents(t, 'text/markdown', '---\ntitle: x\n---\n\n<div>raw</div>\n');
    const unsafe = await mount(t, h(markdownPane.MarkdownPane, { controller: raw.controller, title: 'Raw' }));
    assert.equal(unsafe.q('[data-testid="viewer-mode-rich"]').disabled, true);
    assert.equal(unsafe.q('[data-testid="viewer-mode-source"]').getAttribute('aria-pressed'), 'true');
    assert.match(unsafe.q('[data-testid="markdown-source-only"]').textContent, /front matter, raw HTML/);
  });

  await t.test('the HTML pane has preview and source, Save, and a passive sandboxed preview', async t => {
    const d = await documents(t, 'text/html', '<h1>Fictional</h1><script>alert(1)</script>\n');
    const view = await mount(t, h(htmlPane.HtmlPane, { controller: d.controller, title: 'Page', onShare() {} }));
    assert.equal(view.q('[data-testid="viewer-mode-preview"]').getAttribute('aria-pressed'), 'true');
    assert.equal(view.q('iframe').getAttribute('sandbox'), '');
    assert.doesNotMatch(view.q('iframe').getAttribute('srcdoc'), /<script/);
    await view.click('[data-testid="viewer-mode-source"]');
    assert.ok(view.q('textarea[aria-label="HTML source"]'));
    assert.equal(view.q('[data-testid="viewer-save"]') === null, true);
    await act(async () => { const area = view.q('textarea'); Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(area, '<p>edited</p>'); area.dispatchEvent(new window.Event('input', { bubbles: true })); });
    await view.click('[data-testid="viewer-save"]'); await saved(d.controller);
    assert.equal(new TextDecoder().decode((await d.read()).snapshot.bytes), '<p>edited</p>');
    assert.equal(view.q('[data-testid="viewer-status"]') === null, true);
  });
});
