import { openSqliteWorkspaces } from './shared/sqlite-workspaces.mjs';
import { createResourceClient, createResourceHandler } from '@hachej/boring-files/remote';
import { createHtmlController } from '@hachej/boring-ui-kit/html';

const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });
const handler = createResourceHandler({ authenticate: async () => identity, reader: provider, publisher: provider.publication, lookup: provider.reconciliation });
const client = createResourceClient({ identity, endpoint: 'https://fictional.invalid/resources', fetch: handler, publication: true, reconciliation: true });
const target = { resource: { providerId: 'documents', path: 'page.html' }, view: { kind: 'published' } };
const controller = createHtmlController({ identity, source: { kind: 'new', target }, client, instanceId: 'html-document', epoch: 'demo' });
try {
  controller.actions.edit('<!doctype html>\n<h1>Fictional document</h1>\n<p>  Exact source spacing.  </p>\n');
  const saved = await controller.flush(controller.actions.selection());
  if (saved.kind !== 'saved') throw new Error(JSON.stringify(saved));
  const read = await client.read({ target, revision: { kind: 'exact', value: saved.ref.revision } });
  if (read.kind !== 'available') throw new Error(JSON.stringify(read));
  console.log(JSON.stringify({ outcome: saved.kind, mediaType: read.snapshot.mediaType, source: new TextDecoder().decode(read.snapshot.bytes), dirty: controller.getSnapshot().dirty }, null, 2));
} finally { controller.dispose(); provider.close(); }
