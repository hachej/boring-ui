import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const script = fileURLToPath(new URL('../fixtures/channel-question-crash-child.mjs', import.meta.url));
for (const boundary of ['before-send', 'after-send', 'after-ack']) test(`external question notification survives SIGKILL ${boundary}`, { timeout: 20000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-channel-question-crash-'));
  const workers = [];
  function start(phase) {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [script, directory, phase, boundary], { env, stdio: ['ignore', 'inherit', 'inherit'] });
    const terminal = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    terminal.catch(() => {});
    const worker = { child, terminal }; workers.push(worker); return worker;
  }
  t.after(async () => { for (const worker of workers) { worker.child.kill('SIGKILL'); await worker.terminal.catch(() => {}); } rmSync(directory, { recursive: true, force: true }); });
  const first = start('hold');
  await Promise.race([
    first.terminal.then(result => { throw new Error(`Early exit ${JSON.stringify(result)}`); }),
    (async () => { const deadline = Date.now() + 10000; while (!existsSync(join(directory, 'ready.json'))) { assert.ok(Date.now() < deadline, 'notification checkpoint timeout'); await delay(10); } })(),
  ]);
  first.child.kill('SIGKILL');
  assert.deepEqual(await first.terminal, { code: null, signal: 'SIGKILL' });
  const next = start('recover');
  assert.deepEqual(await next.terminal, { code: 0, signal: null });
  const delivered = readFileSync(join(directory, 'external.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const questions = delivered.filter(item => item.reply.kind === 'question');
  assert.equal(questions.length, boundary === 'after-send' ? 2 : 1, 'only the ambiguous send/ack gap may duplicate a notification');
  assert.equal(new Set(questions.map(item => item.reply.callId)).size, 1, 'retry retains the original question identity');
  assert.equal(delivered.filter(item => item.reply.kind === 'answer').length, 1);
});
