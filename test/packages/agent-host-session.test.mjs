// The neutral session (`createSession` of `@hachej/boring-agent/host-runtime`): one conversation per session id, opened on first use,
// outliving its request, woken by its alarm, told its sender's language, and reporting a failure to every viewer. Node only: pi-durable's
// SQLite storage on a temporary file, Domain in memory, a scripted model. Fictional people: Camille (fr), Dominique (en).
// The tools of host-session-tools are stubs here (the `tools` option).
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
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
import { CurrentUser, Session, defineApp } from '@hachej/boring-agent/host';
import { createSession } from '@hachej/boring-agent/host-runtime';
import { checkSource } from '../../scripts/pi-policy.mjs';
import notes from '../../fixtures/host-apps/notes/app.ts';
import { Notebook, NotebookHandlers, ReaderOnDeposit } from '../../fixtures/host-apps/notes/models/Notebook.model.ts';
import { NotebookApi } from '../../fixtures/host-apps/notes/models/NotebookApi.api.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const policy = JSON.parse(readFileSync(join(root, 'ARCHITECTURE.json'), 'utf8'));
const sessionSource = join(root, 'packages/agent/src/host/runtime/session.ts');
const tmp = mkdtempSync(join(tmpdir(), 'host-session-'));
const cleanups = [];
after(async () => { for (const f of cleanups.reverse()) await f().catch(() => undefined); rmSync(tmp, { recursive: true, force: true }); });

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
  const m = scripted(respond);
  const state = { opens: 0, harnesses: [], armed: [], seen: m.seen, kvWrites: 0, languageCalls: 0 };
  let failed = !failFirstOpen;
  state.session = createSession({
    id, def, api: def.api, storage, services: () => world, models: m.models, model: m.model, tools, budget: sink,
    skills: () => ({ list: async () => [], version: async () => '1' }),
    kv: { get: async () => undefined, put: async () => { state.kvWrites++; } },
    wake: { arm: async (at) => { state.armed.push(at); } },
    language: async (person) => { state.languageCalls++; return language(person); },
    ...(files ? { files } : {}),
    openHarness: async (s, options, context) => {
      state.opens++;
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

/** An NDJSON watch: the lines seen so far, and a way to stop it. */
const watch = (s, person) => {
  const ac = new AbortController();
  const lines = [];
  let ended;
  const done = (async () => {
    const response = await s.fetch(new Request(url('watch'), { signal: ac.signal }), person);
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

test('outlives: a turn finishes with no request open, after an eviction, woken by the alarm alone', async () => {
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

test('model fails: both open watches get the failure, stay open, and the next message is answered', async () => {
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

test('language: every message carries its sender\'s language, resolved at the request, never read from the request', async () => {
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
  await reader.session.wake('dominique', 'Deposit', '1', 'Document n°1');
  assert.deepEqual([reader.opens, reader.seen.length, reader.kvWrites], [0, 0, 0], 'another unit: no Harness, no model request, no key written');
  const personal = await make({ id: 'me:camille' });
  await personal.session.wake('camille', 'Deposit', '1', 'Document n°1');
  assert.deepEqual([personal.opens, personal.seen.length, personal.kvWrites], [0, 0, 0]);
  await reader.session.wake('camille', 'Deposit', '2', 'Document n°2 « Facture »');
  await reader.session.wake('camille', 'Deposit', '2', 'Document n°2 « Facture »');
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
  await reader.session.wake('camille', 'Deposit', '9', 'Document n°9');
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
