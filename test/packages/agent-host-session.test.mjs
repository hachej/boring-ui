// The neutral session (`createSession` of `@hachej/boring-agent/host-runtime`): one conversation per session id, opened on first use,
// outliving its request, woken by its alarm, told its sender's language, and reporting a failure to every viewer. Node only: pi-durable's
// SQLite storage on a temporary file, Domain in memory, a scripted model. Fictional people: Camille (fr), Dominique (en).
// The tools of host-session-tools are stubs here (the `tools` option).
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Domain from '@alchemy.run/domain';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Layer from 'effect/Layer';
import * as Scope from 'effect/Scope';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import { Harness, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai/utils/transcript';
import { defineAgent } from '@hachej/boring-agent/agents';
import { CurrentUser, Session, defineApp } from '@hachej/boring-agent/host';
import { createSession } from '@hachej/boring-agent/host-runtime';
import { checkSource } from '../../scripts/pi-policy.mjs';
import notes from '../../fixtures/host-apps/notes/app.ts';
import todo from '../../fixtures/host-apps/todo/app.ts';
import { Notebook, NotebookHandlers, ReaderOnDeposit } from '../../fixtures/host-apps/notes/models/Notebook.model.ts';
import { NotebookApi } from '../../fixtures/host-apps/notes/models/NotebookApi.api.ts';
import { Notebook as NotebookAggregate } from '../../fixtures/host-apps/notes/models/Notebook/Notebook.aggregate.ts';
import { DocumentDeposited } from '../../fixtures/host-apps/notes/models/Notebook/Deposit.command.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const policy = JSON.parse(readFileSync(join(root, 'ARCHITECTURE.json'), 'utf8'));
const sessionSource = join(root, 'packages/agent/src/host/runtime/session.ts');
const DEPOSIT = ReaderOnDeposit.key;
const tmp = mkdtempSync(join(tmpdir(), 'host-session-'));
const removeTmp = () => rmSync(tmp, { recursive: true, force: true });
process.once('exit', removeTmp);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => process.exit(1));
const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) await f().catch(() => undefined); removeTmp(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 15_000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) { const v = await f(); if (v) return v; } throw new Error('timed out'); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

// The app's data: the notes notebook on Domain in memory, built once.
const World = Notebook.layer(Layer.mergeAll(NotebookHandlers, ReaderOnDeposit.toLayer(Effect.succeed(() => Effect.void)))).pipe(Layer.provide(Domain.InMemory));
const worldScope = await Effect.runPromise(Scope.make());
const world = await Effect.runPromise(Layer.buildWithScope(World, worldScope));
cleanups.push(() => Effect.runPromise(Scope.close(worldScope, Exit.void)));
const as = (userId) => NotebookApi.clientInProcess.pipe(Effect.provide(Layer.succeed(Session, (effect) => Effect.provideService(effect, CurrentUser, { userId }))));
const app = (userId, f) => Effect.runPromise(Effect.scoped(Effect.flatMap(as(userId), f)).pipe(Effect.provideContext(world)));
await app('camille', (c) => c.CreateNotebook('camille', { name: 'Carnet' }));
await app('dominique', (c) => c.CreateNotebook('dominique', { name: 'Carnet' }));
const notesOf = async (id) => (await app(id, (c) => c.Notes.get(id))).notes.map((n) => n.text);

// The scripted model: `respond(request)` answers each model request; `seen` records them all.
const textOf = (message) => (typeof message.content === 'string' ? message.content : message.content.filter((p) => p.type === 'text').map((p) => p.text).join(''));
const scripted = (respond) => {
  const faux = fauxProvider({ provider: 'fictional-faux', models: [{ id: 'main' }] });
  const seen = [];
  faux.setResponses(Array.from({ length: 60 }, () => async (transcript) => {
    const last = transcript.messages.findLastIndex((m) => m.role === 'user');
    const request = {
      user: textOf(transcript.messages[last]), tools: getCurrentTools(transcript.messages).map((t) => t.name), system: getCurrentSystemPrompt(transcript.messages),
      afterTool: transcript.messages.slice(last + 1).some((m) => m.role === 'toolResult'),
    };
    seen.push(request);
    return respond(request);
  }));
  const models = createModels();
  models.setProvider(faux.provider);
  return { models, seen, model: { provider: 'fictional-faux', modelId: 'main' } };
};
const ack = (r) => fauxAssistantMessage([fauxText(`ack ${r.user.replace(/\s+/g, ' ')}`)]);
const callThen = (name, args) => (r) => (r.afterTool ? ack(r) : fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' }));

const sink = { reserveRun: async (i) => ({ reservationId: i.runId }), recordUsage: async () => ({ billedMicros: 0 }), settleRun: async () => undefined, releaseRun: async () => undefined };
const noTools = ({ agent }) => defineExtension({ name: `host.tools.${agent}` });
let storages = 0;
const storageFile = () => join(tmp, `s${++storages}.sqlite`);

/** One session over a temporary SQLite file. `openHarness` is counted and its Harnesses are kept, so a test can close one (an eviction). */
const make = async ({ id = 'me:camille', def = notes, respond = ack, tools = noTools, language = async () => 'fr', file = storageFile(), failFirstOpen = false, files } = {}) => {
  const storage = await openNodeSqliteStorage(file);
  const log = [];
  const m = scripted((r) => { log.push('model'); return respond(r); });
  const state = { log, opens: 0, harnesses: [], armed: [], seen: m.seen, kvWrites: 0, languageCalls: 0 };
  let failed = !failFirstOpen;
  state.session = createSession({
    id, def, api: def.api, storage, services: () => world, models: m.models, model: m.model, tools, budget: sink,
    skills: () => ({ list: async () => [], version: async () => '1' }),
    kv: { get: async () => undefined, put: async () => { state.kvWrites++; } },
    wake: { arm: async (at) => { state.armed.push(at); log.push(typeof at === 'number' ? 'arm' : 'clear'); } },
    language: async (person) => { state.languageCalls++; return language(person); },
    ...(files ? { files } : {}),
    openHarness: async (s, options, context) => {
      state.opens++; log.push('open');
      if (!failed) { failed = true; throw new Error('storage unavailable'); }
      const harness = await Harness.open(s, options, context);
      state.harnesses.push(harness);
      return harness;
    },
  });
  cleanups.push(async () => { for (const h of state.harnesses) await h.close(ctx).catch(() => undefined); });
  return state;
};

const url = (op, extra = '') => `http://host.test/session?op=${op}${extra}`;
const camille = { id: 'camille', language: 'fr' };
const dominique = { id: 'dominique', language: 'en' };
let requests = 0;
const submit = (s, person, content) => s.fetch(new Request(url('submit'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: `r${++requests}`, content }) }), person);
const entries = async (s, person) => JSON.stringify(await (await s.fetch(new Request(url('entries', '&limit=200')), person)).json());
const answered = (s, person, text) => until(async () => (await entries(s, person)).includes(`ack ${text}`)).catch(async (error) => { throw new Error(`${error.message}: no "ack ${text}" in ${(await entries(s, person)).slice(0, 1500)}`); });

const kept = [];
/** An NDJSON watch: the lines seen so far, and a way to stop it. */
const watch = (s, person) => {
  const ac = new AbortController();
  const lines = [];
  let ended;
  const done = (async () => {
    // The Request is kept: Node links its signal to ours only weakly, so once it is collected `ac.abort()` no longer reaches the stream.
    const request = new Request(url('watch'), { signal: ac.signal });
    kept.push(request);
    const response = await s.fetch(request, person);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        for (let i; (i = buffer.indexOf('\n')) >= 0;) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (line) lines.push(line); }
      }
      ended = 'closed by the server';
    } catch { /* aborted by the test */ }
  })();
  cleanups.push(() => { ac.abort(); return done; });
  return { lines, stop: async () => { ac.abort(); await done; }, get ended() { return ended; } };
};

test('entry: createSession comes from host-runtime, and ./host loads no pi-durable runtime module', () => {
  assert.equal(typeof createSession, 'function');
  const dist = join(root, 'packages/agent/dist');
  const seen = new Set(), external = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('.')) { const next = join(dirname(file), spec); if (existsSync(next)) visit(next); } else external.add(spec);
    }
  };
  visit(join(dist, 'host.js'));
  assert.deepEqual([...external].filter((s) => s.startsWith('@earendil-works/pi-durable')), []);
  assert.ok(![...seen].some((f) => /host[\\/]runtime/.test(f)), 'host.js reaches nothing under host/runtime');
});

test('the session never opens a Harness itself: a scratch copy that does fails the pi policy', () => {
  const file = 'packages/agent/src/host/runtime/session.ts';
  const scratch = `import { Harness } from '@earendil-works/pi-durable';\nexport const open = (s, o, c) => Harness.open(s, o, c);\n`;
  const errors = checkSource(file, scratch, policy);
  assert.ok(errors.includes(`BORING-PI-2 ${file}: packages borrow a host-created Harness; the host opens and closes it`), errors.join('; '));
  assert.deepEqual(checkSource(file, readFileSync(sessionSource, 'utf8'), policy), []);
});

test('first use: two requests together open the Harness once, entries is empty, watch beats within 6 s', async () => {
  const h = await make();
  const [a, b] = await Promise.all([h.session.fetch(new Request(url('entries', '&limit=50')), camille), h.session.fetch(new Request(url('entries', '&limit=50')), camille)]);
  assert.equal(h.opens, 1);
  for (const r of [a, b]) { assert.equal(r.status, 200); assert.deepEqual((await r.json()).page.items, []); }
  const w = watch(h.session, camille);
  await until(() => w.lines.some((l) => JSON.parse(l).kind === 'heartbeat'), 6_000);
  console.log('first use: opens', h.opens, '| first frames', w.lines.slice(0, 2).map((l) => JSON.parse(l).kind).join(','));
  await w.stop();
  assert.equal((await h.session.fetch(new Request(url('entries', '&limit=50')), dominique)).status, 404, 'a personal session answers its person only');
});

test('failed open: a rejected openHarness is not kept; 503 once, then the next request opens it', async () => {
  const h = await make({ failFirstOpen: true });
  const first = await h.session.fetch(new Request(url('entries', '&limit=50')), camille);
  assert.equal(first.status, 503);
  assert.deepEqual(await first.json(), { error: 'unavailable' });
  assert.equal((await h.session.fetch(new Request(url('entries', '&limit=50')), camille)).status, 200);
  assert.equal(h.opens, 2);
  assert.equal((await submit(h.session, camille, 'bonjour')).status, 200);
  await answered(h.session, camille, '[language: fr] bonjour');
});

test('survit à sa requête (outlives): a turn finishes with no request open, after an eviction, woken by the alarm alone', async () => {
  const file = storageFile();
  const gate = deferred(), started = deferred();
  let runs = 0;
  const tools = ({ agent }) => defineExtension({ name: `host.tools.${agent}`, tools: agent !== 'assistant' ? [] : [defineTool({
    name: 'add_note', description: 'Add a note to the notebook.', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, replay: 'safe',
    execute: async (args, _api, context) => {
      runs++;
      if (runs === 1) { started.resolve(); await new Promise((_, reject) => context.abortSignal?.addEventListener('abort', () => reject(new Error('closed')), { once: true })); }
      await app('camille', (c) => c.AddNote('camille', { text: args.text }));
      return { output: [{ type: 'text', text: 'noted' }] };
    },
  })] });
  let first = true;
  const respond = async (r) => { if (first) { first = false; await gate.promise; } return callThen('add_note', { text: 'Appeler le garage' })(r); };
  const one = await make({ file, tools, respond });
  assert.equal((await submit(one.session, camille, 'note: garage')).status, 200, 'submit answered while the model was still held: the turn runs apart from the request');
  assert.equal(runs, 0);
  gate.resolve();
  await started.promise;
  assert.deepEqual(await notesOf('camille'), [], 'the tool is waiting: nothing written');
  await one.harnesses[0].close(ctx); // the eviction: the Harness is closed under the waiting tool and the session object is dropped
  assert.ok(one.armed.some((t) => typeof t === 'number'), 'an alarm time was armed before the eviction');
  const two = await make({ file, tools, respond });
  await two.session.alarm(); // the Wake port's job: no fetch in between
  const held = await entries(two.session, camille);
  console.log('outlives: model requests', one.seen.length, '+', two.seen.length, '| tool runs', runs, '| alarm times armed', one.armed.length, '| answer in the first read', held.includes('ack [language: fr] note: garage'));
  assert.ok(held.includes('ack [language: fr] note: garage'), 'the finished answer is in the new session\'s first read');
  assert.deepEqual(await notesOf('camille'), ['Appeler le garage'], 'the app operation ran once');
});

test('le modèle échoue (model fails): both open watches get the failure, stay open, and the next message is answered', async () => {
  let n = 0;
  const h = await make({ respond: (r) => (++n === 1 ? fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'the scripted model fails' }) : ack(r)) });
  const a = watch(h.session, camille), b = watch(h.session, camille);
  await until(() => a.lines.length > 0 && b.lines.length > 0);
  assert.equal((await submit(h.session, camille, 'premier')).status, 200);
  const failed = (w) => w.lines.some((l) => l.includes('runFailure') && l.includes('model_error'));
  await until(() => failed(a) && failed(b), 30_000);
  assert.equal(a.ended, undefined);
  assert.equal(b.ended, undefined);
  assert.ok(![...a.lines, ...b.lines].some((l) => JSON.parse(l).kind === 'end'), 'no stream was ended');
  assert.equal((await submit(h.session, camille, 'second')).status, 200);
  await answered(h.session, camille, '[language: fr] second');
  console.log('model fails: frames', a.lines.length, b.lines.length, '| both carry runFailure model_error | next message answered');
});

test('langue (language): every message carries its sender\'s language, resolved at the request, never read from the request', async () => {
  const records = { camille: 'fr', dominique: 'en' };
  const language = async (id) => records[id];
  const c = await make({ id: 'me:camille', language });
  const d = await make({ id: 'me:dominique', language });
  await submit(c.session, camille, 'un');
  await answered(c.session, camille, '[language: fr] un');
  await submit(d.session, dominique, 'two');
  await answered(d.session, dominique, '[language: en] two');
  records.dominique = 'fr';
  await submit(d.session, dominique, 'three');
  await answered(d.session, dominique, '[language: fr] three');
  await submit(c.session, { id: 'camille', language: 'en' }, 'quatre');
  await answered(c.session, camille, '[language: fr] quatre');
  const first = (r) => r.user.split('\n')[0];
  console.log('language: camille', first(c.seen[0]), '| dominique', first(d.seen[0]), '| dominique after his record changed', first(d.seen[1]), '| camille with a request saying en', first(c.seen[1]));
  assert.deepEqual([first(c.seen[0]), first(d.seen[0]), first(d.seen[1]), first(c.seen[1])], ['[language: fr]', '[language: en]', '[language: fr]', '[language: fr]']);
  assert.ok(c.languageCalls >= 2 && d.languageCalls >= 2, 'resolved again for each message');
});

test('files: only an app that asks for them has upload and the file tools', async () => {
  const files = { upload: async () => Response.json({ ok: true }), download: async () => new Response('x'), env: () => ({}) };
  const withFiles = await make({ files });
  assert.equal(typeof withFiles.session.upload, 'function');
  assert.equal(withFiles.session.saveFile, undefined);
  assert.equal((await withFiles.session.upload(new Request('http://host.test/upload', { method: 'POST' }), camille)).status, 200);
  assert.equal((await withFiles.session.upload(new Request('http://host.test/upload', { method: 'POST' }), dominique)).status, 404);
  await submit(withFiles.session, camille, 'avec');
  await answered(withFiles.session, camille, '[language: fr] avec');
  assert.ok(withFiles.seen[0].tools.includes('read') && withFiles.seen[0].tools.includes('ask_user'), withFiles.seen[0].tools.join(','));

  const bare = await make({ def: defineApp({ ...notes, needs: undefined }), respond: callThen('read', { path: 'a.txt' }), files });
  assert.equal(bare.session.upload, undefined);
  await submit(bare.session, camille, 'sans');
  await answered(bare.session, camille, '[language: fr] sans');
  assert.ok(!bare.seen[0].tools.includes('read'));
  assert.ok((await entries(bare.session, camille)).includes('Tool read is not available'));
  console.log('files: with ->', withFiles.seen[0].tools.join(','), '| without ->', bare.seen[0].tools.join(','), '; its call to read got "Tool read is not available"');
});

test('reader wake: only wake(unit, event, key, text) on its own reader session; a repeated event is one submission', async () => {
  const reader = await make({ id: 'reader:camille' });
  await reader.session.wake('dominique', DEPOSIT, '1', 'Document n°1');
  assert.deepEqual([reader.opens, reader.seen.length, reader.kvWrites], [0, 0, 0], 'another unit: no Harness, no model request, no key written');
  const personal = await make({ id: 'me:camille' });
  await personal.session.wake('camille', DEPOSIT, '1', 'Document n°1');
  assert.deepEqual([personal.opens, personal.seen.length, personal.kvWrites], [0, 0, 0]);
  await reader.session.wake('camille', DEPOSIT, '2', 'Document n°2 « Facture »');
  await reader.session.wake('camille', DEPOSIT, '2', 'Document n°2 « Facture »');
  await until(() => reader.seen.length >= 1);
  await sleep(300);
  assert.equal(reader.seen.length, 1, 'two wakes, one submission, one model request');
  assert.equal(reader.seen[0].user, 'Document n°2 « Facture »');
  assert.ok(reader.seen[0].system.includes('La clé du carnet est camille'), 'the reader agent works on its unit\'s key');
  console.log('reader wake: another unit or a personal session -> 0 Harness opened; the same event twice -> model requests', reader.seen.length);
});

test('one extension per agent: a conversation selects exactly its agent\'s tools', async () => {
  const probe = (agent) => defineTool({ name: `probe_${agent}`, description: `Probe ${agent}.`, parameters: { type: 'object', properties: {} }, replay: 'safe', execute: async () => ({ output: [{ type: 'text', text: agent }] }) });
  const tools = ({ agent }) => defineExtension({ name: `host.tools.${agent}`, tools: [probe(agent)] });
  const h = await make({ tools, respond: callThen('probe_reader', {}) });
  await submit(h.session, camille, 'sonde');
  await answered(h.session, camille, '[language: fr] sonde');
  const names = h.seen[0].tools.filter((t) => t.startsWith('probe_'));
  assert.deepEqual(names, ['probe_assistant']);
  assert.ok((await entries(h.session, camille)).includes('Tool probe_reader is not available'));
  const other = await h.harnesses[0].createConversation({ ownership: { kind: 'ownerless' }, agent: { model: { provider: 'fictional-faux', modelId: 'main' } } }, ctx);
  await other.submit({ type: 'input', content: 'nu', requestId: 'bare-1' }, ctx);
  await until(() => h.seen.some((r) => r.user === 'nu'));
  const bare = h.seen.find((r) => r.user === 'nu').tools;
  assert.deepEqual(bare, [], 'a conversation with no agent change lists no tool');
  assert.ok(!/new Map|ToolRegistration/.test(readFileSync(sessionSource, 'utf8')), 'session.ts keeps no list or map of tools by name');
  console.log('one extension per agent: the assistant sees', names.join(','), '; its call to probe_reader got "Tool probe_reader is not available"; a bare conversation sees', JSON.stringify(bare));
});

test('who is acting: the record is the session\'s own, written once per call, read back after an eviction', async () => {
  const hold = deferred();
  let evictable = 0;
  const toolsFor = (log, hang) => ({ agent, attribution, scope }) => defineExtension({ name: `host.tools.${agent}`, tools: [defineTool({
    name: `who_${agent}`, description: 'Who is acting.', parameters: { type: 'object', properties: {} }, replay: 'safe',
    execute: async (_args, api, context) => {
      const actor = await attribution(api, context);
      log.push({ scope, actor, again: await attribution(api, context) });
      if (hang && ++evictable === 1) { hold.resolve(); await new Promise((_, reject) => context.abortSignal?.addEventListener('abort', () => reject(new Error('closed')), { once: true })); }
      return { output: [{ type: 'text', text: JSON.stringify(actor) }] };
    },
  })] });
  const mine = [];
  const personal = await make({ id: 'me:camille', tools: toolsFor(mine), respond: callThen('who_assistant', {}) });
  await submit(personal.session, camille, 'qui');
  await answered(personal.session, camille, '[language: fr] qui');
  assert.deepEqual(mine[0].actor, { requestedBy: 'camille' });
  assert.deepEqual(mine[0].again, mine[0].actor);
  assert.equal(mine[0].scope, undefined, 'a personal session\'s tools carry no scope');

  const theirs = [];
  const reader = await make({ id: 'reader:camille', tools: toolsFor(theirs), respond: callThen('who_reader', {}) });
  await reader.session.wake('camille', DEPOSIT, '9', 'Document n°9');
  await until(() => theirs.length > 0);
  assert.deepEqual(theirs[0].actor, { requestedBy: 'reader:camille' });
  assert.deepEqual(theirs[0].scope, { kind: 'reader', unit: 'camille', role: 'editor', ops: ['RecordGist'] }, 'derived from the id and the app\'s expose list');

  // After an eviction the record is read back, not recomputed: the new session over the same storage is deliberately a reader session.
  const file = storageFile();
  const reported = [];
  const before = await make({ id: 'me:camille', file, tools: toolsFor(reported, true), respond: callThen('who_assistant', {}) });
  await submit(before.session, camille, 'encore');
  await hold.promise;
  await before.harnesses[0].close(ctx);
  const after = await make({ id: 'reader:camille', file, tools: toolsFor(reported, true), respond: callThen('who_assistant', {}) });
  await after.session.alarm();
  console.log('who is acting:', JSON.stringify(reported.map((r) => r.actor)), '(first run, then the run after the eviction in a session that would say reader:camille)');
  assert.deepEqual(reported.map((r) => r.actor), [{ requestedBy: 'camille' }, { requestedBy: 'camille' }]);
});

test('un seul lecteur: wakes naming two agents are refused in one sentence, and an event the app never declared wakes nothing', async () => {
  const two = defineApp({ ...notes, wakes: [...notes.wakes, { ...notes.wakes[0], agent: 'researcher' }] });
  await assert.rejects(make({ id: 'reader:camille', def: two }), /notes has wakes for more than one agent \(reader, researcher\); one reader per app until a later card designs several/);
  const reader = await make({ id: 'reader:camille' });
  await reader.session.wake('camille', 'NeverDeclared', '1', 'Document n°1');
  assert.deepEqual([reader.opens, reader.seen.length], [0, 0]);
});

test('no assistant: an app with no agent a person can talk to is refused when the session is made, with the cause', async () => {
  const helper = defineApp({ ...todo, agents: () => ({ helper: defineAgent({ id: 'helper', model: { provider: 'fictional-faux', modelId: 'main' }, struggle: false }) }) });
  await assert.rejects(make({ def: helper }), /createSession\(me:camille\): todo declares no agent a person can talk to: no agent named assistant/);
});

test('language: a resolver that answers nothing falls back to the app\'s base language', async () => {
  const h = await make({ language: async () => undefined });
  await submit(h.session, camille, 'rien');
  await answered(h.session, camille, '[language: fr] rien');
});

test('alarm: a Harness the host closes under a waiting alarm() ends the wait and leaves no timer', async () => {
  const started = deferred();
  const tools = ({ agent }) => defineExtension({ name: `host.tools.${agent}`, tools: agent !== 'assistant' ? [] : [defineTool({
    name: 'stuck', description: 'Never finishes.', parameters: { type: 'object', properties: {} }, replay: 'safe',
    execute: async (_args, _api, context) => { started.resolve(); await new Promise((_, reject) => context.abortSignal?.addEventListener('abort', () => reject(new Error('closed')), { once: true })); },
  })] });
  const h = await make({ tools, respond: callThen('stuck', {}) });
  await submit(h.session, camille, 'bloque');
  await started.promise;
  const waiting = h.session.alarm();
  assert.equal(await Promise.race([waiting.then(() => 'returned'), sleep(500).then(() => 'waiting')]), 'waiting', 'the alarm waits while the turn runs');
  await h.harnesses[0].close(ctx);
  assert.equal(await Promise.race([waiting.then(() => 'returned'), sleep(3_000).then(() => 'stuck')]), 'returned');
});

test('order of calls: a time is armed before every open, submit, answer, abort and wake', async () => {
  const armedBetween = (h, mark, stopAt) => { const after = h.log.slice(mark + 1); const end = stopAt && after.includes(stopAt) ? after.indexOf(stopAt) : after.length; return after.slice(0, end).includes('arm'); };
  const h = await make();
  h.log.push('call:submit');
  await submit(h.session, camille, 'ordre');
  await answered(h.session, camille, '[language: fr] ordre');
  assert.ok(h.log.indexOf('arm') < h.log.indexOf('open'), 'a time is armed before the Harness is opened');
  assert.ok(h.log.indexOf('arm', h.log.indexOf('open')) < h.log.indexOf('model'), 'and armed again after the open, before the model is asked');
  for (const op of ['submit', 'answer', 'abort']) {
    h.log.push(`call:${op}`);
    const mark = h.log.length - 1;
    const body = op === 'submit' ? { requestId: `o${++requests}`, content: `ordre ${op}` } : op === 'answer' ? { callId: 'none', answer: 'x' } : {};
    await h.session.fetch(new Request(url(op), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), camille);
    assert.ok(armedBetween(h, mark, 'model'), `${op}: a time was armed before the work started`);
  }
  const reader = await make({ id: 'reader:camille' });
  await reader.session.wake('camille', DEPOSIT, '5', 'Document n°5');
  await until(() => reader.log.includes('model'));
  assert.ok(reader.log.indexOf('arm') < reader.log.indexOf('open') && reader.log.indexOf('arm', reader.log.indexOf('open')) < reader.log.indexOf('model'), 'wake: armed before the open and again before the model');
  console.log('order of calls:', h.log.slice(0, 8).join(' > '), '| reader:', reader.log.slice(0, 6).join(' > '));
});

test('le processus tué (crash): a process killed mid-turn is resumed by alarm() alone, and the restart limit ends as a failure the person sees', async () => {
  const file = storageFile();
  const child = join(root, 'test/helpers/host-session-child.mjs');
  const run = (mode) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--no-warnings', child, file, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', killed = false;
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`child ${mode} timed out: ${out} ${err}`)); }, 40_000);
    p.stdout.on('data', (d) => { out += d; if (!killed && out.includes('waiting')) { killed = true; p.kill('SIGKILL'); } });
    p.stderr.on('data', (d) => { err += d; });
    p.on('exit', () => { clearTimeout(timer); resolve({ killed, out, err }); });
  });
  let last = await run('submit');
  assert.ok(last.killed, `the first process was killed mid-turn: ${last.out} ${last.err}`);
  let kills = 1;
  while (last.killed && kills < 8) { last = await run('alarm'); if (last.killed) kills++; }
  assert.ok(last.out.includes('alarm-returned'), `the last alarm() returned by itself: ${last.out} ${last.err}`);
  const h = await make({ file });
  const seen = await entries(h.session, camille);
  const w = watch(h.session, camille);
  await until(() => w.lines.length > 0);
  console.log('crash: killed', kills, 'times | restart_limit in entries', seen.includes('restart_limit'), '| in a new watch\'s first frame', w.lines[0].includes('restart_limit'));
  assert.equal(kills, 5, 'pi ends the run when the fifth process is cut off');
  assert.ok(seen.includes('restart_limit'), 'the failure is visible in entries');
  assert.ok(w.lines[0].includes('restart_limit'), 'and in a new watch');
  await w.stop();
  await submit(h.session, camille, 'suite');
  await answered(h.session, camille, '[language: fr] suite');
});

test('la clé du réveil: a reader is woken by its policy\'s stable key, whatever its JavaScript name; an unknown key wakes nothing and is recorded', async () => {
  const options = { from: NotebookAggregate, on: [DocumentDeposited] };
  const AsConst = Domain.Policy('ReaderOnDeposit', options);
  class Renamed extends Domain.Policy('ReaderOnDeposit', options) {}
  Object.defineProperty(Renamed, 'name', { value: 'e' });
  for (const policy of [AsConst, Renamed]) {
    assert.equal(policy.key, DEPOSIT);
    assert.notEqual(policy.name, 'ReaderOnDeposit', 'a bundler may erase the JavaScript name');
    const reader = await make({ id: 'reader:camille', def: defineApp({ ...notes, wakes: [{ ...notes.wakes[0], policy }] }) });
    await reader.session.wake('camille', policy.name, '1', 'Document n°1');
    assert.equal(reader.opens, 0, 'the JavaScript name wakes nothing');
    assert.equal((await reader.session.info()).ignoredWake, policy.name, 'and the session says so');
    await reader.session.wake('camille', policy.key, '2', 'Document n°2');
    await until(() => reader.seen.length === 1);
    assert.equal(reader.seen[0].user, 'Document n°2');
  }
  await assert.rejects(make({ id: 'reader:camille', def: defineApp({ ...notes, wakes: [{ ...notes.wakes[0], policy: {} }] }) }), /notes: a wake policy has no stable key/);
});

test('info: an open that failed is recorded for wake and alarm too, and cleared once a later open succeeds', async () => {
  const h = await make({ failFirstOpen: true });
  assert.equal((await h.session.fetch(new Request(url('entries', '&limit=5')), camille)).status, 503);
  assert.match((await h.session.info()).openError, /storage unavailable/);
  assert.equal((await h.session.fetch(new Request(url('entries', '&limit=5')), camille)).status, 200);
  assert.equal((await h.session.info()).openError, undefined);
  const reader = await make({ id: 'reader:camille', failFirstOpen: true });
  await assert.rejects(reader.session.wake('camille', DEPOSIT, '1', 'Document n°1'), /storage unavailable/);
  assert.match((await reader.session.info()).openError, /storage unavailable/);
  const late = await make({ failFirstOpen: true });
  await assert.rejects(late.session.alarm(), /storage unavailable/);
  assert.match((await late.session.info()).openError, /storage unavailable/);
});

test('reader without its agent: the sentence is about the reader', async () => {
  const ghost = defineApp({ ...notes, wakes: [{ ...notes.wakes[0], agent: 'ghost' }], expose: { ...notes.expose, ghost: ['RecordGist'] } });
  await assert.rejects(make({ id: 'reader:camille', def: ghost }), /notes declares no reader agent: no agent named ghost/);
});

test('un flux coupé: a watch whose request is aborted leaves no heartbeat timer, so its process exits by itself', async () => {
  const child = join(root, 'test/helpers/host-session-child.mjs');
  const result = await new Promise((resolve) => {
    const p = spawn(process.execPath, ['--no-warnings', child, storageFile(), 'watch'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { p.kill('SIGKILL'); }, 25_000);
    p.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out }); });
  });
  assert.deepEqual([result.code, result.signal], [0, null], `the process exited by itself: ${result.out}`);
  assert.ok(result.out.includes('watch ended'));
});
