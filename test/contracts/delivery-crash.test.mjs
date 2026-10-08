import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

const script = fileURLToPath(new URL('../fixtures/delivery-crash-child.mjs', import.meta.url));
for (const mode of ['recover', 'before-publication', 'revoked', 'changed-scope', 'changed-namespace', 'changed-validator', 'not-found', 'safe-replay', 'safe-replay-mutable-actor']) {
  test(`native delivery reconciles real SIGKILL: ${mode}`, { timeout: 20000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'boring-delivery-crash-'));
    const workers = [];
    function start(phase) {
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      const child = spawn(process.execPath, [script, directory, phase, mode], { env, stdio: ['ignore', 'inherit', 'inherit'] });
      const terminal = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
      terminal.catch(() => {});
      const worker = { child, terminal }; workers.push(worker); return worker;
    }
    t.after(async () => { for (const worker of workers) { worker.child.kill('SIGKILL'); await worker.terminal.catch(() => {}); } rmSync(directory, { recursive: true, force: true }); });
    const first = start('hold');
    await Promise.race([
      first.terminal.then(result => { throw new Error(`Early exit ${JSON.stringify(result)}`); }),
      (async () => { const until = Date.now() + 10000; while (!existsSync(join(directory, 'ready.json'))) { if (Date.now() > until) throw new Error('Delivery checkpoint timeout'); await delay(10); } })(),
    ]);
    const marker = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
    assert.equal(marker.task.state.checkpoint.phase, 'publish');
    assert.equal(marker.task.state.checkpoint.text, '# Fictional durable result');
    if (mode !== 'before-publication') assert.equal(marker.result.kind, 'committed');
    assert.equal(existsSync(join(directory, 'recovered.json')), false);
    first.child.kill('SIGKILL');
    assert.deepEqual(await first.terminal, { code: null, signal: 'SIGKILL' });
    const next = start('recover');
    assert.deepEqual(await next.terminal, { code: 0, signal: null });
    const recovered = JSON.parse(readFileSync(join(directory, 'recovered.json'), 'utf8'));
    const committed = ['recover', 'before-publication', 'safe-replay', 'safe-replay-mutable-actor'].includes(mode);
    assert.equal(recovered.terminal.state.outcome.result.kind, committed ? 'committed' : 'unknown');
    assert.equal(recovered.publishes, ['before-publication', 'safe-replay', 'safe-replay-mutable-actor'].includes(mode) ? 1 : 0);
    const provider = openSqliteWorkspaces({ filename: join(directory, 'documents.sqlite'), providerId: 'documents', authorize: () => true });
    try {
      const receipt = await provider.reconciliation.lookup(marker.binding.operationId, { scopeId: 'cabinet', principalId: 'editor', initiatorId: 'fictional-reviewer' });
      assert.equal(receipt.kind, 'committed');
      if (marker.result) assert.deepEqual(receipt, marker.result);
      if (committed) assert.deepEqual(recovered.terminal.state.outcome.result, receipt);
    } finally { provider.close(); }
  });
}
