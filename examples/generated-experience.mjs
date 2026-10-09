import { composeExperience } from '@hachej/boring-ui-kit/experience/compose';
import { createExperienceDocumentController } from '@hachej/boring-ui-kit/experience/document';
import { openSqliteWorkspaces } from './shared/sqlite-workspaces.mjs';

const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
const cells = [{ ref: 'fictional/notes', kind: 'document', version: 1 }];
const fallback = { format: 'boring.experience', version: 1, name: 'preparation', source: 'fixed', kinds: { 'boring/stack': 1 }, root: 'page', elements: { page: { type: 'boring/stack', props: {}, children: [] } } };
const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'layouts', authorize: () => true });
const target = { resource: { providerId: provider.providerId, path: 'experience/preparation.json' }, view: { kind: 'published' } };
const client = { read: request => provider.read(request, identity), publish: request => provider.publication.publish(request, identity), lookup: id => provider.reconciliation.lookup(id, identity) };
const controller = createExperienceDocumentController({ identity, source: { kind: 'new', target, descriptor: fallback }, instanceId: 'generated-layout', epoch: 'demo', cells, canView: () => true, client });
try {
  const base = controller.actions.selection(), snapshots = [];
  const abort = new AbortController();
  for await (const snapshot of composeExperience({
    definition: { name: 'preparation', intents: { review: 'Show the notes document in a vertical layout.' }, kinds: [{ kind: 'document', description: 'Notes document', metadata: { status: ['needs-review', 'ready'] } }] },
    candidates: [{ ref: 'fictional/notes', metadata: { status: 'needs-review' } }],
    intent: 'review', cells, canView: () => true, fallback, signal: abort.signal,
    limits: { maxElements: 8, maxDepth: 4, maxEvaluations: 2 },
    evaluate: async ({ questions }) => ({ answers: Object.fromEntries(Object.entries(questions).map(([name, question]) => {
      const keys = Object.keys(question.criteria);
      return [name, { choice: name === 'root' ? 'layout_stack' : keys.find(key => key.startsWith('use:')) ?? keys[0] }];
    })) }),
  })) snapshots.push(snapshot);
  const final = snapshots.at(-1);
  if (final?.kind !== 'final') throw new Error('Fictional composition did not finish');
  const offer = controller.actions.propose(base, final.descriptor);
  if (offer.kind !== 'proposed') throw new Error('Layout offer was refused');
  const adopted = controller.actions.adopt(offer.proposalId);
  if (adopted.kind !== 'applied') throw new Error('Layout adoption was refused');
  if ((await client.read({ target, revision: { kind: 'latest' } })).kind !== 'missing') throw new Error('Composition published before Keep');
  const saved = await controller.flush(adopted.value);
  if (saved.kind !== 'saved') throw new Error('Keep did not commit');
  console.log(JSON.stringify({ snapshots: snapshots.map(value => value.kind), generatedSource: final.descriptor.source,
    keptSource: controller.getSnapshot().descriptor.source, receipt: (await client.lookup(saved.receipt.operationId)).kind,
    dirty: controller.getSnapshot().dirty,
  }, null, 2));
} finally { controller.dispose(); provider.close(); }
