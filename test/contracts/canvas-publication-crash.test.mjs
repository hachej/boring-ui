import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

const script = fileURLToPath(new URL('../fixtures/canvas-publication-crash-child.mjs', import.meta.url));
const access = { scopeId: 'fictional-canvas', principalId: 'fictional-agent', initiatorId: 'fictional-reviewer', authorizationRef: 'fictional-grant-v1' };
const target = { resource: { providerId: 'canvas-crash', path: 'board.tldraw' }, view: { kind: 'published' } };
const modes = ['committed', 'missing-receipt', 'revoked', 'changed-principal', 'changed-scope', 'changed-initiator', 'changed-authorization', 'before-publication', 'human-edit'];
const cases = [...['add', 'remove'].flatMap(operation => modes.map(mode => ({ operation, mode }))),
  ...['committed', 'before-publication'].map(mode => ({ operation: 'create', mode })),
  ...['resolver-throws', 'lookup-denied', 'lookup-throws', 'changed-namespace', 'changed-path', 'changed-root'].map(mode => ({ operation: 'add', mode }))];

for (const { operation, mode } of cases) {
  test(`native canvas ${operation} recovery after real SIGKILL: ${mode}`, { timeout: 20000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'boring-canvas-crash-'));
    const workers = [];
    const start = phase => {
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
      const child = spawn(process.execPath, [script, directory, phase, mode, operation], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      const terminal = new Promise((resolve, reject) => {
        child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal }));
      });
      terminal.catch(() => {});
      const worker = { child, terminal, output: () => output };
      workers.push(worker);
      return worker;
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
          assert.ok(Date.now() < until, `Canvas checkpoint timed out\n${first.output()}`);
          await delay(10);
        }
      })(),
    ]);
    const marker = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8'));
    assert.equal(marker.task.id, marker.taskId);
    assert.equal(marker.task.state.checkpoint.phase, 'execute');
    assert.equal(marker.publishes, 1);
    assert.equal(marker.providerPublications, mode === 'before-publication' ? 0 : 1);
    assert.equal(marker.result?.kind ?? null, mode === 'before-publication' ? null : 'committed');
    assert.equal(marker.request.changes[0].kind, operation === 'create' ? 'create' : 'replace');
    assert.equal(existsSync(join(directory, 'recovered.json')), false);
    assert.equal(first.child.kill('SIGKILL'), true);
    assert.deepEqual(await first.terminal, { code: null, signal: 'SIGKILL' });

    const provider = openSqliteWorkspaces({ filename: join(directory, 'documents.sqlite'), providerId: target.resource.providerId, authorize: () => true });
    let expected;
    try {
      const beforeRecovery = await provider.read({ target, revision: { kind: 'latest' } }, access);
      const absent = operation === 'create' && mode === 'before-publication';
      assert.equal(beforeRecovery.kind, absent ? 'missing' : 'available');
      if (mode === 'human-edit') {
        const document = JSON.parse(new TextDecoder().decode(beforeRecovery.snapshot.bytes));
        document.store['shape:outside'].x = 999;
        const bytes = new TextEncoder().encode(JSON.stringify(document));
        const human = await provider.publication.publish({ operationId: 'fictional-human-after-crash', atomicity: 'all-or-nothing',
          changes: [{ kind: 'replace', target: beforeRecovery.snapshot.ref, bytes, mediaType: beforeRecovery.snapshot.mediaType }] },
        { ...access, principalId: 'fictional-human' });
        assert.equal(human.kind, 'committed');
        expected = { ref: human.receipt.changes[0].after, bytes };
      } else expected = absent ? { kind: 'missing' } : { ref: beforeRecovery.snapshot.ref, bytes: beforeRecovery.snapshot.bytes };
    } finally { provider.close(); }

    const next = start('recover');
    assert.deepEqual(await next.terminal, { code: 0, signal: null }, next.output());
    const recovered = JSON.parse(readFileSync(join(directory, 'recovered.json'), 'utf8'));
    assert.equal(recovered.terminal.id, marker.taskId);
    assert.equal(recovered.terminal.state.outcome.status, 'completed');
    assert.equal(recovered.isError, false, recovered.text);
    const result = JSON.parse(recovered.text);
    const saved = ['committed', 'human-edit'].includes(mode);
    assert.equal(result.kind, saved ? 'saved' : 'unknown');
    assert.equal(recovered.publishes, 0);
    assert.equal(recovered.providerPublications, 0);
    assert.equal(recovered.reads, 0);
    const prohibitedLookup = ['revoked', 'resolver-throws'].includes(mode) || mode.startsWith('changed-');
    assert.equal(recovered.lookups.length, prohibitedLookup ? 0 : 1);
    assert.equal(recovered.authorizationDenials, mode === 'lookup-denied' ? 1 : 0);
    if (!prohibitedLookup) assert.deepEqual(recovered.lookups[0], { operationId: marker.request.operationId, ...access });
    if (saved) {
      const revision = marker.result.receipt.changes[0].after.revision;
      assert.equal(result.revision, revision);
      assert.equal(recovered.baseline, revision);
      assert.notEqual(revision, marker.baseline);
      const retained = JSON.parse(new TextDecoder().decode(Uint8Array.from(marker.request.changes[0].bytes)));
      const ids = Object.values(retained.store).filter(record => record.typeName === 'shape').map(record => record.id.slice(6)).sort();
      assert.deepEqual(result.shapes.map(shape => shape.id).sort(), ids);
      if (mode === 'human-edit') {
        assert.notEqual(result.revision, expected.ref.revision);
        assert.equal(result.shapes.find(shape => shape.id === 'outside').x, 300);
      }
    } else {
      assert.equal(result.operationId, marker.request.operationId);
      assert.equal(recovered.baseline, marker.baseline);
    }
    const check = openSqliteWorkspaces({ filename: join(directory, 'documents.sqlite'), providerId: target.resource.providerId, authorize: () => true });
    try {
      const read = await check.read({ target, revision: { kind: 'latest' } }, access);
      assert.equal(read.kind, expected.kind === 'missing' ? 'missing' : 'available');
      if (read.kind === 'available') {
        assert.deepEqual(read.snapshot.ref, expected.ref);
        assert.deepEqual(read.snapshot.bytes, expected.bytes);
      }
      const found = await check.reconciliation.lookup(marker.request.operationId, access);
      if (mode === 'before-publication') assert.equal(found.kind, 'not-found');
      else {
        assert.deepEqual(found, marker.result);
        if (mode !== 'human-edit') assert.deepEqual(read.snapshot.bytes, Uint8Array.from(marker.request.changes[0].bytes));
      }
    } finally { check.close(); }
  });
}
