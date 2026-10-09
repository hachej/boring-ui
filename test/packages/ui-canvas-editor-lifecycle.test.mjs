import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('native canvas editor lifecycle in a DOM (not browser qualification)', async t => {
  const window = new Window({ url: 'http://localhost/' });
  const previous = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'ResizeObserver', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === 'window' ? window : window[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? value.bind(window) : value });
  }
  previous.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const oldEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    if (oldEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldEnvironment;
  });
  const { act, createElement, StrictMode } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { TldrawEditor, createTLStore } = await import('@tldraw/editor');
  const { PageRecordType, DocumentRecordType, TLDOCUMENT_ID } = await import('@tldraw/tlschema');
  const { createCanvasController } = await import('@hachej/boring-ui-kit/canvas');

  for (const strict of [false, true]) await t.test(`${strict ? 'StrictMode' : 'ordinary'} unmount preserves controller, history, exact saves and remount`, async t => {
    let root, store, provider, controller, stopHistory, stopController;
    t.after(async () => {
      if (root) await act(async () => root.unmount());
      stopHistory?.(); stopController?.();
      controller?.dispose(); store?.dispose(); provider?.close();
    });
    store = createTLStore();
    const page = PageRecordType.create({ id: PageRecordType.createId('fictional-page'), name: 'Initial page', index: 'a1' });
    store.put([page, DocumentRecordType.create({ id: TLDOCUMENT_ID, name: 'Fictional ownership test' })]);
    provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-canvas', authorize: () => true });
    const identity = { scopeId: 'fictional', principalId: 'editor', initiatorId: 'alice' };
    const target = { resource: { providerId: 'fictional-canvas', path: 'ownership.canvas' }, view: { kind: 'published' } };
    let writes = 0;
    const client = {
      read: request => provider.read(request, identity),
      publish: request => { writes++; return provider.publication.publish(request, identity); },
      lookup: operationId => provider.reconciliation.lookup(operationId, identity),
    };
    controller = createCanvasController({ store, client, identity, source: { kind: 'new', target }, instanceId: 'canvas', epoch: 'one' });
    assert.equal((await controller.flush(controller.actions.selection())).kind, 'saved');
    assert.equal(controller.getSnapshot().dirty, false);
    writes = 0;
    let historyEvents = 0, controllerEvents = 0;
    stopHistory = store.listen(() => historyEvents++, { scope: 'document' });
    stopController = controller.subscribe(() => controllerEvents++);
    const container = window.document.createElement('div');
    window.document.body.append(container);
    root = createRoot(container);
    let mountedEditor;
    const props = { store, autoFocus: false, assetUrls: { fonts: {} }, onMount: editor => { mountedEditor = editor; } };
    const view = () => strict ? createElement(StrictMode, null, createElement(TldrawEditor, props)) : createElement(TldrawEditor, props);
    await act(async () => root.render(view()));
    assert.ok(mountedEditor, 'native onMount must run; an error boundary is not a successful mount');
    assert.equal(mountedEditor.store, store);
    assert.equal(writes, 0);
    assert.equal(controller.getSnapshot().problem, null);
    assert.equal(controller.getSnapshot().dirty, true);
    const authors = Object.values(store.getStoreSnapshot('document').store).filter(record => record.typeName === 'user');
    assert.ok(authors.length > 0, 'native author records must be retained');
    await act(async () => store.put([{ ...store.get(page.id), name: 'Mounted edit' }]));
    assert.equal((await controller.flush(controller.actions.selection())).kind, 'saved');
    await act(async () => root.unmount());
    root = null;
    assert.equal(mountedEditor.isDisposed, true);
    assert.equal(controller.getSnapshot().lifecycle, 'active');
    const before = { historyEvents, controllerEvents };
    const changed = structuredClone(store.getStoreSnapshot('document'));
    changed.store[page.id].name = 'Raw load after unmount';
    const observed = Promise.withResolvers();
    const timer = setTimeout(() => observed.reject(new Error('No live controller notification after native renderer unmount')), 2000);
    const unsubscribe = controller.subscribe(() => {
      if (controller.getSnapshot().document.store[page.id].name === 'Raw load after unmount') observed.resolve();
    });
    try {
      store.loadStoreSnapshot(changed);
      await observed.promise;
    } finally { clearTimeout(timer); unsubscribe(); }
    assert.ok(historyEvents > before.historyEvents);
    assert.ok(controllerEvents > before.controllerEvents);
    assert.equal(controller.getSnapshot().dirty, true);
    store.put([{ ...store.get(page.id), name: 'Raw put after unmount' }]);
    const selection = controller.actions.selection();
    const result = await controller.flush(selection);
    assert.equal(result.kind, 'saved');
    assert.deepEqual(result.selection, selection);
    const read = await client.read({ target, revision: { kind: 'latest' } });
    assert.equal(read.kind, 'available');
    assert.deepEqual(result.ref, read.snapshot.ref);
    assert.deepEqual(result.receipt.changes[0].after, result.ref);
    const saved = JSON.parse(new TextDecoder().decode(read.snapshot.bytes));
    assert.equal(saved.store[page.id].name, 'Raw put after unmount');
    for (const author of authors) assert.deepEqual(saved.store[author.id], author);
    assert.equal(controller.getSnapshot().dirty, false);
    const writesBeforeRemount = writes;
    root = createRoot(container);
    mountedEditor = undefined;
    await act(async () => root.render(view()));
    assert.ok(mountedEditor);
    assert.equal(mountedEditor.store.get(page.id).name, 'Raw put after unmount');
    assert.equal(writes, writesBeforeRemount);
  });
});
