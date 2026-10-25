import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const script = fileURLToPath(new URL('../fixtures/room-crash-child.mjs', import.meta.url));
const lines = path => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];

for (const boundary of ['mid-run', 'before-settle', 'after-settle']) test(`a room wake survives SIGKILL ${boundary} with one reply (B7)`, { timeout: 20000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-room-crash-'));
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
    (async () => { const deadline = Date.now() + 10000; while (!existsSync(join(directory, 'ready.json'))) { assert.ok(Date.now() < deadline, 'room checkpoint timeout'); await delay(10); } })(),
  ]);
  first.child.kill('SIGKILL');
  assert.deepEqual(await first.terminal, { code: null, signal: 'SIGKILL' });
  const next = start('recover');
  assert.deepEqual(await next.terminal, { code: 0, signal: null });

  const { messages } = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
  assert.deepEqual(messages.map(message => [message.author, message.text]), [['person:ana', 'Salut'], ['agent:pm', 'Bonjour ana.']], 'no double and no orphan');
  const calls = lines(join(directory, 'model.jsonl'));
  // A run killed mid-request is retried once on recovery; a finished run never runs again.
  assert.deepEqual(calls.map(call => call.phase), boundary === 'mid-run' ? ['hold', 'recover'] : ['hold']);
  const settles = lines(join(directory, 'settles.jsonl'));
  assert.equal(new Set(settles.map(settle => settle.wakeId)).size, 1, 'one wake');
  assert.ok(settles.some(settle => settle.phase === 'recover'), 'the restarted home settles again');
});
