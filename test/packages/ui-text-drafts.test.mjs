import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createTextBuffer } from '@hachej/boring-ui-kit/text-buffer';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { openTextDraftSqlite } from '../fixtures/text-draft-sqlite.mjs';

const identity = { principalId: 'fictional-editor', scopeId: 'fictional-project', initiatorId: 'fictional-alice' };
const target = { resource: { providerId: 'documents', path: 'note.txt' }, view: { kind: 'published' } };
const encode = text => new TextEncoder().encode(text);
const decode = snapshot => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot.bytes);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('editing during a held recovery read settles discovery instead of leaving controls checking', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  const buffer = f.buffer({ client: { ...f.client, read: async request => {
    const result = await f.client.read(request);
    entered.resolve(); await release.promise; return result;
  } } });
  const pending = buffer.checkDrafts();
  await entered.promise;
  assert.equal(buffer.getSnapshot().recovery.discovery.kind, 'checking');
  buffer.edit('Newer local content');
  release.resolve();
  assert.equal((await pending).kind, 'unavailable');
  assert.equal(buffer.getSnapshot().recovery.discovery.kind, 'unavailable');
  assert.equal(buffer.getSnapshot().text, 'Newer local content');
});

test('late storage acknowledgement cannot report an expired checkpoint as stored', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const f = await fixture(t);
  const entered = deferred(), release = deferred();
  let record;
  const store = { ...f.first.store, write: async draft => {
    record = draft;
    const result = await f.first.store.write(draft);
    assert.equal(result.kind, 'stored');
    entered.resolve();
    await release.promise;
    return result;
  } };
  const buffer = f.buffer({ drafts: f.binding(store, { retentionMs: 30 }) });
  buffer.edit('Fictional expiring checkpoint');
  const pending = buffer.checkpointDraft();
  await entered.promise;
  t.mock.timers.tick(31);
  release.resolve();
  assert.equal((await pending).kind, 'expired');
  assert.equal(buffer.getSnapshot().recovery.checkpoint.kind, 'failed');
  assert.equal(buffer.getSnapshot().recovery.checkpoint.result.kind, 'expired');
  assert.equal((await f.first.store.list(record.ref.key, 20)).drafts.length, 0);
  assert.equal(buffer.getSnapshot().text, 'Fictional expiring checkpoint');
});
async function fixture(t, initial = 'Saved fictional note') {
  const directory = await mkdtemp(join(tmpdir(), 'boring-text-drafts-'));
  const provider = openSqliteWorkspaces({ filename: join(directory, 'resources.db'), providerId: 'documents' });
  const sessions = [], buffers = [];
  const client = { read: value => provider.read(value, identity), publish: value => provider.publication.publish(value, identity), lookup: value => provider.reconciliation.lookup(value, identity) };
  const read = () => client.read({ target, revision: { kind: 'latest' } });
  if (initial !== null) assert.equal((await client.publish({ operationId: 'seed', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target, expected: { kind: 'absent' }, bytes: encode(initial), mediaType: 'text/plain' }] })).kind, 'committed');
  const source = initial === null ? { kind: 'new', target } : { kind: 'saved', snapshot: (await read()).snapshot };
  const session = options => { const result = openTextDraftSqlite({ filename: join(directory, 'drafts.db'), identity, ...options }); sessions.push(result); return result; };
  const first = session();
  const binding = (store = first.store, extra = {}) => ({ store, signal: first.signal, expiresAt: first.expiresAt, retentionMs: 3_600_000, providerInstanceId: 'fictional-instance', format: 'plain/v1', ...extra });
  const buffer = (extra = {}) => { const result = createTextBuffer({ identity, instanceId: 'editor-' + buffers.length, epoch: 'epoch', client, source, mediaType: 'text/plain', readText: decode, drafts: binding(), ...extra }); buffers.push(result); return result; };
  t.after(async () => { for (const value of buffers) value.dispose(); for (const value of sessions) value.close(); provider.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, client, source, first, session, binding, buffer, read };
}
async function offer(buffer) { const value = await buffer.checkDrafts(); assert.equal(value.kind, 'offered', JSON.stringify(value)); return value.choices[0].selection; }
async function seeded(t, initial) { const f = await fixture(t, initial); const old = f.buffer(); old.edit('\uFEFFUnfinished fictional 🚀\r\n'); const saved = await old.checkpointDraft(); assert.equal(saved.kind, 'stored'); old.dispose(); return { ...f, draft: saved.ref, text: '\uFEFFUnfinished fictional 🚀\r\n' }; }

test('drafts are opt-in and saved initialization performs no storage or publication', async t => {
  const f = await fixture(t); let calls = 0;
  const store = { list: async () => { calls++; throw Error(); }, write: async () => { calls++; throw Error(); }, remove: async () => { calls++; throw Error(); } };
  const normal = f.buffer({ drafts: undefined }); normal.edit('Local only');
  assert.equal(normal.getSnapshot().recovery.kind, 'disabled'); assert.equal((await normal.checkpointDraft()).kind, 'unavailable');
  const enabled = f.buffer({ drafts: f.binding(store) }); await Promise.resolve();
  assert.equal(calls, 0); assert.equal(enabled.getSnapshot().dirty, false); assert.equal(decode((await f.read()).snapshot), 'Saved fictional note');
});

test('actual SQLite reopen restores exact bytes only after choice and publishes only through flush', async t => {
  const f = await seeded(t); const next = f.session(); const buffer = f.buffer({ drafts: f.binding(next.store) });
  const choice = await offer(buffer); assert.equal(buffer.getSnapshot().dirty, false);
  assert.equal((await buffer.restoreDraft(choice)).kind, 'restored'); assert.equal(buffer.getSnapshot().text, f.text);
  assert.equal(decode((await f.read()).snapshot), 'Saved fictional note');
  assert.equal((await buffer.checkpointDraft()).kind, 'stored');
  const result = await buffer.flush(buffer.selection()); assert.equal(result.kind, 'saved');
  assert.equal((await f.client.lookup(result.receipt.operationId)).kind, 'committed');
  assert.equal(decode((await f.read()).snapshot), f.text);
  assert.deepEqual((await next.store.list(f.draft.key, 20)).drafts, []);
  assert.equal(buffer.getSnapshot().recovery.checkpoint.kind, 'idle');
});

test('empty new document recovers absence while nonempty local work refuses', async t => {
  const f = await seeded(t, null); const buffer = f.buffer();
  assert.equal((await buffer.restoreDraft(await offer(buffer))).kind, 'restored');
  assert.equal((await f.read()).kind, 'missing');
  const busy = f.buffer(); busy.edit('My separate work');
  assert.equal((await busy.restoreDraft(await offer(busy))).kind, 'conflict'); assert.equal(busy.getSnapshot().text, 'My separate work');
});

test('changed revision prevents restore and explicit discard affects only selected writer', async t => {
  const f = await seeded(t); const sibling = f.buffer(); sibling.edit('Another tab'); const siblingDraft = await sibling.checkpointDraft();
  const saved = await f.client.publish({ operationId: 'remote', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: f.source.snapshot.ref, bytes: encode('Remote revision'), mediaType: 'text/plain' }] }); assert.equal(saved.kind, 'committed');
  const buffer = f.buffer(); const choices = await buffer.checkDrafts(); assert.equal(choices.kind, 'offered');
  const chosen = choices.choices.find(choice => choice.selection.draft.writerId === f.draft.writerId);
  assert.equal(chosen.compatibility, 'conflict'); assert.equal((await buffer.restoreDraft(chosen.selection)).kind, 'conflict');
  assert.equal((await buffer.discardDraft(chosen.selection)).kind, 'discarded');
  const remaining = await f.first.store.list(f.draft.key, 20); assert.deepEqual(remaining.drafts.map(value => value.ref), [siblingDraft.ref]);
  assert.equal(buffer.getSnapshot().text, 'Saved fictional note');
});

for (const mode of ['edit', 'save', 'unknown', 'dispose', 'revoke']) test(`held recovery read refuses intervening ${mode}`, async t => {
  const f = await seeded(t); const gate = deferred(), started = deferred(); let hold = false;
  const buffer = f.buffer({ client: { ...f.client, read: async request => { if (hold) { started.resolve(); await gate.promise; } return f.client.read(request); }, publish: mode === 'unknown' ? async () => { throw Error('lost'); } : f.client.publish } });
  const choice = await offer(buffer); hold = true; const restored = buffer.restoreDraft(choice); await started.promise;
  let saving;
  if (mode === 'edit') buffer.edit('Later local text');
  if (mode === 'save' || mode === 'unknown') saving = buffer.flush(buffer.selection());
  if (mode === 'dispose') buffer.dispose();
  if (mode === 'revoke') await f.first.revoke();
  gate.resolve(); const result = await restored; assert.notEqual(result.kind, 'restored');
  if (saving) await saving;
  assert.notEqual(buffer.getSnapshot().text, f.text);
  if (mode === 'unknown') assert.equal(buffer.getSnapshot().save.result.kind, 'unknown');
});

test('validated save removes exactly V1 after disposal while V2 and another writer survive', async t => {
  const f = await fixture(t); const gate = deferred(), started = deferred();
  const buffer = f.buffer({ client: { ...f.client, publish: async request => { const outcome = await f.client.publish(request); started.resolve(); await gate.promise; return outcome; } } });
  buffer.edit('Version one'); const v1 = await buffer.checkpointDraft(); const save = buffer.flush(buffer.selection()); await started.promise;
  buffer.edit('Version two'); const v2 = await buffer.checkpointDraft();
  const other = f.buffer(); other.edit('Other tab'); const vOther = await other.checkpointDraft(); buffer.dispose(); gate.resolve(); assert.equal((await save).kind, 'saved');
  const rows = (await f.first.store.list(v1.ref.key, 20)).drafts;
  assert.deepEqual(new Set(rows.map(row => row.text)), new Set(['Version two', 'Other tab']));
  assert(rows.some(row => row.ref.sequence === v2.ref.sequence)); assert(rows.some(row => row.ref.writerId === vOther.ref.writerId));
});

test('deletion before the delayed checkpoint reaches SQLite prevents resurrection', async t => {
  const f = await fixture(t), gate = deferred(), started = deferred();
  const buffer = f.buffer({ drafts: f.binding({ ...f.first.store, write: async draft => { started.resolve(); await gate.promise; return f.first.store.write(draft); } }) });
  buffer.edit('Save before checkpoint'); await started.promise; const checkpoint = buffer.checkpointDraft(); const ref = buffer.getSnapshot().recovery.checkpoint.ref;
  assert.equal((await buffer.flush(buffer.selection())).kind, 'saved'); gate.resolve(); assert.equal((await checkpoint).kind, 'superseded');
  assert.deepEqual((await f.first.store.list(ref.key, 20)).drafts, []);
  assert.equal(buffer.getSnapshot().recovery.checkpoint.kind, 'idle');
});

test('late acknowledgement rebases a dirty remainder without losing its latest checkpoint', async t => {
  const f = await fixture(t), gate = deferred();
  const buffer = f.buffer({ client: { ...f.client, publish: async value => { const result = await f.client.publish(value); await gate.promise; return result; } } });
  buffer.edit('V1'); await buffer.checkpointDraft(); const saving = buffer.flush(buffer.selection()); buffer.edit('V2'); await buffer.checkpointDraft(); gate.resolve();
  const saved = await saving; const checkpoint = await buffer.checkpointDraft();
  assert.equal(checkpoint.kind, 'stored'); assert.equal(checkpoint.ref.base.target.revision, saved.ref.revision);
  const rows = (await f.first.store.list(checkpoint.ref.key, 20)).drafts; assert.equal(rows.length, 1); assert.equal(rows[0].text, 'V2');
});

test('session revocation fences a delayed write from another SQLite connection', async t => {
  const f = await fixture(t), otherSession = f.session(), gate = deferred(), started = deferred();
  const buffer = f.buffer({ drafts: f.binding({ ...otherSession.store, write: async draft => { started.resolve(); await gate.promise; return otherSession.store.write(draft); } }, { signal: otherSession.signal }) });
  buffer.edit('Must be purged'); const waiting = buffer.checkpointDraft(); await started.promise; const ref = buffer.getSnapshot().recovery.checkpoint.ref;
  await f.first.revoke(); gate.resolve(); assert.equal((await waiting).kind, 'denied');
  assert.equal((await otherSession.store.list(ref.key, 20)).kind, 'denied');
  const newLogin = f.session({ sessionId: 'new-login' }); assert.deepEqual((await newLogin.store.list(ref.key, 20)).drafts, []);
});

test('unknown publication and uncertain storage retain unfinished text', async t => {
  const f = await fixture(t); const buffer = f.buffer({ client: { ...f.client, publish: async () => { throw Error('lost'); } } });
  buffer.edit('Retained'); const checkpoint = await buffer.checkpointDraft(); assert.equal((await buffer.flush(buffer.selection())).kind, 'unknown');
  assert.equal((await f.first.store.list(checkpoint.ref.key, 20)).drafts[0].text, 'Retained');
  const broken = f.buffer({ drafts: f.binding({ ...f.first.store, write: async () => { throw Error('lost'); } }) });
  broken.edit('Still in memory'); assert.equal((await broken.checkpointDraft()).kind, 'unknown'); assert.equal(broken.getSnapshot().text, 'Still in memory');
  assert.equal((await broken.flush(broken.selection())).kind, 'saved');
});

for (const tamper of [draft => ({ ...draft, version: 2 }), draft => ({ ...draft, text: '\uD800' }), draft => ({ ...draft, ref: { ...draft.ref, key: { ...draft.ref.key, providerInstanceId: 'replacement' } } }), draft => ({ ...draft, ref: { ...draft.ref, key: { ...draft.ref.key, identity: { ...identity, principalId: 'another-person' } } } }), draft => ({ ...draft, ref: { ...draft.ref, key: { ...draft.ref.key, target: { ...target, view: { kind: 'working', viewId: 'another-view' } } } } })]) test('untrusted recovery records refuse foreign or malformed payload', async t => {
  const f = await seeded(t); const original = (await f.first.store.list(f.draft.key, 20)).drafts[0];
  const buffer = f.buffer({ drafts: f.binding({ ...f.first.store, list: async () => ({ kind: 'available', drafts: [tamper(original)], truncated: false }) }) });
  assert.equal((await buffer.checkDrafts()).kind, 'unavailable'); assert.equal(buffer.getSnapshot().dirty, false);
});

test('bounds, expiry, and validator rejection preserve the local document', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const f = await seeded(t);
  const bounded = f.buffer({ drafts: f.binding(f.first.store, { maxBytes: 2 }) }); assert.equal((await bounded.checkDrafts()).kind, 'unavailable');
  const structured = f.buffer({ drafts: f.binding(f.first.store, { validateText: () => { throw Error('Invalid domain'); } }) }); const choice = await offer(structured);
  assert.equal((await structured.restoreDraft(choice)).kind, 'unavailable'); assert.equal(structured.getSnapshot().text, 'Saved fictional note');
  const expiring = f.buffer({ drafts: f.binding(f.first.store, { expiresAt: Date.now() + 25 }) }); const expiringChoice = await offer(expiring);
  t.mock.timers.tick(26); assert.equal(expiring.getSnapshot().recovery.kind, 'expired'); assert.equal((await expiring.restoreDraft(expiringChoice)).kind, 'expired');
});

test('store transaction floors span bases, retries are exact, and listings are bounded', async t => {
  const f = await seeded(t), original = (await f.first.store.list(f.draft.key, 20)).drafts[0];
  assert.equal((await f.first.store.write(original)).kind, 'stored'); assert.equal((await f.first.store.write({ ...original, text: 'Different' })).kind, 'denied');
  const newer = { ...original, ref: { ...original.ref, sequence: original.ref.sequence + 1, base: { kind: 'revision', target: { ...target, revision: 'later' } } }, text: 'Later base' };
  assert.equal((await f.first.store.write(newer)).kind, 'stored'); assert.equal((await f.first.store.remove(original.ref)).kind, 'superseded'); assert.equal((await f.first.store.write(original)).kind, 'superseded');
  const second = { ...original, ref: { ...original.ref, writerId: 'second' } }; await f.first.store.write(second);
  const bounded = await f.first.store.list(original.ref.key, 1); assert.equal(bounded.drafts.length, 1); assert.equal(bounded.truncated, true);
});

test('acknowledged SQLite checkpoint survives SIGKILL and explicit reopen', async t => {
  const f = await fixture(t); const child = fork(new URL('../fixtures/text-draft-sqlite-crash-child.mjs', import.meta.url), [join(f.directory, 'drafts.db'), JSON.stringify(identity), JSON.stringify(f.source)], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const [message] = await once(child, 'message'); assert.equal(message.kind, 'stored'); const exited = once(child, 'exit'); child.kill('SIGKILL'); const [, signal] = await exited; assert.equal(signal, 'SIGKILL');
  const buffer = f.buffer(); assert.equal((await buffer.restoreDraft(await offer(buffer))).kind, 'restored'); assert.equal(buffer.getSnapshot().text, 'Fictional checkpoint before SIGKILL');
});

test('checkpoint result stays bound to its captured version during later typing', async t => {
  const f = await fixture(t), gate = deferred(), started = deferred(); let held = true;
  const buffer = f.buffer({ drafts: f.binding({ ...f.first.store, write: async draft => { if (held) { held = false; started.resolve(); await gate.promise; } return f.first.store.write(draft); } }) });
  buffer.edit('Earlier'); const first = buffer.checkpointDraft(); await started.promise;
  buffer.edit('Later'); const second = await buffer.checkpointDraft(); gate.resolve(); const result = await first;
  assert.equal(result.kind, 'superseded'); assert.equal(second.kind, 'stored');
  assert.equal((await f.first.store.list(second.ref.key, 20)).drafts[0].text, 'Later');
});

test('a pending clean save blocks restore even though its selection has not changed', async t => {
  const f = await seeded(t), gate = deferred(), started = deferred();
  const buffer = f.buffer({ client: { ...f.client, publish: async request => { started.resolve(); await gate.promise; return f.client.publish(request); } } });
  const choice = await offer(buffer), selection = buffer.selection(); const saving = buffer.flush(selection); await started.promise;
  assert.deepEqual(buffer.selection(), selection); assert.equal(buffer.getSnapshot().dirty, false);
  assert.equal((await buffer.restoreDraft(choice)).kind, 'conflict');
  gate.resolve(); assert.equal((await saving).kind, 'saved'); assert.equal(buffer.getSnapshot().text, 'Saved fictional note');
});

test('reentrant validator edit invalidates restoration before replaceText', async t => {
  const f = await seeded(t); let buffer, replacements = 0;
  buffer = f.buffer({ replaceText: () => { replacements++; }, drafts: f.binding(f.first.store, { validateText: () => buffer.edit('Intervening domain edit') }) });
  assert.equal((await buffer.restoreDraft(await offer(buffer))).kind, 'conflict');
  assert.equal(replacements, 0); assert.equal(buffer.getSnapshot().text, 'Intervening domain edit');
});

test('stale explicit discard and unavailable current read preserve stored work', async t => {
  const f = await seeded(t); let unavailable = false;
  const buffer = f.buffer({ client: { ...f.client, read: request => unavailable ? Promise.resolve({ kind: 'unavailable', reason: 'Offline' }) : f.client.read(request) } });
  const choice = await offer(buffer); buffer.edit('Separate local draft'); assert.equal((await buffer.discardDraft(choice)).kind, 'conflict');
  const next = f.buffer({ client: { ...f.client, read: request => unavailable ? Promise.resolve({ kind: 'unavailable', reason: 'Offline' }) : f.client.read(request) } });
  const nextChoice = await offer(next); unavailable = true; assert.equal((await next.discardDraft(nextChoice)).kind, 'unavailable');
  assert((await f.first.store.list(f.draft.key, 20)).drafts.some(draft => draft.ref.writerId === f.draft.writerId));
});

test('expired records are never offered, malformed publication keeps draft, lookup receipt clears exact draft', async t => {
  const f = await fixture(t); let real;
  const buffer = f.buffer({ client: { ...f.client, publish: async request => { real = await f.client.publish(request); return { kind: 'committed', receipt: { ...real.receipt, principalId: 'wrong' } }; } } });
  buffer.edit('Actual committed text'); const checkpoint = await buffer.checkpointDraft(); assert.equal((await buffer.flush(buffer.selection())).kind, 'unknown');
  assert.equal((await f.first.store.list(checkpoint.ref.key, 20)).drafts.length, 1); assert.equal((await buffer.reconcile()).kind, 'saved');
  assert.deepEqual((await f.first.store.list(checkpoint.ref.key, 20)).drafts, []);
  const expired = { version: 1, ref: checkpoint.ref, text: 'Expired fictional', createdAt: 1, expiresAt: 2 };
  const viewer = f.buffer({ drafts: f.binding({ ...f.first.store, list: async () => ({ kind: 'available', drafts: [expired], truncated: false }) }) });
  assert.equal((await viewer.checkDrafts()).kind, 'empty');
});

test('checkpoint expiry is visible and an explicit new checkpoint renews the version', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const f = await fixture(t); const buffer = f.buffer({ drafts: f.binding(f.first.store, { retentionMs: 20 }) });
  buffer.edit('Still local'); const first = await buffer.checkpointDraft();
  assert.equal(first.kind, 'stored');
  t.mock.timers.tick(21);
  assert.equal(buffer.getSnapshot().recovery.checkpoint.kind, 'failed'); assert.equal(buffer.getSnapshot().recovery.checkpoint.result.kind, 'expired');
  assert.deepEqual((await f.first.store.list(first.ref.key, 20)).drafts, []);
  const next = await buffer.checkpointDraft(); assert.equal(next.kind, 'stored'); assert(next.ref.sequence > first.ref.sequence); assert.equal(buffer.getSnapshot().text, 'Still local');
});
