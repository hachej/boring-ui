// The lazily loaded canvas: this module (and so tldraw's JavaScript and, through the native renderer, its stylesheet) loads only
// when the person opens a canvas. Fictional board content only.
import { atom, createTLStore } from '@tldraw/editor';
import { DocumentRecordType, PageRecordType, TLDOCUMENT_ID, createShapeId } from '@tldraw/tlschema';
import { GeoShapeUtil, defaultBindingUtils, defaultShapeUtils } from 'tldraw';
import { createCanvasController, canvasMediaType } from '@hachej/boring-ui-kit/canvas';
import { CanvasEditor } from '@hachej/boring-ui-kit/canvas-editor';
import { selfHostedCanvasAssetUrls } from './self-hosted.mjs';

const identity = { scopeId: 'fictional', principalId: 'browser', initiatorId: 'journey' };
const target = { resource: { providerId: 'fictional', path: 'board.canvas' }, view: { kind: 'published' } };

export default function CanvasPanel({ licenseKey }) {
  const pageId = PageRecordType.createId('fictional-page');
  const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils, users: { currentUser: atom('fictional browser user', null) } });
  store.put([
    DocumentRecordType.create({ id: TLDOCUMENT_ID, name: 'Fictional board' }),
    PageRecordType.create({ id: pageId, name: 'One', index: 'a1' }),
    store.schema.types.shape.create({ id: createShapeId('fictional-frame'), type: 'geo', parentId: pageId, index: 'a1', x: 40, y: 40, props: { ...GeoShapeUtil.prototype.getDefaultProps(), w: 220, h: 140 } }),
  ]);
  const snapshot = { ref: { ...target, revision: 'fictional-r1' }, mediaType: canvasMediaType, bytes: new TextEncoder().encode(JSON.stringify(store.getStoreSnapshot('document'))) };
  const client = {
    read: async () => ({ kind: 'available', snapshot }),
    publish: async () => { throw new Error('The journey host does not publish'); },
    lookup: async () => { throw new Error('The journey host does not look up publication'); },
  };
  const controller = createCanvasController({ store, client, identity, source: { kind: 'saved', snapshot }, instanceId: 'canvas-assets-1', epoch: 'browser' });
  return <CanvasEditor controller={controller} assetUrls={selfHostedCanvasAssetUrls('/tldraw-assets')} height={320} title="Fictional board"
    {...(licenseKey === undefined ? {} : { licenseKey })} />;
}
