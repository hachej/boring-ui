import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { fixtureActor, fixtureRequest, PRIVATE_MARKERS, openFixtureApp } from '../../examples/current-hub/app.mjs';
import { provisionFixtureDefinition } from '../../examples/current-hub/definition.mjs';
import { openFixtureCompanion } from '../../examples/current-hub/companion.mjs';
import { openFixtureChangePath } from '../../examples/current-hub/change-path.mjs';
import { admitDocumentTool, documentToolResult } from '../fixtures/native-document.mjs';
import { scanHubRetention } from '../fixtures/hub-retention.mjs';

const privateWords = 'FICTIONAL_PRIVATE_CHANGE_WORDS_5f18';
const gate = () => Promise.withResolvers();
const access = actor => ({ scopeId: actor.scopeId, principalId: actor.principalId,
  initiatorId: actor.initiatorId, authorizationRef: actor.installationId });
const tool = async (hub, appId, args) => (await documentToolResult(hub.harness, hub.conversation,
  await admitDocumentTool(hub.conversation, args, `request_change_${appId}`))).result;

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'boring-hub-handoff-'));
  const apps = {}, changePaths = {};
  for (const appId of ['amber', 'blue']) {
    const appDirectory = join(directory, appId);
    const definitionRef = await provisionFixtureDefinition({ directory: appDirectory, appId });
    apps[appId] = await openFixtureApp({ directory: appDirectory, appId, definitionRef });
    changePaths[appId] = await openFixtureChangePath({ directory: join(appDirectory, 'change-path'),
      app: apps[appId], ...(options[appId] ?? {}) });
  }
  const hubDirectory = join(directory, 'hub');
  const hub = await openFixtureCompanion({ directory: hubDirectory, apps, changePaths, ...(options.hub ?? {}) });
  t.after(async () => {
    await hub.close();
    for (const path of Object.values(changePaths)) await path.close();
    for (const app of Object.values(apps)) await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, hubDirectory, apps, changePaths, hub };
}

async function report(app, appId, requestId) {
  const admitted = await app.invoke(fixtureRequest(appId, requestId), fixtureActor(appId));
  assert.equal(admitted.kind, 'admitted');
  await app.local.harness.waitForTask(admitted.ref.delivery, context);
  return admitted.ref;
}

test('native handoff files one source-owned issue and retains only references in the hub', { timeout: 20000 }, async t => {
  const f = await fixture(t), actor = fixtureActor('amber');
  const contextRef = await report(f.apps.amber, 'amber', 'issue-context');
  const staged = await f.changePaths.amber.stage({ requestId: 'issue-one', text: privateWords }, actor);
  assert.equal(staged.kind, 'staged');
  const draft = await f.changePaths.amber.local.provider.read({ target: staged.source,
    revision: { kind: 'exact', value: staged.source.revision } }, access(actor));
  assert.equal(draft.kind, 'available');
  assert.deepEqual(draft.snapshot.bytes, new TextEncoder().encode(privateWords));
  const args = { requestId: 'issue-one', source: staged.source, context: contextRef };
  const filed = await tool(f.hub, 'amber', args);
  assert.equal(filed.kind, 'filed');
  assert.equal(filed.ref.appId, 'amber');
  assert.equal(filed.ref.repositoryId, 'fictional/amber');
  assert.equal(filed.ref.requestId, args.requestId);
  assert.equal(filed.ref.instanceId, f.apps.amber.identity.instanceId);
  assert.equal(filed.ref.principalId, actor.principalId);
  assert.equal(filed.ref.scopeId, actor.scopeId);
  assert.equal(filed.ref.issue.resource.providerId, 'amber-changes');
  assert.equal(JSON.stringify(filed).includes(privateWords), false);
  const result = await f.changePaths.amber.readIssue(filed.ref, actor);
  assert.equal(result.kind, 'observed'); assert.equal(result.status, 'open');
  assert.deepEqual(result.ref, filed.ref);
  const issue = await f.changePaths.amber.local.provider.read({ target: filed.ref.issue,
    revision: { kind: 'exact', value: filed.ref.issue.revision } }, access(actor));
  assert.equal(issue.kind, 'available');
  const payload = JSON.parse(new TextDecoder('utf-8', { ignoreBOM: true }).decode(issue.snapshot.bytes));
  assert.equal(payload.text, privateWords);
  assert.equal(payload.label, 'boring-factory:triage');
  assert.equal(payload.backlink, 'fictional-hub:reports');
  assert.deepEqual(payload.context, contextRef);
  const receipt = await f.changePaths.amber.local.provider.reconciliation.lookup(filed.ref.operationId, access(actor));
  assert.equal(receipt.kind, 'committed');
  assert.equal(receipt.receipt.evidenceRef, filed.ref.evidenceRef);
  assert.deepEqual(receipt.receipt.changes[0].after, filed.ref.issue);
  assert.deepEqual((await tool(f.hub, 'amber', args)).ref, filed.ref);
  const nativeRows = await f.hub.storage.scanTasks({}, 100, undefined, context);
  assert.equal(nativeRows.items.length, 2);
  const originalRequest = f.changePaths.amber.request;
  f.changePaths.amber.request = async (...values) => {
    const answer = await originalRequest(...values);
    return { ...answer, privateText: privateWords, ref: { ...answer.ref, privateText: privateWords } };
  };
  const filtered = await tool(f.hub, 'amber', args);
  assert.deepEqual(filtered, filed);
  f.changePaths.amber.request = originalRequest;
  const marked = await scanHubRetention({ storages: { hub: f.hub.storage }, directories: [f.hubDirectory],
    markers: { draft: privateWords, ...PRIVATE_MARKERS } });
  assert.deepEqual(marked.hits, []);
  const sourceOwned = await scanHubRetention({ storages: { app: f.apps.amber.local.storage },
    directories: [join(f.directory, 'amber')], markers: { draft: privateWords } });
  assert.ok(sourceOwned.hits.some(hit => hit.marker === 'draft'));
});

test('source and context objects changed during an owner await cannot redirect the captured request', { timeout: 20000 }, async t => {
  const f = await fixture(t), actor = fixtureActor('amber');
  const contextRef = await report(f.apps.amber, 'amber', 'mutable-context');
  const staged = await f.changePaths.amber.stage({ requestId: 'mutable-source', text: privateWords }, actor);
  const entered = gate(), release = gate();
  const originalObserve = f.apps.amber.observe;
  f.apps.amber.observe = async (...values) => { entered.resolve(); await release.promise; return originalObserve(...values); };
  const offered = { requestId: 'mutable-source', source: structuredClone(staged.source), context: structuredClone(contextRef) };
  const pending = f.changePaths.amber.request(offered, actor);
  await entered.promise;
  offered.source.revision = '00000000-0000-0000-0000-000000000000';
  offered.context.requestId = 'changed-context';
  release.resolve();
  const filed = await pending;
  assert.equal(filed.kind, 'filed');
  const issue = await f.changePaths.amber.local.provider.read({ target: filed.ref.issue,
    revision: { kind: 'exact', value: filed.ref.issue.revision } }, access(actor));
  assert.equal(issue.kind, 'available');
  const payload = JSON.parse(new TextDecoder('utf-8', { ignoreBOM: true }).decode(issue.snapshot.bytes));
  assert.deepEqual(payload.source, staged.source);
  assert.deepEqual(payload.context, contextRef);
});

test('exact draft revisions, changed arguments and forged references cannot redirect a filed issue', { timeout: 20000 }, async t => {
  const f = await fixture(t), actor = fixtureActor('amber');
  const contextRef = await report(f.apps.amber, 'amber', 'original-context');
  const otherContext = await report(f.apps.amber, 'amber', 'different-context');
  const staged = await f.changePaths.amber.stage({ requestId: 'stable-request', text: privateWords }, actor);
  assert.equal(staged.kind, 'staged');
  const args = { requestId: 'stable-request', source: staged.source, context: contextRef };
  const first = await f.changePaths.amber.request(args, actor);
  assert.equal(first.kind, 'filed');
  const newer = await f.changePaths.amber.stage({ requestId: 'stable-request', text: 'Later fictional words',
    expected: staged.source }, actor);
  assert.equal(newer.kind, 'staged');
  assert.notEqual(newer.source.revision, staged.source.revision);
  assert.deepEqual((await f.changePaths.amber.request(args, actor)).ref, first.ref);
  assert.equal((await f.changePaths.amber.request({ ...args, source: newer.source }, actor)).kind, 'conflict');
  assert.equal((await f.changePaths.amber.request({ ...args, context: otherContext }, actor)).kind, 'conflict');
  const exact = await f.changePaths.amber.local.provider.read({ target: first.ref.issue,
    revision: { kind: 'exact', value: first.ref.issue.revision } }, access(actor));
  assert.equal(exact.kind, 'available');
  assert.match(new TextDecoder('utf-8', { ignoreBOM: true }).decode(exact.snapshot.bytes), /FICTIONAL_PRIVATE_CHANGE_WORDS_5f18/);
  assert.equal((await f.changePaths.amber.readIssue({ ...first.ref, evidenceRef: 'forged' }, actor)).kind, 'denied');
  assert.equal((await f.changePaths.amber.readIssue({ ...first.ref, issue: newer.source }, actor)).kind, 'denied');
});

test('actor, app, scope and live policy gate staging, filing and observation', { timeout: 20000 }, async t => {
  let permitted = true;
  const f = await fixture(t, { amber: { policy: () => permitted } });
  const actor = fixtureActor('amber'), contextRef = await report(f.apps.amber, 'amber', 'auth-context');
  const blueContext = await report(f.apps.blue, 'blue', 'blue-context');
  const staged = await f.changePaths.amber.stage({ requestId: 'auth-issue', text: privateWords }, actor);
  assert.equal(staged.kind, 'staged');
  const args = { requestId: 'auth-issue', source: staged.source, context: contextRef };
  assert.equal((await f.changePaths.amber.request({ ...args, context: blueContext }, actor)).kind, 'denied');
  assert.equal((await f.changePaths.amber.request(args, { ...actor, scopeId: 'other-scope' })).kind, 'denied');
  assert.equal((await f.changePaths.amber.stage({ requestId: 'wrong-actor', text: privateWords },
    { ...actor, principalId: 'other-person' })).kind, 'denied');
  const filed = await f.changePaths.amber.request(args, actor);
  assert.equal(filed.kind, 'filed');
  permitted = false;
  assert.equal((await f.changePaths.amber.readIssue(filed.ref, actor)).kind, 'denied');
  assert.equal((await f.changePaths.amber.request(args, actor)).kind, 'denied');
  permitted = true;
  assert.equal((await f.changePaths.amber.readIssue(filed.ref, actor)).kind, 'observed');
});

test('owner issue state is read live and immutable binding tampering is refused', { timeout: 20000 }, async t => {
  const f = await fixture(t), actor = fixtureActor('amber');
  const contextRef = await report(f.apps.amber, 'amber', 'status-context');
  const staged = await f.changePaths.amber.stage({ requestId: 'status-issue', text: privateWords }, actor);
  const filed = await f.changePaths.amber.request({ requestId: 'status-issue', source: staged.source, context: contextRef }, actor);
  assert.equal(filed.kind, 'filed');
  const provider = f.changePaths.amber.local.provider;
  const advance = async (expected, status, mutate = issue => issue) => {
    const read = await provider.read({ target: expected, revision: { kind: 'exact', value: expected.revision } }, access(actor));
    assert.equal(read.kind, 'available');
    const payload = mutate(JSON.parse(new TextDecoder('utf-8', { ignoreBOM: true }).decode(read.snapshot.bytes)));
    return provider.publication.publish({ operationId: `owner-maintain-${status}-${expected.revision}`,
      atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: expected,
        bytes: new TextEncoder().encode(JSON.stringify({ ...payload, status })), mediaType: 'application/json' }] }, access(actor));
  };
  const first = await f.changePaths.amber.readIssue(filed.ref, actor);
  assert.equal(first.status, 'open');
  const original = { ...filed.ref.issue, revision: first.revision };
  const progress = await advance(original, 'in-progress'); assert.equal(progress.kind, 'committed');
  assert.equal((await f.changePaths.amber.readIssue(filed.ref, actor)).status, 'in-progress');
  assert.equal((await advance(original, 'shipped')).kind, 'conflict');
  const latest = await f.changePaths.amber.readIssue(filed.ref, actor);
  const shipped = await advance({ ...filed.ref.issue, revision: latest.revision }, 'shipped'); assert.equal(shipped.kind, 'committed');
  assert.equal((await f.changePaths.amber.readIssue(filed.ref, actor)).status, 'shipped');
  const bad = await advance(shipped.receipt.changes[0].after, 'shipped', issue => ({ ...issue, label: 'other-label' }));
  assert.equal(bad.kind, 'committed');
  assert.equal((await f.changePaths.amber.readIssue(filed.ref, actor)).kind, 'unavailable');
});

test('revocation across owner await and borrowed close do not create an unauthorized issue', { timeout: 20000 }, async t => {
  let permitted = true;
  const entered = gate(), release = gate();
  const f = await fixture(t, { amber: { policy: () => permitted } });
  const actor = fixtureActor('amber');
  const contextRef = await report(f.apps.amber, 'amber', 'revoke-context');
  const staged = await f.changePaths.amber.stage({ requestId: 'revoke-issue', text: privateWords }, actor);
  const originalObserve = f.apps.amber.observe;
  f.apps.amber.observe = async (...args) => { entered.resolve(); await release.promise; return originalObserve(...args); };
  const pending = f.changePaths.amber.request({ requestId: 'revoke-issue', source: staged.source, context: contextRef }, actor);
  await entered.promise;
  permitted = false; release.resolve();
  const result = await pending;
  assert.notEqual(result.kind, 'filed');
  const lookup = await f.changePaths.amber.local.provider.reconciliation.lookup(
    JSON.stringify(['fictional/amber', f.apps.amber.identity.instanceId, 'change', 'revoke-issue']), access(actor));
  assert.equal(lookup.kind, 'not-found');
  await f.changePaths.amber.close();
  const stillRunning = await f.apps.amber.observe(contextRef, actor);
  assert.equal(stillRunning.kind, 'observed');
});

test('change tool captures the original request and actor before asynchronous native memo lookup', async () => {
  const { createFixtureChangeTools } = await import('../../examples/current-hub/change-tools.mjs');
  const waiting = gate(), release = gate();
  const actor = fixtureActor('amber');
  let current = actor, captured, calls = 0;
  const identity = { appId: 'amber', runtimeId: 'amber-runtime-v1', instanceId: '11111111-1111-1111-1111-111111111111',
    repositoryId: 'fictional/amber', version: '1' };
  const args = { requestId: 'capture', source: { resource: { providerId: 'amber-changes', path: 'original' },
    view: { kind: 'published' }, revision: '11111111-1111-1111-1111-111111111111' }, context: {
      ...identity, ...actor, capabilityVersion: '1', requestId: 'context', producer: 1, delivery: 2, operationId: 'context-operation' } };
  const path = { identity, request: async () => { calls++; return { kind: 'denied' }; } };
  const [native] = createFixtureChangeTools({ changePaths: { amber: path }, actorFor: () => current });
  const result = native.execute(args, { memo: async (...input) => {
    if (input.length === 2) { waiting.resolve(); await release.promise; return undefined; }
    captured = structuredClone(input[1]); return captured;
  } }, context);
  await waiting.promise;
  current = { ...actor, principalId: 'different-person' };
  args.source.resource.path = 'changed-while-awaiting';
  release.resolve();
  const response = JSON.parse((await result).content[0].text);
  assert.deepEqual(captured.actor, actor);
  assert.equal(captured.request.source.resource.path, 'original');
  assert.equal(calls, 0);
  assert.equal(response.kind, 'denied');
});

test('companion refuses a change path from another incarnation of the same app', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const otherDirectory = join(f.directory, 'other-amber');
  const definitionRef = await provisionFixtureDefinition({ directory: otherDirectory, appId: 'amber' });
  const other = await openFixtureApp({ directory: otherDirectory, appId: 'amber', definitionRef });
  const changes = openFixtureChangePath({ directory: join(otherDirectory, 'changes'), app: other });
  t.after(async () => { changes.close(); await other.close(); });
  assert.notEqual(other.identity.instanceId, f.apps.amber.identity.instanceId);
  let opened;
  try {
    await assert.rejects(async () => { opened = await openFixtureCompanion({ directory: join(f.directory, 'wrong-hub'),
      apps: f.apps, changePaths: { amber: changes } }); }, /binding|installation|instance/i);
  } finally { await opened?.close(); }
});

test('a failed context read before issue publication reports unavailable with no receipt', { timeout: 20000 }, async t => {
  const f = await fixture(t), actor = fixtureActor('amber');
  const contextRef = await report(f.apps.amber, 'amber', 'unavailable-context');
  const staged = await f.changePaths.amber.stage({ requestId: 'no-dispatch', text: privateWords }, actor);
  assert.equal(staged.kind, 'staged');
  f.apps.amber.observe = async () => { throw new Error(privateWords); };
  const outcome = await f.changePaths.amber.request({ requestId: 'no-dispatch', source: staged.source, context: contextRef }, actor);
  assert.deepEqual(outcome, { kind: 'unavailable' });
  const operationId = JSON.stringify(['fictional/amber', f.apps.amber.identity.instanceId, 'change', 'no-dispatch']);
  assert.equal((await f.changePaths.amber.local.provider.reconciliation.lookup(operationId, access(actor))).kind, 'not-found');
});

test('an issue receipt cannot certify a malformed original domain binding', { timeout: 20000 }, async t => {
  const f = await fixture(t), actor = fixtureActor('amber'), path = f.changePaths.amber;
  const requestId = 'malformed-original';
  const operationId = JSON.stringify(['fictional/amber', f.apps.amber.identity.instanceId, 'change', requestId]);
  const created = await path.local.provider.publication.publish({ operationId, atomicity: 'all-or-nothing', changes: [{
    kind: 'create', target: { resource: { providerId: 'amber-changes', path: `${path.identity.instanceId}/issues/${requestId}.json` },
      view: { kind: 'published' } }, expected: { kind: 'absent' },
    bytes: new TextEncoder().encode(JSON.stringify({ format: 'fictional.issue', version: 1, repositoryId: 'fictional/blue', status: 'open' })),
    mediaType: 'application/json',
  }] }, access(actor));
  assert.equal(created.kind, 'committed');
  const ref = { ...path.identity, ...actor, requestId, operationId, issue: created.receipt.changes[0].after, evidenceRef: created.receipt.evidenceRef };
  assert.deepEqual(await path.readIssue(ref, actor), { kind: 'unavailable' });
});
