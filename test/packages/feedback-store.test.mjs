import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FEEDBACK_ID, parseFeedback, subjectKeyOf } from '@hachej/boring-feedback/format';
import { FEEDBACK_LIST_LIMIT, FEEDBACK_PAGE_SIZE, createFeedbackStore, feedbackId, feedbackMentionReader } from '@hachej/boring-feedback/store';
import { createVirtualWorkspace } from '@hachej/boring-execution/virtual';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { FileError, err } from '@earendil-works/pi-durable/env';
import { Harness, MemoryStorage, ToolResultEntry, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { createWriteTool } from '@earendil-works/pi-durable/tools';
import { admitDocumentTool } from '../fixtures/native-document.mjs';
import { openWorkspaceResources } from '../fixtures/feedback-workspace.mjs';

// Fictional data only: the Northwind console, Ada, Bob and Eve do not exist.
const PROVIDER = 'feedback-store';
const ROOT = 'feedback/';
const DIGEST = `sha256:${'4f'.repeat(32)}`;
const published = { kind: 'published' };
const ada = { scopeId: 'fictional-project', principalId: 'p_fictional_ada', initiatorId: 'p_fictional_ada' };
const bob = { scopeId: 'fictional-project', principalId: 'p_fictional_bob', initiatorId: 'p_fictional_bob' };
const NAMES = { p_fictional_ada: 'Ada', p_fictional_bob: 'Bob' };
const hostOn = (app, route = '/settings/:section') => ({ kind: 'host', subject: { type: 'app-page', app, route, build: 'dev-4f2a' }, snapshot: 'app.dom@1', digest: DIGEST, policy: { version: 1, widened: [] } });
const pin = { kind: 'app.element@1', signals: { testId: 'save-settings', role: 'button', name: 'Save' }, snapshot: '<button data-testid="save-settings">Save</button>', box: [880, 612, 120, 36], fallback: 'the «Save» button' };
const future = { kind: 'pdf.rect@7', page: 3, rect: [1, 2, 3, 4], 'x-vendor': { tint: 'teal' }, fallback: 'page 3, the totals box' };
const draftOn = (app, said = 'This button should be green.') => ({ observed: hostOn(app), anchors: [pin], said });
const draft = draftOn('northwind-console');
const latest = path => ({ target: { resource: { providerId: PROVIDER, path }, view: published }, revision: { kind: 'latest' } });

/** A store over a fresh SQLite workspace (one file per report). `grants` maps a principal to the subject-key prefixes it may use;
 * `hooks.publish` wraps every publication so a test can interleave, lose replies or refuse; `hooks.listFolder` replaces the listing. */
async function fixture(t, { protection = 'protected', grants, now, hooks = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'boring-feedback-store-'));
  const resources = await openWorkspaceResources(join(dir, 'feedback.sqlite'), PROVIDER);
  t.after(() => { resources.close(); rmSync(dir, { recursive: true, force: true }); });
  const allowed = grants ?? new Map([[ada.principalId, new Set(['host:app-page:northwind-console:', 'other:'])], [bob.principalId, new Set(['host:app-page:northwind-console:'])]]);
  const calls = { publish: 0, lookup: 0, authorize: [] };
  const publish = async (request, access) => {
    calls.publish++;
    return hooks.publish ? hooks.publish(request, access, () => resources.publication.publish(request, access)) : resources.publication.publish(request, access);
  };
  const store = createFeedbackStore({
    providerId: PROVIDER, view: published, reader: resources, publisher: { publish },
    lookup: { lookup: async (id, access) => { calls.lookup++; return resources.reconciliation.lookup(id, access); } },
    listFolder: hooks.listFolder ?? resources.listFolder,
    capabilities: await resources.capabilities(latest(ROOT.slice(0, -1)).target, ada),
    root: ROOT, operationNamespace: 'fictional-feedback', resolveAccess: () => ada,
    authorizeSubject: (access, subject, permission) => { calls.authorize.push(permission); return [...(allowed.get(access.principalId) ?? [])].some(prefix => subject.key.startsWith(prefix)); },
    displayName: principalId => NAMES[principalId] ?? '', protection, ...(now ? { now } : {}),
  });
  return { store, resources, calls, grants: allowed };
}
let counter = 0;
const operation = (store, action, args, access, id = `draft-${++counter}`) => ({ id, key: store.operationKey(action, args, access) });
const create = (store, value, access = ada, id) => store.create(value, access, operation(store, 'create', value, access, id));
const resolve = (store, id, expectedRevision, note, access = ada, opId) => store.resolve(id, { expectedRevision, note }, access, operation(store, 'resolve', { id, expectedRevision, note }, access, opId));
/** The report files in the root folder: there is nothing else to look at. */
const reportsIn = async resources => (await resources.listFolder(ROOT)).map(name => name.slice(0, -'.md'.length));
const clock = (start = Date.parse('2026-10-05T14:00:00Z')) => { let at = start; return () => new Date(at += 1000); };
const capabilities = { guarantees: { pinnedReads: true, conditionalPublication: true, atomicMutationAndReceipt: true, atomicBatch: true, operationLookup: true, revocationFencing: false } };
const noop = async () => { throw new Error('not called'); };
const options = (overrides = {}) => ({
  providerId: PROVIDER, view: published, reader: { read: noop }, publisher: { publish: noop }, lookup: { lookup: noop }, listFolder: noop, capabilities, root: ROOT,
  operationNamespace: 'fictional-feedback', resolveAccess: () => ada, authorizeSubject: () => true, displayName: () => 'Ada', protection: 'protected', ...overrides,
});

test('the store refuses to start without conditional publication, operation lookup, atomic receipts or an explicit protection', () => {
  for (const flag of ['conditionalPublication', 'operationLookup', 'atomicMutationAndReceipt']) {
    assert.throws(() => createFeedbackStore(options({ capabilities: { guarantees: { ...capabilities.guarantees, [flag]: false } } })), /conditionalPublication, operationLookup and atomicMutationAndReceipt/);
  }
  assert.doesNotThrow(() => createFeedbackStore(options({ capabilities: { guarantees: { ...capabilities.guarantees, atomicBatch: false } } })), 'one file per change needs no batch');
  assert.throws(() => createFeedbackStore(options({ capabilities: undefined })), /conditionalPublication/);
  assert.throws(() => createFeedbackStore(options({ listFolder: undefined })), /listFolder/);
  assert.throws(() => createFeedbackStore(options({ protection: undefined })), /explicit protection/);
  assert.throws(() => createFeedbackStore(options({ protection: 'maybe' })), /explicit protection/);
  assert.throws(() => createFeedbackStore(options({ root: '/abs/' })), /root/);
  assert.throws(() => createFeedbackStore(options({ root: 'feedback' })), /root/);
  assert.throws(() => createFeedbackStore(options({ operationNamespace: '' })), /namespace/);
  assert.throws(() => createFeedbackStore(options({ authorizeSubject: undefined })), /authorizeSubject/);
  assert.deepEqual(createFeedbackStore(options()).guarantees(), { protection: 'protected' });
  assert.deepEqual(createFeedbackStore(options({ protection: 'unprotected' })).guarantees(), { protection: 'unprotected' });
});

test('ids come from the platform source in the feedback@1 alphabet', () => {
  const ids = new Set(Array.from({ length: 500 }, feedbackId));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, FEEDBACK_ID);
});

test('create derives the author from access, publishes the report as one file, and read and list return it', async t => {
  const { store, resources, calls } = await fixture(t);
  const created = await create(store, draft);
  assert.equal(created.kind, 'applied');
  assert.match(created.report.id, FEEDBACK_ID);
  assert.deepEqual(created.report.author, { principalId: ada.principalId, display: 'Ada' });
  assert.equal(created.operationId, JSON.stringify(['fictional-feedback', `draft-${counter}`]));
  assert.ok(calls.authorize.includes('annotate'));
  const receipt = await resources.reconciliation.lookup(created.operationId, ada);
  assert.deepEqual(receipt.receipt.changes.map(change => [change.kind, change.after.resource.path]), [['create', `${ROOT}${created.report.id}.md`]], 'one single-file publication, no index');
  assert.deepEqual(await reportsIn(resources), [created.report.id]);
  const item = { id: created.report.id, path: `${ROOT}${created.report.id}.md`, status: 'open', subject: subjectKeyOf(draft.observed), created: created.report.created, title: 'This button should be green.', author: ada.principalId };
  const read = await store.read(created.report.id, ada);
  assert.deepEqual(read, { kind: 'available', report: created.report, revision: created.revision });
  const listed = await store.list({}, ada);
  assert.deepEqual(listed, { kind: 'available', items: [item], cursor: null, protection: 'protected' });
  assert.deepEqual(await store.read('fb_1111111111111111', ada), { kind: 'missing' });
  assert.deepEqual(await store.read('../notes', ada), { kind: 'missing' });
  const nameless = await create(store, draft, { ...ada, principalId: 'p_fictional_ada', initiatorId: 'p_fictional_agent' });
  assert.equal(nameless.kind, 'applied');
  assert.equal(nameless.report.author.principalId, ada.principalId, 'the principal, not the initiator, is the author');
});

test('a forged author is refused and nothing is stored', async t => {
  const { store, resources, calls } = await fixture(t);
  const forged = { ...draft, author: { principalId: bob.principalId, display: 'Bob' } };
  const result = await store.create(forged, ada, operation(store, 'create', forged, ada));
  assert.equal(result.kind, 'denied');
  assert.match(result.reason, /authorship comes from the host/);
  for (const extra of [{ id: 'fb_1111111111111111' }, { status: 'addressed' }, { created: '2020-01-01T00:00:00Z' }]) {
    assert.equal((await store.create({ ...draft, ...extra }, ada, operation(store, 'create', { ...draft, ...extra }, ada))).kind, 'denied');
  }
  assert.equal(calls.publish, 0);
  assert.deepEqual(await reportsIn(resources), []);
});

test('unknown anchor kinds and unknown observed kinds survive create, read, list and resolve', async t => {
  const { store, resources } = await fixture(t);
  const odd = { observed: { kind: 'recording@2', session: 'rec-fictional-7', 'x-vendor': { region: 'eu' } }, anchors: [pin, future], said: 'Totals box is wrong.' };
  const created = await create(store, odd);
  assert.equal(created.kind, 'applied');
  assert.deepEqual(created.report.anchors[1], future);
  assert.deepEqual(created.report.observed, odd.observed);
  const read = await store.read(created.report.id, ada);
  assert.deepEqual(read.report.anchors, [pin, future]);
  assert.deepEqual(read.report.observed, odd.observed);
  assert.deepEqual((await store.list({ subject: 'other:recording%402' }, ada)).items.map(item => item.id), [created.report.id]);
  const resolved = await resolve(store, created.report.id, created.revision, 'Fixed the totals.');
  assert.equal(resolved.kind, 'applied');
  assert.deepEqual(resolved.report.anchors, [pin, future]);
  assert.deepEqual(resolved.report.observed, odd.observed);
  assert.equal(resolved.report.status, 'addressed');
  const stored = await resources.read(latest(`${ROOT}${created.report.id}.md`), ada);
  assert.deepEqual(parseFeedback(stored.snapshot.bytes).report.anchors[1], future);
  const pinned = await resources.read({ target: latest(`${ROOT}${created.report.id}.md`).target, revision: { kind: 'exact', value: created.revision } }, ada);
  assert.deepEqual(parseFeedback(pinned.snapshot.bytes).report.anchors[1], future, 'the first stored version still carries the unknown kind');
});

test('concurrent creators all land: each report is its own file, so creators never contend', async t => {
  const { store, resources, calls } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 4 }, (_, n) => create(store, draftOn('northwind-console', `Concurrent note ${n}`))));
  assert.deepEqual(results.map(result => result.kind), Array(4).fill('applied'));
  assert.equal(calls.publish, results.length, 'one publication each, no retry');
  assert.deepEqual(new Set(await reportsIn(resources)), new Set(results.map(result => result.report.id)));
  for (const result of results) assert.equal((await store.read(result.report.id, ada)).kind, 'available');
});

test('competing resolutions: one applies, the other is a conflict with the current revision', async t => {
  const { store } = await fixture(t);
  const created = await create(store, draft);
  const [first, second] = await Promise.all([resolve(store, created.report.id, created.revision, 'Made it green.'), resolve(store, created.report.id, created.revision, 'Made it teal.', bob)]);
  const kinds = [first.kind, second.kind].sort();
  assert.deepEqual(kinds, ['applied', 'conflict']);
  const winner = first.kind === 'applied' ? first : second, loser = first.kind === 'applied' ? second : first;
  assert.equal(loser.current, winner.revision);
  const read = await store.read(created.report.id, ada);
  assert.equal(read.report.resolutions.length, 1);
  assert.equal(read.revision, winner.revision);
});

test('a lost reply after commit is reconciled by operation lookup without a duplicate note or report', async t => {
  let lose = false;
  const { store, resources, calls } = await fixture(t, { hooks: { publish: async (request, access, commit) => {
    const result = await commit();
    if (!lose) return result;
    lose = false;
    if (request.changes[0].kind === 'create') throw new Error('fictional connection reset');
    return { kind: 'unknown', operationId: request.operationId, reason: 'fictional timeout' };
  } } });
  lose = true;
  const createOp = operation(store, 'create', draft, ada);
  const created = await store.create(draft, ada, createOp);
  assert.equal(created.kind, 'applied');
  const replayedCreate = await store.create(draft, ada, createOp);
  assert.deepEqual(replayedCreate, created, 'a replay returns the original result');
  assert.equal((await reportsIn(resources)).length, 1, 'no duplicate report');

  lose = true;
  const resolveOp = operation(store, 'resolve', { id: created.report.id, expectedRevision: created.revision, note: 'Made it green.' }, ada);
  const resolved = await store.resolve(created.report.id, { expectedRevision: created.revision, note: 'Made it green.' }, ada, resolveOp);
  assert.equal(resolved.kind, 'applied');
  const publishes = calls.publish;
  const replayed = await store.resolve(created.report.id, { expectedRevision: created.revision, note: 'Made it green.' }, ada, resolveOp);
  assert.deepEqual(replayed, resolved);
  assert.equal(calls.publish, publishes, 'a reconciled replay publishes nothing');
  assert.deepEqual((await store.read(created.report.id, ada)).report.resolutions.map(item => item.note), ['Made it green.'], 'no duplicate note');

});

test('not-found after an uncertain outcome is unknown and is never retried as fresh within the call', async t => {
  let drop = true;
  const { store, resources, calls } = await fixture(t, { hooks: { publish: async (request, access, commit) => drop ? { kind: 'unknown', operationId: request.operationId, reason: 'fictional timeout' } : commit() } });
  const op = operation(store, 'create', draft, ada);
  const result = await store.create(draft, ada, op);
  assert.equal(result.kind, 'unknown');
  assert.equal(result.operationId, JSON.stringify(['fictional-feedback', op.id]));
  assert.match(result.reason, /No receipt/);
  assert.equal(calls.publish, 1);
  assert.deepEqual(await reportsIn(resources), []);
  // A later admission of the same operation looks it up first; with no receipt on an atomic provider it publishes once.
  drop = false;
  const later = await store.create(draft, ada, op);
  assert.equal(later.kind, 'applied');
  assert.equal((await reportsIn(resources)).length, 1);
});

test('replay with a different binding is unknown; an operation id reused for other arguments is a conflict', async t => {
  const { store, resources, calls } = await fixture(t);
  const op = operation(store, 'create', draft, ada);
  const created = await store.create(draft, ada, op);
  const rebound = await store.create(draft, { ...ada, initiatorId: 'p_fictional_agent' }, op);
  assert.equal(rebound.kind, 'unknown');
  assert.match(rebound.reason, /binding changed/);
  const otherArgs = draftOn('northwind-console', 'A different note');
  const reused = await store.create(otherArgs, ada, { id: op.id, key: store.operationKey('create', otherArgs, ada) });
  assert.equal(reused.kind, 'conflict');
  assert.equal((await reportsIn(resources)).length, 1);
  const resolveArgs = { id: created.report.id, expectedRevision: created.revision, note: 'Made it green.' };
  const resolveOp = operation(store, 'resolve', resolveArgs, ada);
  assert.equal((await store.resolve(created.report.id, resolveArgs, ada, resolveOp)).kind, 'applied');
  const before = calls.publish;
  const differentNote = { ...resolveArgs, note: 'Made it blue.' };
  assert.equal((await store.resolve(created.report.id, differentNote, ada, { id: resolveOp.id, key: store.operationKey('resolve', differentNote, ada) })).kind, 'conflict');
  assert.equal(calls.publish, before);
  assert.equal((await store.resolve(created.report.id, resolveArgs, ada, { id: '', key: resolveOp.key })).kind, 'denied');
});

test('a cross-scope subject is denied for create and read, and hidden from list', async t => {
  const grants = new Map([[ada.principalId, new Set(['host:app-page:northwind-console:', 'host:app-page:fabrikam-portal:'])], [bob.principalId, new Set(['host:app-page:northwind-console:'])]]);
  const { store, calls, resources } = await fixture(t, { grants });
  const refused = await create(store, draftOn('fabrikam-portal'), bob);
  assert.equal(refused.kind, 'denied');
  assert.equal(calls.publish, 0);
  assert.deepEqual(await reportsIn(resources), []);
  const theirs = await create(store, draftOn('fabrikam-portal', 'Fabrikam only'), ada);
  const shared = await create(store, draft, ada);
  assert.equal((await store.read(theirs.report.id, bob)).kind, 'denied');
  assert.deepEqual((await store.list({}, bob)).items.map(item => item.id), [shared.report.id]);
  assert.equal((await resolve(store, theirs.report.id, theirs.revision, 'Not mine.', bob)).kind, 'denied');
  assert.equal((await store.read(theirs.report.id, ada)).report.status, 'open');
});

test('after revocation list hides the item, read and the mention reader are denied, and a replay cannot reconcile', async t => {
  const { store, grants } = await fixture(t);
  const op = operation(store, 'create', draft, bob);
  const created = await store.create(draft, bob, op);
  assert.equal(created.kind, 'applied');
  const mentions = feedbackMentionReader(store, () => bob);
  const mentioned = await mentions(`${ROOT}${created.report.id}.md`);
  assert.deepEqual(parseFeedback(mentioned.bytes).report, created.report);
  assert.equal(mentioned.size, mentioned.bytes.length);
  assert.equal(await mentions(`${ROOT}README.md`), undefined);
  assert.equal(await mentions(`elsewhere/${created.report.id}.md`), undefined);
  assert.equal(await mentions(`${ROOT}../${created.report.id}.md`), undefined);

  grants.set(bob.principalId, new Set());
  assert.deepEqual((await store.list({}, bob)).items, []);
  assert.equal((await store.read(created.report.id, bob)).kind, 'denied');
  assert.equal(await mentions(`${ROOT}${created.report.id}.md`), undefined, 'the mention reader is denied for an unreadable subject');
  const replay = await store.create(draft, bob, op);
  assert.equal(replay.kind, 'unknown', 'a committed operation is never reported to a principal who lost the grant');
  assert.equal((await resolve(store, created.report.id, created.revision, 'Too late.', bob)).kind, 'denied');
  assert.equal((await store.read(created.report.id, ada)).kind, 'available');
});

test('list pages newest first, 50 at a time, with an opaque cursor, after status, subject and read filters', async t => {
  const grants = new Map([[ada.principalId, new Set(['host:app-page:'])], [bob.principalId, new Set(['host:app-page:northwind-console:'])]]);
  const { store } = await fixture(t, { grants, now: clock() });
  const ids = [];
  for (let n = 0; n < 125; n++) {
    const result = await create(store, draftOn(n % 5 === 0 ? 'fabrikam-portal' : 'northwind-console', `Note ${n}`));
    assert.equal(result.kind, 'applied');
    ids.push(result.report.id);
  }
  const pages = [];
  let cursor;
  do {
    const page = await store.list(cursor ? { cursor } : {}, ada);
    assert.equal(page.kind, 'available');
    pages.push(page.items.map(item => item.id));
    cursor = page.cursor;
  } while (cursor);
  assert.deepEqual(pages.map(page => page.length), [FEEDBACK_PAGE_SIZE, FEEDBACK_PAGE_SIZE, 25]);
  assert.deepEqual(pages.flat(), [...ids].reverse(), 'newest first across pages');
  const bobs = [];
  cursor = undefined;
  do { const page = await store.list(cursor ? { cursor } : {}, bob); bobs.push(...page.items.map(item => item.id)); cursor = page.cursor; } while (cursor);
  assert.deepEqual(bobs, ids.filter((_, n) => n % 5 !== 0).reverse(), 'read filtering does not break paging');
  const fabrikam = subjectKeyOf(hostOn('fabrikam-portal'));
  assert.deepEqual((await store.list({ subject: fabrikam }, ada)).items.map(item => item.id), ids.filter((_, n) => n % 5 === 0).reverse());
  const last = await store.read(ids.at(-1), ada);
  await resolve(store, ids.at(-1), last.revision, 'Done.');
  assert.deepEqual((await store.list({ status: 'addressed' }, ada)).items.map(item => item.id), [ids.at(-1)]);
  assert.deepEqual(await store.list({ cursor: 'not a cursor' }, ada), { kind: 'unavailable', reason: 'The cursor is not valid' });
});

test('list refuses an oversized folder, skips files that are not reports, and says when the store is unprotected', async t => {
  let names;
  const { store, resources } = await fixture(t, { protection: 'unprotected', hooks: { listFolder: async (folder, access) => names ?? resources.listFolder(folder, access) } });
  assert.equal((await store.list({}, ada)).protection, 'unprotected', 'an unprotected store says so in list');
  const kept = await create(store, draft);
  const junk = feedbackId();
  const written = await resources.publication.publish({ operationId: 'seed-junk', atomicity: 'all-or-nothing', changes: [{ kind: 'create', target: latest(`${ROOT}${junk}.md`).target, expected: { kind: 'absent' }, bytes: new TextEncoder().encode('not a report'), mediaType: 'text/markdown' }] }, ada);
  assert.equal(written.kind, 'committed');
  assert.deepEqual((await store.list({}, ada)).items.map(item => item.id), [kept.report.id], 'a file that is not a valid report is not listed');
  assert.equal((await store.read(junk, ada)).kind, 'unavailable');
  names = Array.from({ length: FEEDBACK_LIST_LIMIT + 1 }, () => `${feedbackId()}.md`);
  assert.deepEqual(await store.list({}, ada), { kind: 'unavailable', reason: `The feedback folder holds more than ${FEEDBACK_LIST_LIMIT} reports` });
  names = { kind: 'denied', reason: 'Listing is not authorized' };
  assert.deepEqual(await store.list({}, ada), names, 'a refused listing is returned as it is');
});

// FEEDBACK-1, root protection, bounded: the store declares `protected`, and a fixture working provider that enforces
// that declaration refuses the stock native `write` tool (a real ToolTask) under the root. Shell, Git and alias paths
// stay pending under BORING-PI-6; this fixture is not a provider qualification.
function protectedEnvironment(environment, store, rootPath) {
  const refused = path => store.guarantees().protection === 'protected' && (path === rootPath.replace(/\/$/, '') || path.startsWith(rootPath));
  const guarded = new Set(['writeFile', 'createDir', 'remove', 'rename', 'symlink', 'copyFile', 'chmod', 'truncate']);
  return new Proxy(environment, { get(target, name) {
    const value = Reflect.get(target, name, target);
    if (typeof value !== 'function') return value;
    if (!guarded.has(name)) return value.bind(target);
    return async (path, ...rest) => {
      const absolute = await target.absolutePath(path, context);
      if (!absolute.ok) return absolute;
      return refused(absolute.value) ? err(new FileError('permission_denied', 'The feedback root is protected', absolute.value)) : value.call(target, path, ...rest);
    };
  } });
}

for (const protection of ['protected', 'unprotected']) test(`a native file-tool write to the feedback root on a fixture provider: ${protection}`, { timeout: 15000 }, async t => {
  const { store } = await fixture(t, { protection });
  const workspace = createVirtualWorkspace({ providerId: 'fictional-working', files: { '/repo/notes.txt': 'fictional\n', '/repo/feedback/notes.md': '{}\n' } });
  t.after(() => workspace.dispose());
  const leases = [];
  const registry = createRegistry(); registry.install(defineExtension({ name: 'fictional.feedback-files', tools: [createWriteTool()] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels(), env: async () => {
    const lease = await workspace.acquire({ operationId: `fixture-${protection}`, input: { cwd: '/repo' } }, context); leases.push(lease);
    return protectedEnvironment(lease.environment, store, '/repo/feedback/');
  } }, context);
  t.after(async () => { await harness.close(context); for (const lease of leases) await lease.release(context); });
  const conversation = await harness.root(context);
  const run = async args => {
    const taskId = await admitDocumentTool(conversation, args, 'write');
    const terminal = await harness.waitForTask(taskId, context);
    const entry = (await conversation.commit(tx => tx.entry(ToolResultEntry, terminal.state.outcome.result.entryId), context)).model[0];
    return { status: terminal.state.outcome.status, ...entry };
  };
  const root = await run({ path: 'feedback/notes.md', content: '{"forged":true}' });
  const outside = await run({ path: 'notes.txt', content: 'still writable\n' });
  assert.equal(outside.isError, false);
  assert.equal(outside.status, 'completed');
  assert.equal((await workspace.createBash({ cwd: '/repo' }).exec('cat notes.txt')).stdout, 'still writable\n');
  const index = (await workspace.createBash({ cwd: '/repo' }).exec('cat feedback/notes.md')).stdout;
  if (protection === 'protected') {
    assert.equal(root.status, 'failed', 'the native tool fails; nothing is written');
    assert.equal(root.isError, true);
    assert.match(root.content[0].text, /protected/);
    assert.equal(index, '{}\n');
  } else {
    assert.equal(root.isError, false, 'an unprotected root is writable, which is why every surface must say so');
    assert.equal(index, '{"forged":true}');
    assert.equal((await store.list({}, ada)).protection, 'unprotected');
  }
});
