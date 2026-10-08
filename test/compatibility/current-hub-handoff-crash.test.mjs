import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { fixtureActor, openFixtureApp } from '../../examples/current-hub/app.mjs';
import { openFixtureChangePath } from '../../examples/current-hub/change-path.mjs';
import { openFixtureCompanion } from '../../examples/current-hub/companion.mjs';
import { documentToolResult } from '../fixtures/native-document.mjs';

const script = fileURLToPath(new URL('../fixtures/current-hub-handoff-crash-child.mjs', import.meta.url));
const temporaryRoot = fileURLToPath(new URL('../../.cache/current-hub-handoff-crash/', import.meta.url));
const accessFor = actor => ({ scopeId: actor.scopeId, principalId: actor.principalId,
  initiatorId: actor.initiatorId, authorizationRef: actor.installationId });

async function crashAfterIssueCommit(t, directory) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [script, directory], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const terminal = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  terminal.catch(() => {});
  t.after(async () => { child.kill('SIGKILL'); await terminal.catch(() => {}); });
  await Promise.race([
    terminal.then(result => { throw new Error(`Handoff child exited before commit boundary: ${JSON.stringify(result)}\n${output}`); }),
    (async () => {
      const deadline = Date.now() + 10000;
      while (!existsSync(join(directory, 'ready.json'))) {
        assert.ok(Date.now() < deadline, `Handoff checkpoint timed out\n${output}`);
        await delay(10);
      }
    })(),
  ]);
  const ready = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
  assert.equal(ready.phase, 'issue-committed-before-ack');
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
  assert.equal(child.kill('SIGKILL'), true);
  assert.deepEqual(await terminal, { code: null, signal: 'SIGKILL' });
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
  return ready;
}

for (const scenario of ['same actor', 'revoked draft', 'changed actor']) {
  test(`native change handoff after SIGKILL with ${scenario} preserves its original issue`, { timeout: 30000 }, async t => {
    mkdirSync(temporaryRoot, { recursive: true });
    const directory = mkdtempSync(join(temporaryRoot, scenario.replaceAll(' ', '-') + '-'));
    let app, blue, path, companion, dispatches = 0;
    t.after(async () => {
      if (companion) await companion.close();
      if (path) await path.close();
      if (blue) await blue.close();
      if (app) await app.close();
      rmSync(directory, { recursive: true, force: true });
    });
    const ready = await crashAfterIssueCommit(t, directory);
    const actor = fixtureActor('amber'), access = accessFor(actor);
    assert.equal(ready.issue.operationId, JSON.stringify([ready.issue.repositoryId, ready.issue.instanceId, 'change', ready.issue.requestId]));
    assert.equal(ready.receipt.operationId, ready.issue.operationId);
    assert.equal(ready.receipt.changes.length, 1);
    assert.deepEqual(ready.receipt.changes[0].after, ready.issue.issue);
    app = await openFixtureApp({ directory: join(directory, 'app'), appId: 'amber' });
    blue = await openFixtureApp({ directory: join(directory, 'blue'), appId: 'blue' });
    path = await openFixtureChangePath({ directory: join(directory, 'change'), app,
      policy: (_actor, action) => scenario !== 'revoked draft' || action !== 'read-draft' });
    assert.deepEqual(path.identity.instanceId, ready.issue.instanceId);
    const original = await path.local.provider.reconciliation.lookup(ready.issue.operationId, access);
    assert.equal(original.kind, 'committed'); assert.deepEqual(original.receipt, ready.receipt);
    const later = await path.stage({ requestId: ready.issue.requestId, text: 'Fictional later handoff draft.', expected: ready.source }, actor);
    assert.equal(later.kind, 'staged'); assert.notEqual(later.source.revision, ready.source.revision);
    companion = await openFixtureCompanion({ directory: join(directory, 'hub'), apps: { amber: app, blue },
      changePaths: { amber: { ...path, request: (...args) => { dispatches++; return path.request(...args); } } },
      actorFor: appId => scenario === 'changed actor' && appId === 'amber'
        ? { ...fixtureActor(appId), initiatorId: 'different-fictional-requester' } : fixtureActor(appId) });
    const replayed = await documentToolResult(companion.harness, companion.conversation, ready.hubTask);
    assert.deepEqual(replayed.result, scenario === 'same actor' ? { kind: 'filed', ref: ready.issue } : { kind: 'unknown' });
    assert.equal(dispatches, scenario === 'changed actor' ? 0 : 1);
    const terminal = await companion.harness.getTask(ready.hubTask, context);
    assert.equal(terminal.id, ready.hubTask);
    assert.deepEqual(await path.local.provider.reconciliation.lookup(ready.issue.operationId, access), original);
    const observed = await path.readIssue(ready.issue, actor);
    assert.equal(observed.kind, 'observed');
    assert.deepEqual(observed.ref, ready.issue);
    assert.equal(observed.status, 'open');
    assert.equal(observed.revision, ready.issue.issue.revision);
    const issue = await path.local.provider.read({ target: ready.issue.issue, revision: { kind: 'exact', value: ready.issue.issue.revision } }, access);
    assert.equal(issue.kind, 'available'); assert.deepEqual(issue.snapshot.ref, ready.issue.issue);
    const document = JSON.parse(new TextDecoder('utf-8', { ignoreBOM: true }).decode(issue.snapshot.bytes));
    assert.equal(JSON.stringify(document).includes('Fictional original handoff draft.'), true);
    assert.equal(JSON.stringify(document).includes('Fictional later handoff draft.'), false);
    const all = await companion.storage.scanTasks({}, 100, undefined, context);
    assert.equal(all.next, undefined); assert.deepEqual(all.items.map(task => task.id), [ready.hubTask]);
    assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
  });
}
