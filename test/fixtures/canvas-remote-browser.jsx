import 'tldraw/tldraw.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { atom, createTLStore } from '@tldraw/editor';
import { createShapeId, PageRecordType } from '@tldraw/tlschema';
import { defaultBindingUtils, defaultShapeUtils } from 'tldraw';
import { createResourceClient } from '@hachej/boring-files/remote';
import { createCanvasController } from '@hachej/boring-ui-kit/canvas';
import { CanvasEditor } from '@hachej/boring-ui-kit/canvas-editor';
import { connectCanvasPresentation } from '../../examples/shared/canvas-transport-client.mjs';
import { ASSETS } from './canvas-mounted-browser-assets.mjs';

const root = createRoot(document.getElementById('root'));
const identity = { scopeId: 'fictional', principalId: 'browser', initiatorId: 'journey' };
const target = { resource: { providerId: 'fictional', path: 'board.canvas' }, view: { kind: 'published' } };
const pageId = PageRecordType.createId('one'), shapeId = createShapeId('reviewed');
const effects = { select: 0, propose: 0 };
let fixture, releaseDelivery, releaseReply;
const faults = { pauseDelivery: false, dropReply: false, pauseReply: false, deliveryHeld: false, replyHeld: false };
const authenticated = request => {
  const headers = new Headers(request.headers);
  headers.set('authorization', 'Bearer fictional-browser');
  return fetch(new Request(request, { headers }));
};
const client = createResourceClient({ identity, endpoint: new URL('/resources', location.href), publication: true, reconciliation: true, fetch: authenticated });
const transportFetch = async request => {
  const op = new URL(request.url).searchParams.get('op');
  if (op === 'result' && faults.dropReply) { faults.dropReply = false; throw new Error('Fictional acknowledgement lost after browser effect'); }
  if (op === 'result' && faults.pauseReply) {
    faults.pauseReply = false; faults.replyHeld = true;
    await new Promise(resolve => { releaseReply = resolve; });
    faults.replyHeld = false;
  }
  const response = await authenticated(request);
  if (op === 'poll' && response.status === 200 && faults.pauseDelivery) {
    faults.pauseDelivery = false; faults.deliveryHeld = true;
    await new Promise(resolve => { releaseDelivery = resolve; });
    faults.deliveryHeld = false;
  }
  return response;
};
async function attach() {
  const owned = fixture;
  await owned.transport?.close();
  if (fixture !== owned || !owned.tools?.getTarget()) throw new Error('No current mounted canvas');
  const tools = { ...owned.tools };
  for (const command of ['select', 'propose']) tools[command] = { ...owned.tools[command], invoke: async (...args) => {
    const result = await owned.tools[command].invoke(...args);
    if (result.kind === 'applied' || result.kind === 'proposed') effects[command]++;
    return result;
  } };
  owned.transport = await connectCanvasPresentation({ endpoint: new URL('/canvas', location.href), fetch: transportFetch, tools });
  document.getElementById('connection').textContent = `Connected ${owned.transport.id}`;
  void owned.transport.closed.then(() => {
    if (fixture === owned) document.getElementById('connection').textContent = 'Disconnected';
  });
  return { id: owned.transport.id, target: owned.transport.target };
}
async function mount(readOnly = false) {
  await fixture?.transport?.close();
  const read = await client.read({ target, revision: { kind: 'latest' } });
  if (read.kind !== 'available') throw new Error(`Cannot open fictional canvas: ${read.kind}`);
  flushSync(() => root.render(null));
  await fixture?.controller.dispose(); fixture?.store.dispose();
  const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils, users: { currentUser: atom('fictional remote canvas user', null) } });
  const controller = createCanvasController({ store, client, identity, source: { kind: 'saved', snapshot: read.snapshot }, instanceId: crypto.randomUUID(), epoch: 'browser', readOnly });
  const owned = fixture = { store, controller, editor: null, tools: null, transport: null };
  flushSync(() => root.render(<><button onClick={() => attach().catch(error => { document.getElementById('connection').textContent = String(error); })}>Connect agent</button>
    <span id="connection">Disconnected</span><CanvasEditor controller={controller} assetUrls={ASSETS} height="70dvh" title="Fictional remote canvas"
      onMount={editor => { owned.editor = editor; editor.setCurrentPage(pageId); }} onMountedTools={tools => { owned.tools = tools; }} /></>));
}
window.canvasRemote = {
  mount, attach, faults, effects, shapeId, pageId,
  get fixture() { return fixture; },
  state: () => fixture.controller.getSnapshot(),
  move: x => fixture.editor.updateShape({ id: shapeId, type: 'geo', x }),
  resumeDelivery: () => { releaseDelivery?.(); releaseDelivery = undefined; },
  resumeReply: () => { releaseReply?.(); releaseReply = undefined; },
  async detach() { await fixture.transport?.close(); fixture.transport = null; },
};
mount().catch(error => { document.body.textContent = String(error); throw error; });
