import { createResourceHandler } from '@hachej/boring-files/remote';
import { openSqliteWorkspaces } from '../shared/sqlite-workspaces.mjs';
import { DocumentRecordType, PageRecordType, TLDOCUMENT_ID, createTLSchema } from '@tldraw/tlschema';

export const draftIdentity = Object.freeze({ principalId: 'fictional-editor', scopeId: 'fictional-draft-project', initiatorId: 'fictional-person' });
export const draftTarget = format => ({ resource: { providerId: 'fictional-drafts', path: `document.${format}` }, view: { kind: 'published' } });
export const draftLayout = title => ({ format: 'boring.experience', version: 1, name: 'fictional-recovery', title, source: 'fixed', kinds: { 'boring/stack': 1, 'boring/cell': 1, 'fictional/content': 1 }, root: 'root', elements: { root: { type: 'boring/stack', props: {}, children: ['content'] }, content: { type: 'boring/cell', props: { ref: 'fictional/content' } } } });

export async function openDraftHost({ filename, authenticate = async () => draftIdentity, beforePublish } = {}) {
  const provider = openSqliteWorkspaces({ filename, providerId: 'fictional-drafts' });
  const page = PageRecordType.create({ id: PageRecordType.createId('fictional'), name: 'Fictional page', index: 'a1' });
  const document = DocumentRecordType.create({ id: TLDOCUMENT_ID, name: 'Fictional recovery canvas' });
  const sources = { markdown: ['text/markdown', '# Fictional original\n'], html: ['text/html', '<p>Fictional original</p>\n'], experience: ['application/json', JSON.stringify(draftLayout('Original fictional layout')) + '\n'], canvas: ['application/vnd.tldraw+json', JSON.stringify({ schema: createTLSchema().serialize(), store: { [document.id]: document, [page.id]: page } })] };
  for (const [format, [mediaType, text]] of Object.entries(sources)) {
    const read = await provider.read({ target: draftTarget(format), revision: { kind: 'latest' } }, draftIdentity);
    if (read.kind === 'missing') await provider.publication.publish({ operationId: `fictional-seed-${format}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: draftTarget(format), expected: { kind: 'absent' }, bytes: new TextEncoder().encode(text), mediaType }] }, draftIdentity);
  }
  let publications = 0;
  const handlers = new Map(Object.keys(sources).map(format => [format, createResourceHandler({ authenticate, reader: { read: (request, access) => request.target.resource.path === draftTarget(format).resource.path ? provider.read(request, access) : Promise.resolve({ kind: 'denied', reason: 'Wrong fictional document' }) }, publisher: { publish: async (request, access) => {
    if (request.changes.some(change => change.target.resource.path !== draftTarget(format).resource.path)) return Promise.resolve({ kind: 'denied', reason: 'Wrong fictional document' });
    publications++; await beforePublish?.(request); return provider.publication.publish(request, access);
  } }, lookup: { lookup: (id, access) => provider.reconciliation.lookup(id, access) } })]));
  return { provider, publications: () => publications, handle: request => {
    const format = new URL(request.url).pathname.split('/').at(-1);
    return handlers.get(format)?.(request) ?? Promise.resolve(new Response(null, { status: 404 }));
  }, close: provider.close };
}
