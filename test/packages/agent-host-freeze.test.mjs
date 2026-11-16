// What host-contract-freeze froze and what stays true after every slice: the entries, `DefinedAgent.delegates`, one Extension per agent,
// and the notes fixture's notebook run on Domain's in-memory runtime. The "not built" answers are run once and pasted in the report, never kept.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Domain from '@alchemy.run/domain';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { defineExtension } from '@earendil-works/pi-durable';
import { defineAgent } from '@hachej/boring-agent/agents';
import { Session } from '@hachej/boring-agent/host';
import notes from '../../fixtures/host-apps/notes/app.ts';
import todo from '../../fixtures/host-apps/todo/app.ts';
import { Notebook, NotebookHandlers, ReaderOnDeposit } from '../../fixtures/host-apps/notes/models/Notebook.model.ts';
import { NotebookApi } from '../../fixtures/host-apps/notes/models/NotebookApi.api.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const entry = (name) => join(root, 'packages/agent/dist', name);
const node = (code) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });

test('entries: the built host-runtime and host-build entries export functions and load in plain Node', async () => {
  const runtime = await import(entry('host-runtime.js'));
  for (const name of ['createSession', 'appTools', 'checkExpose', 'checkAgentTools', 'modelRoute']) assert.equal(typeof runtime[name], 'function', name);
  assert.equal(typeof runtime.SenderUnknown, 'function');
  assert.ok(new runtime.SenderUnknown('call-1') instanceof Error);
  assert.equal(new runtime.SenderUnknown('call-1').callId, 'call-1');
  const build = await import(entry('host-build.js'));
  assert.equal(typeof build.hostBuild, 'function');
  for (const file of ['host-runtime.js', 'host-build.js']) {
    const child = node(`await import(${JSON.stringify(entry(file))}); console.log('loaded')`);
    assert.equal(child.status, 0, `${file}: ${child.stderr}`);
  }
  // The Cloudflare entry loads @alchemy.run/cloudflare from host-mount-backend on, so only its declarations are read.
  const declarations = readFileSync(entry('host-cloudflare.d.ts'), 'utf8') + readFileSync(entry('host-cloudflare/index.d.ts'), 'utf8');
  assert.match(declarations, /mountApp/);
  assert.match(declarations, /entry/);
});

test('delegates: DefinedAgent.delegates holds the agents a delegate tool reaches', () => {
  const model = { provider: 'faux', modelId: 'faux' };
  const b = defineAgent({ id: 'b', model });
  const a = defineAgent({ id: 'a', model, delegates: [{ agent: b, name: 'ask_b', description: 'Ask b.' }] });
  assert.equal(a.delegates[0], b);
  assert.equal(a.delegates.length, 1);
  assert.deepEqual(defineAgent({ id: 'c', model }).delegates, []);
  assert.ok(Object.isFrozen(a.delegates));
  const evolving = defineAgent({ id: 'd', model, selfEvolving: true, delegates: [{ agent: b, name: 'ask_b', description: 'Ask b.' }] });
  assert.equal(evolving.inWorkspace('w').delegates[0], b);
});

const kit = (extensions) => ({
  person: 'camille', model: { provider: 'faux', modelId: 'faux' }, tools: (id) => defineExtension({ name: `host.tools.${id}` }),
  skills: () => ({ list: async () => [], version: async () => '1' }), ask: { name: 'ask', description: 'ask', parameters: { type: 'object', properties: {} }, execute: async () => ({}) },
  files: [{ name: 'read', description: 'read', parameters: { type: 'object', properties: {} }, execute: async () => ({}) }], ...extensions,
});

test('fixtures: each agent of both apps selects exactly its own host.tools extension, and ask and files stay tools', async () => {
  const { agents: notesAgents } = await import('../../fixtures/host-apps/notes/agents.ts');
  const { agents: todoAgents } = await import('../../fixtures/host-apps/todo/agents.ts');
  for (const [app, make] of [[notes, notesAgents], [todo, todoAgents]]) {
    const record = make(kit());
    for (const [id, agent] of Object.entries(record)) {
      const hostTools = agent.extensions.filter((e) => e.name.startsWith('host.tools.')).map((e) => e.name);
      assert.deepEqual(hostTools, [`host.tools.${id}`], `${app.name}/${id}`);
    }
    const own = record.assistant.extensions.flatMap((e) => (e.tools ?? []).map((t) => t.name));
    assert.ok(own.includes('ask'), `${app.name}: ask`);
  }
  assert.ok(notesAgents(kit()).assistant.extensions.flatMap((e) => (e.tools ?? []).map((t) => t.name)).includes('read'));
});

const ids = { 'camille.p1@example.test': 'camille', 'dominique.p1@example.test': 'dominique', 'edgar.p1@example.test': 'edgar' };
const World = Layer.mergeAll(
  Notebook.layer(Layer.mergeAll(NotebookHandlers, ReaderOnDeposit.toLayer(Effect.succeed(() => Effect.void)))).pipe(Layer.provide(Domain.InMemory)),
);
const as = (userId, scope) => NotebookApi.clientInProcess.pipe(Effect.provide(Layer.succeed(Session, (effect) => Effect.provideService(effect, notesUser, { userId, ...(scope ? { scope } : {}) }))));
const notesUser = (await import('@hachej/boring-agent/host')).CurrentUser;
const run = (effect) => Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(World)));
const outcome = (effect) => Effect.result(effect).pipe(Effect.map((r) => (r._tag === 'Success' ? r.success : { rejected: r.failure?._tag ?? String(r.failure) })));

test('fixtures: the notes notebook, run on Domain in memory, each operation as its person on that person\'s id', async () => {
  await run(Effect.gen(function* () {
    // The seed: each operation is applied as its person, on that person's own id.
    for (const op of notes.seed.operations) {
      const who = ids[op.as];
      const client = yield* as(who);
      const result = yield* outcome(client[op.op](who, op.input));
      assert.equal(result.rejected, undefined, `${op.op} as ${who}`);
    }
    const camille = yield* as('camille');
    const mine = yield* camille.Notes.get('camille');
    assert.deepEqual(mine.notes.map((n) => [n.text, n.by]), [['Appeler le garage lundi', 'camille']]);

    const dominique = yield* as('dominique');
    assert.equal((yield* outcome(dominique.AddNote('camille', { text: 'Salut' }))).rejected, 'NotYours');
    yield* camille.SetMember('camille', { userId: 'dominique', role: 'editor' });
    assert.equal((yield* outcome(dominique.AddNote('camille', { text: 'Salut' }))).rejected, undefined);

    const emma = yield* as('emma');
    yield* camille.SetMember('camille', { userId: 'emma', role: 'reader' });
    assert.ok((yield* outcome(emma.Notes.get('camille'))).notes);
    assert.equal((yield* outcome(emma.AddNote('camille', { text: 'Non' }))).rejected, 'NotAllowed');

    assert.equal((yield* outcome(camille.RemoveMember('camille', { userId: 'camille' }))).rejected, 'LastOwner');
    assert.equal((yield* outcome(camille.CreateNotebook('camille', { name: 'Deux' }))).rejected, 'NotYours');
    const scoped = yield* as('camille', { kind: 'reader', unit: 'zoe', role: 'owner' });
    assert.equal((yield* outcome(scoped.CreateNotebook('zoe', { name: 'Agent' }))).rejected, 'NotYours');

    yield* camille.Deposit('camille', { name: 'Facture', body: 'Courses de la semaine' });
    const reader = yield* as('camille', { kind: 'reader', unit: 'camille', role: 'editor', ops: ['RecordGist'] });
    assert.equal((yield* outcome(reader.RecordGist('camille', { number: 1, topic: 'shopping' }))).rejected, undefined);
    assert.equal((yield* outcome(reader.AddNote('camille', { text: 'Non' }))).rejected, 'NotYours');
    assert.equal((yield* outcome(reader.RecordGist('dominique', { number: 1, topic: 'work' }))).rejected, 'NotYours');

    assert.equal((yield* outcome(dominique.AddContact('camille', { name: 'Garage', address: 'garage@example.test' }))).rejected, 'NotYours');
    assert.equal((yield* outcome(camille.AddContact('camille', { name: 'Garage', address: 'garage@example.test' }))).rejected, undefined);
  }));
});
