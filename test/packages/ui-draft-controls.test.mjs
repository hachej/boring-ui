import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTextDraftSqlite } from '../fixtures/text-draft-sqlite.mjs';
import { Window } from 'happy-dom';
import { openDraftHost, draftIdentity, draftTarget } from '../../examples/draft-recovery/host.mjs';

test('four public concrete viewers expose explicit recovery and retain ordinary receipt semantics', { timeout: 30000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/', settings: { enableJavaScriptEvaluation: false, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const globals = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'SVGElement', 'ResizeObserver', 'DOMParser', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); const value = name === 'window' ? window : window[name]; Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: typeof value === 'function' && /^[a-z]/.test(name) ? value.bind(window) : value });
  }
  const previousNodeEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'test';
  globals.set('FontFace', Object.getOwnPropertyDescriptor(globalThis, 'FontFace'));
  class FictionalFontFace { constructor() { this.status = 'unloaded'; this.loaded = Promise.resolve(this); } load() { this.status = 'loaded'; return this.loaded; } }
  globalThis.FontFace = FictionalFontFace; Object.defineProperty(document, 'fonts', { configurable: true, value: new Set() });
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  t.after(async () => { if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv; await window.happyDOM.close(); for (const [name, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  const { createElement: h, act } = await import('react'); const { createRoot } = await import('react-dom/client');
  const { createMarkdownController } = await import('@hachej/boring-ui-kit/markdown'); const { MarkdownEditor } = await import('@hachej/boring-ui-kit/markdown-editor');
  const { createHtmlController } = await import('@hachej/boring-ui-kit/html'); const { HtmlViewer } = await import('@hachej/boring-ui-kit/html-viewer');
  const { createExperienceDocumentController } = await import('@hachej/boring-ui-kit/experience/document'); const { ExperienceDocument } = await import('@hachej/boring-ui-kit/experience/document-viewer');
  const { createCanvasController } = await import('@hachej/boring-ui-kit/canvas'); const { CanvasEditor } = await import('@hachej/boring-ui-kit/canvas-editor');
  const { createTLStore, atom } = await import('@tldraw/editor'); const { defaultShapeUtils, defaultBindingUtils } = await import('tldraw'); const { ASSETS } = await import('../fixtures/canvas-mounted-browser-assets.mjs');
  const wait = async predicate => { const deadline = Date.now() + 5000; while (!predicate()) { assert.ok(Date.now() < deadline, 'Concrete operation settles'); await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); } };
  const host = await openDraftHost({ filename: ':memory:' }); t.after(host.close);
  const cells = [{ ref: 'fictional/content', kind: 'fictional/content', version: 1, render: () => h('p', null, 'Independent fictional cell') }];
  let next = 0;
  for (const format of ['markdown', 'html', 'experience', 'canvas']) await t.test(`${format} explicit check and restore without publication`, async () => {
    const target = draftTarget(format), snapshot = (await host.provider.read({ target, revision: { kind: 'latest' } }, draftIdentity)).snapshot;
    const original = new TextDecoder('utf-8', { ignoreBOM: true }).decode(snapshot.bytes);
    let text = format === 'markdown' ? '# Recovered Markdown 🌞' : format === 'html' ? '\uFEFF<p>Recovered HTML 🌞</p>' : original;
    if (format === 'experience') { const layout = JSON.parse(original); layout.title = 'Recovered layout'; text = JSON.stringify(layout) + '\n'; }
    if (format === 'canvas') { const document = JSON.parse(original); Object.values(document.store).find(record => record.typeName === 'page').name = 'Recovered page'; text = JSON.stringify(document); }
    const key = { identity: draftIdentity, providerInstanceId: 'fictional-provider-v1', target, format: `${format}/v1` }, expiry = Date.now() + 60000;
    const directory = mkdtempSync(join(tmpdir(), 'boring-recovery-controls-'));
    const session = openTextDraftSqlite({ filename: join(directory, 'drafts.sqlite'), identity: draftIdentity, providerInstanceId: key.providerInstanceId, expiresAt: expiry });
    const record = { version: 1, ref: { key, base: { kind: 'revision', target: snapshot.ref }, writerId: 'stored-writer', sequence: 1 }, text, createdAt: Date.now(), expiresAt: expiry };
    assert.equal((await session.store.write(record)).kind, 'stored');
    let lists = 0;
    const store = { ...session.store, list: async (...args) => { lists++; return session.store.list(...args); } };
    const client = { read: request => host.provider.read(request, draftIdentity), publish: request => host.provider.publication.publish(request, draftIdentity), lookup: id => host.provider.reconciliation.lookup(id, draftIdentity) };
    const options = { identity: draftIdentity, source: { kind: 'saved', snapshot }, client, instanceId: `view-${++next}`, epoch: 'page', drafts: { store, providerInstanceId: key.providerInstanceId, signal: session.signal, expiresAt: expiry, retentionMs: 30000 } };
    let nativeStore;
    const controller = format === 'markdown' ? createMarkdownController(options) : format === 'html' ? createHtmlController(options) : format === 'experience' ? createExperienceDocumentController({ ...options, cells, canView: () => true }) : createCanvasController({ ...options, store: nativeStore = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils, users: { currentUser: atom('fictional controls user', null) } }) });
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
    const component = format === 'markdown' ? MarkdownEditor : format === 'html' ? HtmlViewer : format === 'experience' ? ExperienceDocument : CanvasEditor;
    const props = { controller, initialMode: 'source', mode: 'source', cells, canView: () => true, assetUrls: ASSETS };
    const click = async label => { const button = [...container.querySelectorAll('[data-boring="text-draft-controls"] button')].find(button => button.textContent === label); assert.ok(button, label); assert.equal(button.disabled, false); await act(async () => { button.click(); }); };
    try {
      await act(async () => { root.render(h(component, props)); }); assert.equal(lists, 0); assert.equal(controller.getSnapshot().dirty, false);
      await click('Check stored drafts'); await wait(() => controller.getSnapshot().recovery.discovery.kind === 'offered'); assert.equal(controller.getSnapshot().recovery.discovery.kind, 'offered'); assert.equal(controller.getSnapshot().dirty, false);
      await click('Restore draft'); await wait(() => controller.getSnapshot().dirty && container.textContent.includes('restored locally')); assert.equal(controller.getSnapshot().dirty, true); assert.match(container.textContent, /restored locally/);
      const after = await host.provider.read({ target, revision: { kind: 'latest' } }, draftIdentity); assert.equal(after.snapshot.ref.revision, snapshot.ref.revision);
      if (format === 'experience') assert.equal(controller.getSnapshot().pin, null);
      let save; await act(async () => { save = await controller.flush(controller.actions.selection()); }); assert.equal(save.kind, 'saved'); assert.equal((await client.lookup(save.receipt.operationId)).kind, 'committed');
      if (format === 'html') {
        let release;
        const heldStore = { ...store, list: () => new Promise(resolve => { release = resolve; }) };
        const currentSnapshot = (await client.read({ target, revision: { kind: 'latest' } })).snapshot;
        const other = createHtmlController({ ...options, source: { kind: 'saved', snapshot: currentSnapshot }, instanceId: 'other-html', drafts: { ...options.drafts, store: heldStore } });
        await act(async () => { root.render(h(HtmlViewer, { controller: other, mode: 'source' })); });
        await click('Check stored drafts'); await wait(() => !!release);
        await act(async () => { root.render(h(HtmlViewer, { controller, mode: 'source' })); });
        await act(async () => { release({ kind: 'denied', reason: 'Old controller refusal must not leak' }); });
        await wait(() => other.getSnapshot().recovery.discovery.kind === 'denied');
        assert.ok(!container.textContent.includes('Old controller refusal must not leak'));
        other.dispose();
        const failed = createHtmlController({ ...options, source: { kind: 'saved', snapshot: currentSnapshot }, instanceId: 'failed-html', drafts: { ...options.drafts, store: { ...store, list: async () => ({ kind: 'unavailable', reason: 'Injected host storage is unavailable' }) } } });
        await act(async () => { root.render(h(HtmlViewer, { controller: failed, mode: 'source' })); }); await click('Check stored drafts');
        await wait(() => container.textContent.includes('Injected host storage is unavailable')); assert.equal(failed.getSnapshot().dirty, false); failed.dispose();
        await act(async () => { root.render(h(HtmlViewer, { controller, mode: 'source' })); });
      }
      await act(async () => { await session.revoke(); }); assert.equal(controller.getSnapshot().recovery.kind, 'revoked'); assert.match(container.textContent, /Draft recovery revoked/);
      await act(async () => { root.unmount(); }); assert.equal(controller.getSnapshot().lifecycle, 'active');
    } finally { await act(async () => { root.unmount(); controller.dispose(); }); nativeStore?.dispose(); session.close(); rmSync(directory, { recursive: true, force: true }); container.remove(); }
  });
});
