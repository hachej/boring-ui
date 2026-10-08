import 'tldraw/tldraw.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { atom, createTLStore } from '@tldraw/editor';
import { createShapeId, PageRecordType } from '@tldraw/tlschema';
import { GeoShapeUtil, defaultBindingUtils, defaultShapeUtils } from 'tldraw';
import { createResourceClient } from '@hachej/boring-files/remote';
import { createCanvasController } from '@hachej/boring-ui-kit/canvas';
import { CanvasEditor } from '@hachej/boring-ui-kit/canvas-editor';
import { ASSETS } from './canvas-mounted-browser-assets.mjs';

const root = createRoot(document.getElementById('root'));
const identity = { scopeId: 'fictional', principalId: 'browser', initiatorId: 'journey' };
const target = { resource: { providerId: 'fictional', path: 'board.canvas' }, view: { kind: 'published' } };
const pageId = PageRecordType.createId('one');
const shapeId = createShapeId('reviewed');
const client = createResourceClient({ identity, endpoint: new URL('/resources', location.href), publication: true, reconciliation: true,
  fetch: request => { const headers = new Headers(request.headers); headers.set('authorization', 'Bearer fictional-canvas-journey'); return fetch(new Request(request, { headers })); },
});
let fixture;
async function mount(readOnly = false) {
  const read = await client.read({ target, revision: { kind: 'latest' } });
  if (read.kind !== 'available') throw new Error(`Cannot open fixture: ${read.kind}`);
  flushSync(() => root.render(null));
  fixture?.controller.dispose(); fixture?.store.dispose();
  const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils, users: { currentUser: atom('fictional proposal user', null) } });
  const controller = createCanvasController({ store, client, identity, source: { kind: 'saved', snapshot: read.snapshot }, instanceId: crypto.randomUUID(), epoch: 'browser', readOnly });
  const owned = fixture = { store, controller, editor: null, tools: null };
  flushSync(() => root.render(<CanvasEditor controller={controller} assetUrls={ASSETS} height="60dvh" title="Fictional proposal review" onMount={editor => { owned.editor = editor; editor.setCurrentPage(pageId); }} onMountedTools={tools => { owned.tools = tools; }} />));
}
window.canvasProposals = {
  mount, shapeId,
  get fixture() { return fixture; },
  state: () => fixture.controller.getSnapshot(),
  addChild() {
    const parent = fixture.store.schema.types.shape.create({ id: createShapeId('parent'), type: 'group', parentId: pageId, index: 'a2', props: {} });
    fixture.store.put([parent, { ...fixture.store.get(shapeId), parentId: parent.id }]);
  },
  proposeParentRemoval() {
    return fixture.controller.actions.propose(fixture.controller.actions.selection(), [{ kind: 'remove', id: createShapeId('parent') }], 'Remove parent and its child');
  },
  move: x => fixture.editor.updateShape({ id: shapeId, type: 'geo', x }),
  propose(kind, summary) {
    const record = kind === 'create' ? fixture.store.schema.types.shape.create({ id: shapeId, type: 'geo', parentId: pageId, index: 'a1', x: 40, y: 50,
      props: { ...GeoShapeUtil.prototype.getDefaultProps(), w: 180, h: 100 } })
      : { ...fixture.store.get(shapeId), y: fixture.store.get(shapeId).y + 100 };
    const edit = kind === 'remove' ? { kind, id: shapeId } : { kind, record };
    return fixture.controller.actions.propose(fixture.controller.actions.selection(), [edit], summary);
  },
};
mount().catch(error => { document.body.textContent = String(error); throw error; });
