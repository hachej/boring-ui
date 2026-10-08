import assert from 'node:assert/strict';
import { composeExperienceRegion } from '@hachej/boring-ui-kit/experience/regions';
import { createExperienceDocumentController } from '@hachej/boring-ui-kit/experience/document';
import { openSqliteWorkspaces } from './shared/sqlite-workspaces.mjs';

const identity = { scopeId: 'fictional-project', principalId: 'editor', initiatorId: 'alice' };
const cells = ['header', 'notes'].map(name => ({ ref: `fictional/${name}`, kind: 'document', version: 1 }));
const descriptor = { format: 'boring.experience', version: 1, name: 'preparation', source: 'fixed',
  kinds: { 'boring/stack': 1, 'boring/generated': 1, 'boring/cell': 1, document: 1 }, root: 'page', elements: {
    page: { type: 'boring/stack', props: {}, children: ['header', 'region'] },
    header: { type: 'boring/cell', props: { ref: 'fictional/header' }, children: [] },
    region: { type: 'boring/generated', props: { region: 'work', candidates: ['fictional/notes'], maxElements: 8, minWidth: 280, regenerate: ['request'], prompt: 'review' }, children: [] },
  } };
const provider = openSqliteWorkspaces({ filename: ':memory:', providerId: 'layouts', authorize: () => true });
const target = { resource: { providerId: provider.providerId, path: 'experience/preparation.json' }, view: { kind: 'published' } };
const client = { read: request => provider.read(request, identity), publish: request => provider.publication.publish(request, identity), lookup: id => provider.reconciliation.lookup(id, identity) };
const source = JSON.stringify(descriptor, null, 2) + '\n';
await client.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(source), mediaType: 'application/json' }] });
const read = await client.read({ target, revision: { kind: 'latest' } });
assert.equal(read.kind, 'available');
const controller = createExperienceDocumentController({ identity, source: { kind: 'saved', snapshot: read.snapshot }, instanceId: 'region-layout', epoch: 'demo', cells, canView: () => true, client });
try {
  const started = controller.actions.beginRegion(controller.actions.selection(), 'work', 'request');
  assert.equal(started.kind, 'applied');
  const snapshots = [];
  for await (const snapshot of composeExperienceRegion({ descriptor: controller.getSnapshot().descriptor, region: started.value.region, trigger: started.value.trigger,
    definition: { name: 'preparation', intents: { review: 'Show the notes document in a vertical layout.' }, kinds: [{ kind: 'document', description: 'Notes document', metadata: { status: ['needs-review', 'ready'] } }] },
    candidates: [{ ref: 'fictional/notes', metadata: { status: 'needs-review' } }], intent: 'review', cells, canView: () => true,
    signal: new AbortController().signal, limits: { maxElements: 8, maxDepth: 4, maxEvaluations: 2 },
    evaluate: async ({ questions }) => ({ answers: Object.fromEntries(Object.entries(questions).map(([name, question]) => {
      const keys = Object.keys(question.criteria);
      return [name, { choice: name === 'root' ? 'layout_stack' : keys.find(key => key.startsWith('use:')) ?? keys[0] }];
    })) }),
  })) snapshots.push(snapshot);
  const final = snapshots.at(-1);
  assert.equal(final.kind, 'final');
  const offer = controller.actions.proposeRegion(started.value, final.descriptor);
  assert.equal(offer.kind, 'proposed');
  assert.equal(controller.getSnapshot().text, source);
  const adopted = controller.actions.adopt(offer.proposalId);
  assert.equal(adopted.kind, 'applied');
  assert.deepEqual(controller.getSnapshot().descriptor.elements.header, descriptor.elements.header);
  const saved = await controller.actions.pin(adopted.value);
  assert.equal(saved.kind, 'saved');
  console.log(JSON.stringify({ snapshots: snapshots.map(value => value.kind), pinnedRegion: started.value.region,
    receipt: (await client.lookup(saved.receipt.operationId)).kind, dirty: controller.getSnapshot().dirty }, null, 2));
} finally { controller.dispose(); provider.close(); }
