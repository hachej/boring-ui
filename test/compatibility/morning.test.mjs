import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openMorningRuntime } from '../../examples/morning/runtime.mjs';
import { morningIdentity as actor } from '../../examples/morning/documents.mjs';
import { privateCanaries, initialEmail, initialCalendar } from '../../examples/morning/fixtures.mjs';
const layout = { format: 'boring.experience', version: 1, name: 'morning', source: 'fixed', kinds: { 'boring/stack': 1 }, root: 'root', elements: { root: { type: 'boring/stack', props: { gap: 'medium' }, children: [] } } };
async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-morning-'));
  const runtime = await openMorningRuntime({ directory, layout, ...options });
  t.after(async () => { await runtime.close(); rmSync(directory, { recursive: true, force: true }); });
  const prepared = await runtime.prepare();
  for (const result of Object.values(prepared.results)) assert.equal(result.state.outcome.status, 'completed', JSON.stringify(result));
  return { runtime, directory, prepared };
}
const draft = runtime => runtime.draftClient(actor).read({ target: runtime.draftTarget, revision: { kind: 'latest' } });
const saveDraft = async (runtime, text, operationId = 'human-draft') => {
  const current = await draft(runtime);
  return runtime.draftClient(actor).publish({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: current.snapshot.ref, bytes: new TextEncoder().encode(text), mediaType: 'text/markdown' }] });
};

test('real native preparation creates parallel app tasks and a dependent merge without overwriting human edits', async t => {
  const { runtime: r, prepared } = await fixture(t);
  assert.equal(new Set(Object.values(prepared.ids)).size, 3);
  assert.equal(prepared.results.merge.input.email, prepared.ids.email);
  assert.equal(prepared.results.merge.input.calendar, prepared.ids.calendar);
  const todo = await r.todo.read(actor);
  assert.deepEqual(todo.document.items.map(item => item.id), ['reply', 'calendar']);
  const changed = await r.todo.setCompleted({ operationId: 'tick', expected: todo.revision, itemId: 'reply', completed: true }, actor);
  assert.equal(changed.kind, 'committed');
  await saveDraft(r, 'A human draft');
  const counts = { ...r.local.publicationCounts };
  await r.prepare();
  assert.deepEqual(r.local.publicationCounts, counts);
  assert.equal((await r.todo.read(actor)).document.items[0].completed, true);
  assert.equal(new TextDecoder().decode((await draft(r)).snapshot.bytes), 'A human draft');
});

test('send atomically queues the exact saved draft with original receipts on duplicates', async t => {
  const { runtime: r } = await fixture(t);
  const email = await r.email.read(actor), saved = await draft(r);
  const request = { operationId: 'send-one', expected: email.revision, draftRevision: saved.snapshot.ref.revision };
  const result = await r.email.send(request, actor);
  assert.equal(result.kind, 'committed'); assert.equal(result.receipt.changes.length, 2);
  const outbox = result.receipt.changes.find(change => change.after.resource.path.startsWith('outbox/')).after;
  const stored = await r.local.providers.email.read({ target: { resource: outbox.resource, view: outbox.view }, revision: { kind: 'latest' } }, actor);
  assert.equal(JSON.parse(new TextDecoder().decode(stored.snapshot.bytes)).text.includes(privateCanaries.draft), true);
  await saveDraft(r, 'Later draft');
  const replay = await r.email.send(request, actor);
  assert.deepEqual(replay, result);
  const changed = await r.email.send({ ...request, draftRevision: (await draft(r)).snapshot.ref.revision }, actor);
  assert.equal(changed.kind, 'conflict');
});

test('queued email refuses new send and snooze operations; exact saved Unicode survives send', async t => {
  let permitted = true;
  const { runtime: r } = await fixture(t, { authorize: () => permitted });
  const text = '\uFEFFHello 🌞';
  await saveDraft(r, text);
  const email = await r.email.read(actor), saved = await draft(r);
  const input = { operationId: 'unicode-send', expected: email.revision, draftRevision: saved.snapshot.ref.revision };
  const result = await r.email.send(input, actor);
  assert.equal(result.kind, 'committed');
  const outbox = result.receipt.changes[1].after;
  const stored = await r.local.providers.email.read({ target: outbox, revision: { kind: 'latest' } }, actor);
  assert.equal(JSON.parse(new TextDecoder().decode(stored.snapshot.bytes)).text, text);
  const queued = await r.email.read(actor), count = r.local.publicationCounts.email;
  assert.equal((await r.email.send({ ...input, operationId: 'second-send', expected: queued.revision }, actor)).kind, 'conflict');
  assert.equal((await r.email.snooze({ operationId: 'after-send', expected: queued.revision, option: 'later' }, actor)).kind, 'conflict');
  assert.equal(r.local.publicationCounts.email, count);
  permitted = false;
  assert.equal((await r.email.send(input, actor)).kind, 'unknown');
  assert.equal((await r.email.send({ ...input, operationId: 'never-attempted' }, actor)).kind, 'denied');
  assert.equal(r.canRead('email', actor), false);
  permitted = true;
  assert.equal(r.canRead('email', actor), true);
  assert.equal(r.canRead('unknown', actor), false);
  const client = r.draftClient(actor);
  assert.throws(() => { r.draftTarget.resource.path = 'email.json'; }, TypeError);
  assert.throws(() => { r.layoutTarget.view.kind = 'other'; }, TypeError);
  assert.equal((await client.read({ target: r.draftTarget, revision: { kind: 'latest' } })).kind, 'available');
});

test('merge derives completion from its exact authorized sources and preserves those references', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-derived-'));
  const r = await openMorningRuntime({ directory, layout });
  t.after(async () => { await r.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const [app, document] of [['email', { ...initialEmail(), status: 'queued' }], ['calendar', { ...initialCalendar(), selected: 'early' }]]) {
    const result = await r.local.providers[app].publication.publish({ operationId: `existing-${app}`, atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: { resource: { providerId: `morning-${app}`, path: `${app}.json` }, view: { kind: 'published' } }, expected: { kind: 'absent' }, bytes: new TextEncoder().encode(JSON.stringify(document)), mediaType: 'application/json' }] }, actor);
    assert.equal(result.kind, 'committed');
  }
  const prepared = await r.prepare(), result = prepared.results.merge.state.outcome.result;
  assert.deepEqual((await r.todo.read(actor)).document.items.map(item => item.completed), [true, true]);
  assert.equal(result.sources.email.revision, (await r.email.read(actor)).revision);
  assert.equal(result.sources.calendar.revision, (await r.calendar.read(actor)).revision);
  assert.deepEqual(result.links, { reply: 'email/reply', calendar: 'calendar/conflict' });
});

test('a draft edit during the send boundary prevents both email mutation and outbox creation', async t => {
  let runtime, raced = false;
  const f = await fixture(t, { beforePublish: async ({ request }) => {
    if (request.operationId === 'race-send') { raced = true; await saveDraft(runtime, 'Concurrent saved draft', 'race-draft'); }
  } }); runtime = f.runtime;
  const email = await runtime.email.read(actor), saved = await draft(runtime);
  const result = await runtime.email.send({ operationId: 'race-send', expected: email.revision, draftRevision: saved.snapshot.ref.revision }, actor);
  assert.ok(raced); assert.equal(result.kind, 'conflict');
  assert.equal((await runtime.email.read(actor)).revision, email.revision);
  const outbox = { resource: { providerId: 'morning-email', path: `outbox/${createHash('sha256').update('race-send').digest('hex')}.json` }, view: { kind: 'published' } };
  assert.equal((await runtime.local.providers.email.read({ target: outbox, revision: { kind: 'latest' } }, actor)).kind, 'missing');
});

test('concrete action owners reject injected routes and use current policy after hooks', async t => {
  let authorized = true;
  const { runtime: r } = await fixture(t, { authorize: () => authorized, beforePublish: ({ request, access }) => {
    if (request.operationId === 'revoke') authorized = false;
    request.operationId = 'hook-redirect'; access.principalId = 'hook-person';
  } });
  const calendar = await r.calendar.read(actor), before = { ...r.local.publicationCounts };
  assert.equal((await r.calendar.acceptSlot({ operationId: 'inject', expected: calendar.revision, optionId: 'early', app: 'email' }, actor)).kind, 'denied');
  assert.equal((await r.calendar.acceptSlot({ operationId: 'foreign', expected: calendar.revision, optionId: 'early' }, { ...actor, principalId: 'intruder' })).kind, 'denied');
  assert.deepEqual(r.local.publicationCounts, before);
  const result = await r.calendar.acceptSlot({ operationId: 'revoke', expected: calendar.revision, optionId: 'early' }, actor);
  assert.equal(result.kind, 'unknown'); assert.equal(result.operationId, 'revoke');
  authorized = true;
  assert.equal((await r.calendar.read(actor)).revision, calendar.revision);
  assert.equal((await r.calendar.lookup('hook-redirect', actor)).kind, 'not-found');
});

test('restricted resource clients cannot read, write, precondition or reveal another app document', async t => {
  const { runtime: r } = await fixture(t), client = r.draftClient(actor), email = await r.email.read(actor), saved = await draft(r);
  const result = await r.email.snooze({ operationId: 'snooze-private', expected: email.revision, option: 'later' }, actor);
  assert.equal(result.kind, 'committed');
  const emailTarget = { resource: { providerId: 'morning-email', path: 'email.json' }, view: { kind: 'published' } };
  assert.equal((await client.read({ target: emailTarget, revision: { kind: 'latest' } })).kind, 'denied');
  assert.equal((await client.lookup('snooze-private')).kind, 'unknown');
  assert.equal((await client.publish({ operationId: 'bad-precondition', atomicity: 'all-or-nothing', preconditions: [{ kind: 'absent', target: emailTarget }], changes: [{ kind: 'replace', target: saved.snapshot.ref, bytes: new TextEncoder().encode('No'), mediaType: 'text/markdown' }] })).kind, 'denied');
  assert.equal((await client.publish({ operationId: 'bad-target', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: result.receipt.changes[0].after, bytes: new TextEncoder().encode('No'), mediaType: 'text/markdown' }] })).kind, 'denied');
  assert.equal((await r.layoutClient(actor).read({ target: r.draftTarget, revision: { kind: 'latest' } })).kind, 'denied');
});

for (const app of ['email', 'layout']) test(`restricted ${app} client checks current access after SQLite reads and lookups`, async t => {
  let armed, permitted = true, calls = 0;
  const { runtime: r } = await fixture(t, { authorize: (selected, permission) => {
    if (selected === app && permission === armed?.permission && ++calls === armed.at) queueMicrotask(() => { permitted = false; });
    return permitted;
  } });
  const client = app === 'email' ? r.draftClient(actor) : r.layoutClient(actor);
  const target = app === 'email' ? r.draftTarget : r.layoutTarget;
  const original = await client.read({ target, revision: { kind: 'latest' } });
  assert.equal(original.kind, 'available');
  const operationId = `current-${app}`;
  const published = await client.publish({ operationId, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: original.snapshot.ref, bytes: original.snapshot.bytes, mediaType: original.snapshot.mediaType }] });
  assert.equal(published.kind, 'committed');
  armed = { permission: 'read', at: 1 }; calls = 0;
  const read = await client.read({ target, revision: { kind: 'latest' } });
  assert.equal(permitted, false);
  assert.equal(read.kind, 'denied');
  assert.equal('snapshot' in read, false);
  for (const at of [2, 3]) {
    permitted = true; armed = { permission: 'lookup', at }; calls = 0;
    const found = await client.lookup(operationId);
    assert.equal(permitted, false);
    assert.equal(found.kind, 'unknown');
    assert.equal(found.operationId, operationId);
    assert.equal('receipt' in found, false);
  }
});

test('native execute revocation at the publication boundary prevents effects despite retained write access', async t => {
  let execute = true;
  const { runtime: r } = await fixture(t, {
    authorize: (_app, permission) => permission !== 'execute' || execute,
    beforePublish: ({ request }) => { if (request.operationId.startsWith('["fictional.morning"')) execute = false; },
  });
  const before = await r.email.read(actor), count = r.local.publicationCounts.email;
  const result = await r.invokeTool('snooze_email', { expected: before.revision, option: 'later' }, actor);
  assert.equal(result.result.kind, 'unknown');
  assert.equal((await r.email.read(actor)).revision, before.revision);
  assert.equal(r.local.publicationCounts.email, count);
});

test('native acknowledgement and lookup exceptions preserve the original uncertain operation', async t => {
  let r, operationId;
  const f = await fixture(t, { afterPublish: ({ request }) => {
    if (request.operationId.startsWith('["fictional.morning"')) {
      operationId = request.operationId;
      r.local.providers.email.reconciliation.lookup = async () => { throw new Error('Unavailable receipt transport'); };
      throw new Error('Lost commit acknowledgement');
    }
  } }); r = f.runtime;
  const email = await r.email.read(actor);
  const result = await r.invokeTool('snooze_email', { expected: email.revision, option: 'later' }, actor);
  assert.equal(result.result.kind, 'unknown');
  assert.equal(result.result.operationId, operationId);
  assert.equal((await r.email.read(actor)).document.status, 'snoozed');
  assert.equal((await r.local.providers.email.workspace(actor.scopeId).reconciliation.lookup(operationId, actor)).kind, 'committed');
});

test('headless native actions use owner services and reconcile committed acknowledgement loss', async t => {
  let drop = false;
  const { runtime: r } = await fixture(t, { afterPublish: () => { if (drop) throw new Error('Lost fictional acknowledgement'); } });
  drop = true;
  const email = await r.email.read(actor);
  const snoozed = await r.invokeTool('snooze_email', { expected: email.revision, option: 'later' }, actor);
  assert.ok(snoozed.taskId); assert.equal(snoozed.result.kind, 'committed');
  assert.equal((await r.email.read(actor)).document.status, 'snoozed');
  const cal = await r.calendar.read(actor);
  const slot = await r.invokeTool('accept_calendar_slot', { expected: cal.revision, optionId: 'late' }, actor);
  assert.equal(slot.result.kind, 'committed'); assert.equal((await r.calendar.read(actor)).document.selected, 'late');
  const todo = await r.todo.read(actor);
  const tick = await r.invokeTool('complete_todo', { expected: todo.revision, itemId: 'reply', completed: true }, actor);
  assert.equal(tick.result.kind, 'committed'); assert.equal((await r.todo.read(actor)).document.items[0].completed, true);
  const foreign = await r.invokeTool('snooze_email', { expected: email.revision, option: 'later' }, { ...actor, scopeId: 'other' });
  assert.equal(foreign.taskId, null); assert.equal(foreign.result.kind, 'denied');
});

for (const mode of ['committed', 'newer', 'revoked', 'replaced', 'missing', 'prepare-committed', 'prepare-revoked', 'prepare-missing']) test(`native SIGKILL recovery preserves the original owning publication: ${mode}`, { timeout: 20000 }, async t => {
  const { readFile, access: exists } = await import('node:fs/promises');
  const { spawn } = await import('node:child_process'), { once } = await import('node:events');
  const directory = mkdtempSync(join(tmpdir(), 'fictional-morning-crash-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const child = phase => spawn(process.execPath, [new URL('../fixtures/morning-crash-child.mjs', import.meta.url).pathname, directory, phase, mode], { stdio: ['ignore', 'ignore', 'pipe'] });
  const holding = child('hold'); let errors = ''; holding.stderr.on('data', chunk => { errors += chunk; });
  const exited = once(holding, 'exit'); t.after(() => holding.kill('SIGKILL'));
  const deadline = Date.now() + 10000;
  while (true) {
    try { await exists(join(directory, 'ready.json')); break; }
    catch { assert.equal(holding.exitCode, null, errors); assert.ok(Date.now() < deadline, 'native publication did not reach the crash barrier'); await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  holding.kill('SIGKILL'); assert.deepEqual(await exited, [null, 'SIGKILL']);
  if (mode === 'replaced') for (const suffix of ['', '-wal', '-shm']) rmSync(join(directory, 'email.sqlite' + suffix), { force: true });
  const recovering = child('recover'); recovering.stderr.on('data', chunk => { errors += chunk; }); t.after(() => recovering.kill('SIGKILL'));
  assert.deepEqual(await once(recovering, 'exit'), [0, null], errors);
  const { result, receipt, saved } = JSON.parse(await readFile(join(directory, 'recovered.json'), 'utf8'));
  assert.equal(await readFile(join(directory, 'attempts'), 'utf8'), 'publish\n');
  if (mode.startsWith('prepare-')) {
    assert.equal(result.kind, mode === 'prepare-committed' ? 'committed' : 'unknown');
    assert.equal(receipt.kind, mode === 'prepare-missing' ? 'not-found' : 'committed');
    if (mode === 'prepare-committed') assert.deepEqual(result.receipt, receipt.receipt);
    assert.equal(saved.kind === 'missing', mode === 'prepare-missing');
    return;
  }
  if (mode === 'committed' || mode === 'newer') {
    assert.equal(result.kind, 'committed'); assert.deepEqual(result, receipt);
    assert.equal(result.receipt.changes.length, 2);
    assert.equal(saved.document.status, 'queued');
    if (mode === 'newer') assert.equal(saved.document.subject, 'Later human annotation');
    if (mode === 'newer') assert.notEqual(result.receipt.changes[0].after.revision, saved.revision);
  } else {
    assert.equal(result.kind, 'unknown');
    if (mode === 'revoked') { assert.equal(receipt.kind, 'committed'); assert.equal(saved.document.status, 'queued'); }
    if (mode === 'missing') { assert.equal(receipt.kind, 'not-found'); assert.equal(saved.document.status, 'pending'); }
    if (mode === 'replaced') { assert.equal(receipt.kind, 'not-found'); assert.equal(saved.kind, 'missing'); }
  }
});
