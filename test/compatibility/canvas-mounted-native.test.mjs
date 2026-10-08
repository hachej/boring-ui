import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { Harness, MemoryStorage, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createPresentationTool } from '@hachej/boring-agent/presentation';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { admitDocumentTool, documentToolResult } from '../fixtures/native-document.mjs';

test('native ToolTasks select a captured mounted canvas and refuse stale or closed viewers', { timeout: 20000 }, async t => {
  const window = new Window({ url: 'https://fictional.invalid/' });
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
  class FixtureFontFace {
    constructor(family, source, descriptors) { this.family = family; Object.assign(this, descriptors); this.status = 'unloaded'; this.loaded = Promise.resolve(this); }
    load() { this.status = 'loaded'; return this.loaded; }
  }
  install('FontFace', FixtureFontFace);
  Object.defineProperty(document, 'fonts', { configurable: true, value: new Set() });
  const fetchAsset = async input => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    assert.ok(url.startsWith('https://assets.example.invalid/'), `Unexpected fetch: ${url}`);
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  };
  install('fetch', fetchAsset); window.fetch = fetchAsset;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const restoreEnvironment = async () => {
    await window.happyDOM.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
  };
  const { act, createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { createTLStore, LANGUAGES, createShapeId, atom } = await import('@tldraw/editor');
  const { defaultEditorAssetUrls, iconTypes, DEFAULT_EMBED_DEFINITIONS } = await import('tldraw');
  const { PageRecordType, DocumentRecordType, TLDOCUMENT_ID } = await import('@tldraw/tlschema');
  const { createCanvasController } = await import('@hachej/boring-ui-kit/canvas');
  const { CanvasEditor } = await import('@hachej/boring-ui-kit/canvas-editor');
  const assetBase = 'https://assets.example.invalid/';
  const assets = {
    fonts: Object.fromEntries(Object.keys(defaultEditorAssetUrls.fonts).map(key => [key, `${assetBase}${key}.woff2`])),
    icons: Object.fromEntries(iconTypes.map(key => [key, `${assetBase}icons.svg#${key}`])),
    translations: Object.fromEntries(LANGUAGES.map(({ locale }) => [locale, `${assetBase}${locale}.json`])),
    embedIcons: Object.fromEntries(DEFAULT_EMBED_DEFINITIONS.map(({ type }) => [type, `${assetBase}${type}.png`])),
  };
  const store = createTLStore({ users: { currentUser: atom('fictional mounted user', null) } });
  const pageId = PageRecordType.createId('native-page');
  store.put([DocumentRecordType.create({ id: TLDOCUMENT_ID, name: 'Native selection' }), PageRecordType.create({ id: pageId, name: 'Page', index: 'a1' })]);
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'native-canvas', authorize: () => true });
  const identity = { scopeId: 'fictional', principalId: 'host', initiatorId: 'alice' };
  const resource = { resource: { providerId: 'native-canvas', path: 'canvas.json' }, view: { kind: 'published' } };
  let writes = 0;
  const controller = createCanvasController({ store, identity, source: { kind: 'new', target: resource }, instanceId: 'native-canvas', epoch: 'one',
    client: { read: request => provider.read(request, identity), lookup: id => provider.reconciliation.lookup(id, identity),
      publish: request => { writes++; return provider.publication.publish(request, identity); } } });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  let editor, tools, harness, unmounted = false;
  const mount = native => { editor = native; };
  const mounted = value => { tools = value; };
  const render = async key => {
    await act(async () => root.render(createElement(CanvasEditor, { key, controller, assetUrls: assets, onMount: mount, onMountedTools: mounted })));
    const deadline = Date.now() + 5000;
    while (!editor || !tools?.getTarget()) {
      assert.ok(Date.now() < deadline, 'Actual mounted tools did not become available');
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
  };
  t.after(async () => {
    if (!unmounted) await act(async () => root.unmount());
    if (harness) await harness.close(context);
    controller.dispose(); store.dispose(); provider.close(); container.remove();
    await restoreEnvironment();
  });
  await render('first');
  const shapeId = createShapeId('native-box');
  await act(async () => editor.createShape({ id: shapeId, type: 'geo', x: 10, y: 20, props: { w: 80, h: 60 } }));
  const captured = tools.getTarget(), firstTools = tools;
  assert.ok(captured);
  const before = controller.getSnapshot();
  let permit = true;
  let gate;
  const definition = createPresentationTool({ name: 'select_canvas', description: 'Select a fictional canvas shape',
    parameters: Type.Object({ shapeIds: Type.Array(Type.String()) }), command: tools.select, target: captured,
    prepareInput: args => ({ shapeIds: args.shapeIds, expiresAt: Date.now() + 10000 }),
    authorize: async (_input, _target, _api, ctx) => {
      if (gate) { gate.signal = ctx.abortSignal; gate.entered.resolve(); await gate.release.promise; }
      return permit;
    },
    formatResult: result => ({ content: [{ type: 'text', text: JSON.stringify(result) }] }),
  });
  const proposalDefinition = createPresentationTool({ name: 'propose_canvas', description: 'Propose a reviewed fictional move',
    parameters: Type.Object({ x: Type.Number() }), command: tools.propose, target: captured,
    prepareInput: args => ({ edits: [{ kind: 'update', record: { ...editor.getShape(shapeId), x: args.x } }], summary: 'Native proposed move', expiresAt: Date.now() + 10000 }),
    authorize: async () => permit,
    formatResult: result => ({ content: [{ type: 'text', text: JSON.stringify(result) }] }),
  });
  const registry = createRegistry(); registry.install(defineExtension({ name: 'fixture.canvas-mounted', tools: [definition, proposalDefinition] }));
  harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  const conversation = await harness.root(context);
  const run = async ids => {
    let result;
    await act(async () => { result = await documentToolResult(harness, conversation, await admitDocumentTool(conversation, { shapeIds: ids }, 'select_canvas')); });
    return result;
  };
  assert.equal((await run([shapeId])).result.kind, 'applied');
  assert.deepEqual(editor.getSelectedShapeIds(), [shapeId]);
  assert.equal(controller.getSnapshot().bufferVersion, before.bufferVersion);
  assert.deepEqual(controller.getSnapshot().document, before.document);
  assert.equal(writes, 0);
  let proposed;
  await act(async () => { proposed = await documentToolResult(harness, conversation, await admitDocumentTool(conversation, { x: 80 }, 'propose_canvas')); });
  assert.equal(proposed.result.kind, 'proposed');
  assert.equal(controller.getSnapshot().proposals.length, 1);
  assert.equal(editor.getShape(shapeId).x, 10);
  assert.equal(writes, 0);
  assert.equal(controller.getSnapshot().proposals[0].after.store[shapeId].x, 80);
  await act(async () => controller.actions.reject(proposed.result.proposalId));
  permit = false;
  await act(async () => { proposed = await documentToolResult(harness, conversation, await admitDocumentTool(conversation, { x: 90 }, 'propose_canvas')); });
  assert.equal(proposed.result.kind, 'denied');
  assert.equal(controller.getSnapshot().proposals.length, 0);
  assert.equal((await run([])).result.kind, 'denied');
  assert.deepEqual(editor.getSelectedShapeIds(), [shapeId]);
  permit = true;
  gate = { entered: Promise.withResolvers(), release: Promise.withResolvers() };
  const pending = await admitDocumentTool(conversation, { shapeIds: [] }, 'select_canvas');
  await gate.entered.promise;
  const stopping = harness.abortTask(pending, context);
  if (!gate.signal.aborted) await new Promise(resolve => gate.signal.addEventListener('abort', resolve, { once: true }));
  gate.release.resolve();
  assert.equal(await stopping, 'marked');
  assert.equal((await harness.waitForTask(pending, context)).state.outcome.status, 'aborted');
  gate = undefined;
  assert.deepEqual(editor.getSelectedShapeIds(), [shapeId]);
  await act(async () => editor.updateShape({ id: shapeId, type: 'geo', x: 35 }));
  assert.equal((await run([])).result.kind, 'stale');
  assert.deepEqual(editor.getSelectedShapeIds(), [shapeId]);
  await render('second');
  assert.equal(firstTools.getTarget(), null);
  assert.notEqual(tools.getTarget().subject.mountId, captured.subject.mountId);
  assert.equal((await run([])).result.kind, 'unavailable');
  await act(async () => root.unmount()); unmounted = true;
  assert.equal(tools, null);
  assert.equal(controller.getSnapshot().lifecycle, 'active');
  await conversation.configure({ instructions: 'Native host survives viewer teardown' }, context);
  assert.equal((await run([])).result.kind, 'unavailable');
  assert.equal(writes, 0);
});
