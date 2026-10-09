import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToolResultEntry } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openMorningRuntime } from '../../examples/morning/runtime.mjs';
import { morningIdentity as actor } from '../../examples/morning/documents.mjs';
const [directory, phase, mode] = process.argv.slice(2), keepAlive = setInterval(() => {}, 1000);
const layout = { format: 'boring.experience', version: 1, name: 'morning', source: 'fixed', kinds: { 'boring/stack': 1 }, root: 'root', elements: { root: { type: 'boring/stack', props: { gap: 'medium' }, children: [] } } };
const preparation = mode.startsWith('prepare-');
const isNative = request => preparation ? request.operationId.startsWith('["morning-prepare"') && JSON.parse(request.operationId)[2] === 'todo' : request.operationId.startsWith('["fictional.morning"');
const pause = async request => { writeFileSync(join(directory, 'ready.json'), JSON.stringify({ operationId: request.operationId, taskId: preparation ? JSON.parse(request.operationId)[1] : JSON.parse(request.operationId).at(-1) })); await new Promise(() => {}); };
const runtime = await openMorningRuntime({ directory, layout,
  authorize: () => !(phase === 'recover' && mode.endsWith('revoked')),
  beforePublish: async ({ request }) => { if (!isNative(request)) return; appendFileSync(join(directory, 'attempts'), 'publish\n'); if (phase === 'hold' && mode.endsWith('missing')) await pause(request); },
  afterPublish: async ({ request }) => { if (phase === 'hold' && isNative(request)) await pause(request); },
});
if (phase === 'hold') {
  await runtime.prepare();
  if (preparation) throw new Error('Preparation did not reach barrier');
  const email = await runtime.email.read(actor), draft = await runtime.draftClient(actor).read({ target: runtime.draftTarget, revision: { kind: 'latest' } });
  await runtime.invokeTool('send_email', { expected: email.revision, draftRevision: draft.snapshot.ref.revision }, actor);
} else {
  if (mode === 'newer') {
    const email = await runtime.email.read(actor);
    await runtime.local.providers.email.publication.publish({ operationId: 'later-human', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: { resource: { providerId: 'morning-email', path: 'email.json' }, view: { kind: 'published' }, revision: email.revision }, mediaType: 'application/json', bytes: new TextEncoder().encode(JSON.stringify({ ...email.document, subject: 'Later human annotation' })) }] }, actor);
  }
  const ready = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
  const terminal = await runtime.local.harness.waitForTask(ready.taskId, context);
  const entry = preparation ? null : await runtime.local.conversation.commit(tx => tx.entry(ToolResultEntry, terminal.state.outcome.result.entryId), context);
  const result = preparation ? terminal.state.outcome.result.todo : JSON.parse(entry.model[0].content[0].text);
  const app = preparation ? 'todo' : 'email';
  const actual = runtime.local.providers[app].workspace(actor.scopeId);
  const saved = await actual.read({ target: { resource: { providerId: `morning-${app}`, path: `${app}.json` }, view: { kind: 'published' } }, revision: { kind: 'latest' } }, actor);
  const receipt = await actual.reconciliation.lookup(ready.operationId, actor);
  writeFileSync(join(directory, 'recovered.json'), JSON.stringify({ result, receipt, saved: saved.kind === 'available' ? { revision: saved.snapshot.ref.revision, document: JSON.parse(new TextDecoder().decode(saved.snapshot.bytes)) } : saved }));
}
await runtime.close(); clearInterval(keepAlive);
