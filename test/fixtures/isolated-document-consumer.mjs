import assert from 'node:assert/strict';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createWorkspaceJournal } from '@hachej/boring-files/journal';
import { createWorkspaceProvider } from '@hachej/boring-files/workspace';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { createResourceClient, createResourceHandler } from '@hachej/boring-files/remote';

const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
// The SQLite workspace backend: the files are rows of one workspace, the journal is in the same database.
const connection = openNodeConnection(':memory:');
const fs = openSqliteFileSystem({ connection, workspace: 'fictional-project', cwd: '/workspace' });
const provider = createWorkspaceProvider({ identity: { providerId: 'documents', instanceId: 'fictional-project', incarnation: fs.incarnation, viewId: 'published' }, fs, journal: createWorkspaceJournal(connection) });
const target = { resource: { providerId: 'documents', path: 'notes.md' }, view: { kind: 'published' } };
const handler = createResourceHandler({ authenticate: async () => identity, reader: provider, publisher: provider.publication, lookup: provider.reconciliation });
const client = createResourceClient({ identity, endpoint: 'https://fictional.invalid/resources', fetch: handler, publication: true, reconciliation: true });
const controller = createMarkdownController({ identity, source: { kind: 'new', target }, client, instanceId: 'editor', epoch: 'page' });
try {
  controller.actions.edit('Saved from an isolated tarball consumer');
  const saved = await controller.flush(controller.actions.selection());
  assert.equal(saved.kind, 'saved');
  assert.equal(controller.getSnapshot().dirty, false);
  const read = await client.read({ target, revision: { kind: 'exact', value: saved.ref.revision } });
  assert.equal(new TextDecoder().decode(read.snapshot.bytes), 'Saved from an isolated tarball consumer');
  assert.deepEqual(await client.lookup(saved.receipt.operationId), { kind: 'committed', receipt: saved.receipt });
  const base = controller.actions.selection();
  assert.equal((await controller.tools.inspect.invoke(base.target, { expiresAt: Date.now() + 1000 })).kind, 'applied');
  const proposal = controller.actions.propose(base, [{ find: 'Saved', replace: 'Edited' }]);
  assert.equal(proposal.kind, 'proposed');
  const accepted = await controller.actions.accept(proposal.proposalId);
  assert.equal(accepted.kind, 'saved');
  assert.equal(new TextDecoder().decode((await client.read({ target, revision: { kind: 'latest' } })).snapshot.bytes), 'Edited from an isolated tarball consumer');
  const listed = await fs.listDir('/workspace', { value: () => undefined });
  assert.deepEqual(listed.value.map(entry => entry.name), ['notes.md'], 'the saved document is a workspace file');
  console.log('PASS: installed SQLite workspace provider and authenticated Fetch client, exact saves, proposals, target-bound inspection and receipt lookup');
} finally { controller.dispose(); connection.close(); }
