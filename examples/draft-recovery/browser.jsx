import 'tldraw/tldraw.css';
import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { atom, createTLStore } from '@tldraw/editor';
import { createShapeId } from '@tldraw/tlschema';
import { defaultBindingUtils, defaultShapeUtils } from 'tldraw';
import { randomUUID } from '@hachej/boring-files/platform';
import { createResourceClient } from '@hachej/boring-files/remote';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { MarkdownEditor } from '@hachej/boring-ui-kit/markdown-editor';
import { createHtmlController } from '@hachej/boring-ui-kit/html';
import { HtmlViewer } from '@hachej/boring-ui-kit/html-viewer';
import { createCanvasController } from '@hachej/boring-ui-kit/canvas';
import { CanvasEditor } from '@hachej/boring-ui-kit/canvas-editor';
import { createExperienceDocumentController } from '@hachej/boring-ui-kit/experience/document';
import { ExperienceDocument } from '@hachej/boring-ui-kit/experience/document-viewer';
import { ASSETS } from '../../test/fixtures/canvas-mounted-browser-assets.mjs';
import { openDraftDatabase } from './indexeddb-store.mjs';

const identity = { principalId: 'fictional-editor', scopeId: 'fictional-draft-project', initiatorId: 'fictional-person' };
const target = format => ({ resource: { providerId: 'fictional-drafts', path: `document.${format}` }, view: { kind: 'published' } });
const root = createRoot(document.getElementById('root'));
const revocation = new AbortController();
let releaseWrite, writeHeld = false, canvasStore;
const database = await openDraftDatabase({ indexedDB, beforeMutation: async operation => {
  if (operation === 'write' && window.drafts.holdWrite) { writeHeld = true; await new Promise(resolve => { releaseWrite = resolve; }); writeHeld = false; }
} });
const session = await database.login(identity);
const draftStore = database.storeFor(session);
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('fictional-draft-session-v1') : null;
if (!channel) throw new Error('The fictional cross-tab host requires BroadcastChannel');
channel.onmessage = event => { if (event.data === session.epoch) revocation.abort(); };
const drafts = { store: draftStore, providerInstanceId: 'fictional-sqlite-provider-v1', signal: revocation.signal, expiresAt: session.expiresAt, retentionMs: 3600000 };
const clients = new Map(), controllers = new Map();
const cells = [{ ref: 'fictional/content', kind: 'fictional/content', version: 1, render: () => <p>Fictional borrowed content remains independent.</p> }];
const canView = () => !revocation.signal.aborted;
for (const format of ['markdown', 'html', 'canvas', 'experience']) {
  const client = createResourceClient({ identity, endpoint: new URL(`/resource/${format}`, location.href), publication: true, reconciliation: true, fetch: request => fetch(request) });
  clients.set(format, client);
  const read = await client.read({ target: target(format), revision: { kind: 'latest' } });
  if (read.kind !== 'available') throw new Error(`Fictional ${format} unavailable`);
  const options = { identity, client, drafts, source: { kind: 'saved', snapshot: read.snapshot }, instanceId: randomUUID(), epoch: 'page' };
  let controller;
  if (format === 'markdown') controller = createMarkdownController(options);
  if (format === 'html') controller = createHtmlController(options);
  if (format === 'experience') controller = createExperienceDocumentController({ ...options, cells, canView });
  if (format === 'canvas') {
    canvasStore = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils, users: { currentUser: atom('fictional recovery user', null) } });
    controller = createCanvasController({ ...options, store: canvasStore });
  }
  controllers.set(format, controller);
}
function App() {
  const html = useSyncExternalStore(controllers.get('html').subscribe, controllers.get('html').getSnapshot, controllers.get('html').getSnapshot);
  return <main><h1>Fictional opt-in draft recovery</h1><p>Stored drafts are local recovery content. Save publishes through the SQLite resource provider. This fixture makes no encryption claim.</p>
    <button onClick={() => window.drafts.logout()}>Log out of draft storage</button>
    <p role="status">{html.recovery.kind === 'revoked' ? 'Draft session revoked' : 'Fictional authenticated draft session'}</p>
    <section data-format="markdown"><MarkdownEditor controller={controllers.get('markdown')} initialMode="source" title="Fictional Markdown" /></section>
    <section data-format="html"><HtmlViewer controller={controllers.get('html')} mode="source" /></section>
    <section data-format="experience"><ExperienceDocument controller={controllers.get('experience')} cells={cells} canView={canView} /></section>
    <section data-format="canvas"><CanvasEditor controller={controllers.get('canvas')} assetUrls={ASSETS} height={500} onMount={editor => { window.drafts.editor = editor; }} /></section>
  </main>;
}
window.drafts = {
  openDraftDatabase, controllers, clients, session, store: draftStore, database, holdWrite: false, editor: null,
  get writeHeld() { return writeHeld; }, releaseWrite: () => { releaseWrite?.(); releaseWrite = undefined; },
  logout: async () => { revocation.abort(); channel.postMessage(session.epoch); await database.logout(session); },
  addCanvas: () => { const page = Object.values(canvasStore.getStoreSnapshot('document').store).find(record => record.typeName === 'page'); const id = createShapeId(randomUUID()); canvasStore.put([canvasStore.schema.types.shape.create({ id, type: 'group', parentId: page.id, index: 'a1', x: 25, props: {} })]); return id; },
  changeLayout: () => { const controller = controllers.get('experience'); const descriptor = structuredClone(controller.getSnapshot().descriptor); descriptor.title = 'Recovered fictional layout'; const proposed = controller.actions.propose(controller.actions.selection(), descriptor); if (proposed.kind !== 'proposed') throw new Error('Layout refused'); return controller.actions.adopt(proposed.proposalId); },
  unmount: () => { flushSync(() => root.unmount()); channel.close(); for (const controller of controllers.values()) controller.dispose(); canvasStore.dispose(); database.close(); },
};
flushSync(() => root.render(<App />));
window.drafts.ready = true;
