// host-ops-plain: an app's plain operation is an agent's tool, through one pi-durable Extension per agent. Run on built output, on a
// Harness this test opens (the test is host code), each unit's storage on node:sqlite in memory, and a scripted model.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import * as Effect from 'effect/Effect';
import { arr, obj, str, union } from '@earendil-works/pi-schema';
import { Harness, MemoryStorage, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { defineAgent } from '@hachej/boring-agent/agents';
import { APPROVE, DENIED_PREFIX, DENY, isApprovalGated } from '@hachej/boring-agent/approval';
import { answerUserQuestion } from '@hachej/boring-agent/ask-user';
import { CurrentUser, admit, defineApp, defineOp, isRefusal, must, refuse } from '@hachej/boring-agent/host';
import { SenderUnknown, appTools, checkAgentTools, checkExpose, createSession, runOp } from '@hachej/boring-agent/host-runtime';
import notesPlain from '../../fixtures/host-apps/notes-plain/app.ts';
import { agents as plainAgents } from '../../fixtures/host-apps/notes-plain/agents.ts';
import { addNote, createNotebook, listNotes, recordGist, setMember } from '../../fixtures/host-apps/notes-plain/ops.ts';
import notes from '../../fixtures/host-apps/notes/app.ts';
import { agents as notesAgents } from '../../fixtures/host-apps/notes/agents.ts';
import { Notebook, NotebookHandlers, ReaderOnDeposit } from '../../fixtures/host-apps/notes/models/Notebook.model.ts';
import { toolableApi } from '@hachej/boring-agent/host-runtime';
import * as Domain from '@alchemy.run/domain';
import * as Layer from 'effect/Layer';
import * as Scope from 'effect/Scope';

const model = { provider: 'fictional-faux', modelId: 'm' };
const acting = (requestedBy) => async () => ({ requestedBy });
const textOf = (message) => message.content.filter((part) => part.type === 'text').map((part) => part.text).join('');
const root = new URL('../../', import.meta.url);

/** One unit's storage on node:sqlite in memory, built per unit from the definition's schema; `opened` lists every `storage(unit)` call. */
function world(def) {
  const dbs = new Map();
  const opened = [];
  const storage = (unit) => {
    opened.push(unit);
    if (!dbs.has(unit)) { const created = new DatabaseSync(':memory:'); for (const sql of def.ops.schema ?? []) created.exec(sql); dbs.set(unit, created); }
    const db = dbs.get(unit);
    return { all: async (sql, ...params) => db.prepare(sql).all(...params).map((row) => ({ ...row })), run: async (sql, ...params) => { db.prepare(sql).run(...params); } };
  };
  const rows = (unit, table) => [...dbs.get(unit).prepare(`select * from ${table}`).all()].map((row) => ({ ...row }));
  return { storage, opened, rows, host: { storage } };
}
const as = (w, def, person, unit) => (op, input) => runOp(def, op, input, { person, ...(unit ? { unit } : {}), now: Date.now() }, w.host);

/** Camille's notebook A (Dominique editor, Emma reader) and Dominique's own B holding a secret. */
async function seeded(def = notesPlain) {
  const w = world(def);
  const camille = as(w, def, 'camille');
  const dominique = as(w, def, 'dominique');
  assert.deepEqual((await camille(createNotebook, { name: 'Carnet de Camille' })).value, { name: 'Carnet de Camille' });
  await camille(setMember, { userId: 'dominique', role: 'editor' });
  await camille(setMember, { userId: 'emma', role: 'reader' });
  await dominique(createNotebook, { name: 'Carnet de Dominique' });
  await dominique(addNote, { text: 'SECRET-DE-DOMINIQUE' });
  w.opened.length = 0;
  return w;
}

/** The def's agents as a host builds them: each agent's tools are `appTools` for that agent. */
function build(def, w, { make = plainAgents, scope, attribution = acting('dominique'), commandId } = {}) {
  return make({
    person: 'camille', model, skills: () => ({ list: async () => [], version: async () => '1' }),
    ask: { name: 'ask', description: 'ask', parameters: { type: 'object', properties: {} }, execute: async () => ({}) }, files: [],
    tools: (agent) => appTools({ def, agent, scope, attribution, storage: w.storage, ...(commandId ? { commandId } : {}) }),
  });
}

/** One Harness on a scripted model, every agent installed, the default extension list empty; a conversation of `agent` makes `calls` in one round. */
async function drive(agents, agent, calls, { before } = {}) {
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
    const submission = await conversation.submit({ type: 'input', requestId: 'ask', content: 'Vas-y.' }, context);
    if (before) await before(conversation);
    const settled = await submission.wait(context);
    const messages = (await conversation.context(context)).messages;
    const results = messages.filter((message) => message.role === 'toolResult').map((message) => ({ text: textOf(message), isError: message.isError === true }));
    const final = textOf([...messages].reverse().find((message) => message.role === 'assistant') ?? { content: [] });
    return { offered, results, final, settled };
  } finally { await harness.close(context); }
}

const send = (name, input = {}) => [name, input];
const refuses = (fn, ...parts) => assert.throws(fn, (error) => parts.every((part) => error.message.includes(part)), parts.join(' / '));

test('mapping: each agent has one Extension of its plain operations, each tool the operation itself', async () => {
  const w = await seeded();
  const agents = build(notesPlain, w);
  for (const [id, agent] of Object.entries(agents)) {
    const own = agent.extensions.filter((extension) => extension.name.startsWith('host.tools.'));
    assert.deepEqual(own.map((extension) => extension.name), [`host.tools.${id}`]);
    const expected = notesPlain.expose[id].map((name) => notesPlain.ops.list.find((op) => op.name === name));
    assert.deepEqual(own[0].tools.map((tool) => tool.name), expected.map((op) => op.name), `${id}: the operations of expose, in order`);
    for (const [i, op] of expected.entries()) {
      const tool = own[0].tools[i];
      assert.equal(tool.parameters, op.input, `${op.name}: parameters is the input itself`);
      assert.equal(tool.structuredOutputSchema, op.output, `${op.name}: structuredOutputSchema is the output itself`);
      assert.equal(tool.description, op.description);
      assert.equal(tool.replay, op.kind === 'read' || op.risky ? 'safe' : undefined, op.name);
      assert.equal(isApprovalGated(tool), op.risky === true, op.name);
      if (op.risky) assert.deepEqual(tool.callers, ['model']);
      assert.deepEqual(Object.keys(tool.parameters.properties).sort(), Object.keys(op.input.properties).sort(), `${op.name}: nothing the input does not declare`);
    }
  }
  // A call of the tool itself answers the JSON text and the structured value.
  const tool = agents.assistant.extensions.find((e) => e.name === 'host.tools.assistant').tools.find((t) => t.name === 'addNote');
  const api = { callId: 'c1', now: () => Date.parse('2026-11-17T08:00:00Z') };
  const answered = await tool.execute({ text: 'Une note' }, api, { abortSignal: undefined });
  assert.deepEqual(answered.structuredOutput, { number: 2 }, 'the unit already holds one note');
  assert.deepEqual(answered.output, [{ type: 'text', text: '{"number":2}' }]);
  assert.notEqual(answered.isError, true);
  const source = readFileSync(new URL('packages/agent/src/host/runtime/ops.ts', root), 'utf8');
  assert.ok(source.split('\n').length - 1 <= 80, 'ops.ts is at most 80 lines');
  console.log(`la traduction: ops.ts is ${source.split('\n').length - 1} lines (at most 80); each tool takes the operation's own schema as parameters, unconverted`);
});

const FIELDS = ['target', 'key', 'unit', 'notebook', 'userId', 'by', 'author', 'scope'];
const SPELLINGS = ['dominique', 'Camille', 'camille-', 'camille/../dominique', 'camille\u0000', 'camille,dominique', 'camill'];

test('no field (hors du carnet): a field the model adds to name the person or the unit is refused, in seven spellings', async () => {
  const w = await seeded();
  let runs = 0;
  const counted = { ...notesPlain, ops: { ...notesPlain.ops, list: notesPlain.ops.list.map((op) => ({ ...op, run: (...args) => { runs++; return op.run(...args); } })) } };
  const agents = build(counted, w, { scope: { kind: 'unit', unit: 'camille', role: 'owner' }, attribution: acting('camille') });
  const before = w.rows('dominique', 'notes');
  const calls = [];
  for (const field of FIELDS) for (const spelling of SPELLINGS) {
    calls.push(send('addNote', { text: 'Intrus', [field]: spelling }), send('listNotes', { [field]: spelling }));
  }
  const { results } = await drive(agents, 'assistant', calls);
  assert.equal(results.length, calls.length);
  for (const [i, result] of results.entries()) {
    const [name, args] = calls[i];
    const field = Object.keys(args).find((key) => FIELDS.includes(key));
    assert.equal(result.isError, true, JSON.stringify(calls[i]));
    assert.ok(result.text.includes(`Validation failed for tool "${name}"`) && result.text.includes(`${field}: unknown field`), result.text);
    assert.ok(!result.text.includes('SECRET-DE-DOMINIQUE'));
  }
  assert.equal(runs, 0, 'no handler ran');
  assert.deepEqual(w.rows('dominique', 'notes'), before, 'B is unchanged');
  assert.ok(!JSON.stringify(w.rows('camille', 'notes')).includes('SECRET-DE-DOMINIQUE'));
});

const probe = (name, kind, record, extra = {}) => defineOp({
  name, description: `Probe ${name}.`, input: obj({}), output: obj({ ok: str() }), role: 'reader', kind,
  run: async (_input, ctx) => { record.push(ctx); return { ok: 'ok' }; }, ...extra,
});
const plant = (def, list, expose = {}) => ({ ...def, ops: { ...def.ops, list: [...def.ops.list, ...list] }, expose: { ...def.expose, ...expose } });
const REFUSED = 'refused: sender-unknown. Stop and tell the person.';

test('ctx: who and the unit come from the session scope and the call sender, never from the input', async () => {
  const w = await seeded();
  const scoped = build(notesPlain, w, { scope: { kind: 'unit', unit: 'camille', role: 'editor' }, attribution: acting('dominique') });
  const written = await drive(scoped, 'assistant', [send('addNote', { text: 'Note de Dominique' })]);
  assert.equal(written.results[0].isError, false, written.results[0].text);
  const listed = await as(w, notesPlain, 'camille')(listNotes, {});
  assert.ok(listed.value.notes.some((n) => n.text === 'Note de Dominique' && n.by === 'dominique'), 'recorded by the sender, in the scope\'s unit');
  assert.ok(!w.rows('dominique', 'notes').some((n) => n.text === 'Note de Dominique'));

  const personal = build(notesPlain, w, { attribution: acting('camille') });
  await drive(personal, 'assistant', [send('addNote', { text: 'Note perso' })]);
  assert.ok(w.rows('camille', 'notes').some((n) => n.text === 'Note perso' && n.by === 'camille'), 'no scope: the unit is the sender');

  const seen = [];
  const entered = Promise.withResolvers();
  let aborted = false;
  const wait = defineOp({ name: 'wait', description: 'Waits for the stop.', input: obj({}), output: obj({ ok: str() }), role: 'reader', kind: 'read',
    run: async (_input, ctx) => { entered.resolve(); await new Promise((resolve) => ctx.signal.addEventListener('abort', resolve, { once: true })); aborted = ctx.signal.aborted; return { ok: 'ok' }; } });
  const probing = plant(notesPlain, [probe('now', 'read', seen), wait], { assistant: [...notesPlain.expose.assistant, 'now', 'wait'] });
  const before = Date.now();
  const agents = build(probing, w, { attribution: acting('camille') });
  await drive(agents, 'assistant', [send('now')]);
  assert.match(seen[0].now, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Date.parse(seen[0].now) >= before - 1000 && Date.parse(seen[0].now) <= Date.now() + 1000);
  await drive(agents, 'assistant', [send('wait')], { before: async (conversation) => { await entered.promise; await conversation.abort(context); } });
  assert.equal(aborted, true, 'the call\'s own signal ended the operation');
});

test('ctx (expéditeur inconnu): an unknown sender is refused with nothing run, on a read and on a write', async () => {
  const w = await seeded();
  let runs = 0;
  const counted = { ...notesPlain, ops: { ...notesPlain.ops, list: notesPlain.ops.list.map((op) => ({ ...op, run: (...args) => { runs++; return op.run(...args); } })) } };
  const agents = build(counted, w, { attribution: async (call) => { throw new SenderUnknown(call.callId); } });
  const before = w.rows('camille', 'notes');
  const { results } = await drive(agents, 'assistant', [send('listNotes'), send('addNote', { text: 'Fantôme' })]);
  assert.deepEqual(results.map((r) => r.text), [REFUSED, REFUSED]);
  assert.ok(results.every((r) => r.isError));
  assert.equal(runs, 0, 'the handler ran 0 times');
  assert.deepEqual(w.opened, [], 'storage(unit) was called 0 times');
  assert.deepEqual(w.rows('camille', 'notes'), before);
});

test('no field (setMember, planted read, admit): the operation is checked on ctx, never on a field', async () => {
  const w = await seeded();
  const via = (scope, person) => build(notesPlain, w, { scope, attribution: acting(person) });
  const set = send('setMember', { userId: 'dominique', role: 'owner' });
  const denied = await drive(via({ kind: 'unit', unit: 'camille', role: 'editor' }, 'dominique'), 'assistant', [set]);
  assert.deepEqual(denied.results, [{ text: '{"_tag":"NotAllowed","need":"owner"}', isError: true }]);
  const set2 = await drive(via({ kind: 'unit', unit: 'camille', role: 'owner' }, 'camille'), 'assistant', [set]);
  assert.equal(set2.results[0].isError, false, set2.results[0].text);
  assert.equal(w.rows('camille', 'members').find((m) => m.user_id === 'dominique').role, 'owner');

  const lists = defineOp({ name: 'lists', description: 'Lists the notes of the unit.', input: obj({ notebook: str() }), output: obj({ texts: { type: 'array', items: { type: 'string' } } }), role: 'reader', kind: 'read',
    run: async (_input, ctx) => ({ texts: (await ctx.storage.all('select text from notes')).map((r) => r.text) }) });
  const planted = plant(notesPlain, [lists], { assistant: ['lists'] });
  const own = await drive(build(planted, w, { scope: { kind: 'unit', unit: 'camille', role: 'owner' }, attribution: acting('camille') }), 'assistant', [send('lists', { notebook: 'dominique' })]);
  assert.ok(!own.results[0].text.includes('SECRET-DE-DOMINIQUE'), own.results[0].text);
});

test('no field (admit): the twelve rows of must, and four rows for an empty unit', async () => {
  const members = [{ userId: 'camille', role: 'owner' }, { userId: 'dominique', role: 'editor' }, { userId: 'edgar', role: 'reader' }];
  const scoped = (person, unit, role, ops) => ({ person, scope: { kind: 'unit', unit, role, ...(ops ? { ops } : {}) } });
  const rows = [
    [{ person: 'camille' }, 'editor', 'u1', 'AddNote', 'ok'], [{ person: 'dominique' }, 'editor', 'u1', 'AddNote', 'ok'], [{ person: 'edgar' }, 'editor', 'u1', 'AddNote', 'NotAllowed'],
    [{ person: 'gaspard' }, 'editor', 'u1', 'AddNote', 'NotYours'], [{ person: 'camille' }, 'editor', 'u2', 'AddNote', 'NotYours'], [{ person: 'dominique' }, 'editor', 'u1', 'AddContact', 'ok'],
    [scoped('camille', 'u1', 'owner', ['AddNote']), 'editor', 'u1', 'AddNote', 'ok'], [scoped('camille', 'u1', 'editor'), 'editor', 'u1', 'AddNote', 'ok'], [scoped('camille', 'u1', 'reader'), 'editor', 'u1', 'AddNote', 'NotAllowed'],
    [scoped('camille', 'u2', 'owner'), 'editor', 'u1', 'AddNote', 'NotYours'], [scoped('camille', 'u1', 'owner', ['Notes.get']), 'editor', 'u1', 'AddNote', 'NotYours'], [scoped('gaspard', 'u1', 'editor'), 'editor', 'u1', 'AddNote', 'ok'],
  ];
  const tag = (r) => (isRefusal(r) ? r.kind : 'ok');
  const mustTag = (caller, need, unit, op, list) => Effect.runPromise(Effect.result(must(need, unit, list, op).pipe(Effect.provideService(CurrentUser, { userId: caller.person, ...(caller.scope ? { scope: caller.scope } : {}) })))).then((r) => (r._tag === 'Success' ? 'ok' : r.failure._tag));
  for (const [caller, need, unit, op, want] of rows) {
    const list = unit === 'u2' && !caller.scope ? [{ userId: 'dominique', role: 'editor' }] : members;
    assert.equal(tag(admit(need, unit, list, op, caller)), want, JSON.stringify([caller, unit, op]));
    assert.equal(await mustTag(caller, need, unit, op, list), want, 'must agrees');
  }
  const empty = (caller, unit) => admit('owner', unit, [], 'createNotebook', caller);
  assert.deepEqual(empty({ person: 'camille' }, 'camille'), { person: 'camille', role: 'owner' }, 'no scope, an empty unit keyed by the caller');
  assert.equal(empty({ person: 'camille' }, 'dominique').kind, 'NotYours', 'no scope, an empty unit keyed by another id');
  assert.equal(empty(scoped('camille', 'camille', 'owner'), 'dominique').kind, 'NotYours', 'scoped to camille, called on empty dominique');
  assert.deepEqual(empty(scoped('camille', 'dominique', 'owner'), 'dominique'), { person: 'camille', role: 'owner' }, 'scoped to empty dominique, as must gives');
});

test('no field (scope): a session with a scope never falls back to the caller\'s own empty unit', async () => {
  const w = world(notesPlain);
  const reader = build(notesPlain, w, { scope: { kind: 'unit', unit: 'camille', role: 'reader' }, attribution: acting('camille') });
  const { results } = await drive(reader, 'assistant', [send('addNote', { text: 'Je suis propriétaire ?' })]);
  assert.deepEqual(results, [{ text: '{"_tag":"NotAllowed","need":"editor"}', isError: true }], 'the scope\'s role, not owner of one\'s own empty unit');
  const narrow = build(notesPlain, w, { scope: { kind: 'unit', unit: 'camille', role: 'owner', ops: ['listNotes'] }, attribution: acting('camille') });
  const outside = await drive(narrow, 'assistant', [send('addNote', { text: 'Hors du périmètre' })]);
  assert.deepEqual(outside.results, [{ text: '{"_tag":"NotYours"}', isError: true }], 'an operation outside the scope is not rescued by owning one\'s own empty unit');
  const other = build(notesPlain, w, { scope: { kind: 'unit', unit: 'dominique', role: 'owner' }, attribution: acting('camille') });
  const second = await drive(other, 'assistant', [send('listNotes')]);
  assert.equal(second.results[0].isError, false, 'the scope\'s unit is the unit');
  assert.deepEqual(w.rows('camille', 'notes'), [], 'nothing reached the caller\'s own unit');
});

test('command id (identifiant de commande): the host\'s id reaches a write, never the model\'s', async () => {
  const seen = [];
  const writer = probe('probeWrite', 'write', seen, { role: 'editor' });
  const reader = probe('probeRead', 'read', seen);
  const planted = plant(notesPlain, [writer, reader], { assistant: ['addNote', 'probeWrite', 'probeRead'] });
  const w = await seeded(planted);
  const withId = build(planted, w, { attribution: acting('camille'), commandId: async (call) => `cmd-${call.callId}` });
  await drive(withId, 'assistant', [send('probeWrite'), send('probeRead')]);
  assert.deepEqual(seen.map((ctx) => ctx.commandId), ['cmd-call-0', undefined], 'a write gets the host\'s id; a read none');
  seen.length = 0;
  await drive(build(planted, w, { attribution: acting('camille') }), 'assistant', [send('probeWrite')]);
  assert.equal(seen[0].commandId, undefined, 'no commandId function: none');
  for (const tool of withId.assistant.extensions.flatMap((e) => e.tools ?? [])) assert.ok(!('commandId' in tool.parameters.properties), tool.name);
  seen.length = 0;
  const before = w.rows('camille', 'notes').length;
  const { results } = await drive(withId, 'assistant', [send('addNote', { text: 'Rejeu', commandId: 'cmd-A-1' })]);
  assert.equal(results[0].isError, true);
  assert.ok(results[0].text.includes('Validation failed for tool "addNote"') && results[0].text.includes('commandId: unknown field'), results[0].text);
  assert.equal(w.rows('camille', 'notes').length, before);
});

const withExpose = (def, expose) => ({ ...def, expose: { ...def.expose, ...expose } });
const withOp = (op) => plant(notesPlain, [op]);

test('refused at mount (définition refusée): a definition that does not resolve stops before anything is served', () => {
  checkExpose(notesPlain);
  checkExpose(notes);
  const one = (name, mutate = {}) => ({ ...addNote, name, ...mutate });
  refuses(() => checkExpose(withExpose(notesPlain, { assistant: [...notesPlain.expose.assistant, 'nope'] })), 'notes-plain', 'assistant', 'nope', 'no api');
  refuses(() => checkExpose(withExpose(notes, { assistant: [...notes.expose.assistant, 'nope'] })), 'notes', 'assistant', 'nope');
  refuses(() => checkExpose(withOp(one('add.note'))), 'add.note');
  refuses(() => checkExpose(withOp(one('n'.repeat(65)))), 'nnnn');
  refuses(() => checkExpose(withOp(one('delegateNote'))), 'delegateNote', 'delegate');
  refuses(() => checkExpose(withOp(one('addNote'))), 'addNote');
  refuses(() => checkExpose({ ...notes, ops: { list: [one('AddNote')] } }), 'AddNote');
  refuses(() => checkExpose(withOp(one('riskyRead', { kind: 'read', risky: true }))), 'riskyRead', 'risky');
  refuses(() => checkExpose(withExpose(notesPlain, { mcp: ['removeMember'] })), 'removeMember', 'mcp');
  refuses(() => checkExpose(withOp(one('flat', { input: { type: 'string' } }))), 'flat');
  refuses(() => checkExpose(withOp(one('flatOut', { output: { type: 'string' } }))), 'flatOut');
  refuses(() => checkExpose(withOp(one('opened', { input: obj({ text: str() }, { open: true }) }))), 'opened', 'open');
  refuses(() => checkExpose(withOp(one('hand', { input: { type: 'object', properties: { text: { type: 'string' } } } }))), 'hand', 'open');
  refuses(() => checkExpose(withOp(one('withId', { input: obj({ commandId: str() }) }))), 'withId', 'commandId');
  refuses(() => appTools({ def: notesPlain, agent: 'assistant', scope: undefined, attribution: acting('camille') }), 'notes-plain', 'assistant', 'storage');
});

test('refused at mount (un agent, une extension): an agent holds only its own tools, a delegate a subset of its caller, and no two tools of one name', async () => {
  const w = await seeded();
  const agents = build(notesPlain, w);
  checkAgentTools(notesPlain, agents);
  const plain = { model: { provider: 'faux', modelId: 'faux' }, struggle: false };
  const tools = (def, agent) => appTools({ def, agent, scope: undefined, attribution: acting('camille'), storage: w.storage });
  const check = (def, record) => () => checkAgentTools(def, record);
  const reader = (...extensions) => ({ ...agents, reader: defineAgent({ id: 'reader', ...plain, extensions }) });
  refuses(check(notesPlain, reader(tools(notesPlain, 'assistant'))), 'notes-plain', 'reader', 'host.tools.assistant');

  const widened = withExpose(notesPlain, { researcher: [...notesPlain.expose.researcher, 'deposit'] });
  refuses(check(widened, build(widened, w)), 'researcher', 'deposit');

  const scribed = withExpose(notesPlain, { scribe: ['addNote'] });
  const scribe = defineAgent({ id: 'scribe', ...plain, extensions: [tools(scribed, 'scribe')] });
  const researcher = defineAgent({ id: 'researcher', ...plain, extensions: [tools(scribed, 'researcher')], delegates: [{ agent: scribe, name: 'delegate_scribe', description: 'Writes.' }] });
  refuses(check(scribed, { ...agents, researcher, scribe }), 'scribe', 'addNote');

  const askDef = plant(notesPlain, [defineOp({ name: 'ask', description: 'A plain operation named like the ask tool.', input: obj({}), output: obj({ ok: str() }), role: 'reader', kind: 'read', run: async () => ({ ok: 'ok' }) })], { assistant: ['ask'] });
  const askTool = defineExtension({ name: 'app.ask', tools: [{ name: 'ask', description: 'ask', parameters: { type: 'object', properties: {} }, execute: async () => ({ output: [] }) }] });
  const clash = defineAgent({ id: 'assistant', ...plain, extensions: [tools(askDef, 'assistant'), askTool] });
  refuses(check(askDef, { ...agents, assistant: clash }), 'assistant', 'two tools', 'ask');

  const faux = fauxProvider({ provider: model.provider, models: [{ id: model.modelId }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  for (const defined of Object.values(agents)) defined.install(registry);
  const harness = await Harness.open(new MemoryStorage(), { registry, models, settings: { extensions: [] } }, context);
  try {
    const none = await harness.createConversation({ ownership: { kind: 'ownerless' } }, context);
    assert.deepEqual((await none.agent(context)).tools, [], 'the default extension list is empty');
  } finally { await harness.close(context); }

  // Three levels: the top agent does not hold deposit, so the middle agent may not get it through `tools:`.
  const wide = withExpose(notesPlain, { middle: ['listNotes'], leaf: ['listNotes'], other: ['deposit'] });
  const deposit = tools(wide, 'other').tools[0];
  const chain = (extra) => {
    const leaf = defineAgent({ id: 'leaf', ...plain, extensions: [tools(wide, 'leaf')] });
    const middle = defineAgent({ id: 'middle', ...plain, extensions: [tools(wide, 'middle')], tools: extra, delegates: [{ agent: leaf, name: 'delegate_leaf', description: 'Reads.' }] });
    const top = defineAgent({ id: 'assistant', ...plain, extensions: [tools(wide, 'assistant')], delegates: [{ agent: middle, name: 'delegate_middle', description: 'Reads.' }] });
    return { ...agents, assistant: top, middle, leaf };
  };
  checkAgentTools(wide, chain([]));
  refuses(check(wide, chain([deposit])), 'middle', 'deposit');
});

test('both forms: Domain stays possible beside the plain form, and defineApp refuses a definition without an operation', async () => {
  const ping = defineOp({ name: 'ping', description: 'Answers ok.', input: obj({}), output: obj({ ok: str() }), role: 'reader', kind: 'read', run: async () => ({ ok: 'ok' }) });
  const both = { ...notes, ops: { list: [ping] }, expose: { ...notes.expose, assistant: ['AddNote', 'Notes.get', 'ping'] } };
  defineApp(both);
  checkExpose(both);
  const worldScope = await Effect.runPromise(Scope.make());
  const domain = await Effect.runPromise(Layer.buildWithScope(Notebook.layer(Layer.mergeAll(NotebookHandlers, ReaderOnDeposit.toLayer(Effect.succeed(() => Effect.void)))).pipe(Layer.provide(Domain.InMemory)), worldScope));
  try {
    const input = { api: toolableApi(both), agent: 'assistant', scope: undefined, services: () => domain, attribution: acting('camille'), storage: () => ({}) };
    const mixed = appTools({ def: both, ...input }).tools;
    const only = appTools({ def: { ...notes, expose: { ...notes.expose, assistant: ['AddNote', 'Notes.get'] } }, ...input }).tools;
    assert.deepEqual(mixed.map((tool) => tool.name), ['NotebookApi_AddNote_send', 'NotebookApi_Notes_get', 'ping']);
    for (const tool of only) assert.deepEqual([mixed.find((t) => t.name === tool.name).parameters, mixed.find((t) => t.name === tool.name).replay], [tool.parameters, tool.replay], tool.name);
  } finally { await Effect.runPromise(Scope.close(worldScope, Effect.void)); }
  assert.doesNotThrow(() => defineApp({ ...notesPlain }));
  const stripped = { ...notes, models: undefined, handlers: undefined, api: undefined };
  refuses(() => defineApp(stripped), 'notes', 'neither api nor ops');
  refuses(() => defineApp({ ...notes, handlers: undefined }), 'notes', 'handlers');
  refuses(() => defineApp({ ...notes, models: undefined, api: undefined }), 'notes', 'models', 'api');
});

test('first use: an empty notebook, a refusal and a broken output are each answered, and two writes in one round both land', async () => {
  const w = world(notesPlain);
  const camille = build(notesPlain, w, { attribution: acting('camille') });
  await as(w, notesPlain, 'camille')(createNotebook, { name: 'Carnet de Camille' });
  const first = await drive(camille, 'assistant', [send('listNotes')]);
  assert.deepEqual(first.results, [{ text: '{"name":"Carnet de Camille","members":[{"userId":"camille","role":"owner"}],"notes":[]}', isError: false }]);
  const blank = await drive(camille, 'assistant', [send('addNote', { text: '  ' })]);
  assert.deepEqual(blank.results, [{ text: '{"_tag":"EmptyNote","received":"  "}', isError: true }]);
  assert.equal(blank.final, 'Fait.', 'the turn goes on to the model\'s final text');

  const broken = defineOp({ name: 'broken', description: 'Returns a wrong value.', input: obj({}), output: obj({ number: { type: 'integer' } }), role: 'reader', kind: 'read', run: async () => ({ number: 'x' }) });
  const planted = plant(notesPlain, [broken], { assistant: ['broken', 'addNote'] });
  const bad = await drive(build(planted, w, { attribution: acting('camille') }), 'assistant', [send('broken')]);
  assert.equal(bad.results[0].isError, true);
  assert.ok(bad.results[0].text.includes('broken') && bad.results[0].text.includes('/number'), bad.results[0].text);
  const alone = await runOp(planted, broken, {}, { person: 'camille', now: Date.now() }, w.host);
  assert.ok(alone.broken?.startsWith('/number:'), JSON.stringify(alone));

  const two = await drive(build(planted, w, { attribution: acting('camille') }), 'assistant', [send('addNote', { text: 'Un' }), send('addNote', { text: 'Deux' })]);
  assert.deepEqual(two.results.map((r) => r.isError), [false, false]);
  const numbers = two.results.map((r) => JSON.parse(r.text).number).sort();
  assert.deepEqual(numbers, [numbers[0], numbers[0] + 1]);
});

test('risky: a write marked risky waits for the person; Deny writes nothing, Approve writes once', async () => {
  for (const [answer, removed] of [[DENY, false], [APPROVE, true]]) {
    const w = await seeded();
    const agents = build(notesPlain, w, { scope: { kind: 'unit', unit: 'camille', role: 'owner' }, attribution: acting('camille') });
    const faux = fauxProvider({ provider: model.provider, models: [{ id: model.modelId }] });
    faux.setResponses([
      () => fauxAssistantMessage([fauxToolCall('removeMember', { userId: 'emma' }, { id: 'rm-1' })], { stopReason: 'toolUse' }),
      () => fauxAssistantMessage([fauxText('Fait.')]),
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const registry = createRegistry();
    for (const defined of Object.values(agents)) defined.install(registry);
    const harness = await Harness.open(new MemoryStorage(), { registry, models, settings: { extensions: [] } }, context);
    try {
      const conversation = await agents.assistant.createConversation(harness, context);
      const submission = await conversation.submit({ type: 'input', requestId: 'ask', content: 'Retire Emma.' }, context);
      const deadline = Date.now() + 8000;
      while ((await answerUserQuestion(conversation, 'rm-1', answer)).kind !== 'answered') { assert.ok(Date.now() < deadline, 'the question was asked'); await new Promise((r) => setTimeout(r, 10)); }
      await submission.wait(context);
      const result = (await conversation.context(context)).messages.find((m) => m.role === 'toolResult');
      assert.equal(textOf(result).startsWith(DENIED_PREFIX), !removed, textOf(result));
      assert.equal(w.rows('camille', 'members').some((m) => m.user_id === 'emma'), !removed, answer);
    } finally { await harness.close(context); }
  }
  const tool = build(notesPlain, await seeded()).assistant.extensions.find((e) => e.name === 'host.tools.assistant').tools.find((t) => t.name === 'removeMember');
  assert.equal(isApprovalGated(tool), true, 'a tool already gated is not gated twice');
});

test('one rank rule: must and admit share one comparison of roles, and differ only in an empty unit', async () => {
  const source = readFileSync(new URL('packages/agent/src/host/identity.ts', root), 'utf8');
  assert.equal(source.split('\n').filter((line) => line.includes('RANK[')).length, 1, 'one comparison of roles');
  const mine = Effect.runPromise(Effect.result(must('owner', 'camille', [], 'createNotebook').pipe(Effect.provideService(CurrentUser, { userId: 'camille' }))));
  assert.equal((await mine).failure._tag, 'NotYours', 'must: one\'s own empty unit is not one\'s own, for Domain\'s Notes.get');
  assert.deepEqual(admit('owner', 'camille', [], 'createNotebook', { person: 'camille' }), { person: 'camille', role: 'owner' });
});

test('read cannot write: a read\'s storage answers one select and nothing else', async () => {
  const attempts = {
    run: (ctx) => ctx.storage.run("insert into notes (number, text, by, at) values (99, 'x', 'x', 'x')"),
    returning: (ctx) => ctx.storage.all("insert into notes (number, text, by, at) values (98, 'x', 'x', 'x') returning number"),
    hidden: (ctx) => ctx.storage.all('select 1 as n; delete from notes'),
    withInsert: (ctx) => ctx.storage.all("with t as (select 1 as n) insert into notes (number, text, by, at) select 97, 'x', 'x', 'x' from t returning number"),
  };
  for (const [name, attempt] of Object.entries(attempts)) {
    const make = (kind) => defineOp({ name: 'sneak', description: 'Tries to write.', input: obj({}), output: obj({ ok: str() }), role: 'reader', kind, run: async (_input, ctx) => { await attempt(ctx); return { ok: 'ok' }; } });
    const read = make('read');
    const w = await seeded(plant(notesPlain, [read]));
    const before = w.rows('camille', 'notes');
    const answered = await runOp(plant(notesPlain, [read]), read, {}, { person: 'camille', now: Date.now() }, w.host).catch((error) => ({ thrown: error.message }));
    assert.match(answered.thrown ?? '', /^read-only: sneak/, name);
    assert.deepEqual(w.rows('camille', 'notes'), before, `${name}: the unit's tables are unchanged`);
    const planted = plant(notesPlain, [read], { assistant: ['sneak'] });
    const driven = await drive(build(planted, w, { attribution: acting('camille') }), 'assistant', [send('sneak')]);
    assert.equal(driven.results[0].isError, true, name);
    assert.deepEqual(w.rows('camille', 'notes'), before, `${name}: through the agent too`);
    if (name === 'hidden') continue;
    const write = make('write');
    const w2 = await seeded(plant(notesPlain, [write]));
    await runOp(plant(notesPlain, [write]), write, {}, { person: 'camille', now: Date.now() }, w2.host);
    assert.notDeepEqual(w2.rows('camille', 'notes'), [], `${name}: the same handler declared a write writes`);
  }
  const reading = defineOp({ name: 'okRead', description: 'A select.', input: obj({}), output: obj({ ok: str() }), role: 'reader', kind: 'read', run: async (_input, ctx) => { await ctx.storage.all('select number from notes;'); return { ok: 'ok' }; } });
  const w3 = await seeded();
  assert.deepEqual((await runOp(plant(notesPlain, [reading]), reading, {}, { person: 'camille', now: Date.now() }, w3.host)).value, { ok: 'ok' });
});

test('mapping (declaration): defineOp returns the same object, and the built op.js imports nothing', () => {
  const op = { name: 'x', description: 'x', input: obj({}), output: obj({}), role: 'reader', kind: 'read', run: async () => ({}) };
  assert.equal(defineOp(op), op);
  assert.equal(isRefusal(refuse('K', { a: 1 })), true);
  assert.equal(isRefusal({ kind: 'K' }), false);
  const built = readFileSync(new URL('packages/agent/dist/host/op.js', root), 'utf8');
  assert.doesNotMatch(built, /^\s*import\s/m, 'a type-only import leaves no import behind');
});

test('session (unitStorage): a personal session hands its plain tools the unit storage, with no tools override', async () => {
  const w = world(notesPlain);
  const faux = fauxProvider({ provider: model.provider, models: [{ id: model.modelId }] });
  faux.setResponses([
    () => fauxAssistantMessage([fauxToolCall('addNote', { text: 'Depuis la session' }, { id: 'c1' })], { stopReason: 'toolUse' }),
    () => fauxAssistantMessage([fauxText('Fait.')]),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const harnesses = [];
  const session = createSession({
    id: 'me:camille', def: notesPlain, storage: new MemoryStorage(), unitStorage: w.storage, models, model,
    openHarness: async (storage, options, ctx) => { const harness = await Harness.open(storage, options, ctx); harnesses.push(harness); return harness; },
    budget: { reserveRun: async (i) => ({ reservationId: i.runId }), recordUsage: async () => ({ billedMicros: 0 }), settleRun: async () => undefined, releaseRun: async () => undefined },
    skills: () => ({ list: async () => [], version: async () => '1' }),
    kv: { get: async () => undefined, put: async () => undefined }, wake: { arm: async () => undefined }, language: async () => 'fr',
  });
  try {
    const request = new Request('http://host.test/session?op=submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'r1', content: 'note' }) });
    assert.equal((await session.fetch(request, { id: 'camille', language: 'fr' })).status, 200);
    for (const end = Date.now() + 15_000; w.opened.length === 0 || w.rows('camille', 'notes').length === 0; await new Promise((r) => setTimeout(r, 25))) assert.ok(Date.now() < end, 'the note was written');
    assert.deepEqual(w.rows('camille', 'notes').map((n) => [n.text, n.by]), [['Depuis la session', 'camille']]);
  } finally { for (const harness of harnesses) await harness.close(context).catch(() => undefined); }
});

test('no field (unknown role): a role that is not owner, editor or reader is never admitted', async () => {
  for (const role of ['viewer', 'Owner', 'reader ', '__proto__', 'toString']) {
    for (const need of ['reader', 'owner']) {
      const got = admit(need, 'u1', [{ userId: 'gaspard', role }], 'x', { person: 'gaspard' });
      assert.equal(isRefusal(got) && got.kind, 'NotYours', `member role ${JSON.stringify(role)}, need ${need}`);
      const viaMust = await Effect.runPromise(Effect.result(must(need, 'u1', [{ userId: 'gaspard', role }], 'x').pipe(Effect.provideService(CurrentUser, { userId: 'gaspard' }))));
      assert.equal(viaMust._tag === 'Failure' && viaMust.failure._tag, 'NotYours', `must: ${role}`);
    }
  }
  const scoped = admit('owner', 'u1', [], 'x', { person: 'gaspard', scope: { kind: 'unit', unit: 'u1', role: 'superuser' } });
  assert.equal(isRefusal(scoped) && scoped.kind, 'NotYours', 'a scope role "superuser"');
});

test('refused at mount (schéma ouvert): every object of an input is closed, at any depth, and appTools checks it itself', () => {
  const open = (input) => withOp({ ...addNote, name: 'deep', input });
  const closed = [
    obj({ text: str() }),
    obj({ meta: obj({ a: str() }) }),
    obj({ items: arr(obj({ a: str() })) }),
    obj({ pick: union([obj({ a: str() }), str()]) }),
  ];
  for (const input of closed) assert.doesNotThrow(() => checkExpose(open(input)));
  const opened = {
    'a nested object without additionalProperties': obj({ meta: { type: 'object', properties: { userId: { type: 'string' } } } }),
    'an open obj inside obj': obj({ meta: obj({}, { open: true }) }),
    'an array of open objects': obj({ items: arr(obj({}, { open: true })) }),
    'a union branch that is open': obj({ pick: union([obj({}, { open: true }), str()]) }),
    patternProperties: { ...obj({}), patternProperties: { '^u': { type: 'string' } } },
  };
  for (const [name, input] of Object.entries(opened)) {
    refuses(() => checkExpose(open(input)), 'deep', 'open');
    refuses(() => appTools({ def: open(input), agent: 'assistant', scope: undefined, attribution: acting('camille'), storage: () => ({}) }), 'deep', 'open');
    console.log('refusé au montage:', name);
  }
});

test('refused at mount (phrases): an operation with no input, and both forms built without api, answer a sentence', () => {
  refuses(() => checkExpose(withOp({ ...addNote, name: 'noInput', input: undefined })), 'noInput', 'input');
  const both = { ...notes, ops: { list: [addNote] }, expose: { ...notes.expose, assistant: ['AddNote', 'addNote'] } };
  assert.throws(() => appTools({ def: both, agent: 'assistant', scope: undefined, attribution: acting('camille'), storage: () => ({}) }), (e) => !(e instanceof TypeError) && /notes.*assistant.*no api/.test(e.message));
});

test('risky (avant la question): an unknown sender or a missing role is refused before the person is asked', async () => {
  const w = await seeded();
  const timed = (promise) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('the person was asked to approve')), 8000))]);
  const call = [send('removeMember', { userId: 'emma' })];
  const unknown = await timed(drive(build(notesPlain, w, { attribution: async (c) => { throw new SenderUnknown(c.callId); } }), 'assistant', call));
  assert.deepEqual(unknown.results, [{ text: REFUSED, isError: true }]);
  const editor = await timed(drive(build(notesPlain, w, { scope: { kind: 'unit', unit: 'camille', role: 'editor' }, attribution: acting('dominique') }), 'assistant', call));
  assert.deepEqual(editor.results, [{ text: '{"_tag":"NotAllowed","need":"owner"}', isError: true }]);
  assert.ok(w.rows('camille', 'members').some((m) => m.user_id === 'emma'));
  console.log('accord: refused before asking (unknown sender, missing role); Approve and Deny as in the risky test');
});
