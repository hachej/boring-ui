import 'tldraw/tldraw.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { atom, createTLStore } from '@tldraw/editor';
import { DocumentRecordType, PageRecordType, TLDOCUMENT_ID, createShapeId } from '@tldraw/tlschema';
import { GeoShapeUtil, defaultBindingUtils, defaultShapeUtils } from 'tldraw';
import { createCanvasController, canvasMediaType } from '@hachej/boring-ui-kit/canvas';
import { CanvasEditor } from '@hachej/boring-ui-kit/canvas-editor';

import { ASSETS } from './canvas-mounted-browser-assets.mjs';

const root = createRoot(document.getElementById('root'));
const pageId = PageRecordType.createId('fictional-one');
const otherPageId = PageRecordType.createId('fictional-two');
const shapeIds = [createShapeId('fictional-near'), createShapeId('fictional-far')];
const identity = { scopeId: 'fictional', principalId: 'browser', initiatorId: 'journey' };
const target = { resource: { providerId: 'fictional', path: 'board.canvas' }, view: { kind: 'published' } };
let fixture;
let writes = 0;
let generation = 0;
function mount(readOnly = false) {
  flushSync(() => root.render(null));
  fixture?.controller.dispose();
  fixture?.store.dispose();
  const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils, users: { currentUser: atom('fictional browser user', null) } });
  store.put([
    DocumentRecordType.create({ id: TLDOCUMENT_ID, name: 'Fictional board' }),
    PageRecordType.create({ id: pageId, name: 'One', index: 'a1' }),
    PageRecordType.create({ id: otherPageId, name: 'Two', index: 'a2' }),
    ...shapeIds.map((id, index) => store.schema.types.shape.create({ id, type: 'geo', parentId: pageId, index: index ? 'a2' : 'a1', x: index ? 3000 : 10, y: index ? 1800 : 20, props: { ...GeoShapeUtil.prototype.getDefaultProps(), w: 200, h: 150 } })),
  ]);
  const snapshot = { ref: { ...target, revision: 'fictional-r1' }, mediaType: canvasMediaType, bytes: new TextEncoder().encode(JSON.stringify(store.getStoreSnapshot('document'))) };
  const client = {
    read: async () => ({ kind: 'available', snapshot }),
    publish: async () => { writes++; throw new Error('Presentation commands must not publish'); },
    lookup: async () => { throw new Error('Presentation commands must not look up publication'); },
  };
  const controller = createCanvasController({ store, client, identity, source: { kind: 'saved', snapshot }, instanceId: `fixture-${++generation}`, epoch: 'browser', readOnly });
  fixture = { store, controller, editor: null, tools: null };
  const owned = fixture;
  flushSync(() => root.render(<CanvasEditor controller={controller} assetUrls={ASSETS} height="calc(100dvh - 100px)" title="Fictional mounted commands" onMount={editor => { owned.editor = editor; editor.setCurrentPage(pageId); }} onMountedTools={tools => { owned.tools = tools; }} />));
}
window.canvasJourney = {
  mount, shapeIds, pageId, otherPageId,
  get fixture() { return fixture; },
  get writes() { return writes; },
  state() {
    const state = fixture.controller.getSnapshot();
    return { dirty: state.dirty, bufferVersion: state.bufferVersion, document: state.document, writes };
  },
  async command(name, extra = {}, target = fixture.tools.getTarget(), tools = fixture.tools) {
    return tools[name].invoke(target, { expiresAt: Date.now() + 10000, ...extra });
  },
};
mount();
