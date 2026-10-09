import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openValidatedOutputFixture } from '../../examples/validated-output/app.mjs';

const script = fileURLToPath(new URL('../fixtures/validation-repair-crash-child.mjs', import.meta.url));
const actor = { principalId: 'fictional-editor', initiatorId: 'fictional-human', scopeId: 'fictional-team' };

async function crashAfterDecision(t, directory, scenario = 'repair') {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [script, directory, scenario], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const ended = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  ended.catch(() => {});
  t.after(async () => { child.kill('SIGKILL'); await ended.catch(() => {}); });
  const deadline = Date.now() + 10000;
  while (!existsSync(join(directory, 'admitted.json')) || !existsSync(join(directory, 'decision-committed.json'))) {
    assert.ok(Date.now() < deadline, `Repair decision checkpoint timed out\n${output}`);
    await Promise.race([delay(10), ended.then(result => { throw new Error(`Child exited early ${JSON.stringify(result)}\n${output}`); })]);
  }
  const ref = JSON.parse(readFileSync(join(directory, 'admitted.json'), 'utf8'));
  const decision = JSON.parse(readFileSync(join(directory, 'decision-committed.json'), 'utf8'));
  assert.equal(decision.continue, true);
  assert.equal(child.kill('SIGKILL'), true);
  assert.deepEqual(await ended, { code: null, signal: 'SIGKILL' });
  return { ref, decision };
}

test('SIGKILL after committed repair decision reuses one native budget and original binding', { timeout: 25000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-validation-crash-'));
  let app;
  t.after(async () => { if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const { ref, decision } = await crashAfterDecision(t, directory);
  app = await openValidatedOutputFixture({ directory, maxRepairs: 0 });
  const replay = await app.admit('request');
  assert.equal(replay.kind, 'admitted');
  assert.deepEqual(replay.ref, ref);
  assert.equal((await app.harness.getTask(ref.producer, context)).input.maxRepairs, 1);
  const [producer, validation, delivery] = await Promise.all([
    app.harness.waitForTask(ref.producer, context),
    app.harness.waitForTask(ref.validation, context),
    app.harness.waitForTask(ref.delivery, context),
  ]);
  assert.equal(producer.state.outcome.status, 'completed');
  assert.equal(producer.state.outcome.result.text, '{"number":4,"label":"Fictional answer"}');
  assert.equal(validation.state.outcome.result.kind, 'valid');
  assert.equal(delivery.state.outcome.result.kind, 'committed');
  assert.equal((await app.provider.read({ target: app.target.output, revision: { kind: 'latest' } }, actor)).kind, 'available');
  const child = (await app.harness.commit(tx => tx.scanConversations({ ownerTaskId: ref.producer }, 10), context)).items;
  assert.equal(child.length, 1);
  const budget = await app.harness.snapshot(app.budgets, String(child[0].id), context);
  assert.equal(budget.attempts, 1);
  assert.equal(Object.keys(budget.decisions).length, 1);
  assert.deepEqual(Object.values(budget.decisions)[0], decision);
  assert.equal(app.fake.calls.length, 2);
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
});

test('SIGKILL preserves missing-evidence scenario and original repair limit across changed reopen options', { timeout: 25000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-validation-missing-crash-'));
  let app;
  t.after(async () => { if (app) await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const { ref } = await crashAfterDecision(t, directory, 'missing');
  app = await openValidatedOutputFixture({ directory, scenario: 'repair', maxRepairs: 8 });
  const replay = await app.admit('request');
  assert.equal(replay.kind, 'admitted');
  assert.deepEqual(replay.ref, ref);
  const original = await app.harness.getTask(ref.producer, context);
  assert.equal(original.input.scenario, 'missing');
  assert.equal(original.input.maxRepairs, 1);
  const [producer, validation, delivery] = await Promise.all([
    app.harness.waitForTask(ref.producer, context),
    app.harness.waitForTask(ref.validation, context),
    app.harness.waitForTask(ref.delivery, context),
  ]);
  assert.equal(producer.state.outcome.status, 'completed');
  assert.deepEqual(producer.state.outcome.result.evidence, []);
  assert.equal(validation.state.outcome.result.kind, 'invalid');
  assert.notEqual(delivery.state.outcome.result.kind, 'committed');
  assert.equal((await app.provider.read({ target: app.target.output, revision: { kind: 'latest' } }, actor)).kind, 'missing');
  const child = (await app.harness.commit(tx => tx.scanConversations({ ownerTaskId: ref.producer }, 10), context)).items;
  assert.equal(child.length, 1);
  const budget = await app.harness.snapshot(app.budgets, String(child[0].id), context);
  assert.equal(budget.attempts, 1);
  assert.equal(existsSync(join(directory, 'acknowledged.json')), false);
});
