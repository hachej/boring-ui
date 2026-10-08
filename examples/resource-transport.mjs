import { openSqliteWorkspaces } from './shared/sqlite-workspaces.mjs';
import { createResourceClient, createResourceHandler } from '@hachej/boring-files/remote';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';

const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });
const handler = createResourceHandler({ authenticate: async () => identity, reader: provider, publisher: provider.publication, lookup: provider.reconciliation });
const client = createResourceClient({ identity, endpoint: 'https://fictional.invalid/resources', fetch: handler, publication: true, reconciliation: true });
const target = { resource: { providerId: 'documents', path: 'notes.md' }, view: { kind: 'published' } };
const editor = createMarkdownController({ identity, source: { kind: 'new', target }, client, instanceId: 'editor', epoch: 'demo' });
try {
  editor.actions.edit('# Fictional remote resource\n\nSaved through authenticated Fetch objects.\n');
  const result = await editor.flush(editor.actions.selection());
  if (result.kind !== 'saved') throw new Error(JSON.stringify(result));
  const retained = await client.lookup(result.receipt.operationId);
  if (retained.kind !== 'committed') throw new Error(JSON.stringify(retained));
  const bytes = Uint8Array.from({ length: 2 * 1024 * 1024 }, (_, index) => index * 31 & 255);
  const roomy = createResourceClient({ identity, endpoint: 'https://fictional.invalid/resources', fetch: createResourceHandler({ authenticate: async () => identity, reader: provider, publisher: provider.publication, maxRequestBytes: 8_388_608, maxResponseBytes: 8_388_608 }), publication: true, reconciliation: true, maxRequestBytes: 8_388_608, maxResponseBytes: 8_388_608 });
  const large = { resource: { providerId: 'documents', path: 'large.bin' }, view: { kind: 'published' } };
  const stored = await roomy.publish({ operationId: 'large-binary', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: large, expected: { kind: 'absent' }, bytes, mediaType: 'application/octet-stream' }] });
  const back = await roomy.read({ target: large, revision: { kind: 'latest' } });
  if (stored.kind !== 'committed' || back.kind !== 'available' || !Buffer.from(back.snapshot.bytes).equals(bytes)) throw new Error('multi-MiB binary did not round-trip');
  console.log(JSON.stringify({ transport: 'in-process Request/Response', saved: result.ref, operationId: retained.receipt.operationId, dirty: editor.getSnapshot().dirty }, null, 2));
} finally { editor.dispose(); provider.close(); }
