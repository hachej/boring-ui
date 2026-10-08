import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

const script = fileURLToPath(new URL('../fixtures/delivery-guards-crash-child.mjs', import.meta.url));
const access = { scopeId: 'cabinet', principalId: 'editor', initiatorId: 'fictional-reviewer' };
const output = { resource: { providerId: 'documents', path: 'report.md' }, view: { kind: 'published' } };

for (const mode of ['after', 'before', 'v1-wait', 'v1-validate', 'v1-after', 'v1-malformed']) {
  test(`native delivery across real SIGKILL at ${mode}`, { timeout: 20000 }, async t => {
    const old = mode.startsWith('v1-');
    const directory = mkdtempSync(join(tmpdir(), 'boring-delivery-guards-'));
    const workers = [];
    const start = phase => {
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      const child = spawn(process.execPath, [script, directory, phase, mode], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      const terminal = new Promise((resolve, reject) => {
        child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
      });
      terminal.catch(() => {});
      workers.push({ child, terminal });
      return { child, terminal, output: () => output };
    };
    t.after(async () => {
      for (const worker of workers) { worker.child.kill('SIGKILL'); await worker.terminal.catch(() => {}); }
      rmSync(directory, { recursive: true, force: true });
    });
    const first = start('hold');
    await Promise.race([
      first.terminal.then(result => { throw new Error(`Early exit ${JSON.stringify(result)}\n${first.output()}`); }),
      (async () => {
        const until = Date.now() + 10000;
        while (!existsSync(join(directory, 'ready.json'))) {
          assert.ok(Date.now() < until, `Delivery guard checkpoint timed out\n${first.output()}`);
          await delay(10);
        }
      })(),
    ]);
    const marker = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
    assert.equal(marker.task.state.checkpoint.phase, ['v1-wait', 'v1-malformed'].includes(mode) ? 'wait' : mode === 'v1-validate' ? 'validate' : 'publish');
    if (marker.task.state.checkpoint.phase === 'publish') {
      assert.equal(marker.task.state.checkpoint.text, old ? '# Fictional unguarded result' : '# Fictional guarded result');
    }
    assert.equal(marker.result?.kind ?? null, ['after', 'v1-after'].includes(mode) ? 'committed' : null);
    assert.equal(existsSync(join(directory, 'recovered.json')), false);
    assert.equal(first.child.kill('SIGKILL'), true);
    assert.deepEqual(await first.terminal, { code: null, signal: 'SIGKILL' });

    if (!old) {
      const provider = openSqliteWorkspaces({ filename: join(directory, 'documents.sqlite'), providerId: 'documents', authorize: () => true });
      try {
        const advanced = await provider.publication.publish({ operationId: 'advance-guard', atomicity: 'all-or-nothing', changes: [
          { kind: 'replace', target: marker.guard, bytes: new TextEncoder().encode('approved generation 2'), mediaType: 'text/plain' },
        ] }, access);
        assert.equal(advanced.kind, 'committed');
        assert.notEqual(advanced.receipt.changes[0].after.revision, marker.guard.revision);
      } finally { provider.close(); }
    }

    const next = start('recover');
    assert.deepEqual(await next.terminal, { code: 0, signal: null }, next.output());
    if (mode === 'v1-malformed') {
      const failed = JSON.parse(readFileSync(join(directory, 'migration.json'), 'utf8'));
      assert.equal(failed.task.id, marker.binding.delivery);
      assert.equal(failed.task.version, 1);
      assert.equal(failed.blocked.state.kind, 'blocked');
      assert.equal(failed.blocked.state.reason, 'migration_failed');
      assert.equal(failed.publishes, 0);
      const check = openSqliteWorkspaces({ filename: join(directory, 'documents.sqlite'), providerId: 'documents', authorize: () => true });
      try {
        assert.equal((await check.reconciliation.lookup(marker.binding.operationId, access)).kind, 'not-found');
        assert.equal((await check.read({ target: output, revision: { kind: 'latest' } }, access)).kind, 'missing');
      } finally { check.close(); }
      return;
    }
    const recovered = JSON.parse(readFileSync(join(directory, 'recovered.json'), 'utf8'));
    const result = recovered.terminal.state.outcome.result;
    assert.equal(recovered.terminal.id, marker.binding.delivery);
    assert.equal(recovered.terminal.state.outcome.status, 'completed');
    assert.equal(result.kind, mode === 'before' ? 'conflict' : 'committed');
    assert.equal(recovered.publishes, ['after', 'v1-after'].includes(mode) ? 0 : 1);
    if (old) {
      assert.equal(marker.task.version, 1);
      assert.equal(recovered.terminal.version, 2);
      assert.equal(recovered.terminal.input.preconditions.length, 0);
      assert.equal(recovered.terminal.input.producer, marker.binding.producer);
      assert.deepEqual(recovered.terminal.input.identity, marker.task.input.identity);
      assert.equal(recovered.terminal.input.namespace, 'legacy\nnamespace');
      assert.equal(recovered.terminal.input.validationVersion, 'v'.repeat(1100));
    }
    const check = openSqliteWorkspaces({ filename: join(directory, 'documents.sqlite'), providerId: 'documents', authorize: () => true });
    try {
      const receipt = await check.reconciliation.lookup(marker.binding.operationId, access);
      if (mode !== 'before') {
        if (['after', 'v1-after'].includes(mode)) { assert.deepEqual(result, marker.result); assert.deepEqual(receipt, marker.result); }
        else assert.deepEqual(result, receipt);
        const read = await check.read({ target: output, revision: { kind: 'latest' } }, access);
        assert.equal(read.kind, 'available');
        assert.equal(new TextDecoder().decode(read.snapshot.bytes), old ? '# Fictional unguarded result' : '# Fictional guarded result');
      } else {
        assert.equal(receipt.kind, 'not-found');
        assert.equal((await check.read({ target: output, revision: { kind: 'latest' } }, access)).kind, 'missing');
      }
    } finally { check.close(); }
  });
}

test('a version 1 definition cannot resume a guarded version 2 delivery after SIGKILL', { timeout: 20000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'boring-delivery-downgrade-'));
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const workers = [];
  const start = phase => {
    const child = spawn(process.execPath, [script, directory, phase, 'before'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const terminal = new Promise((resolve, reject) => {
      child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    terminal.catch(() => {});
    workers.push({ child, terminal });
    return { child, terminal, output: () => output };
  };
  t.after(async () => {
    for (const worker of workers) { worker.child.kill('SIGKILL'); await worker.terminal.catch(() => {}); }
    rmSync(directory, { recursive: true, force: true });
  });
  const first = start('hold');
  await Promise.race([
    first.terminal.then(result => { throw new Error(`Early exit ${JSON.stringify(result)}\n${first.output()}`); }),
    (async () => {
      const until = Date.now() + 10000;
      while (!existsSync(join(directory, 'ready.json'))) {
        assert.ok(Date.now() < until, `Downgrade checkpoint timed out\n${first.output()}`);
        await delay(10);
      }
    })(),
  ]);
  const marker = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
  assert.equal(marker.task.version, 2);
  assert.equal(first.child.kill('SIGKILL'), true);
  assert.deepEqual(await first.terminal, { code: null, signal: 'SIGKILL' });
  const oldRuntime = start('downgrade');
  assert.deepEqual(await oldRuntime.terminal, { code: 0, signal: null }, oldRuntime.output());
  const downgraded = JSON.parse(readFileSync(join(directory, 'downgrade.json'), 'utf8'));
  assert.equal(downgraded.witness.state.outcome.status, 'completed');
  assert.equal(downgraded.task.id, marker.binding.delivery);
  assert.equal(downgraded.task.version, 2);
  const blocked = downgraded.inspection.tasks.find(item => item.record.id === marker.binding.delivery);
  assert.deepEqual(blocked.state, { kind: 'blocked', reason: 'task_too_old' });
  const provider = openSqliteWorkspaces({ filename: join(directory, 'documents.sqlite'), providerId: 'documents', authorize: () => true });
  try {
    assert.equal((await provider.reconciliation.lookup(marker.binding.operationId, access)).kind, 'not-found');
    assert.equal((await provider.read({ target: output, revision: { kind: 'latest' } }, access)).kind, 'missing');
  } finally { provider.close(); }
});
