import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../shared/sqlite-workspaces.mjs';
import { fictionalPdf } from '../fixtures/fictional-pdf.mjs';
import { fictionalPng } from '../fixtures/blob-bytes.mjs';

// Compiles the viewers registry source as a consumer would and drives it in a DOM environment (structure and behaviour, not browser
// geometry: the studio scenarios `docs-*` are the browser evidence).
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = `${root}.cache/viewers-test`;
mkdirSync(out, { recursive: true });
/** The viewer items (D-257): the frame and its helpers, and one item per pane. */
const FOLDER = { 'markdown-pane.tsx': 'viewer-markdown', 'html-pane.tsx': 'viewer-html', 'image-pane.tsx': 'viewer-image', 'pdf-pane.tsx': 'viewer-pdf', 'pdf-pages.tsx': 'viewer-pdf', 'local-file-viewer.tsx': 'viewer-pdf' };
async function load(name) {
  await build({ entryPoints: [`${root}registry/${FOLDER[name] ?? 'viewer-frame'}/${name}`], outfile: `${out}/${name.replace(/\.tsx?$/, '')}.mjs`, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', logLevel: 'silent' });
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
  const menus = await load('menu.tsx');
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
    const q = selector => container.querySelector(selector) ?? document.querySelector('[data-slot="dropdown-menu-content"]')?.querySelector(selector) ?? null;
    const click = async selector => { const node = q(selector); assert.ok(node, selector); await act(async () => node.click()); };
    return { container, q, click, render: async next => { await act(async () => rootNode.render(next)); } };
  };
  const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  // The words a sighted person sees: everything except screen-reader-only text.
  const visibleText = node => [...node.childNodes].map(child => child.nodeType === 3 ? child.textContent : child.classList?.contains('sr-only') ? '' : visibleText(child)).join('');
  // A quiet status is a coloured dot: its label is the tooltip and the accessible name, never visible words.
  const assertDot = (view, label, tone) => {
    const status = view.q('[data-testid="viewer-status"]');
    assert.ok(status, `a ${label} status`);
    assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.getAttribute('aria-label'), label);
    assert.equal(status.getAttribute('title'), label);
    assert.equal(status.dataset.tone, tone);
    assert.ok(status.querySelector('svg[aria-hidden="true"]'), 'the dot');
    assert.equal(visibleText(status), '', `no visible ${label} text`);
  };
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
    for (const [id, label] of [['more', 'More actions'], ['close', 'Close']]) {
      const button = all.q(`[data-testid="viewer-${id}"]`);
      assert.equal(button.getAttribute('aria-label'), label); assert.equal(button.getAttribute('title'), label);
    }
    for (const id of ['refresh', 'share', 'copy', 'download', 'open']) assert.equal(all.q(`[data-testid="viewer-${id}"]`) === null, true, `${id} waits in the menu`);
    await all.click('[data-testid="viewer-more"]');
    assert.deepEqual([...document.querySelectorAll('[data-slot="dropdown-menu-content"] [role="menuitem"]')].map(node => node.textContent), ['Share', 'Reload', 'Copy', 'Download', 'Open in new tab']);
  });

  await t.test('a host can portal the existing bar into its shared header and keep the same menu and close handlers', async t => {
    const { createPortal } = await import('react-dom');
    const header = document.createElement('div'); document.body.append(header);
    t.after(() => header.remove());
    let copied = 0, closed = 0;
    const view = await mount(t, h(frame.ViewerWindowProvider, { value: { renderHeader: bar => createPortal(bar, header) } },
      h(frame.ViewerFrame, { title: 'notes.md', onCopy: () => { copied++; }, onClose: () => { closed++; } }, 'editor body')));
    assert.equal(Boolean(view.q('[data-testid=viewer-bar]')), false, 'no second bar above the editor');
    assert.equal(header.querySelector('h2').textContent, 'notes.md');
    assert.equal(view.q('[data-testid=viewer-body]').textContent, 'editor body');
    await act(async () => header.querySelector('[data-testid=viewer-more]').click());
    await act(async () => document.querySelector('[data-testid=viewer-copy]').click());
    await settle();
    assert.equal(copied, 1);
    await act(async () => header.querySelector('[data-testid=viewer-close]').click());
    assert.equal(closed, 1);
    await view.render(h(frame.ViewerFrame, { title: 'default.md' }, 'body'));
    assert.equal(header.childElementCount, 0, 'a detached viewer leaves no bar behind');
    assert.equal(view.q('[data-testid=viewer-bar] h2').textContent, 'default.md', 'the default still renders its own bar');
  });

  await t.test('stacked header keeps title, menu and close together above viewer controls inside the same frame', async t => {
    let closed = 0, toggled = 0;
    const control = h('button', { 'data-testid': 'fixture-mode', onClick: () => { toggled++; } }, 'Source');
    const props = { compactHeader: false, title: 'AP policy.md', subtitle: 'Policies/AP policy.md · Markdown · 2 KB', controls: control, onCopy() {}, onClose: () => { closed++; } };
    const view = await mount(t, h(frame.ViewerWindowProvider, { value: { headerLayout: 'stacked' } }, h(frame.ViewerFrame, props, 'document')));
    const titlebar = view.q('[data-testid=viewer-titlebar]');
    const toolbar = view.q('[data-testid=viewer-controls]');
    assert.ok(titlebar, 'a title row separate from the content toolbar');
    assert.equal(titlebar.querySelector('h2').textContent, 'AP policy.md');
    assert.ok(titlebar.querySelector('[data-testid=viewer-more]'));
    assert.ok(titlebar.querySelector('[data-testid=viewer-close]'));
    assert.equal(titlebar.contains(toolbar), false);
    assert.equal(titlebar.nextElementSibling, toolbar, 'controls immediately under the title row');
    assert.equal(toolbar.parentElement, view.q('[data-testid=viewer-bar]'));
    assert.equal(view.q('[data-testid=viewer-frame]').contains(titlebar), true);
    await view.click('[data-testid=fixture-mode]');
    await view.click('[data-testid=viewer-close]');
    assert.deepEqual([toggled, closed], [1, 1]);
    await view.render(h(frame.ViewerFrame, props, 'document'));
    assert.equal(view.q('[data-testid=viewer-titlebar]'), null, 'default header structure is unchanged');
    assert.equal(view.q('[data-testid=viewer-controls]').parentElement, view.q('[data-testid=viewer-bar]'));
  });

  await t.test('Reload (in the menu) runs the handler and reports a failure instead of throwing', async t => {
    let calls = 0;
    const view = await mount(t, h(frame.ViewerFrame, { title: 'a', onRefresh: () => { calls++; return calls === 1 ? undefined : Promise.reject(new Error('fictional')); } }));
    await view.click('[data-testid="viewer-more"]'); await view.click('[data-testid="viewer-refresh"]'); await settle();
    assert.equal(calls, 1); assert.equal(view.q('[data-testid="viewer-notice"]') === null, true);
    await view.click('[data-testid="viewer-more"]'); await view.click('[data-testid="viewer-refresh"]'); await settle();
    assert.equal(view.q('[data-testid="viewer-notice"]').textContent, 'Refresh failed');
  });

  await t.test('the status appears only when something needs attention; read-only is a word in the subtitle', async t => {
    const saved = await mount(t, h(frame.ViewerFrame, { title: 'a', status: { label: 'Saved', tone: 'success' } }));
    assert.equal(saved.q('[data-testid="viewer-status"]') === null, true);
    const unsaved = await mount(t, h(frame.ViewerFrame, { title: 'a', status: { label: 'Unsaved', tone: 'warning' } }));
    assertDot(unsaved, 'Unsaved', 'warning');
    assert.match(unsaved.q('[data-testid="viewer-status"] svg').getAttribute('class'), /\bfill-muted-foreground\b/, 'unsaved and saving use the muted role');
    assert.doesNotMatch(unsaved.q('[data-testid="viewer-status"] svg').getAttribute('class'), /animate-|--success|--warning/, 'no pulse, no host-only roles');
    const refused = await mount(t, h(frame.ViewerFrame, { title: 'a', status: { label: 'Not saved: offline', tone: 'danger' } }));
    assert.equal(refused.q('[data-testid="viewer-status"]').dataset.tone, 'danger');
    assert.equal(visibleText(refused.q('[data-testid="viewer-status"]')), 'Not saved: offline', 'a status the person must act on shows its words beside the dot');
    const reading = await mount(t, h(frame.ViewerFrame, { title: 'a', subtitle: 'HTML page', status: { label: 'Read-only' } }));
    assert.equal(reading.q('[data-testid="viewer-status"]') === null, true);
    assert.equal(reading.q('[data-testid="viewer-subtitle"]').textContent, 'HTML page·Read-only');
  });

  await t.test('Share hands the host the title, target and revision; the default copies a link and says so, or uses the Web Share API', async t => {
    let seen;
    const link = request => { seen = request; return `https://fictional.invalid/?open=${request.target}`; };
    const written = [];
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { written.push(text); } } });
    const view = await mount(t, h(frame.ViewerFrame, { compactHeader: false, title: 'notes.md', target: '/workspace/notes.md', revision: 'r7', onShare: sharing.createLinkShare(link) }));
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

  await t.test('Copy, Download and Share live in the menu while Close stays on the bar', async t => {
    let copied = 0;
    const view = await mount(t, h(frame.ViewerFrame, { title: 'a', onRefresh() {}, onShare() {}, onCopy: () => { copied++; }, onDownload() {}, onClose() {} }));
    assert.equal(view.q('[data-testid="viewer-copy"]') === null, true);
    assert.equal(view.q('[data-testid="viewer-share"]'), null);
    assert.ok(view.q('[data-testid="viewer-close"]'));
    await view.click('[data-testid="viewer-more"]');
    assert.equal(view.q('[data-testid="viewer-more"]').getAttribute('aria-expanded'), 'true');
    assert.deepEqual([...document.querySelectorAll('[data-slot="dropdown-menu-content"] [role="menuitem"]')].map(node => node.textContent), ['Share', 'Reload', 'Copy', 'Download']);
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

  await t.test('the PDF viewer uses the browser viewer over an object URL; without one, pdf.js draws it, and Download remains when that fails too', async t => {
    const pdf = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
    const inline = await mount(t, h(pdfPane.PdfPane, { name: 'report.pdf', bytes: pdf, inline: true }));
    assert.ok(inline.q('iframe[data-testid="viewer-frame-pdf"]').getAttribute('src').startsWith('blob:'));
    assert.equal(inline.q('[data-testid="viewer-pdf-fallback"]') === null, true);
    assert.equal(inline.q('iframe').hasAttribute('sandbox'), false, 'the browser PDF viewer does not run inside a sandboxed frame');
    const page = await mount(t, h(pdfPane.PdfPane, { name: 'report.pdf', blob: new Blob(['<script>1</script>'], { type: 'text/html' }), inline: true }));
    await settle();
    assert.equal(page.q('iframe') === null, true, 'a blob that is not a PDF is never loaded into the unsandboxed frame');
    assert.ok(page.q('[data-testid="viewer-pdf-fallback"]'), 'it offers Download instead');
    const typed = await mount(t, h(pdfPane.PdfPane, { name: 'report.pdf', blob: new Blob([pdf], { type: 'application/pdf' }), inline: true }));
    assert.ok(typed.q('iframe[data-testid="viewer-frame-pdf"]'), 'a PDF blob still uses the browser viewer');
    const fallback = await mount(t, h(pdfPane.PdfPane, { name: 'report.pdf', bytes: pdf, inline: false, onRefresh() {} }));
    assert.equal(fallback.q('iframe') === null, true);
    // No browser viewer: pdf.js is tried first. This DOM has no Worker, so the worker cannot start and the pane falls back to Download.
    for (let tries = 0; tries < 200 && !fallback.q('[data-testid="viewer-pdf-fallback"]'); tries++) await settle();
    assert.equal(fallback.q('[data-testid="viewer-stage"]').dataset.pdf, 'fallback');
    assert.match(fallback.q('[data-testid="viewer-pdf-fallback"]').textContent, /cannot show PDFs inline/);
    assert.ok(fallback.q('[data-testid="viewer-pdf-download"]'));
    assert.ok(fallback.q('[data-testid="viewer-more"]'));
    window.navigator.pdfViewerEnabled = false;
    assert.equal(pdfPane.browserShowsPdf(), false);
    delete window.navigator.pdfViewerEnabled;
  });

  await t.test('LocalFileViewer opens browser-only File PDFs and PNGs by type or name and revokes replaced and unmounted URLs', async t => {
    const { LocalFileViewer } = await load('local-file-viewer.tsx');
    const created = [], revoked = [];
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    URL.createObjectURL = blob => { const url = create(blob); created.push({ url, blob }); return url; };
    URL.revokeObjectURL = url => { revoked.push(url); revoke(url); };
    t.after(() => { URL.createObjectURL = create; URL.revokeObjectURL = revoke; });
    const pdfBytes = fictionalPdf([['Compte rendu fictif']]);
    const file = new File([pdfBytes], 'compte-rendu-fictif.pdf', { type: 'application/pdf' });
    let closed = 0;
    const view = await mount(t, h(LocalFileViewer, { name: file.name, blob: file, onClose: () => { closed++; } }));
    assert.equal(view.q('[data-testid="viewer-title"]').textContent, file.name);
    assert.ok(view.q('[data-testid="viewer-frame-pdf"]').getAttribute('src').startsWith(created[0].url));
    assert.deepEqual(new Uint8Array(await created[0].blob.arrayBuffer()), pdfBytes);
    await view.click('[data-testid="viewer-close"]'); assert.equal(closed, 1);
    for (const [name, type] of [['unnamed', 'image/png'], ['fictional.PNG', 'application/octet-stream']]) {
      const png = fictionalPng(2, 2);
      await view.render(h(LocalFileViewer, { name, blob: new Blob([png], { type }) }));
      assert.equal(view.q('[data-testid="viewer-frame-pdf"]'), null);
      assert.equal(view.q('[data-testid="viewer-image"]').getAttribute('src'), created.at(-1).url);
      assert.equal(created.at(-1).blob.type, 'image/png');
      assert.deepEqual(new Uint8Array(await created.at(-1).blob.arrayBuffer()), png);
      assert.equal(view.q('[data-testid="viewer-close"]'), null, 'Close requires a handler');
    }
    await view.render(h(LocalFileViewer, { name: 'extension-only.PDF', blob: new Blob([pdfBytes]) }));
    assert.ok(view.q('[data-testid="viewer-frame-pdf"]'));
    assert.equal(created.at(-1).blob.type, 'application/pdf');
    await view.render(null);
    assert.deepEqual(revoked, created.map(entry => entry.url), 'every preview URL is revoked exactly once');
  });

  await t.test('LocalFileViewer renders UTF-8 text literally and never displays a late previous Blob read', async t => {
    const { LocalFileViewer } = await load('local-file-viewer.tsx');
    const text = '\uFEFFCompte rendu fictif\r\n<script>fictional()</script>';
    const view = await mount(t, h(LocalFileViewer, { name: 'notes.txt', blob: new File([text], 'notes.txt') }));
    assert.equal(view.q('[data-testid="viewer-text"]').textContent, text);
    assert.equal(view.q('script'), null);
    let finish;
    class SlowBlob extends Blob { arrayBuffer() { return new Promise(resolve => { finish = resolve; }); } }
    await view.render(h(LocalFileViewer, { name: 'old.txt', blob: new SlowBlob(['old']) }));
    assert.equal(view.q('[data-testid="viewer-text"]'), null, 'old text is hidden while the next file loads');
    await view.render(h(LocalFileViewer, { name: 'new', blob: new Blob(['new fictional text'], { type: 'text/plain' }) }));
    await act(async () => finish(new TextEncoder().encode('old fictional text').buffer));
    assert.equal(view.q('[data-testid="viewer-text"]').textContent, 'new fictional text');
  });

  await t.test('LocalFileViewer offers no preview for unknown, invalid or unreadable files and downloads the original bytes', async t => {
    const { LocalFileViewer } = await load('local-file-viewer.tsx');
    const created = [], revoked = [], downloads = [];
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL, click = window.HTMLAnchorElement.prototype.click;
    URL.createObjectURL = blob => { const url = create(blob); created.push({ url, blob }); return url; };
    URL.revokeObjectURL = url => { revoked.push(url); revoke(url); };
    window.HTMLAnchorElement.prototype.click = function () { downloads.push({ name: this.download, url: this.href }); };
    t.after(() => { URL.createObjectURL = create; URL.revokeObjectURL = revoke; window.HTMLAnchorElement.prototype.click = click; });
    class UnreadableBlob extends Blob { arrayBuffer() { return Promise.reject(new Error('fictional read failure')); } }
    for (const [name, blob] of [
      ['unknown.bin', new Blob(['printable but unknown'], { type: 'application/x-fictional' })],
      ['invalid.txt', new Blob([new Uint8Array([0xff])])],
      ['binary.txt', new Blob([new Uint8Array([65, 0, 66])])],
      ['unreadable.txt', new UnreadableBlob(['unreadable'])],
    ]) {
      const view = await mount(t, h(LocalFileViewer, { name, blob }));
      assert.match(view.q('[role="status"]').textContent, /No preview/);
      assert.equal(view.q('[data-testid="viewer-text"]'), null);
      assert.equal(view.q('iframe, img, textarea'), null);
      await view.click('[data-testid="viewer-more"]'); await view.click('[data-testid="viewer-download"]');
      assert.equal(downloads.at(-1).name, name);
      assert.equal(downloads.at(-1).url, created.at(-1).url);
      assert.equal(created.at(-1).blob.size, blob.size);
      if (!(blob instanceof UnreadableBlob)) assert.deepEqual(await created.at(-1).blob.arrayBuffer(), await blob.arrayBuffer());
      await view.render(null);
    }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    assert.deepEqual(revoked, created.map(entry => entry.url), 'download URLs are also released');
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

  await t.test('version menus show relative time, provenance, day groups and a quiet Current marker', async t => {
    let selected;
    const now = Date.now();
    const view = await mount(t, h(menus.ViewerVersions, { current: 'new', onSelect: id => { selected = id; }, versions: [
      { id: 'new', label: 'unused time', savedAt: now - 120000, source: 'agent' },
      { id: 'old', label: 'unused time', savedAt: now - 86400000, source: 'publish', changeSummary: '+2 lines' },
    ] }));
    await view.click('[data-testid=viewer-versions]');
    const rows = [...document.querySelectorAll('[data-testid=viewer-versions-item]')];
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent, /2 min ago/);
    assert.equal(rows[0].querySelector('[data-testid=viewer-versions-description]').textContent, 'Agent');
    assert.match(rows[0].textContent, /Current/);
    assert.equal(rows[0].getAttribute('aria-checked'), 'true');
    assert.match(rows[1].querySelector('[data-testid=viewer-versions-description]').textContent, /You · \+2 lines/);
    assert.match(document.querySelector('[data-testid=viewer-versions-list]').textContent, /Today.*Yesterday/s);
    await act(async () => rows[1].click()); assert.equal(selected, 'old');
  });

  await t.test('standalone Markdown close awaits autosave and refuses to close over a failed save', async t => {
    const d = await documents(t, 'text/markdown', 'original');
    let closed = 0;
    const view = await mount(t, h(markdownPane.MarkdownPane, { controller: d.controller, initialMode: 'source', onClose: () => { assert.equal(d.controller.getSnapshot().dirty, false); closed++; } }));
    assert.equal(view.q('[data-testid="viewer-save"]'), null, 'autosave is the pane default');
    const input = async text => act(async () => { const area = view.q('textarea'); Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(area, text); area.dispatchEvent(new window.Event('input', { bubbles: true })); });
    await input('flushed before standalone close');
    await view.click('[data-testid="viewer-close"]'); await settle();
    assert.equal(closed, 1);
    assert.equal(new TextDecoder().decode((await d.read()).snapshot.bytes), 'flushed before standalone close');
    d.client.publish = async () => ({ kind: 'unavailable', reason: 'Fictional offline provider' });
    await input('keep this failed draft');
    await view.click('[data-testid="viewer-close"]'); await settle();
    assert.equal(closed, 1, 'a bare pane never drops a draft when its save fails');
    assert.equal(view.q('textarea').value, 'keep this failed draft');
    assert.match(view.q('[data-testid="viewer-status"]').textContent, /Not saved/);
    assert.match(visibleText(view.q('[data-testid="viewer-status"]')), /Not saved: Fictional offline provider/, 'a refused save shows its reason in words');
  });

  await t.test('manual Markdown Save carries the translated label into the phone overflow controls', async t => {
    for (const save of ['Save', 'Enregistrer']) {
      const d = await documents(t, 'text/markdown', 'original');
      d.controller.actions.edit('fictional draft');
      const view = await mount(t, h(markdownPane.MarkdownPane, { controller: d.controller, autosave: false, labels: { save } }));
      await view.click('[data-testid="viewer-more"]');
      const button = document.querySelector('[data-testid="viewer-more-list"] [data-testid="viewer-save-menu"]');
      assert.ok(button, 'the phone overflow has the manual Save control');
      assert.equal(button.dataset.slot, 'dropdown-menu-item', 'Save uses the same menu item as the standard actions');
      assert.equal(button.getAttribute('role'), 'menuitem');
      assert.equal(button.textContent.trim(), save, 'Save has visible words, not only an accessible name');
      assert.equal(button.getAttribute('aria-label'), save);
      await act(async () => button.click()); await saved(d.controller);
      assert.equal(new TextDecoder().decode((await d.read()).snapshot.bytes), 'fictional draft');
      await view.render(null);
    }
  });

  await t.test('the Markdown pane keeps tools in its real menu; Refresh never drops unsaved edits; unsafe documents stay in source', async t => {
    const d = await documents(t, 'text/markdown', '# Plan\n\n- [x] done\n');
    let tools;
    const view = await mount(t, h(markdownPane.MarkdownPane, { controller: d.controller, title: 'Plan', subtitle: 'Markdown', autosave: false, onShare() {}, onMountedTools: value => { tools = value; } }));
    assert.equal(view.q('section[data-boring="markdown-editor"] > header') === null, true, 'the editor has no header of its own');
    assertDot(view, 'Saved', 'success');
    assert.match(view.q('[data-testid="viewer-status"] svg').getAttribute('class'), /\bfill-primary\b/, 'saved uses the primary role');
    assert.equal(view.q('[data-testid="viewer-save"]') === null, true, 'Save waits for an edit');
    assert.equal(view.q('.boring-markdown-toolbar'), null, 'formatting is selection-only by default');
    assert.equal(view.q('[data-testid="viewer-bar"] [data-testid="viewer-mode-source"]'), null, 'the header has no visible mode switch');
    await act(async () => {
      const result = await tools.select.invoke(tools.getTarget(), { expiresAt: Date.now() + 5000, selection: { kind: 'rich', anchor: 2, head: 5 } });
      assert.equal(result.kind, 'applied');
    });
    await view.click('[data-testid="viewer-more"]');
    const rich = () => view.q('[data-testid="viewer-mode-rich"]'), source = () => view.q('[data-testid="viewer-mode-source"]');
    assert.deepEqual([rich(), source()].map(item => [item.dataset.slot, item.textContent.trim(), item.getAttribute('aria-checked'), !!item.querySelector('svg[aria-hidden="true"]')]),
      [['dropdown-menu-radio-item', 'Formatted', 'true', true], ['dropdown-menu-radio-item', 'Markdown', 'false', true]], 'real shadcn radio items with icons and labels');
    assert.equal(document.querySelector('[data-testid="viewer-more-list"] [data-testid="viewer-formatting"]'), null, 'no formatting item in the menu');
    await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const pin = view.q('[data-testid="viewer-bar"] [data-testid="viewer-formatting"]');
    assert.equal(pin.dataset.slot, 'toggle', 'Formatting uses the host Toggle pressed-state skin');
    assert.equal(pin.getAttribute('aria-pressed'), 'false');
    assert.equal(pin.getAttribute('title'), 'Formatting');
    assert.ok(pin.querySelector('svg.lucide-type'));
    await view.click('[data-testid="viewer-formatting"]');
    assert.ok(view.q('.boring-markdown-toolbar button[aria-label="Bold"] svg'), 'the header icon pins the formatting row');
    await view.click('[data-testid="viewer-more"]');
    await view.click('[data-testid="viewer-mode-source"]');
    assert.equal(view.q('section[data-boring="markdown-editor"]').dataset.mode, 'source');
    assert.equal(document.activeElement === view.q('textarea'), true, 'choosing a mode hands focus to the editor, not back to the menu trigger');
    assert.equal(d.controller.getSnapshot().text, '# Plan\n\n- [x] done\n');
    assert.equal(view.q('[data-testid="viewer-formatting"]'), null, 'source hides the header icon');
    await view.click('[data-testid="viewer-more"]');
    await view.click('[data-testid="viewer-mode-rich"]');
    assert.equal(view.q('[data-testid="viewer-formatting"]').getAttribute('aria-pressed'), 'true', 'the viewer session remembers pinning');
    assert.equal(view.q('section[data-boring="markdown-editor"]').dataset.mode, 'rich');
    assert.ok(view.q('.boring-markdown-toolbar'));
    const inspected = await tools.inspect.invoke(tools.getTarget(), { expiresAt: Date.now() + 5000 });
    assert.equal(inspected.kind, 'applied');
    assert.deepEqual([inspected.value.currentSelection.anchor, inspected.value.currentSelection.head], [2, 5], 'menu mode switches retain the native caret');
    await view.click('[data-testid="viewer-more"]'); await view.click('[data-testid="viewer-mode-source"]');
    const area = view.q('textarea');
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(area, '# Plan\n\n- [x] done\n- [ ] local edit\n'); area.dispatchEvent(new window.Event('input', { bubbles: true })); });
    assertDot(view, 'Unsaved', 'warning');
    const base = d.controller.getSnapshot().base.target;
    await d.publish('elsewhere', '# Plan\n\nchanged by someone else\n', base);
    await view.click('[data-testid="viewer-more"]'); await view.click('[data-testid="viewer-refresh"]'); await until(d.controller, state => state.remote !== null);
    assert.equal(d.controller.getSnapshot().text, '# Plan\n\n- [x] done\n- [ ] local edit\n', 'Refresh kept the unsaved edit');
    assert.equal(view.q('[data-testid="viewer-status"]').dataset.tone, 'danger');
    assert.match(view.q('[data-testid="viewer-status"] svg').getAttribute('class'), /\bfill-destructive\b/, 'a conflict uses the destructive role');
    assert.equal(visibleText(view.q('[data-testid="viewer-status"]')), 'Changed elsewhere', 'a conflict shows its words: the person must act');
    assert.match(view.container.textContent, /Your local text has been kept/);
    await view.click('[data-testid="viewer-save"]'); await saved(d.controller);
    assert.equal(visibleText(view.q('[data-testid="viewer-status"]')), 'Changed elsewhere', 'a refused stale write retains the existing conflict status');
    // Preserved constructs open Formatted in the real frame, not just the standalone editor.
    const preserved = await documents(t, 'text/markdown', '---\ntitle: x\n---\n\n<div>raw</div>\n');
    const formatted = await mount(t, h(markdownPane.MarkdownPane, { controller: preserved.controller, title: 'Preserved' }));
    assert.equal(formatted.q('section[data-boring="markdown-editor"]').dataset.mode, 'rich');
    assert.ok(formatted.q('[data-preserved="Front matter"]'));
    assert.ok(formatted.q('[data-preserved="HTML"]'));
    assert.equal(preserved.controller.getSnapshot().dirty, false);
    await formatted.render(null);
    // A genuine unsupported encoding still explains the fallback.
    const raw = await documents(t, 'text/markdown', '# Mixed\r\n\nMixed line endings.\n');
    const unsafe = await mount(t, h(markdownPane.MarkdownPane, { controller: raw.controller, title: 'Raw' }));
    await unsafe.click('[data-testid="viewer-more"]');
    assert.equal(unsafe.q('[data-testid="viewer-mode-rich"]').getAttribute('aria-disabled'), 'true');
    assert.match(unsafe.q('[data-testid="viewer-mode-rich"]').getAttribute('title'), /^Formatted is off: this document contains mixed line endings/, 'the disabled mode says why');
    assert.match(document.getElementById(unsafe.q('[data-testid="viewer-mode-rich"]').getAttribute('aria-describedby')).textContent, /mixed line endings/, 'the visible reason is also its accessible description');
    assert.equal(unsafe.q('[data-testid="viewer-mode-source"]').getAttribute('aria-checked'), 'true');
    assert.match(unsafe.q('[data-testid="markdown-source-only"]').textContent, /mixed line endings/);
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
