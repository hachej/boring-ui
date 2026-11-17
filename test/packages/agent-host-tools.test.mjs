// host-session-tools: each agent's Domain operations as one pi-durable Extension, read per call on the session's scope, and a
// definition that does not resolve refused. Run on built output, on a Harness this test opens (the test is host code), Domain in
// memory and a scripted model.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import * as Domain from '@alchemy.run/domain';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Scope from 'effect/Scope';
import { Harness, MemoryStorage, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { CurrentUser, Session } from '@hachej/boring-agent/host';
import { SenderUnknown, appTools, checkAgentTools, checkExpose, toolableApi } from '@hachej/boring-agent/host-runtime';
import notes from '../../fixtures/host-apps/notes/app.ts';
import todo from '../../fixtures/host-apps/todo/app.ts';
import { agents as notesAgents } from '../../fixtures/host-apps/notes/agents.ts';
import { agents as todoAgents } from '../../fixtures/host-apps/todo/agents.ts';
import { Notebook, NotebookHandlers, ReaderOnDeposit } from '../../fixtures/host-apps/notes/models/Notebook.model.ts';
import { NotebookApi } from '../../fixtures/host-apps/notes/models/NotebookApi.api.ts';

const World = Notebook.layer(Layer.mergeAll(NotebookHandlers, ReaderOnDeposit.toLayer(Effect.succeed(() => Effect.void)))).pipe(Layer.provide(Domain.InMemory));
const worldScope = await Effect.runPromise(Scope.make());
const world = await Effect.runPromise(Layer.buildWithScope(World, worldScope));
after(() => Effect.runPromise(Scope.close(worldScope, Effect.void)));

const api = toolableApi(notes);
const as = (userId) => NotebookApi.clientInProcess.pipe(Effect.provide(Layer.succeed(Session, (effect) => Effect.provideService(effect, CurrentUser, { userId }))));
const doAs = (userId, fn) => Effect.runPromise(Effect.scoped(Effect.gen(function* () { return yield* fn(yield* as(userId)); })).pipe(Effect.provide(world)));
const read = (userId, key) => doAs(userId, (client) => client.Notes.get(key));

// The fictional notebooks: Camille's (Dominique editor, Emma reader) and Dominique's own, holding a secret.
await doAs('camille', (c) => c.CreateNotebook('camille', { name: 'Carnet de Camille' }));
await doAs('camille', (c) => c.SetMember('camille', { userId: 'dominique', role: 'editor' }));
await doAs('camille', (c) => c.SetMember('camille', { userId: 'emma', role: 'reader' }));
await doAs('dominique', (c) => c.CreateNotebook('dominique', { name: 'Carnet de Dominique' }));
await doAs('dominique', (c) => c.AddNote('dominique', { text: 'SECRET-DE-DOMINIQUE' }));

const acting = (requestedBy) => async () => ({ requestedBy });
const model = { provider: 'fictional-faux', modelId: 'm' };

/** The def's agents as a host builds them: each agent's tools are `appTools` for that agent. */
function build(def, make, { scope, attribution = acting('dominique'), count = { services: 0 }, commandId } = {}) {
  const services = () => { count.services++; return world; };
  return make({
    person: 'camille', model, skills: () => ({ list: async () => [], version: async () => '1' }),
    ask: { name: 'ask', description: 'ask', parameters: { type: 'object', properties: {} }, execute: async () => ({}) }, files: [],
    tools: (agent) => appTools({ def, api: toolableApi(def), agent, scope, services, attribution, ...(commandId ? { commandId } : {}) }),
  });
}

const textOf = (message) => message.content.filter((part) => part.type === 'text').map((part) => part.text).join('');

/** One Harness on a scripted model, every agent installed and the default extension list empty; a conversation of `agent` makes `calls` in one round. */
async function drive(agents, agent, calls) {
  const faux = fauxProvider({ provider: model.provider, models: [{ id: model.modelId }] });
  faux.setResponses([
    () => fauxAssistantMessage(calls.map(([name, args], i) => fauxToolCall(name, args, { id: `call-${i}` })), { stopReason: 'toolUse' }),
    () => fauxAssistantMessage([fauxText('Fait.')]),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  for (const defined of Object.values(agents)) defined.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models, settings: { extensions: [] } }, context);
  try {
    const conversation = await agents[agent].createConversation(harness, context);
    const offered = (await conversation.agent(context)).tools.map((tool) => tool.name);
    await (await conversation.submit({ type: 'input', requestId: 'ask', content: 'Vas-y.' }, context)).wait(context);
    const results = (await conversation.context(context)).messages.filter((message) => message.role === 'toolResult');
    return { offered, results: results.map((message) => ({ text: textOf(message), isError: message.isError === true })) };
  } finally { await harness.close(context); }
}

const send = (name, target, input) => [`NotebookApi_${name}_send`, { target, input }];
const get = (view, key) => [`NotebookApi_${view}_get`, { key }];

test('tools: a read declares replay safe, a command declares none, and the caller is the attribution, never the arguments', async () => {
  const agents = build(notes, notesAgents);
  const assistant = agents.assistant.extensions.find((e) => e.name === 'host.tools.assistant');
  const byName = Object.fromEntries(assistant.tools.map((tool) => [tool.name, tool]));
  assert.deepEqual(Object.keys(byName).sort(), [
    'NotebookApi_AddContact_send', 'NotebookApi_AddNote_send', 'NotebookApi_Contacts_get', 'NotebookApi_Documents_get', 'NotebookApi_Notes_get', 'NotebookApi_RecordGist_send',
  ]);
  for (const [name, tool] of Object.entries(byName)) {
    if (name.endsWith('_get')) assert.equal(tool.replay, 'safe', name);
    else assert.equal(tool.replay, undefined, name);
  }

  // Dominique (editor) writes into Camille's notebook; the arguments try to name Gaspard as the author.
  const named = { by: 'gaspard', userId: 'gaspard', author: 'gaspard' };
  const written = await drive(agents, 'assistant', [['NotebookApi_AddNote_send', { target: 'camille', input: { text: 'Note de Dominique', ...named }, ...named }]]);
  const view = await read('camille', 'camille');
  const note = view.notes.find((n) => n.text === 'Note de Dominique');
  assert.ok(note || written.results[0].isError, `neither recorded nor refused: ${written.results[0].text}`);
  assert.ok(view.notes.every((n) => n.by !== 'gaspard'));
  if (note) assert.equal(note.by, 'dominique');

  const readBack = await drive(agents, 'assistant', [get('Notes', 'camille')]);
  assert.equal(readBack.results[0].isError, false, readBack.results[0].text);
});

test('scope (hors du carnet): a session scoped to one notebook never reaches another, in seven spellings, for the assistant and the researcher', async () => {
  const scope = { kind: 'unit', unit: 'camille', role: 'owner' };
  const agents = build(notes, notesAgents, { scope });
  const names = ['dominique', 'Camille', 'camille-', 'camille/../dominique', 'camille\u0000', 'camille,dominique', 'camill'];
  const before = await read('dominique', 'dominique');

  const own = await drive(agents, 'assistant', [get('Notes', 'camille')]);
  assert.equal(own.results[0].isError, false, `the scope reaches its own unit: ${own.results[0].text}`);

  const reads = names.map((key) => get('Notes', key));
  const writes = names.map((key) => send('AddNote', key, { text: 'Intrus' }));
  for (const [agent, calls] of [['assistant', [...reads, ...writes]], ['researcher', reads]]) {
    const { results } = await drive(agents, agent, calls);
    assert.equal(results.length, calls.length);
    for (const [i, result] of results.entries()) {
      const label = `${agent} ${JSON.stringify(calls[i][1])}`;
      assert.equal(result.isError, true, label);
      assert.match(result.text, /NotYours/, label);
      assert.ok(!result.text.includes('SECRET-DE-DOMINIQUE'), label);
    }
  }
  assert.deepEqual(await read('dominique', 'dominique'), before, 'a write into B left B unchanged');
});

test('sender unknown (expéditeur inconnu): the tool refuses before any operation and writes nothing', async () => {
  const count = { services: 0 };
  const agents = build(notes, notesAgents, { attribution: async (call) => { throw new SenderUnknown(call.callId); }, count });
  const before = await read('camille', 'camille');
  const { results } = await drive(agents, 'assistant', [
    get('Notes', 'camille'),
    ['NotebookApi_AddNote_send', { target: 'camille', input: { text: 'Fantôme', userId: 'camille' }, userId: 'camille' }],
  ]);
  assert.deepEqual(results.map((r) => r.text), Array(2).fill('refused: sender-unknown. Stop and tell the person.'));
  assert.ok(results.every((r) => r.isError));
  assert.equal(count.services, 0, 'no operation ran');
  assert.deepEqual(await read('camille', 'camille'), before);
});

const withExpose = (def, expose) => ({ ...def, expose: { ...def.expose, ...expose } });
const refuses = (fn, ...parts) => assert.throws(fn, (error) => parts.every((part) => error.message.includes(part)), parts.join(' / '));

test('exposure (définition refusée): a name that gives no tool, or a tool name Domain refuses, stops the definition naming the app, the audience and the operation', () => {
  checkExpose(notes);
  checkExpose(todo);
  refuses(() => checkExpose(withExpose(notes, { assistant: [...notes.expose.assistant, 'DeleteEverything'] })), 'notes', 'assistant', 'DeleteEverything');
  refuses(() => checkExpose(withExpose(notes, { page: [...notes.expose.page, 'Nope.get'] })), 'notes', 'page', 'Nope.get');
  refuses(() => checkExpose(withExpose(notes, { mcp: [...notes.expose.mcp, 'Notes.watch'] })), 'notes', 'mcp', 'Notes.watch');
  refuses(() => appTools({ def: withExpose(notes, { assistant: ['DeleteEverything'] }), api, agent: 'assistant', scope: undefined, services: () => world, attribution: acting('camille') }), 'notes', 'assistant', 'DeleteEverything');

  // A real operation (AddNote) on an Api whose long name puts the tool name past 64 characters: Domain keeps no tool, and the reason says length.
  class LongApi extends Domain.Api('L'.repeat(60), { model: Notebook, commands: ['AddNote'], views: [], streams: [], queries: [] }, { description: 'Scratch.' }) {}
  refuses(() => checkExpose({ name: 'scratch', api: LongApi, expose: { page: ['AddNote'] } }), 'scratch', 'page', 'AddNote', 'passes 64 characters');
  assert.throws(() => checkExpose(withExpose(notes, { page: [...notes.expose.page, 'Nope.get'] })), (error) => !/passes 64/.test(error.message));
});

const check = (def, agents) => () => checkAgentTools(def, agents);

test('one extension per agent (un agent, une extension): each agent has its own host.tools extension, a delegate holds a subset of its caller, and a conversation selects only its agent', async () => {
  for (const [def, make] of [[notes, notesAgents], [todo, todoAgents]]) {
    const agents = build(def, make);
    checkAgentTools(def, agents);
    for (const [id, agent] of Object.entries(agents)) {
      const own = agent.extensions.filter((e) => e.name.startsWith('host.tools.'));
      assert.deepEqual(own.map((e) => e.name), [`host.tools.${id}`], `${def.name}/${id}`);
      assert.equal(own[0].tools.length, (def.expose[id] ?? []).length, `${def.name}/${id}: one tool per exposed operation`);
    }
  }

  const agents = build(notes, notesAgents);
  const plain = { model: { provider: 'faux', modelId: 'faux' }, struggle: false };
  const tools = (def, agent) => appTools({ def, api, agent, scope: undefined, services: () => world, attribution: acting('camille') });
  const reader = (...extensions) => ({ ...agents, reader: defineAgent({ id: 'reader', ...plain, extensions }) });
  refuses(check(notes, reader(tools(notes, 'assistant'))), 'notes', 'reader', 'host.tools.assistant');
  refuses(check(notes, reader(tools(notes, 'reader'), defineExtension({ name: 'host.tools.assistant' }))), 'reader', 'host.tools.assistant');

  const widened = withExpose(notes, { researcher: [...notes.expose.researcher, 'Deposit'] });
  refuses(check(widened, build(widened, notesAgents)), 'notes', 'researcher', 'Deposit');

  const scribed = withExpose(notes, { scribe: ['AddNote'] });
  const scribe = defineAgent({ id: 'scribe', ...plain, extensions: [tools(scribed, 'scribe')] });
  const researcher = defineAgent({ id: 'researcher', ...plain, extensions: [tools(scribed, 'researcher')], delegates: [{ agent: scribe, name: 'delegate_scribe', description: 'Writes.' }] });
  refuses(check(scribed, { ...agents, researcher, scribe }), 'notes', 'scribe', 'AddNote');

  // Smuggling: the assistant's write repackaged in an app extension a delegate holds is refused, whatever the extension is called.
  const addNote = tools(notes, 'assistant').tools.find((tool) => tool.name === 'NotebookApi_AddNote_send');
  const smuggler = defineAgent({ id: 'researcher', ...plain, extensions: [tools(notes, 'researcher'), defineExtension({ name: 'app.extra', tools: [addNote] })] });
  const lead = defineAgent({ id: 'assistant', ...plain, extensions: [tools(notes, 'assistant')], delegates: [{ agent: smuggler, name: 'delegate_researcher', description: 'Reads.' }] });
  const own = defineAgent({ id: 'assistant', ...plain, extensions: [tools(notes, 'assistant')], delegates: [{ agent: build(notes, notesAgents).researcher, name: 'delegate_researcher', description: 'Reads.' }] });
  checkAgentTools(notes, { ...agents, assistant: own });
  refuses(check(notes, { ...agents, assistant: lead, researcher: smuggler }), 'notes', 'researcher', 'NotebookApi_AddNote_send');

  // A reader conversation is offered only its own extension's tools, whatever else is installed.
  const { offered, results } = await drive(agents, 'reader', [send('AddNote', 'camille', { text: 'Non' })]);
  assert.ok(offered.includes('NotebookApi_RecordGist_send'));
  assert.ok(!offered.includes('NotebookApi_AddNote_send'));
  assert.equal(results[0].isError, true);
  assert.ok(!(await read('camille', 'camille')).notes.some((n) => n.text === 'Non'));

  const source = readFileSync(new URL('../../packages/agent/src/host/runtime/tools.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createRegistry|new Map\b|new WeakMap\b/, 'no registry or lookup by name of ours');
});

test('tools: the command id the host supplies reaches the command', async () => {
  const seen = [];
  const agents = build(notes, notesAgents, { attribution: acting('camille'), commandId: async (call) => { seen.push(call.callId); return `cmd-${call.callId}`; } });
  const first = await drive(agents, 'assistant', [send('AddNote', 'camille', { text: 'Une fois' })]);
  assert.equal(first.results[0].isError, false, first.results[0].text);
  assert.equal(seen.length, 1);
});

test('tools: a command id the model chooses never reaches Domain, and the model is not offered one', async () => {
  await doAs('dominique', (c) => c.AddNote('dominique', { text: 'Avant' }, { commandId: 'cmd-B-1' }));
  await doAs('camille', (c) => c.AddNote('camille', { text: 'Premier' }, { commandId: 'cmd-A-1' }));
  const mine = build(notes, notesAgents, { scope: { kind: 'unit', unit: 'camille', role: 'owner' } });
  for (const tool of mine.assistant.extensions.flatMap((e) => e.tools ?? []).filter((t) => t.name.endsWith('_send'))) {
    assert.ok(!('commandId' in tool.parameters.properties), `${tool.name}: no commandId offered`);
  }
  const before = await read('dominique', 'dominique');
  const across = await drive(mine, 'assistant', [['NotebookApi_AddNote_send', { target: 'dominique', input: { text: 'Rejeu' }, commandId: 'cmd-B-1' }]]);
  assert.equal(across.results[0].isError, true, across.results[0].text);
  assert.match(across.results[0].text, /NotYours/);
  assert.deepEqual(await read('dominique', 'dominique'), before);

  const same = await drive(mine, 'assistant', [['NotebookApi_AddNote_send', { target: 'camille', input: { text: 'Second' }, commandId: 'cmd-A-1' }]]);
  assert.equal(same.results[0].isError, false, same.results[0].text);
  assert.ok((await read('camille', 'camille')).notes.some((n) => n.text === 'Second'), 'the reused id did not turn the write into a no-op');
});
