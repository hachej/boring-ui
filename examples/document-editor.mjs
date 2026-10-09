import { openSqliteWorkspaces } from './shared/sqlite-workspaces.mjs';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';

const identity = { scopeId: 'fictional-project', principalId: 'local-editor', initiatorId: 'alice' };
const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: (_action, _target, access) => access.scopeId === identity.scopeId && access.principalId === identity.principalId });
const target = { resource: { providerId: provider.providerId, path: 'notes.md' }, view: { kind: 'published' } };
const client = {
  read: request => provider.read(request, identity),
  publish: request => provider.publication.publish(request, identity),
  lookup: operationId => provider.reconciliation.lookup(operationId, identity),
};
const editor = createMarkdownController({ identity, source: { kind: 'new', target }, client, instanceId: 'notes-editor', epoch: 'demo-page' });
try {
  editor.actions.edit('# Fictional project\n\nA document saved through the public controller.\n');
  const saved = await editor.flush(editor.actions.selection());
  if (saved.kind !== 'saved') throw new Error(JSON.stringify(saved));
  const loaded = await client.read({ target, revision: { kind: 'exact', value: saved.ref.revision } });
  if (loaded.kind !== 'available') throw new Error(JSON.stringify(loaded));
  console.log(JSON.stringify({ outcome: saved.kind, dirty: editor.getSnapshot().dirty, revision: saved.ref.revision, text: new TextDecoder().decode(loaded.snapshot.bytes) }, null, 2));
} finally {
  editor.dispose();
  provider.close();
}
