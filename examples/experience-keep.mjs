import { openSqliteWorkspaces } from './shared/sqlite-workspaces.mjs';
import { createExperienceDocumentController } from '@hachej/boring-ui-kit/experience/document';

const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'layouts', authorize: () => true });
const target = { resource: { providerId: provider.providerId, path: 'experience/preparation.json' }, view: { kind: 'published' } };
const controller = createExperienceDocumentController({ identity, source: { kind: 'new', target }, instanceId: 'layout-document', epoch: 'demo',
  cells: [{ ref: 'fictional/notes', kind: 'notes', version: 1 }], canView: ref => ref === 'fictional/notes',
  client: { read: request => provider.read(request, identity), publish: request => provider.publication.publish(request, identity), lookup: id => provider.reconciliation.lookup(id, identity) },
});
try {
  const candidate = { format: 'boring.experience', version: 1, name: 'preparation', source: 'derived',
    kinds: { 'boring/stack': 1, 'boring/cell': 1, notes: 1 }, root: 'page', elements: {
      page: { type: 'boring/stack', props: {}, children: ['notes'] }, notes: { type: 'boring/cell', props: { ref: 'fictional/notes' } },
    },
  };
  const offer = controller.actions.propose(controller.actions.selection(), candidate);
  if (offer.kind !== 'proposed') throw new Error(JSON.stringify(offer));
  const adopted = controller.actions.adopt(offer.proposalId);
  if (adopted.kind !== 'applied') throw new Error(JSON.stringify(adopted));
  const before = await provider.read({ target, revision: { kind: 'latest' } }, identity);
  if (before.kind !== 'missing') throw new Error('Layout was published before Keep');
  const saved = await controller.flush(adopted.value);
  if (saved.kind !== 'saved') throw new Error(JSON.stringify(saved));
  const retained = await provider.reconciliation.lookup(saved.receipt.operationId, identity);
  console.log(JSON.stringify({ outcome: saved.kind, source: controller.getSnapshot().descriptor.source, revision: saved.ref.revision, operation: retained.kind, dirty: controller.getSnapshot().dirty }, null, 2));
} finally { controller.dispose(); provider.close(); }
