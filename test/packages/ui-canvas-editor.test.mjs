import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

test('CanvasEditor DOM controls with fictional fonts and assets (not browser, font or geometry qualification)', async t => {
  const window = new Window({ url: 'http://localhost/' });
  const previous = new Map();
  const install = (name, value) => {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'ResizeObserver', 'MutationObserver', 'DOMParser', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    const value = name === 'window' ? window : window[name];
    install(name, ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? value.bind(window) : value);
  }
  install('IS_REACT_ACT_ENVIRONMENT', true);
  const requests = [], fontRequests = [];
  const assetBase = 'https://assets.example.invalid/';
  // Only the font/network boundary is fictional; the native editor and document runtime are real.
  class FictionalFontFace {
    constructor(family, source, descriptors) {
      this.family = family; this.source = source; Object.assign(this, descriptors);
      this.status = 'unloaded'; this.loaded = Promise.resolve(this);
      assert.ok(source.includes(assetBase), 'fonts must use host-provided asset URLs');
      fontRequests.push(source);
    }
    load() { this.status = 'loaded'; return this.loaded; }
  }
  install('FontFace', FictionalFontFace);
  Object.defineProperty(window.document, 'fonts', { configurable: true, value: new Set() });
  const fictionalFetch = async input => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    requests.push(url);
    assert.ok(url.startsWith(assetBase), `Unexpected network request: ${url}`);
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  };
  install('fetch', fictionalFetch);
  window.fetch = fictionalFetch;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  t.after(async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });
  const { act, createElement, Suspense, startTransition, StrictMode } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { createTLStore, LANGUAGES, createShapeId, Box } = await import('@tldraw/editor');
  const { defaultEditorAssetUrls, iconTypes, DEFAULT_EMBED_DEFINITIONS } = await import('tldraw');
  const { PageRecordType, DocumentRecordType, TLDOCUMENT_ID, TLINSTANCE_ID } = await import('@tldraw/tlschema');
  const { createCanvasController } = await import('@hachej/boring-ui-kit/canvas');
  const { CanvasEditor } = await import('@hachej/boring-ui-kit/canvas-editor');
  const assets = {
    fonts: Object.fromEntries(Object.keys(defaultEditorAssetUrls.fonts).map(key => [key, `${assetBase}fonts/${key}.woff2`])),
    icons: Object.fromEntries(iconTypes.map(key => [key, `${assetBase}icons.svg#${key}`])),
    translations: Object.fromEntries(LANGUAGES.map(({ locale }) => [locale, `${assetBase}translations/${locale}.json`])),
    embedIcons: Object.fromEntries(DEFAULT_EMBED_DEFINITIONS.map(({ type }) => [type, `${assetBase}embed/${type}.png`])),
  };
  const identity = { scopeId: 'fictional', principalId: 'canvas-editor', initiatorId: 'alice' };
  const pageId = PageRecordType.createId('fictional-page');
  const shapeId = createShapeId('fictional-box');
  async function waitFor(predicate, message) {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, message);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
  }
  function button(container, label) {
    const result = [...container.querySelectorAll('button')].find(node => node.textContent === label);
    assert.ok(result, `Missing button: ${label}`);
    return result;
  }
  async function fixture(t, { readOnly = false, hostReadOnly = false, mount = true, wrapClient = client => client, title = 'Fictional canvas' } = {}) {
    const store = createTLStore();
    store.put([DocumentRecordType.create({ id: TLDOCUMENT_ID, name: title }), PageRecordType.create({ id: pageId, name: 'Original', index: 'a1' })]);
    const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'fictional-documents', authorize: () => true });
    const target = { resource: { providerId: 'fictional-documents', path: 'canvas.json' }, view: { kind: 'published' } };
    let writes = 0;
    const client = {
      read: request => provider.read(request, identity),
      publish: request => { writes++; return provider.publication.publish(request, identity); },
      lookup: operationId => provider.reconciliation.lookup(operationId, identity),
    };
    const seed = createCanvasController({ store, client, identity, source: { kind: 'new', target }, instanceId: 'seed', epoch: 'seed' });
    assert.equal((await seed.flush(seed.actions.selection())).kind, 'saved');
    seed.dispose(); writes = 0;
    const source = { kind: 'saved', snapshot: (await client.read({ target, revision: { kind: 'latest' } })).snapshot };
    const controller = createCanvasController({ store, client: wrapClient(client), identity, source, instanceId: title, epoch: 'one', readOnly });
    store.put([store.schema.types.instance.create({ id: TLINSTANCE_ID, currentPageId: pageId, isReadonly: hostReadOnly })]);
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container);
    let editor, readonlyAtMount, unmounted = false;
    const render = async (selected = controller, mounted = native => { editor = native; readonlyAtMount = native.getIsReadonly(); }, assetUrls = assets, extra = {}) => {
      await act(async () => root.render(createElement(CanvasEditor, { controller: selected, assetUrls, title, onMount: mounted, ...extra })));
      await waitFor(() => container.querySelector('[aria-label="Canvas tools"]'), 'Native canvas did not mount');
    };
    const unmount = async () => { await act(async () => root.unmount()); unmounted = true; };
    t.after(async () => {
      if (!unmounted) await unmount();
      controller.dispose(); store.dispose(); provider.close(); container.remove();
    });
    if (mount) {
      await render();
      assert.ok(editor, 'actual native Editor must mount');
    }
    return { controller, store, client, target, source, container, root, render, unmount, get editor() { return editor; }, get readonlyAtMount() { return readonlyAtMount; }, get writes() { return writes; } };
  }
  async function readDocument(fixture) {
    const read = await fixture.client.read({ target: fixture.target, revision: { kind: 'latest' } });
    assert.equal(read.kind, 'available');
    return JSON.parse(new TextDecoder().decode(read.snapshot.bytes));
  }
  async function click(container, label) { await act(async () => button(container, label).click()); }

  await t.test('a suspended replacement keeps committed canvas controls active', async t => {
    const f = await fixture(t);
    const replacement = await fixture(t, { mount: false, title: 'Replacement' });
    const pending = new Promise(() => {});
    function Suspend() { throw pending; }
    const tree = (controller, suspend) => createElement(Suspense, { fallback: 'Waiting' },
      createElement(CanvasEditor, { controller, assetUrls: assets }), suspend ? createElement(Suspend) : null);
    await act(async () => f.root.render(tree(f.controller, false)));
    await waitFor(() => f.container.querySelector('[aria-label="Canvas tools"]'), 'Canvas absent');
    await act(async () => startTransition(() => f.root.render(tree(replacement.controller, true))));
    await click(f.container, 'Rectangle');
    assert.equal(button(f.container, 'Rectangle').getAttribute('aria-pressed'), 'true');
  });

  async function mountedFixture(t, options) {
    const f = await fixture(t, options);
    let tools;
    await f.render(f.controller, undefined, assets, { onMountedTools: value => { tools = value; } });
    assert.ok(tools);
    return { ...f, f, get writes() { return f.writes; }, get tools() { return tools; } };
  }
  function syntheticViewport(f) {
    f.editor.getContainer().getBoundingClientRect = () => new window.DOMRect(0, 0, 800, 600);
    f.editor.updateViewportScreenBounds(new Box(0, 0, 800, 600));
  }
  const expiry = () => ({ expiresAt: Date.now() + 10000 });
  async function invoke(f, command, input = expiry(), target = f.tools.getTarget(), signal) {
    let result;
    await act(async () => { result = await f.tools[command].invoke(target, input, signal); });
    return result;
  }

  await t.test('mounted inspection and selection preserve exact dirty document and never publish', async t => {
    const f = await mountedFixture(t);
    await act(async () => f.editor.createShape({ id: shapeId, type: 'geo', props: { w: 80, h: 60 } }));
    const target = f.tools.getTarget(), selection = f.controller.actions.selection();
    const result = await invoke(f, 'inspect');
    assert.equal(result.kind, 'applied');
    assert.equal(result.value.dirty, true);
    assert.deepEqual(result.value.selection, selection);
    assert.equal(result.value.pageId, pageId);
    assert.equal(result.value.shapes[0].id, shapeId);
    assert.ok(Object.isFrozen(result.value.shapes[0].props));
    assert.notEqual(result.value.shapes[0], f.editor.getShape(shapeId));
    assert.equal((await invoke(f, 'select', { ...expiry(), shapeIds: [shapeId, shapeId] })).kind, 'applied');
    assert.deepEqual(f.editor.getSelectedShapeIds(), [shapeId]);
    assert.deepEqual(f.tools.getTarget(), target);
    assert.equal((await invoke(f, 'select', { ...expiry(), shapeIds: [] })).kind, 'applied');
    assert.deepEqual(f.editor.getSelectedShapeIds(), []);
    assert.deepEqual(f.controller.actions.selection(), selection);
    assert.equal(f.f.writes, 0);
  });

  await t.test('mounted commands reject stale targets, expiry, cancellation and missing shapes atomically', async t => {
    const f = await mountedFixture(t);
    await act(async () => f.editor.createShape({ id: shapeId, type: 'geo' }));
    const target = f.tools.getTarget();
    for (const mutate of [x => { x.instanceId += 'old'; }, x => { x.epoch += 'old'; }, x => { x.subject.scopeId += 'old'; },
      x => { x.subject.mountId += 'old'; }, x => { x.subject.pageId += 'old'; }, x => { x.subject.bufferVersion++; },
      x => { x.subject.base.target.resource.path += '.old'; }, x => { x.subject.base.target.revision += 'old'; },
      x => { x.subject.base.target.resource.providerId += 'old'; }, x => { x.subject.base.target.view = { kind: 'working', viewId: 'other' }; }]) {
      const changed = structuredClone(target); mutate(changed);
      assert.equal((await invoke(f, 'select', { ...expiry(), shapeIds: [shapeId] }, changed)).kind, 'stale');
    }
    assert.equal((await invoke(f, 'inspect', { expiresAt: 0 })).kind, 'stale');
    assert.equal((await invoke(f, 'select', { ...expiry(), shapeIds: [shapeId] }, target, AbortSignal.abort())).kind, 'denied');
    assert.equal((await invoke(f, 'select', { ...expiry(), shapeIds: [shapeId, 'shape:absent'] })).kind, 'denied');
    assert.deepEqual(f.editor.getSelectedShapeIds(), []);
    await act(async () => f.editor.updateShape({ id: shapeId, type: 'geo', x: 9 }));
    assert.equal((await invoke(f, 'inspect', expiry(), target)).kind, 'stale');
    assert.equal(f.f.writes, 0);
  });

  await t.test('page changes and detached or disposed owners revoke commands', async t => {
    const f = await mountedFixture(t);
    const old = f.tools.getTarget();
    const second = PageRecordType.createId('second');
    await act(async () => f.editor.createPage({ id: second, name: 'Second' }));
    const otherShape = createShapeId('other-page');
    await act(async () => f.editor.createShape({ id: otherShape, parentId: second, type: 'geo' }));
    assert.equal((await invoke(f, 'select', { ...expiry(), shapeIds: [otherShape] })).kind, 'denied');
    const before = f.tools.getTarget();
    await act(async () => f.editor.setCurrentPage(second));
    assert.equal((await invoke(f, 'inspect', expiry(), before)).kind, 'stale');
    assert.notEqual(f.tools.getTarget().subject.pageId, old.subject.pageId);
    f.container.remove();
    assert.equal(f.tools.getTarget(), null);
    assert.equal((await invoke(f, 'inspect', expiry(), before)).kind, 'unavailable');
    window.document.body.append(f.container);
    await act(async () => f.controller.dispose());
    assert.equal(f.tools, null);
  });

  await t.test('callback replacement preserves one binding and cleanup revokes old handles', async t => {
    const f = await fixture(t);
    const events = [];
    const first = value => events.push(['first', value]);
    const second = value => events.push(['second', value]);
    await f.render(f.controller, undefined, assets, { onMountedTools: first });
    const tools = events[0][1], target = tools.getTarget();
    await f.render(f.controller, undefined, assets, { onMountedTools: second });
    assert.deepEqual(events.map(([name, value]) => [name, value === null]), [['first', false], ['first', true], ['second', false]]);
    assert.equal(events[2][1], tools);
    await f.unmount();
    assert.equal(events.at(-1)[1], null);
    assert.equal(tools.getTarget(), null);
    assert.equal((await tools.inspect.invoke(target, expiry())).kind, 'unavailable');
    assert.equal(f.controller.getSnapshot().lifecycle, 'active');
  });

  await t.test('readonly presentation works while locked camera refuses framing', async t => {
    const f = await mountedFixture(t, { readOnly: true });
    await act(async () => { f.editor.updateInstanceState({ isReadonly: false }); f.editor.createShape({ id: shapeId, type: 'geo' }); f.editor.updateInstanceState({ isReadonly: true }); });
    const before = f.controller.actions.selection();
    assert.equal((await invoke(f, 'select', { ...expiry(), shapeIds: [shapeId] })).kind, 'applied');
    await act(async () => f.editor.setCameraOptions({ isLocked: true }));
    const camera = structuredClone(f.editor.getCamera());
    assert.equal((await invoke(f, 'frame', { ...expiry(), shapeIds: [shapeId] })).kind, 'denied');
    assert.deepEqual(f.editor.getCamera(), camera);
    assert.equal((await invoke(f, 'frame', { ...expiry(), shapeIds: [] })).kind, 'denied');
    assert.deepEqual(f.controller.actions.selection(), before);
    assert.equal(f.f.writes, 0);
  });

  await t.test('native framing verifies bounds with synthetic DOM geometry and reports zoom constraints', async t => {
    const f = await mountedFixture(t);
    await act(async () => {
      syntheticViewport(f);
      f.editor.createShape({ id: shapeId, type: 'geo', x: 500, y: 700, props: { w: 80, h: 60 } });
    });
    const selection = f.controller.actions.selection();
    assert.equal((await invoke(f, 'frame', { ...expiry(), shapeIds: [shapeId] })).kind, 'applied');
    const viewport = f.editor.getViewportPageBounds(), bounds = f.editor.getShapePageBounds(shapeId);
    assert.ok(viewport.contains(bounds));
    assert.deepEqual(f.controller.actions.selection(), selection);
    await act(async () => {
      f.editor.setCameraOptions({ zoomSteps: [1] });
      f.editor.updateShape({ id: shapeId, type: 'geo', props: { w: 5000 } });
    });
    assert.equal((await invoke(f, 'frame', { ...expiry(), shapeIds: [shapeId] })).kind, 'unavailable');
    assert.equal(f.f.writes, 0);
    for (const value of [null, {}, { expiresAt: Infinity }, { expiresAt: 2.5 }]) assert.throws(() => f.tools.inspect.input.parse(value));
    for (const shapeIds of [null, [7], ['']]) assert.throws(() => f.tools.select.input.parse({ ...expiry(), shapeIds }));
  });

  await t.test('framing refuses stale native geometry and reentrant DOM hide or resize', async t => {
    const f = await mountedFixture(t);
    await act(async () => { syntheticViewport(f); f.editor.createShape({ id: shapeId, type: 'geo', x: 500 }); });
    f.editor.getContainer().getBoundingClientRect = () => new window.DOMRect(0, 0, 400, 300);
    const camera = structuredClone(f.editor.getCamera());
    assert.equal((await invoke(f, 'frame', { ...expiry(), shapeIds: [shapeId] })).kind, 'unavailable');
    assert.deepEqual(f.editor.getCamera(), camera);
    for (const width of [0, 400]) {
      await act(async () => syntheticViewport(f));
      f.editor.once('stop-camera-animation', () => {
        f.editor.getContainer().getBoundingClientRect = () => new window.DOMRect(0, 0, width, 300);
      });
      assert.equal((await invoke(f, 'frame', { ...expiry(), shapeIds: [shapeId] })).kind, 'unavailable');
    }
    assert.equal(f.f.writes, 0);
  });

  await t.test('reentrant native effects refuse success after controller teardown or cancellation', async t => {
    const f = await mountedFixture(t);
    await act(async () => f.editor.createShape({ id: shapeId, type: 'geo' }));
    await act(async () => syntheticViewport(f));
    const abort = new AbortController();
    f.editor.once('stop-camera-animation', () => abort.abort());
    assert.equal((await invoke(f, 'frame', { ...expiry(), shapeIds: [shapeId] }, f.tools.getTarget(), abort.signal)).kind, 'denied');
    const remove = f.store.sideEffects.registerAfterChangeHandler('instance_page_state', () => f.controller.dispose());
    t.after(remove);
    assert.equal((await invoke(f, 'select', { ...expiry(), shapeIds: [shapeId] })).kind, 'unavailable');
    assert.equal(f.f.writes, 0);
  });

  await t.test('host mount cleanup runs once and a remount never reactivates old commands', async t => {
    const f = await fixture(t, { mount: false });
    let mounts = 0, cleanups = 0, tools;
    const onMount = () => { mounts++; return () => { cleanups++; assert.equal(tools.getTarget(), null); }; };
    const onMountedTools = value => { if (value) tools = value; };
    await f.render(f.controller, onMount, assets, { onMountedTools });
    const old = tools, target = old.getTarget();
    await f.render(f.controller, onMount, assets, { onMountedTools });
    assert.equal(mounts, 1); assert.equal(cleanups, 0);
    await act(async () => f.root.render(null));
    assert.equal(cleanups, 1); assert.equal(old.getTarget(), null);
    await f.render(f.controller, onMount, assets, { onMountedTools });
    assert.equal(mounts, 2);
    assert.notEqual(tools.getTarget().subject.mountId, target.subject.mountId);
    assert.equal((await tools.inspect.invoke(target, expiry())).kind, 'stale');
    assert.equal((await old.inspect.invoke(target, expiry())).kind, 'unavailable');
  });

  await t.test('StrictMode retains writable canvas and invokes host mounts', async t => {
    const f = await fixture(t, { mount: false });
    let editor, mounts = 0;
    await act(async () => f.root.render(createElement(StrictMode, null, createElement(CanvasEditor, {
      controller: f.controller, assetUrls: assets, onMount: value => { editor = value; mounts++; },
    }))));
    await waitFor(() => f.container.querySelector('[aria-label="Canvas tools"]'), 'StrictMode canvas absent');
    assert.ok(mounts > 0);
    assert.equal(editor.isDisposed, false);
    assert.equal(editor.getIsReadonly(), false);
    assert.equal(button(f.container, 'Rectangle').disabled, false);
  });

  await t.test('zero DOM viewport refuses camera effects', async t => {
    const f = await mountedFixture(t);
    await act(async () => {
      f.editor.updateViewportScreenBounds(new Box(0, 0, 800, 600));
      f.editor.createShape({ id: shapeId, type: 'geo', x: 500 });
    });
    const camera = structuredClone(f.editor.getCamera());
    assert.equal((await invoke(f, 'frame', { ...expiry(), shapeIds: [shapeId] })).kind, 'unavailable');
    assert.deepEqual(f.editor.getCamera(), camera);
  });

  await t.test('unsupported document capture inside a native transaction returns unavailable', async t => {
    const f = await mountedFixture(t);
    const target = f.tools.getTarget();
    const asset = f.store.schema.types.asset.create({ id: 'asset:local', type: 'image', props: { name: 'Fictional', src: 'https://example.invalid/image.png', w: 20, h: 20, mimeType: 'image/png', isAnimated: false } });
    await act(async () => {
      f.store.atomic(() => {
        f.store.put([asset]);
        assert.equal(f.controller.getSnapshot().problem, null);
        assert.equal(f.tools.getTarget(), null);
      });
    });
    assert.match(f.controller.getSnapshot().problem, /asset adapter/);
    assert.equal((await invoke(f, 'inspect', expiry(), target)).kind, 'unavailable');
  });

  await t.test('real native tools, shape edits, exact save and host asset maps', async t => {
    const f = await fixture(t);
    assert.equal(f.editor.store, f.store);
    assert.equal(f.writes, 0);
    const nativeEditor = f.editor;
    await f.render(f.controller, undefined, { fonts: { ...assets.fonts }, icons: { ...assets.icons }, translations: { ...assets.translations }, embedIcons: { ...assets.embedIcons } });
    assert.equal(f.editor, nativeEditor, 'equal host asset maps must not remount the native editor');
    await click(f.container, 'Rectangle');
    assert.equal(f.editor.getCurrentToolId(), 'geo');
    assert.equal(button(f.container, 'Rectangle').getAttribute('aria-pressed'), 'true');
    await click(f.container, 'Draw');
    assert.equal(f.editor.getCurrentToolId(), 'draw');
    await click(f.container, 'Select');
    assert.equal(f.editor.getCurrentToolId(), 'select');
    await act(async () => {
      f.editor.markHistoryStoppingPoint('fictional-shape');
      f.editor.createShape({ id: shapeId, type: 'geo', x: 30, y: 40, props: { geo: 'rectangle', w: 80, h: 60 } });
    });
    assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal(button(f.container, 'Undo').disabled, false);
    await click(f.container, 'Undo');
    assert.equal(f.store.get(shapeId), undefined);
    assert.equal(f.controller.getSnapshot().document.store[shapeId], undefined);
    assert.equal(button(f.container, 'Redo').disabled, false);
    await click(f.container, 'Redo');
    assert.equal(f.store.get(shapeId).x, 30);
    assert.equal(f.controller.getSnapshot().document.store[shapeId].props.w, 80);
    assert.equal(f.writes, 0);
    const selection = f.controller.actions.selection();
    await click(f.container, 'Save');
    await waitFor(() => !f.controller.getSnapshot().dirty, 'Save did not acknowledge the native shape');
    const document = await readDocument(f);
    assert.equal(document.store[shapeId].x, 30);
    assert.equal(document.store[shapeId].props.w, 80);
    const settled = f.controller.getSnapshot().save;
    assert.equal(settled.kind, 'settled');
    assert.equal(settled.result.kind, 'saved');
    assert.deepEqual(settled.result.selection, selection);
    assert.deepEqual(settled.result.receipt.changes[0].after, settled.result.ref);
    assert.equal(f.writes, 1);
    assert.equal(button(f.container, 'Save').disabled, true);
    assert.ok(fontRequests.length > 0);
    assert.ok(requests.includes(assets.translations.en));
    assert.equal(f.editor.hasExternalAssetHandler('file'), false);
    assert.equal(f.editor.hasExternalAssetHandler('url'), false);
  });

  await t.test('lost save acknowledgement retains newer native edits and reconciles without resubmission', async t => {
    const f = await fixture(t, { wrapClient: client => ({ ...client, publish: async request => { await client.publish(request); throw new Error('Fictional lost acknowledgement'); } }) });
    await act(async () => f.editor.updatePage({ id: pageId, name: 'Committed page' }));
    await click(f.container, 'Save');
    await waitFor(() => f.container.textContent.includes('Save unconfirmed'), 'Unknown acknowledgement was not shown');
    await act(async () => f.editor.updatePage({ id: pageId, name: 'Newer local page' }));
    assert.equal(button(f.container, 'Save').disabled, true);
    await click(f.container, 'Check save outcome');
    await waitFor(() => !f.container.textContent.includes('Save unconfirmed'), 'Reconciliation did not settle');
    assert.equal(f.store.get(pageId).name, 'Newer local page');
    assert.equal(f.controller.getSnapshot().dirty, true);
    assert.equal((await readDocument(f)).store[pageId].name, 'Committed page');
    assert.equal(f.writes, 1);
  });

  await t.test('an unconfirmed save can be abandoned through the UI without replay or draft loss', async t => {
    for (const committed of [false, true]) {
      let attempts = 0;
      const f = await fixture(t, { wrapClient: client => ({ ...client,
        publish: async request => { attempts++; if (committed) await client.publish(request); throw new Error('Fictional lost acknowledgement'); },
        lookup: async () => ({ kind: 'not-found' }),
      }) });
      await act(async () => f.editor.updatePage({ id: pageId, name: 'Attempted page' }));
      await click(f.container, 'Save');
      await waitFor(() => f.container.textContent.includes('Save unconfirmed'), 'Unknown acknowledgement was not shown');
      await act(async () => f.editor.updatePage({ id: pageId, name: 'Newer local draft' }));
      await click(f.container, 'Check save outcome');
      assert.equal(f.controller.getSnapshot().save.result.kind, 'unknown');
      await click(f.container, 'Keep draft and refresh');
      await waitFor(() => f.controller.getSnapshot().save.kind === 'idle', 'Explicit abandonment did not release the unknown save');
      assert.equal(f.store.get(pageId).name, 'Newer local draft');
      assert.equal(f.controller.getSnapshot().dirty, true);
      assert.equal(button(f.container, 'Save').disabled, false);
      assert.equal(attempts, 1);
      assert.equal(f.writes, committed ? 1 : 0);
      assert.equal((await readDocument(f)).store[pageId].name, committed ? 'Attempted page' : 'Original');
      await f.unmount();
    }
  });

  await t.test('external conflict keeps native edits until the explicit discard control is used', async t => {
    const f = await fixture(t);
    await act(async () => f.editor.updatePage({ id: pageId, name: 'Human draft' }));
    const document = JSON.parse(new TextDecoder().decode(f.source.snapshot.bytes));
    document.store[pageId].name = 'External saved page';
    const result = await f.client.publish({ operationId: 'external-change', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: f.source.snapshot.ref, mediaType: f.source.snapshot.mediaType, bytes: new TextEncoder().encode(JSON.stringify(document)) }] });
    assert.equal(result.kind, 'committed');
    await click(f.container, 'Save');
    await waitFor(() => f.container.textContent.includes('Changed elsewhere'), 'Revision conflict was not shown');
    assert.equal(f.store.get(pageId).name, 'Human draft');
    await click(f.container, 'Discard local changes and reload');
    await waitFor(() => f.store.get(pageId).name === 'External saved page', 'Explicit discard did not load remote document');
    assert.equal(f.controller.getSnapshot().dirty, false);
  });

  await t.test('read-only native mode is set before host onMount and editing controls are disabled', async t => {
    const f = await fixture(t, { readOnly: true });
    assert.equal(f.readonlyAtMount, true);
    assert.equal(f.editor.getIsReadonly(), true);
    assert.equal(button(f.container, 'Save').disabled, true);
    for (const label of ['Draw', 'Rectangle', 'Text', 'Arrow', 'Erase', 'Undo', 'Redo']) assert.equal(button(f.container, label).disabled, true, label);
    assert.equal(button(f.container, 'Hand').disabled, false);
    await click(f.container, 'Hand');
    assert.equal(f.editor.getCurrentToolId(), 'hand');
    assert.equal(f.writes, 0);
    await f.unmount();
    assert.equal(f.store.get(TLINSTANCE_ID).isReadonly, true);
  });

  await t.test('a host read-only assertion during the mount remains in the borrowed session after unmount', async t => {
    const f = await fixture(t, { readOnly: true });
    assert.equal(f.editor.getIsReadonly(), true);
    await act(async () => f.editor.updateInstanceState({ isReadonly: true }));
    await f.unmount();
    assert.equal(f.store.get(TLINSTANCE_ID).isReadonly, true);
    assert.equal(f.controller.getSnapshot().lifecycle, 'active');
    assert.equal(f.writes, 0);
  });

  await t.test('an existing host read-only native session survives mounting and unmounting', async t => {
    const f = await fixture(t, { hostReadOnly: true });
    assert.equal(f.readonlyAtMount, true);
    assert.equal(button(f.container, 'Draw').disabled, true);
    await f.unmount();
    assert.equal(f.store.get(TLINSTANCE_ID).isReadonly, true);
  });

  await t.test('controller replacement retains the new document when the previous save acknowledges late', async t => {
    const committed = Promise.withResolvers(), release = Promise.withResolvers();
    t.after(() => release.resolve());
    const old = await fixture(t, { title: 'Old canvas', wrapClient: client => ({ ...client, publish: async request => {
      const result = await client.publish(request);
      committed.resolve();
      await release.promise;
      return result;
    } }) });
    await act(async () => old.editor.updatePage({ id: pageId, name: 'Old selected page' }));
    await click(old.container, 'Save');
    await committed.promise;
    const next = await fixture(t, { title: 'Next canvas', mount: false });
    let nextEditor;
    await old.render(next.controller, editor => { nextEditor = editor; });
    await waitFor(() => nextEditor?.store === next.store, 'Replacement native editor did not mount');
    await act(async () => nextEditor.updatePage({ id: pageId, name: 'Newer document draft' }));
    await act(async () => release.resolve());
    await waitFor(() => old.controller.getSnapshot().save.kind === 'settled', 'Old save did not finish');
    assert.equal(next.controller.getSnapshot().document.store[pageId].name, 'Newer document draft');
    assert.equal(next.controller.getSnapshot().dirty, true);
    assert.equal(next.controller.getSnapshot().save.kind, 'idle');
    assert.equal(next.writes, 0);
    assert.equal(old.controller.getSnapshot().lifecycle, 'active');
    assert.equal(old.editor.isDisposed, true);
    assert.ok(old.container.textContent.includes('Unsaved changes'));
    assert.equal(old.container.textContent.includes('Saving'), false);
  });

  await t.test('unmount preserves borrowed controller, native store and publication capability', async t => {
    const f = await fixture(t);
    await f.unmount();
    assert.equal(f.editor.isDisposed, true);
    assert.equal(f.controller.getSnapshot().lifecycle, 'active');
    f.store.put([{ ...f.store.get(pageId), name: 'Edit after unmount' }]);
    const result = await f.controller.flush(f.controller.actions.selection());
    assert.equal(result.kind, 'saved');
    assert.equal((await readDocument(f)).store[pageId].name, 'Edit after unmount');
  });
  await t.test('mounted proposal review preserves dirty edits until human acceptance and publishes the reviewed candidate', async t => {
    const f = await mountedFixture(t);
    await act(async () => f.editor.createShape({ id: shapeId, type: 'geo', x: 10, props: { w: 80, h: 60 } }));
    const before = f.store.getStoreSnapshot('document'), edited = { ...f.editor.getShape(shapeId), x: 25 };
    const proposed = await invoke(f, 'propose', { ...expiry(), edits: [{ kind: 'update', record: edited }], summary: 'Move the fictional box' });
    assert.equal(proposed.kind, 'proposed');
    assert.deepEqual(f.store.getStoreSnapshot('document'), before);
    assert.equal(f.writes, 0);
    const card = f.container.querySelector('[data-boring="canvas-proposal"]');
    assert.ok(card.textContent.includes('Move the fictional box'));
    assert.ok(card.querySelector('table').textContent.includes('25'));
    assert.equal(button(f.container, 'Accept and save').disabled, false);
    await click(f.container, 'Accept and save');
    await waitFor(() => f.controller.getSnapshot().save.kind === 'settled', 'Proposal save did not settle');
    assert.equal(f.controller.getSnapshot().save.result.kind, 'saved');
    assert.equal(f.writes, 1);
    assert.equal((await readDocument(f)).store[shapeId].x, 25);
    assert.equal(f.controller.getSnapshot().dirty, false);
    assert.ok(f.container.textContent.includes('Applied locally'));
  });

  await t.test('proposal acceptance respects native readonly and stale local changes; dismiss never writes', async t => {
    const f = await mountedFixture(t);
    await act(async () => f.editor.createShape({ id: shapeId, type: 'geo', x: 10 }));
    const input = { ...expiry(), edits: [{ kind: 'update', record: { ...f.editor.getShape(shapeId), x: 25 } }], summary: 'Review move' };
    assert.equal((await invoke(f, 'propose', input)).kind, 'proposed');
    await act(async () => f.editor.updateInstanceState({ isReadonly: true }));
    assert.equal(button(f.container, 'Accept and save').disabled, true);
    await click(f.container, 'Accept and save');
    assert.equal(f.editor.getShape(shapeId).x, 10);
    assert.equal(f.writes, 0);
    assert.equal((await invoke(f, 'propose', input)).kind, 'denied');
    await act(async () => { f.editor.updateInstanceState({ isReadonly: false }); f.editor.updateShape({ id: shapeId, type: 'geo', x: 45 }); });
    assert.equal(button(f.container, 'Accept and save').disabled, true);
    assert.ok(f.container.textContent.includes('Canvas changed since this proposal'));
    await click(f.container, 'Dismiss');
    assert.equal(f.container.querySelector('[data-boring="canvas-proposal"]'), null);
    assert.equal(f.editor.getShape(shapeId).x, 45);
    assert.equal(f.writes, 0);
  });

  await t.test('mounted proposals refuse old pages and unmounted handles without creating proposals', async t => {
    const f = await mountedFixture(t);
    await act(async () => {
      f.editor.createShape({ id: shapeId, type: 'geo' });
      f.editor.createPage({ id: PageRecordType.createId('proposal-other'), name: 'Other', index: 'a2' });
    });
    const target = f.tools.getTarget(), tools = f.tools;
    const input = { ...expiry(), edits: [{ kind: 'update', record: { ...f.editor.getShape(shapeId), x: 25 } }], summary: 'Old page' };
    await act(async () => f.editor.setCurrentPage(PageRecordType.createId('proposal-other')));
    assert.equal((await invoke(f, 'propose', input, target)).kind, 'stale');
    assert.equal(f.controller.getSnapshot().proposals.length, 0);
    await f.unmount();
    assert.equal((await tools.propose.invoke(target, input)).kind, 'unavailable');
    assert.equal(f.controller.getSnapshot().proposals.length, 0);
    assert.equal(f.writes, 0);
  });

  await t.test('mounted proposal retention rechecks readonly and cancellation after synchronous host callbacks', async t => {
    const f = await mountedFixture(t);
    await act(async () => f.editor.createShape({ id: shapeId, type: 'geo' }));
    for (const mode of ['readonly', 'cancelled']) {
      const abort = new AbortController();
      const unsubscribe = f.controller.subscribe(() => {
        if (f.controller.getSnapshot().proposals.length) {
          if (mode === 'readonly') f.editor.updateInstanceState({ isReadonly: true });
          else abort.abort();
        }
      });
      const result = await invoke(f, 'propose', { ...expiry(), edits: [{ kind: 'update', record: { ...f.editor.getShape(shapeId), x: 25 } }], summary: mode }, f.tools.getTarget(), abort.signal);
      unsubscribe();
      assert.equal(result.kind, 'denied');
      assert.equal(f.controller.getSnapshot().proposals.length, 0);
      assert.equal(f.editor.getShape(shapeId).x, 0);
      assert.equal(f.writes, 0);
      await act(async () => f.editor.updateInstanceState({ isReadonly: false }));
    }
  });

  await t.test('proposal review includes newly added empty metadata objects', async t => {
    const f = await mountedFixture(t);
    await act(async () => f.editor.createShape({ id: shapeId, type: 'geo' }));
    const record = f.editor.getShape(shapeId);
    const proposed = await invoke(f, 'propose', { ...expiry(), edits: [{ kind: 'update', record: { ...record, meta: { ...record.meta, audit: {}, 'a.b': 1, a: { b: 2 }, 'a/b': 3, '~a': 4 } } }], summary: 'Add empty audit metadata' });
    assert.equal(proposed.kind, 'proposed');
    const review = f.container.querySelector('[data-boring="canvas-proposal"]');
    assert.ok(review.querySelector('summary').textContent.includes('1 changed record'));
    assert.ok(review.querySelector('table').textContent.includes('/meta/audit'));
    assert.ok(review.querySelector('table').textContent.includes('{}'));
    for (const field of ['/meta/a.b', '/meta/a/b', '/meta/a~1b', '/meta/~0a']) assert.ok(review.querySelector('table').textContent.includes(field));
    assert.equal(f.writes, 0);
    await click(f.container, 'Dismiss');
    await act(async () => f.editor.updateShape({ id: shapeId, type: 'geo', meta: { ...record.meta, audit: {} } }));
    assert.equal((await invoke(f, 'propose', { ...expiry(), edits: [{ kind: 'update', record: { ...f.editor.getShape(shapeId), meta: record.meta } }], summary: 'Remove empty audit metadata' })).kind, 'proposed');
    const removed = f.container.querySelector('[data-boring="canvas-proposal"] table');
    assert.ok(removed.textContent.includes('/meta/audit'));
    assert.ok(removed.textContent.includes('Absent'));
    assert.equal(f.writes, 0);
  });

});
