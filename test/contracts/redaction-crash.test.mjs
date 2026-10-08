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

const script = fileURLToPath(new URL('../fixtures/redaction-crash-child.mjs', import.meta.url));
const outputText = '# Fictional A\nInvented redaction input.';

async function crashAt(t, directory, boundary) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [script, directory, boundary], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const terminal = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  terminal.catch(() => {});
  t.after(async () => { child.kill('SIGKILL'); await terminal.catch(() => {}); });
  await Promise.race([
    terminal.then(result => { throw new Error(`Redaction child exited before ${boundary}: ${JSON.stringify(result)}\n${output}`); }),
    (async () => {
      const deadline = Date.now() + 10000;
      while (!existsSync(join(directory, 'ready.json'))) {
        assert.ok(Date.now() < deadline, `Redaction ${boundary} checkpoint timed out\n${output}`);
        await delay(10);
      }
    })(),
  ]);
  const ready = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
  assert.equal(child.kill('SIGKILL'), true);
  assert.deepEqual(await terminal, { code: null, signal: 'SIGKILL' });
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
  return ready;
}

async function taskIds(app) {
  const page = await app.local.harness.inspect(context);
  return page.tasks.map(item => item.record.id).sort((a, b) => a - b);
}

test('reservation SIGKILL recovers the original actor, generation and one native pair', { timeout: 25000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-redaction-reservation-'));
  const producing = Promise.withResolvers(); let app;
  t.after(async () => { producing.resolve(); if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const ready = await crashAt(t, directory, 'reservation');
  assert.equal(ready.phase, 'reservation-committed');
  app = await openRedactionFixture({ directory: join(directory, 'app'), beforeProduce: () => producing.promise });
  assert.deepEqual(await taskIds(app), []);
  const actor = redactionActor();
  const current = await app.local.provider.read({ target: app.paths('A').generation, revision: { kind: 'latest' } }, actor);
  assert.equal(current.kind, 'available');
  const changedActor = redactionActor({ principalId: 'fictional-editor-2', initiatorId: 'fictional-human-2' });
  const other = await app.admit(ready.request, changedActor);
  assert.equal(other.kind, 'conflict');
  const changedBody = await app.capture('A', ready.request.requestId, actor);
  assert.equal(changedBody.kind, 'captured');
  assert.notDeepEqual(changedBody.request, ready.request);
  assert.equal((await app.admit(changedBody.request, actor)).kind, 'conflict');
  assert.deepEqual(await taskIds(app), []);
  const still = await app.local.provider.read({ target: app.paths('A').generation, revision: { kind: 'latest' } }, actor);
  assert.equal(still.kind, 'available'); assert.deepEqual(still.snapshot.ref, current.snapshot.ref);
  const recovered = await app.admit(ready.request, actor);
  assert.equal(recovered.kind, 'admitted');
  assert.equal(ready.result.kind, 'committed');
  assert.deepEqual(recovered.ref.reservation, ready.result.receipt.changes[0].after);
  assert.deepEqual(recovered.ref.guard, ready.result.receipt.changes[1].after);
  assert.deepEqual((await app.admit(ready.request, actor)).ref, recovered.ref);
  assert.deepEqual(await taskIds(app), [recovered.ref.producer, recovered.ref.delivery].sort((a, b) => a - b));
  assert.equal(recovered.ref.guard.revision, current.snapshot.ref.revision);
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
});

test('native admission SIGKILL retries the original producer and delivery without replacing its guard', { timeout: 25000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-redaction-admission-'));
  const producing = Promise.withResolvers(); let app;
  t.after(async () => { producing.resolve(); if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const ready = await crashAt(t, directory, 'admission');
  assert.equal(ready.phase, 'native-admitted');
  app = await openRedactionFixture({ directory: join(directory, 'app'), beforeProduce: () => producing.promise });
  const expected = [ready.admitted.producer, ready.admitted.delivery].sort((a, b) => a - b);
  assert.deepEqual(await taskIds(app), expected);
  const retried = await app.admit(ready.request, redactionActor());
  assert.equal(retried.kind, 'admitted'); assert.deepEqual(retried.ref, ready.admitted);
  assert.deepEqual(await taskIds(app), expected);
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
});

test('a newer generation after reservation SIGKILL cannot be rewound by the original retry', { timeout: 25000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-redaction-superseded-'));
  const newerProducing = Promise.withResolvers(); let app;
  t.after(async () => { newerProducing.resolve(); if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const ready = await crashAt(t, directory, 'reservation');
  app = await openRedactionFixture({ directory: join(directory, 'app'), beforeProduce: input =>
    input.request.requestId === 'newer' ? newerProducing.promise : undefined });
  const actor = redactionActor();
  const captured = await app.capture('A', 'newer', actor);
  assert.equal(captured.kind, 'captured');
  const newer = await app.admit(captured.request, actor);
  assert.equal(newer.kind, 'admitted');
  const guardBeforeOldRetry = await app.local.provider.read({ target: app.paths('A').generation, revision: { kind: 'latest' } }, actor);
  assert.equal(guardBeforeOldRetry.kind, 'available');
  assert.deepEqual(guardBeforeOldRetry.snapshot.ref, newer.ref.guard);
  const original = await app.admit(ready.request, actor);
  assert.equal(original.kind, 'admitted');
  assert.notEqual(original.ref.generationId, newer.ref.generationId);
  assert.notEqual(original.ref.guard.revision, newer.ref.guard.revision);
  const oldDelivery = await app.local.harness.waitForTask(original.ref.delivery, context);
  assert.equal(oldDelivery.state.outcome.status, 'completed');
  assert.equal(oldDelivery.state.outcome.result.kind, 'conflict');
  const guardAfterOldRetry = await app.local.provider.read({ target: app.paths('A').generation, revision: { kind: 'latest' } }, actor);
  assert.equal(guardAfterOldRetry.kind, 'available');
  assert.deepEqual(guardAfterOldRetry.snapshot.ref, newer.ref.guard);
  assert.equal((await app.local.provider.read({ target: app.paths('A').output, revision: { kind: 'latest' } }, actor)).kind, 'missing');
  newerProducing.resolve();
  const newDelivery = await app.local.harness.waitForTask(newer.ref.delivery, context);
  assert.equal(newDelivery.state.outcome.result.kind, 'committed');
  assert.notEqual(original.ref.producer, newer.ref.producer);
  assert.notEqual(original.ref.delivery, newer.ref.delivery);
});

test('revoked recovery after reservation SIGKILL creates no substitute native work', { timeout: 25000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-redaction-revoked-'));
  let app;
  t.after(async () => { if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const ready = await crashAt(t, directory, 'reservation');
  app = await openRedactionFixture({ directory: join(directory, 'app'), policy: (_actor, action) => action !== 'admit' });
  const actor = redactionActor();
  const before = await app.local.provider.read({ target: app.paths('A').generation, revision: { kind: 'latest' } }, actor);
  assert.equal(before.kind, 'available');
  assert.equal((await app.admit(ready.request, actor)).kind, 'denied');
  assert.deepEqual(await taskIds(app), []);
  const after = await app.local.provider.read({ target: app.paths('A').generation, revision: { kind: 'latest' } }, actor);
  assert.equal(after.kind, 'available'); assert.deepEqual(after.snapshot.ref, before.snapshot.ref);
  await app.close();
  app = await openRedactionFixture({ directory: join(directory, 'app') });
  const recovered = await app.admit(ready.request, actor);
  assert.equal(recovered.kind, 'admitted');
  assert.equal(recovered.ref.guard.revision, before.snapshot.ref.revision);
});

test('output commit SIGKILL reconciles the original receipt after guard advancement', { timeout: 25000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-redaction-output-'));
  let app;
  t.after(async () => { if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const ready = await crashAt(t, directory, 'delivery');
  assert.equal(ready.phase, 'output-committed');
  assert.equal(ready.result.kind, 'committed');
  app = await openRedactionFixture({ directory: join(directory, 'app') });
  const actor = redactionActor();
  const paths = app.paths('A');
  const guard = await app.local.provider.read({ target: paths.generation, revision: { kind: 'latest' } }, actor);
  assert.equal(guard.kind, 'available');
  const advanced = await app.local.provider.publication.publish({ operationId: 'advance-after-output', atomicity: 'all-or-nothing', changes: [
    // Revisions name the bytes: a trailing newline advances the guard without changing its JSON.
    { kind: 'replace', target: guard.snapshot.ref, bytes: new TextEncoder().encode(`${new TextDecoder().decode(guard.snapshot.bytes)}\n`), mediaType: 'application/json' },
  ] }, actor);
  assert.equal(advanced.kind, 'committed');
  assert.notEqual(advanced.receipt.changes[0].after.revision, guard.snapshot.ref.revision);
  const delivery = await app.local.harness.waitForTask(ready.admitted.delivery, context);
  assert.equal(delivery.state.outcome.status, 'completed');
  assert.deepEqual(delivery.state.outcome.result, ready.result);
  const observed = await app.local.provider.read({ target: paths.output, revision: { kind: 'latest' } }, actor);
  assert.equal(observed.kind, 'available');
  assert.equal(new TextDecoder().decode(observed.snapshot.bytes), outputText);
  assert.equal((await app.local.harness.getTask(ready.admitted.producer, context)).id, ready.admitted.producer);
  assert.equal((await app.local.harness.getTask(ready.admitted.delivery, context)).id, ready.admitted.delivery);
});
