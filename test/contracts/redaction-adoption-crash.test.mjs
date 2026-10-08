import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openRedactionFixture, redactionActor } from '../../examples/redaction/app.mjs';

const script = fileURLToPath(new URL('../fixtures/redaction-adoption-crash-child.mjs', import.meta.url));
const actor = redactionActor();
const decode = snapshot => new TextDecoder('utf-8', { ignoreBOM: true }).decode(snapshot.bytes);

async function crashAfterCommit(t, directory) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [script, directory], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  ended.catch(() => {});
  t.after(async () => { child.kill('SIGKILL'); await ended.catch(() => {}); });
  const deadline = Date.now() + 10000;
  while (!existsSync(join(directory, 'ready.json'))) {
    assert.ok(Date.now() < deadline, `Adoption commit checkpoint timed out\n${output}`);
    await Promise.race([delay(10), ended.then(result => { throw new Error(`Child exited early ${JSON.stringify(result)}\n${output}`); })]);
  }
  const ready = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
  assert.equal(ready.result.kind, 'committed');
  assert.equal(ready.result.receipt.changes.length, 2);
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
  assert.equal(child.kill('SIGKILL'), true);
  assert.deepEqual(await ended, { code: null, signal: 'SIGKILL' });
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
  return ready;
}

async function readPair(app) {
  const locations = app.domainPaths('A');
  const read = target => app.local.provider.read({ target, revision: { kind: 'latest' } }, actor);
  return Promise.all([read(locations.record), read(locations.letter)]);
}

test('SIGKILL after one real two-output commit reconciles exact receipt despite a later generation', { timeout: 30000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-adoption-crash-'));
  let app;
  t.after(async () => { if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const ready = await crashAfterCommit(t, directory);
  app = await openRedactionFixture({ directory: join(directory, 'app') });
  const before = await readPair(app);
  assert.deepEqual(before.map(read => read.kind), ['available', 'available']);
  assert.deepEqual(before.map(read => read.snapshot.ref), ready.result.receipt.changes.map(change => change.after));
  const next = await app.capture('A', 'proposal-newer', actor);
  assert.equal(next.kind, 'captured');
  const newer = await app.admitProposal(next.request, actor);
  assert.equal(newer.kind, 'admitted');
  await app.local.harness.waitForTask(newer.ref.validation, context);
  const recovered = await app.adopt(ready.request, actor);
  assert.equal(recovered.kind, 'admitted');
  assert.deepEqual(recovered.ref, ready.ref);
  const result = await app.adoptionResult(recovered.ref, actor);
  assert.deepEqual(result, ready.result);
  const after = await readPair(app);
  assert.deepEqual(after.map(read => read.snapshot.ref), before.map(read => read.snapshot.ref));
  assert.match(decode(after[1].snapshot), /^# Fictional A\n/);
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
});

test('revoked recovery discloses no adoption receipt until current access returns', { timeout: 30000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-adoption-revoked-'));
  let app;
  t.after(async () => { if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const ready = await crashAfterCommit(t, directory);
  app = await openRedactionFixture({ directory: join(directory, 'app'), policy: (_actor, action) => !['read', 'adopt'].includes(action) });
  app.local.harness.resume();
  const native = await app.local.harness.waitForTask(ready.ref.taskId, context);
  assert.equal(native.state.outcome.status, 'completed');
  assert.equal(native.state.outcome.result.kind, 'unknown');
  assert.equal(native.state.outcome.result.operationId, ready.ref.operationId);
  assert.equal(Object.hasOwn(native.state.outcome.result, 'receipt'), false);
  assert.equal((await app.adopt(ready.request, actor)).kind, 'denied');
  const concealed = await app.adoptionResult(ready.ref, actor);
  assert.equal(concealed.kind, 'denied');
  await app.close();
  app = await openRedactionFixture({ directory: join(directory, 'app') });
  const recovered = await app.adopt(ready.request, actor);
  assert.equal(recovered.kind, 'admitted');
  assert.deepEqual(recovered.ref, ready.ref);
  assert.deepEqual(await app.adoptionResult(recovered.ref, actor), ready.result);
});
