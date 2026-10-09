import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createResourceClient } from '@hachej/boring-files/remote';
import { openRedactionBrowser } from '../../examples/redaction-browser/runtime.mjs';
import { createRedactionBrowserHandler } from '../../examples/redaction-browser/server.mjs';
import { redactionActor } from '../../examples/redaction/app.mjs';
import { preparationTargets, parsePreparation } from '../../examples/redaction/preparation-schema.mjs';
import { preparationCanaries } from '../../examples/redaction/preparation-fixtures.mjs';
import { preparationLayout, fakePreparationEvaluator } from '../../examples/redaction-browser/preparation-composition.mjs';
const actor = redactionActor(), bytes = text => new TextEncoder().encode(text), json = value => bytes(JSON.stringify(value));
async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'preparation-runtime-')), runtime = await openRedactionBrowser({ directory, ...options });
  t.after(async () => { await runtime.close(); rmSync(directory, { recursive: true, force: true }); });
  const configuration = await runtime.configuration(actor), first = configuration.consultations[0], app = runtime.local.apps.first;
  const notes = runtime.resourceClient('first', 'notes', actor), read = await notes.read({ target: first.notesTarget, revision: { kind: 'latest' } });
  const saved = await notes.publish({ operationId: 'acknowledged-notes', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: read.snapshot.ref, bytes: bytes('FICTIONAL_PRIVATE_NOTES_392'), mediaType: 'text/markdown' }] });
  assert.equal(saved.kind, 'committed');
  const capture = async (requestId = 'first-preparation') => runtime.preparationCapture('first', { requestId, source: saved.receipt.changes[0].after, saveOperationId: saved.receipt.operationId }, actor);
  return { runtime, app, first, saved, capture, directory };
}
async function complete(f, id) {
  const captured = await f.capture(id); assert.equal(captured.kind, 'captured', JSON.stringify(captured));
  const admitted = await f.runtime.preparationAdmit('first', captured.request, actor); assert.equal(admitted.kind, 'admitted', JSON.stringify(admitted));
  const terminal = await f.app.local.harness.waitForTask(admitted.ref.delivery, context);
  const result = await f.runtime.preparationResult('first', admitted.ref, actor);
  return { captured, ref: admitted.ref, result, terminal };
}
async function replace(f, name, value, id) {
  const target = preparationTargets(f.app.instanceId)[name], provider = f.app.local.provider;
  const current = await provider.read({ target, revision: { kind: 'latest' } }, actor);
  return provider.publication.publish({ operationId: id, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: current.snapshot.ref, bytes: typeof value === 'string' ? bytes(value) : json(value), mediaType: name === 'notes' ? 'text/markdown' : 'application/json' }] }, actor);
}
const tasks = async app => (await app.local.harness.inspect(context)).tasks.map(item => item.record.id).sort((a, b) => a - b);

test('native preparation validates actual tool evidence and publishes typed JSON in the same Harness as ABC', async t => {
  const f = await fixture(t), prepared = await complete(f);
  assert.equal(prepared.result.kind, 'committed');
  const read = await f.app.preparation.read(actor), document = parsePreparation(JSON.parse(new TextDecoder().decode(read.snapshot.bytes)));
  assert.equal(document.cards.length, 12); assert.equal(document.requestId, prepared.ref.requestId);
  assert.deepEqual(document.sources.notes, f.saved.receipt.changes[0].after);
  assert.equal(document.header, preparationCanaries.header);
  const before = await tasks(f.app), latest = await f.runtime.preparationLatest('first', actor);
  assert.deepEqual(latest.ref, prepared.ref); assert.deepEqual(latest.request, prepared.captured.request); assert.deepEqual(await tasks(f.app), before);
  assert.deepEqual((await f.runtime.preparationAdmit('first', prepared.captured.request, actor)).ref, prepared.ref);
  const abc = await f.runtime.capture('first', { subject: 'A', requestId: 'independent-abc', source: f.saved.receipt.changes[0].after, saveOperationId: f.saved.receipt.operationId }, actor);
  const admitted = await f.runtime.admit('first', abc.request, actor); assert.equal(admitted.kind, 'admitted');
  await f.app.local.harness.waitForTask(admitted.ref.delivery, context); assert.equal((await f.runtime.view('first', admitted.ref, actor)).kind, 'ready');
  assert.equal((await f.runtime.preparationResult('second', prepared.ref, actor)).kind, 'denied');
  assert.equal((await f.app.preparation.latest(redactionActor({ principalId: 'fictional-editor-2' }))).kind, 'denied');
});

for (const scenario of ['missing-evidence', 'forged-evidence', 'malformed', 'incomplete', 'altered']) test(`invalid ${scenario} never publishes preparation`, async t => {
  const f = await fixture(t);
  assert.equal((await replace(f, 'config', { format: 'fictional.redaction.preparation-config', version: 1, scenario }, 'scenario')).kind, 'committed');
  const result = await complete(f); assert.equal(result.result.kind, 'invalid', JSON.stringify(result.result));
  assert.equal((await f.app.preparation.read(actor)).kind, 'missing');
});

for (const source of ['notes', 'dossier', 'config']) test(`changed ${source} blocks held native delivery`, async t => {
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const f = await fixture(t, { fixtureOptions: () => ({ preparation: { beforeProduce: () => { entered.resolve(); return gate.promise; } } }) }); t.after(() => gate.resolve());
  const captured = await f.capture(), admitted = await f.runtime.preparationAdmit('first', captured.request, actor); await entered.promise;
  const target = preparationTargets(f.app.instanceId)[source], read = await f.app.local.provider.read({ target, revision: { kind: 'latest' } }, actor);
  const value = source === 'notes' ? 'Later notes' : JSON.parse(new TextDecoder().decode(read.snapshot.bytes));
  if (source === 'dossier') value.synthesis = 'Later fictional source'; if (source === 'config') value.scenario = 'altered';
  await replace(f, source, value, 'later-source'); gate.resolve();
  await f.app.local.harness.waitForTask(admitted.ref.delivery, context);
  assert.equal((await f.runtime.preparationResult('first', admitted.ref, actor)).kind, 'conflict'); assert.equal((await f.app.preparation.read(actor)).kind, 'missing');
});

test('new preparation guard blocks the older result without suppressing the newer result', async t => {
  const gate = Promise.withResolvers();
  const f = await fixture(t, { fixtureOptions: () => ({ preparation: { beforeProduce: input => input.request.requestId === 'old' ? gate.promise : undefined } }) }); t.after(() => gate.resolve());
  const old = await f.capture('old'), admitted = await f.runtime.preparationAdmit('first', old.request, actor);
  const current = await complete(f, 'new'); assert.equal(current.result.kind, 'committed'); gate.resolve();
  await f.app.local.harness.waitForTask(admitted.ref.delivery, context);
  assert.equal((await f.runtime.preparationResult('first', admitted.ref, actor)).kind, 'conflict');
  assert.equal((await f.app.preparation.latest(actor)).ref.requestId, 'new');
});

test('publication hook revocation prevents output and receipt access is current after acknowledgement loss', async t => {
  let authorized = true;
  const f = await fixture(t, { policy: () => authorized, fixtureOptions: () => ({ preparation: { beforePublish: () => { authorized = false; } } }) });
  const captured = await f.capture(), admitted = await f.runtime.preparationAdmit('first', captured.request, actor);
  await f.app.local.harness.waitForTask(admitted.ref.delivery, context);
  assert.equal((await f.runtime.preparationResult('first', admitted.ref, actor)).kind, 'denied'); authorized = true;
  assert.equal((await f.app.preparation.read(actor)).kind, 'missing');
  assert.equal((await f.runtime.preparationResult('first', admitted.ref, actor)).kind, 'unknown');
});

test('compose uses only metadata, requires explicit evaluator and checks current preparation and processing permission', async t => {
  let external = true, readAllowed = true;
  const f = await fixture(t, { policy: (_id, _actor, action) => action === 'process-composition-metadata' ? external : action === 'read' ? readAllowed : true });
  await complete(f); const read = await f.app.preparation.read(actor), input = { preparation: read.snapshot.ref, descriptor: preparationLayout, trigger: 'request' };
  assert.equal((await f.runtime.preparationCompose('first', input, actor)).kind, 'unavailable');
  const captured = [], evaluate = async request => { captured.push(structuredClone(request)); return fakePreparationEvaluator(request); };
  const result = await f.runtime.preparationCompose('first', input, actor, { evaluation: { kind: 'fake', evaluate } });
  assert.equal(result.kind, 'composed', JSON.stringify(result)); assert.ok(result.snapshots.some(snapshot => snapshot.kind === 'final'));
  const observed = JSON.stringify([captured, result]);
  for (const canary of [...Object.values(preparationCanaries), 'FICTIONAL_PRIVATE_NOTES_392']) assert.equal(observed.includes(canary), false, canary);
  assert.equal(JSON.stringify(captured).includes(f.app.instanceId), false);
  assert.equal(JSON.stringify(result.snapshots).includes(f.app.instanceId), false);
  external = false; assert.equal((await f.runtime.preparationCompose('first', input, actor, { evaluation: { kind: 'jev', evaluate } })).kind, 'denied'); external = true;
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const held = f.runtime.preparationCompose('first', input, actor, { evaluation: { kind: 'fake', evaluate: async request => { entered.resolve(); await gate.promise; return fakePreparationEvaluator(request); } } });
  await entered.promise; readAllowed = false; gate.resolve(); assert.equal((await held).kind, 'denied');
});

test('new output during composition is a conflict and layout publication rejects private or incomplete descriptors', async t => {
  const f = await fixture(t); await complete(f); const read = await f.app.preparation.read(actor);
  const gate = Promise.withResolvers(), entered = Promise.withResolvers();
  const composing = f.runtime.preparationCompose('first', { preparation: read.snapshot.ref, descriptor: preparationLayout, trigger: 'phase' }, actor, { evaluation: { kind: 'fake', evaluate: async request => { entered.resolve(); await gate.promise; return fakePreparationEvaluator(request); } } });
  await entered.promise; await complete(f, 'later'); gate.resolve(); assert.equal((await composing).kind, 'conflict');
  const target = f.first.preparation.layoutTarget, client = f.runtime.resourceClient('first', 'preparation-layout', actor), saved = await client.read({ target, revision: { kind: 'latest' } });
  const request = document => ({ operationId: 'layout-save', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: saved.snapshot.ref, mediaType: 'application/json', bytes: json(document) }] });
  assert.equal((await client.publish(request({ ...preparationLayout, private: 'secret' }))).kind, 'denied');
  assert.equal((await f.runtime.resourceClient('first', 'preparation', actor).publish(request(preparationLayout))).kind, 'denied');
  assert.equal((await client.publish(request(preparationLayout))).kind, 'committed');
});

test('HTTP preparation routes use authenticated owner and exact source receipt with readonly output', async t => {
  const f = await fixture(t), origin = 'http://fictional.test', handler = createRedactionBrowserHandler({ runtime: f.runtime, getOrigin: () => origin, evaluation: { kind: 'fake', evaluate: fakePreparationEvaluator } });
  const transport = request => { const headers = new Headers(request.headers); headers.set('authorization', 'Bearer fictional-redaction'); headers.set('origin', origin); return handler(new Request(request, { headers })); };
  const post = (route, input) => transport(new Request(`${origin}/consultations/first/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }));
  assert.equal((await post('preparation-capture', { requestId: 'bad', source: f.saved.receipt.changes[0].after, saveOperationId: 'no-receipt', actor })).status, 400);
  const capture = await (await post('preparation-capture', { requestId: 'http', source: f.saved.receipt.changes[0].after, saveOperationId: f.saved.receipt.operationId })).json(); assert.equal(capture.kind, 'captured');
  const admitted = await (await post('preparation-admit', capture.request)).json(); assert.equal(admitted.kind, 'admitted');
  await f.app.local.harness.waitForTask(admitted.ref.delivery, context);
  assert.equal((await (await post('preparation-result', admitted.ref)).json()).kind, 'committed');
  const client = createResourceClient({ endpoint: `${origin}/consultations/first/preparation`, identity: actor, fetch: transport });
  assert.equal((await client.read({ target: f.first.preparation.outputTarget, revision: { kind: 'latest' } })).kind, 'available');
});

test('schema-valid foreign output is unavailable and lost lookup remains original-operation unknown', async t => {
  const f = await fixture(t), first = await complete(f);
  const output = await f.app.preparation.read(actor), document = JSON.parse(new TextDecoder().decode(output.snapshot.bytes));
  const foreign = f.runtime.local.apps.second.instanceId, targets = preparationTargets(foreign);
  const replacement = { ...document, instanceId: foreign, sources: Object.fromEntries(['notes', 'dossier', 'config'].map(name => [name, { ...targets[name], revision: 'foreign-revision' }])) };
  parsePreparation(replacement);
  await replace(f, 'output', replacement, 'foreign-output');
  assert.equal((await f.app.preparation.read(actor)).kind, 'unavailable');
  assert.equal((await f.runtime.resourceClient('first', 'preparation', actor).read({ target: f.first.preparation.outputTarget, revision: { kind: 'latest' } })).kind, 'unavailable');
  assert.equal((await f.runtime.preparationCompose('first', { preparation: output.snapshot.ref, descriptor: preparationLayout, trigger: 'request' }, actor, { evaluation: { kind: 'fake', evaluate: fakePreparationEvaluator } })).kind, 'unavailable');
  f.app.local.provider.reconciliation.lookup = async () => { throw new Error('Private provider failure'); };
  const result = await f.runtime.preparationResult('first', first.ref, actor);
  assert.equal(result.kind, 'unknown'); assert.equal(result.operationId, first.ref.operationId); assert.equal(JSON.stringify(result).includes('Private provider failure'), false);
});

for (const mode of ['reservation', 'admission', 'output', 'missing', 'revoked']) test(`SIGKILL preparation ${mode} preserves the original request and publication obligation`, { timeout: 20000 }, async t => {
  const { spawn } = await import('node:child_process'), { once } = await import('node:events'), { readFile, access, appendFile } = await import('node:fs/promises');
  const directory = mkdtempSync(join(tmpdir(), 'preparation-crash-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [new URL('../fixtures/redaction-preparation-crash-child.mjs', import.meta.url).pathname, directory, mode], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; child.stderr.on('data', data => { errors += data; }); const exited = once(child, 'exit'); t.after(() => child.kill('SIGKILL'));
  const deadline = Date.now() + 10000;
  while (true) { try { await access(join(directory, 'ready.json')); break; } catch { assert.equal(child.exitCode, null, errors); assert.ok(Date.now() < deadline, errors); await new Promise(resolve => setTimeout(resolve, 10)); } }
  child.kill('SIGKILL'); assert.deepEqual(await exited, [null, 'SIGKILL']);
  const gate = Promise.withResolvers();
  const runtime = await openRedactionBrowser({ directory, policy: () => mode !== 'revoked', fixtureOptions: () => ({ preparation: { beforeProduce: () => gate.promise, beforePublish: () => appendFile(join(directory, 'attempts'), 'attempt\n') } }) });
  t.after(async () => { gate.resolve(); await runtime.close(); });
  const request = JSON.parse(await readFile(join(directory, 'request.json'), 'utf8')), app = runtime.local.apps.first;
  const latest = await runtime.preparationLatest('first', actor);
  if (mode === 'revoked') {
    assert.equal(latest.kind, 'denied');
    const ref = JSON.parse(await readFile(join(directory, 'ref.json'), 'utf8'));
    const terminal = await app.local.harness.waitForTask(ref.delivery, context);
    assert.equal(terminal.state.outcome.result.kind, 'unknown');
    assert.equal((await app.local.provider.workspace(actor.scopeId).reconciliation.lookup(ref.operationId, actor)).kind, 'committed');
  } else {
    assert.equal(latest.kind, mode === 'reservation' ? 'reserved' : 'admitted', JSON.stringify(latest)); assert.deepEqual(latest.request, request);
    const before = await tasks(app); await runtime.preparationLatest('first', actor); assert.deepEqual(await tasks(app), before);
    gate.resolve();
    const admitted = await runtime.preparationAdmit('first', request, actor); assert.equal(admitted.kind, 'admitted');
    if (latest.ref) assert.deepEqual(admitted.ref, latest.ref);
    await app.local.harness.waitForTask(admitted.ref.delivery, context);
    const result = await runtime.preparationResult('first', admitted.ref, actor);
    assert.equal(result.kind, mode === 'missing' ? 'unknown' : 'committed', JSON.stringify(result));
    assert.equal((await app.preparation.read(actor)).kind, mode === 'missing' ? 'missing' : 'available');
    const done = await tasks(app); assert.deepEqual((await runtime.preparationAdmit('first', request, actor)).ref, admitted.ref); assert.deepEqual(await tasks(app), done);
  }
  assert.equal(await readFile(join(directory, 'attempts'), 'utf8'), 'attempt\n');
});


test('new native instance cannot alias an earlier delivery operation in the retained resource store', async t => {
  const f = await fixture(t), before = await complete(f, 'old-instance');
  assert.equal(before.result.kind, 'committed');
  await f.runtime.close();
  for (const suffix of ['', '-wal', '-shm']) rmSync(join(f.directory, 'first', `native.sqlite${suffix}`), { force: true });
  const runtime = await openRedactionBrowser({ directory: f.directory });
  try {
    const first = (await runtime.configuration(actor)).consultations[0], notes = runtime.resourceClient('first', 'notes', actor);
    assert.notEqual(first.instanceId, f.first.instanceId);
    const current = await notes.read({ target: first.notesTarget, revision: { kind: 'latest' } });
    const saved = await notes.publish({ operationId: 'new-instance-notes', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: current.snapshot.ref, bytes: bytes('Fictional new instance notes'), mediaType: 'text/markdown' }] });
    assert.equal(saved.kind, 'committed');
    const capture = await runtime.preparationCapture('first', { requestId: 'new-instance', source: saved.receipt.changes[0].after, saveOperationId: saved.receipt.operationId }, actor);
    assert.equal(capture.kind, 'captured');
    const admitted = await runtime.preparationAdmit('first', capture.request, actor);
    assert.equal(admitted.kind, 'admitted');
    assert.equal(admitted.ref.delivery, before.ref.delivery, 'Native task IDs can repeat across installations');
    assert.notEqual(admitted.ref.operationId, before.ref.operationId);
    await runtime.local.apps.first.local.harness.waitForTask(admitted.ref.delivery, context);
    assert.equal((await runtime.preparationResult('first', admitted.ref, actor)).kind, 'committed');
    assert.equal((await runtime.local.apps.first.preparation.read(actor)).kind, 'available');
    assert.equal((await runtime.preparationResult('first', before.ref, actor)).kind, 'denied');
  } finally { await runtime.close(); }
});

test('restricted layout reads refuse a privileged malformed shell without hiding independent notes', async t => {
  const f = await fixture(t), bad = structuredClone(preparationLayout);
  bad.elements.page.children.reverse();
  assert.equal((await replace(f, 'layout', bad, 'privileged-malformed-layout')).kind, 'committed');
  assert.equal((await f.runtime.resourceClient('first', 'preparation-layout', actor).read({ target: f.first.preparation.layoutTarget, revision: { kind: 'latest' } })).kind, 'unavailable');
  assert.equal((await f.runtime.resourceClient('first', 'notes', actor).read({ target: f.first.notesTarget, revision: { kind: 'latest' } })).kind, 'available');
});


test('concurrent retries acknowledge one native admission with the same retained IDs', async t => {
  const gate = Promise.withResolvers();
  const f = await fixture(t, { fixtureOptions: () => ({ preparation: { beforeProduce: () => gate.promise } }) });
  const captured = await f.capture('concurrent-admission'); assert.equal(captured.kind, 'captured');
  let results;
  try {
    results = await Promise.all(Array.from({ length: 12 }, () => f.runtime.preparationAdmit('first', captured.request, actor)));
    assert.deepEqual(results.map(result => result.kind), Array(12).fill('admitted'));
    for (const result of results) assert.deepEqual(result.ref, results[0].ref);
    const inspected = (await f.app.local.harness.inspect(context)).tasks.map(item => item.record);
    for (const name of ['produce', 'validate', 'deliver']) assert.equal(inspected.filter(task => task.kind === `fixture.redaction.preparation.${name}`).length, 1);
  } finally { gate.resolve(); }
  await f.app.local.harness.waitForTask(results[0].ref.delivery, context);
  assert.equal((await f.runtime.preparationResult('first', results[0].ref, actor)).kind, 'committed');
});
