import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createResourceClient } from '@hachej/boring-files/remote';
import { openRedactionBrowser } from '../../examples/redaction-browser/runtime.mjs';
import { createRedactionBrowserHandler } from '../../examples/redaction-browser/server.mjs';
import { createActionRequestId } from '../../examples/redaction-browser/action-binding.mjs';
import { redactionActor } from '../../examples/redaction/app.mjs';
const actor = redactionActor(), encoder = new TextEncoder();
async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'redaction-browser-runtime-'));
  const runtime = await openRedactionBrowser({ directory, ...options });
  t.after(async () => { await runtime.close(); rmSync(directory, { recursive: true, force: true }); });
  const config = await runtime.configuration(actor);
  return { r: runtime, directory, config, first: config.consultations?.[0], second: config.consultations?.[1] };
}
const read = (client, target) => client.read({ target, revision: { kind: 'latest' } });
async function save(r, target, text = 'Saved fictional notes 🌞', operationId = 'notes-save', id = 'first') {
  const client = r.resourceClient(id, 'notes', actor), current = await read(client, target);
  const result = await client.publish({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: current.snapshot.ref, bytes: encoder.encode(text), mediaType: 'text/markdown' }] });
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  return { source: result.receipt.changes[0].after, saveOperationId: operationId };
}
const tasks = async app => (await app.local.harness.inspect(context)).tasks.map(item => item.record.id).sort((a, b) => a - b);
async function proposal(r, first, requestId = 'generation') {
  const saved = await save(r, first.notesTarget, undefined, `save-${requestId}`);
  const capture = await r.capture('first', { subject: 'A', requestId, ...saved }, actor);
  assert.equal(capture.kind, 'captured', JSON.stringify(capture));
  const admitted = await r.admit('first', capture.request, actor);
  assert.equal(admitted.kind, 'admitted', JSON.stringify(admitted));
  await r.local.apps.first.local.harness.waitForTask(admitted.ref.delivery, context);
  const view = await r.view('first', admitted.ref, actor);
  assert.equal(view.kind, 'ready', JSON.stringify(view));
  return { request: capture.request, ref: admitted.ref, view };
}

test('acknowledged source binds generation and read-only reload observes original native tasks', async t => {
  const { r, first, second } = await fixture(t);
  const saved = await save(r, first.notesTarget);
  assert.equal((await r.capture('first', { subject: 'A', requestId: 'fake', ...saved, saveOperationId: 'not-a-save' }, actor)).kind, 'unavailable');
  assert.equal((await r.capture('second', { subject: 'A', requestId: 'cross', ...saved }, actor)).kind, 'unavailable');
  assert.deepEqual(await tasks(r.local.apps.first), []);
  const captured = await r.capture('first', { subject: 'A', requestId: 'original', ...saved }, actor);
  assert.equal(captured.kind, 'captured');
  assert.deepEqual(captured.request.source, saved.source);
  const admitted = await r.admit('first', captured.request, actor);
  await r.local.apps.first.local.harness.waitForTask(admitted.ref.delivery, context);
  const before = await tasks(r.local.apps.first);
  const latest = await r.latest('first', 'A', actor);
  assert.equal(latest.kind, 'admitted'); assert.deepEqual(latest.request, captured.request); assert.deepEqual(latest.ref, admitted.ref);
  assert.deepEqual(await tasks(r.local.apps.first), before);
  assert.equal((await r.latest('second', 'A', actor)).kind, 'missing');
  assert.equal((await r.latest('first', 'A', redactionActor({ principalId: 'fictional-editor-2' }))).kind, 'denied');
  assert.equal((await r.view('second', admitted.ref, actor)).kind, 'denied');
  assert.notEqual(first.instanceId, second.instanceId);
});

test('capture refuses a newer source and retained admission refuses intervening publication', async t => {
  const { r, first } = await fixture(t), saved = await save(r, first.notesTarget);
  const captured = await r.capture('first', { subject: 'A', requestId: 'stale', ...saved }, actor);
  await save(r, first.notesTarget, 'Later saved notes', 'later-notes');
  assert.equal((await r.capture('first', { subject: 'B', requestId: 'new-capture', ...saved }, actor)).kind, 'conflict');
  assert.equal((await r.admit('first', captured.request, actor)).kind, 'conflict');
  assert.deepEqual(await tasks(r.local.apps.first), []);
});

test('restricted resources fence targets, preconditions, records, hooks and receipt lookup', async t => {
  const { r, first } = await fixture(t, { beforeDocumentPublish: ({ request, actor, target }) => { request.operationId = 'redirect'; actor.principalId = 'intruder'; target.resource.path = 'other'; } });
  const saved = await save(r, first.notesTarget), notes = r.resourceClient('first', 'notes', actor), letter = r.resourceClient('first', 'letter-A', actor);
  assert.equal((await letter.lookup(saved.saveOperationId)).kind, 'unknown');
  assert.equal((await notes.read({ target: first.letters.A, revision: { kind: 'latest' } })).kind, 'denied');
  const write = { operationId: 'bad', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: saved.source, bytes: encoder.encode('Bad'), mediaType: 'text/markdown' }] };
  assert.equal((await notes.publish({ ...write, preconditions: [{ kind: 'absent', target: first.records.A }] })).kind, 'denied');
  assert.equal((await r.resourceClient('first', 'record-A', actor).publish(write)).kind, 'denied');
  assert.equal((await notes.lookup('redirect')).kind, 'not-found');
  assert.throws(() => { first.notesTarget.resource.path = 'other'; }, TypeError);
});

test('actual resource reads and lookups recheck current policy after awaiting SQLite', async t => {
  let permission, allowed = true, calls = 0, at = 1;
  const { r, first } = await fixture(t, { policy: (_id, _actor, action) => {
    if (permission === action && ++calls === at) queueMicrotask(() => { allowed = false; });
    return allowed;
  } });
  const saved = await save(r, first.notesTarget), client = r.resourceClient('first', 'notes', actor);
  permission = 'read'; calls = 0;
  assert.equal((await read(client, first.notesTarget)).kind, 'denied');
  allowed = true; calls = 0; at = 2;
  const found = await client.lookup(saved.saveOperationId);
  assert.equal(found.kind, 'unknown'); assert.equal('receipt' in found, false);
});

test('lost document acknowledgement reconciles one original receipt and reopening preserves human content', async t => {
  let lose = true;
  const f = await fixture(t, { afterDocumentPublish: () => { if (lose) throw new Error('Lost ack'); } }), { r, first } = f;
  const client = r.resourceClient('first', 'notes', actor), before = await read(client, first.notesTarget);
  const request = { operationId: 'lost-save', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: before.snapshot.ref, bytes: encoder.encode('Human content'), mediaType: 'text/markdown' }] };
  assert.equal((await client.publish(request)).kind, 'unknown');
  lose = false; const found = await client.lookup('lost-save'); assert.equal(found.kind, 'committed');
  assert.deepEqual(await client.publish(request), found);
  await r.close(); const reopened = await openRedactionBrowser({ directory: f.directory }); t.after(() => reopened.close());
  const current = await read(reopened.resourceClient('first', 'notes', actor), first.notesTarget);
  assert.equal(new TextDecoder().decode(current.snapshot.bytes), 'Human content');
  assert.equal(current.snapshot.ref.revision, found.receipt.changes[0].after.revision);
});

test('displayed correction and record expectations fence adoption before admission', async t => {
  const { r, first } = await fixture(t), p = await proposal(r, first), itemId = p.view.catalog.source;
  const initial = p.view.corrections.find(item => item.itemId === itemId);
  assert.equal((await r.correct('first', { ref: p.ref, options: { requestId: 'c1', itemId, expected: initial.expected, text: 'C1 displayed' } }, actor)).kind, 'committed');
  const shown = await r.view('first', p.ref, actor), slot = shown.corrections.find(item => item.itemId === itemId);
  const input = { ref: p.ref, choices: [{ itemId, kind: 'corrected' }], requestId: 'adoption', letter: { kind: 'absent', target: first.letters.A }, record: { kind: 'absent', target: first.records.A }, corrections: [{ itemId, expected: slot.expected }] };
  assert.equal((await r.correct('first', { ref: p.ref, options: { requestId: 'c2', itemId, expected: slot.expected, text: 'C2 concurrent' } }, actor)).kind, 'committed');
  const count = await tasks(r.local.apps.first);
  assert.equal((await r.captureAdoption('first', input, actor)).kind, 'conflict'); assert.deepEqual(await tasks(r.local.apps.first), count);
  const current = await r.view('first', p.ref, actor); input.corrections = [{ itemId, expected: current.corrections.find(item => item.itemId === itemId).expected }];
  const captured = await r.captureAdoption('first', input, actor); assert.equal(captured.kind, 'captured');
  const admitted = await r.adopt('first', captured.request, actor); assert.equal(admitted.kind, 'admitted');
  await r.local.apps.first.local.harness.waitForTask(admitted.ref.taskId, context);
  const result = await r.adoptionResult('first', admitted.ref, actor); assert.equal(result.kind, 'committed'); assert.equal(result.receipt.changes.length, 2);
  assert.equal((await r.captureAdoption('first', { ...input, requestId: 'stale-record' }, actor)).kind, 'conflict');
  const letter = await read(r.resourceClient('first', 'letter-A', actor), first.letters.A);
  assert.match(new TextDecoder().decode(letter.snapshot.bytes), /C2 concurrent/);
});

test('transcription captures arguments and never writes, including failed retry, revocation and cancellation', async t => {
  let resolve, authorized = true, calls = 0;
  const { r } = await fixture(t, { policy: () => authorized, transcribe: input => { calls++; input.actor.principalId = 'mutated'; return new Promise(done => { resolve = done; }); } });
  const input = { requestId: 'dictation', recordingId: 'recording' }, pending = r.transcribe('first', input, actor);
  input.recordingId = 'changed'; resolve('Fictional 🌞');
  const result = await pending; assert.equal(result.recordingId, 'recording'); assert.equal(result.kind, 'transcribed');
  const denied = r.transcribe('first', { requestId: 'dictation', recordingId: 'recording' }, actor); authorized = false; resolve('Private result');
  assert.equal((await denied).kind, 'denied'); authorized = true;
  const controller = new AbortController(), cancelled = r.transcribe('first', { requestId: 'dictation', recordingId: 'recording' }, actor, controller.signal); controller.abort(); resolve('Late result');
  assert.equal((await cancelled).kind, 'denied'); assert.equal(calls, 3);
  assert.deepEqual(await tasks(r.local.apps.first), []);
});

test('Fetch handler binds actor and owner, accepts ResourceAccess signals and rejects extra fields', async t => {
  const { r, first } = await fixture(t), origin = 'http://fictional.test', handler = createRedactionBrowserHandler({ runtime: r, getOrigin: () => origin });
  const post = (path, body, headers = {}) => handler(new Request(origin + path, { method: 'POST', headers: { authorization: 'Bearer fictional-redaction', origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
  assert.equal((await post('/configuration', {}, { origin: 'http://foreign.test' })).status, 403);
  assert.equal((await post('/consultations/first/transcribe', { requestId: 'dictate', recordingId: 'clip', actor })).status, 400);
  const client = createResourceClient({ endpoint: origin + '/consultations/first/notes', identity: actor, publication: true, reconciliation: true, fetch: request => { const headers = new Headers(request.headers); headers.set('authorization', 'Bearer fictional-redaction'); headers.set('origin', origin); return handler(new Request(request, { headers })); } });
  const current = await read(client, first.notesTarget); assert.equal(current.kind, 'available', JSON.stringify(current));
  const result = await client.publish({ operationId: 'http-save', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: current.snapshot.ref, bytes: encoder.encode('HTTP fictional notes'), mediaType: 'text/markdown' }] });
  assert.equal(result.kind, 'committed', JSON.stringify(result));
  assert.equal((await post('/consultations/first/latest', { subject: 'A', actor })).status, 400);
});

for (const boundary of ['reservation', 'admission']) test(`SIGKILL ${boundary}: latest observes retained state without admitting tasks`, { timeout: 20000 }, async t => {
  const { spawn } = await import('node:child_process'), { once } = await import('node:events'), { readFile, access } = await import('node:fs/promises');
  const directory = mkdtempSync(join(tmpdir(), 'redaction-browser-crash-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [new URL('../fixtures/redaction-browser-crash-child.mjs', import.meta.url).pathname, directory, boundary], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; child.stderr.on('data', data => { errors += data; }); const exited = once(child, 'exit'); t.after(() => child.kill('SIGKILL'));
  const deadline = Date.now() + 10000;
  while (true) { try { await access(join(directory, 'ready.json')); break; } catch { assert.equal(child.exitCode, null, errors); assert.ok(Date.now() < deadline, errors); await new Promise(resolve => setTimeout(resolve, 10)); } }
  child.kill('SIGKILL'); assert.deepEqual(await exited, [null, 'SIGKILL']);
  const producing = Promise.withResolvers();
  const runtime = await openRedactionBrowser({ directory, fixtureOptions: () => ({ beforeProduce: () => producing.promise }) });
  t.after(async () => { producing.resolve(); await runtime.close(); });
  const original = JSON.parse(await readFile(join(directory, 'request.json'), 'utf8'));
  const before = await tasks(runtime.local.apps.first), latest = await runtime.latest('first', 'A', actor);
  assert.equal(latest.kind, boundary === 'reservation' ? 'reserved' : 'admitted');
  assert.deepEqual(latest.request, original);
  assert.deepEqual(await tasks(runtime.local.apps.first), before);
  if (boundary === 'reservation') assert.deepEqual(before, []);
  producing.resolve();
  const admitted = await runtime.admit('first', original, actor); assert.equal(admitted.kind, 'admitted');
  if (boundary === 'admission') assert.deepEqual(admitted.ref, latest.ref);
  await runtime.local.apps.first.local.harness.waitForTask(admitted.ref.delivery, context);
  const after = await tasks(runtime.local.apps.first);
  assert.deepEqual((await runtime.admit('first', original, actor)).ref, admitted.ref);
  assert.deepEqual(await tasks(runtime.local.apps.first), after);
});


test('HTTP request identity binds exact correction and adoption semantics before effects', async t => {
  const { r, first } = await fixture(t), p = await proposal(r, first), origin = 'http://fictional.test';
  const handler = createRedactionBrowserHandler({ runtime: r, getOrigin: () => origin });
  const post = (route, value) => handler(new Request(`${origin}/consultations/first/${route}`, { method: 'POST', headers: { authorization: 'Bearer fictional-redaction', origin, 'content-type': 'application/json' }, body: JSON.stringify(value) }));
  const itemId = p.view.catalog.source, slot = p.view.corrections.find(item => item.itemId === itemId);
  const payload = { ref: p.ref, options: { itemId, expected: slot.expected, text: 'Explicitly reviewed correction' } };
  const requestId = await createActionRequestId('correct', 'first', actor, payload);
  const correction = { ref: p.ref, options: { ...payload.options, requestId } };
  assert.equal((await post('correct', { ...correction, options: { ...correction.options, text: 'Substituted valid text' } })).status, 400);
  const other = p.view.corrections.find(item => item.itemId === p.view.catalog.calculation);
  assert.equal((await post('correct', { ...correction, options: { ...correction.options, itemId: other.itemId, expected: other.expected } })).status, 400);
  assert.equal((await r.view('first', p.ref, actor)).corrections.find(item => item.itemId === itemId).value, null);
  assert.equal((await (await post('correct', correction)).json()).kind, 'committed');
  const shown = await r.view('first', p.ref, actor), expectedCorrection = shown.corrections.find(item => item.itemId === itemId).expected;
  const adoptionPayload = { ref: p.ref, choices: [{ itemId, kind: 'corrected' }], letter: { kind: 'absent', target: first.letters.A }, record: { kind: 'absent', target: first.records.A }, corrections: [{ itemId, expected: expectedCorrection }] };
  const adoptionId = await createActionRequestId('adopt', 'first', actor, adoptionPayload);
  const before = await tasks(r.local.apps.first);
  assert.equal((await post('capture-adoption', { ...adoptionPayload, requestId: adoptionId, choices: [{ itemId, kind: 'proposed' }] })).status, 400);
  const captured = await (await post('capture-adoption', { ...adoptionPayload, requestId: adoptionId })).json();
  assert.equal(captured.kind, 'captured', JSON.stringify(captured));
  assert.equal((await post('adopt', { ...captured.request, choices: [{ itemId, kind: 'proposed' }] })).status, 400);
  assert.deepEqual(await tasks(r.local.apps.first), before);
  assert.equal((await read(r.resourceClient('first', 'record-A', actor), first.records.A)).kind, 'missing');
  const adopted = await (await post('adopt', captured.request)).json(); assert.equal(adopted.kind, 'admitted', JSON.stringify(adopted));
  await r.local.apps.first.local.harness.waitForTask(adopted.ref.taskId, context);
  const result = await (await post('adoption-result', adopted.ref)).json(); assert.equal(result.kind, 'committed');
  const saved = await read(r.resourceClient('first', 'record-A', actor), first.records.A);
  assert.equal(JSON.parse(new TextDecoder().decode(saved.snapshot.bytes)).items[0].text, payload.options.text);
});
