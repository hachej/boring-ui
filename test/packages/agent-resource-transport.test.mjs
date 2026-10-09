import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { createResourceClient, createResourceHandler } from '@hachej/boring-files/remote';
import { createMarkdownController } from '@hachej/boring-ui-kit/markdown';
import { admitDocumentTool, createSaveNoteTool, documentToolResult } from '../fixtures/native-document.mjs';

const identity = { principalId: 'editor', initiatorId: 'alice', scopeId: 'fictional-project' };
const target = { resource: { providerId: 'documents', path: 'notes.md' }, view: { kind: 'published' } };

test('a native publishing ToolTask and exact Markdown flush share authenticated remote publication', { timeout: 15000 }, async t => {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });
  t.after(() => provider.close());
  let admitted = 0;
  const handler = createResourceHandler({ authenticate: async () => identity, reader: provider,
    publisher: { publish: (...args) => { admitted++; return provider.publication.publish(...args); } }, lookup: provider.reconciliation });
  const client = createResourceClient({ identity, endpoint: 'https://fictional.invalid/resources', fetch: handler, publication: true, reconciliation: true });
  const tool = createSaveNoteTool({ target, publisher: { publish: request => client.publish(request) }, operationNamespace: 'fictional-remote', resolveAccess: () => identity });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.remote-resource', tools: [tool] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  const saved = await documentToolResult(harness, conversation, await admitDocumentTool(conversation, { text: 'Native fictional notes', expected: { kind: 'absent' } }));
  assert.equal(saved.result.kind, 'committed');
  assert.deepEqual(await client.lookup(saved.result.receipt.operationId), saved.result);
  const source = await client.read({ target, revision: { kind: 'latest' } });
  assert.equal(source.kind, 'available');
  const editor = createMarkdownController({ identity, source: { kind: 'saved', snapshot: source.snapshot }, client, instanceId: 'editor', epoch: 'page' });
  t.after(() => editor.dispose());
  editor.actions.edit('Human fictional edit');
  const selected = editor.actions.selection();
  const flushed = await editor.flush(selected);
  assert.equal(flushed.kind, 'saved');
  assert.equal(editor.getSnapshot().dirty, false);
  const stale = await documentToolResult(harness, conversation, await admitDocumentTool(conversation, { text: 'Stale native text', expected: { kind: 'revision', revision: source.snapshot.ref.revision } }));
  assert.equal(stale.result.kind, 'conflict');
  assert.equal(new TextDecoder().decode((await client.read({ target, revision: { kind: 'latest' } })).snapshot.bytes), 'Human fictional edit');
  assert.equal(admitted, 3);
  editor.dispose();
  await conversation.configure({ instructions: 'Still owned by the host' }, context);
  assert.deepEqual(await client.lookup(flushed.receipt.operationId), { kind: 'committed', receipt: flushed.receipt });
});

test('Markdown lost Fetch acknowledgement reconciles without replay or overwriting later typing', async t => {
  const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'documents', authorize: () => true });
  t.after(() => provider.close());
  const handler = createResourceHandler({ authenticate: async () => identity, reader: provider, publisher: provider.publication, lookup: provider.reconciliation });
  let writes = 0;
  const committed = Promise.withResolvers(), release = Promise.withResolvers();
  const client = createResourceClient({ identity, endpoint: 'https://fictional.invalid/resources', publication: true, reconciliation: true, fetch: async request => {
    const kind = (await request.clone().json()).kind;
    const response = await handler(request);
    if (kind === 'publish') {
      writes++;
      committed.resolve();
      await release.promise;
      await response.body.cancel();
      throw new Error('Lost fictional acknowledgement');
    }
    return response;
  } });
  const editor = createMarkdownController({ identity, source: { kind: 'new', target }, client, instanceId: 'editor', epoch: 'page' });
  t.after(() => editor.dispose());
  editor.actions.edit('Captured text');
  const pending = editor.flush(editor.actions.selection());
  await committed.promise;
  editor.actions.edit('Later unsaved text');
  release.resolve();
  assert.equal((await pending).kind, 'unknown');
  assert.equal((await editor.actions.reconcile()).kind, 'saved');
  assert.equal(editor.getSnapshot().text, 'Later unsaved text');
  assert.equal(editor.getSnapshot().dirty, true);
  assert.equal(new TextDecoder().decode((await client.read({ target, revision: { kind: 'latest' } })).snapshot.bytes), 'Captured text');
  assert.equal(writes, 1);
});
