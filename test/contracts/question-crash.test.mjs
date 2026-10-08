import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const script = fileURLToPath(new URL('../fixtures/question-crash-child.mjs', import.meta.url));
for (const state of ['pending', 'resolved', 'consumed']) test(`native question survives SIGKILL with ${state} evidence`, { timeout: 20000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-question-crash-'));
  const workers = [];
  function start(phase) {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [script, directory, phase, state], { env, stdio: ['ignore', 'inherit', 'inherit'] });
    const terminal = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    terminal.catch(() => {});
    const worker = { child, terminal }; workers.push(worker); return worker;
  }
  t.after(async () => { for (const worker of workers) { worker.child.kill('SIGKILL'); await worker.terminal.catch(() => {}); } rmSync(directory, { recursive: true, force: true }); });
  const first = start('hold');
  await Promise.race([
    first.terminal.then(result => { throw new Error(`Early exit ${JSON.stringify(result)}`); }),
    (async () => { const until = Date.now() + 10000; while (!existsSync(join(directory, 'ready.json'))) { if (Date.now() > until) throw new Error('Question checkpoint timeout'); await delay(10); } })(),
  ]);
  const marker = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
  assert.equal(marker.task.state.checkpoint.phase, 'wait');
  assert.equal(marker.task.state.status, state === 'pending' ? 'running' : 'pending');
  assert.equal(existsSync(join(directory, 'recovered.json')), false);
  first.child.kill('SIGKILL');
  assert.deepEqual(await first.terminal, { code: null, signal: 'SIGKILL' });
  const next = start('recover');
  assert.deepEqual(await next.terminal, { code: 0, signal: null });
  const result = JSON.parse(readFileSync(join(directory, 'recovered.json'), 'utf8'));
  assert.equal(result.before.question.state.kind, state === 'consumed' ? 'resolved' : state);
  if (state === 'consumed') assert.equal(result.before.question.state.resolution.consumedBy, 'report-one');
  assert.equal(result.answer.kind, 'resolved');
  assert.equal(result.terminal.id, marker.ref.taskId);
  assert.deepEqual(result.terminal.state.outcome.result, { kind: 'resolved', answer: 'brief', resolutionId: 'resolution-one' });
  assert.equal(result.sameConsumer.kind, 'resolved');
  assert.equal(result.otherConsumer.kind, 'conflict');
});
