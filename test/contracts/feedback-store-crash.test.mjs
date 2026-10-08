import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseFeedback } from '@hachej/boring-feedback/format';
import { createFeedbackStore } from '@hachej/boring-feedback/store';
import { openWorkspaceResources } from '../fixtures/feedback-workspace.mjs';

// A hard kill between the provider commit and the store's acknowledgement (the existing SIGKILL pattern of
// document-crash.test.mjs). This file is also the child: with BORING_FEEDBACK_CRASH_CHILD set it creates one report,
// lets the SQLite workspace provider commit, records the receipt and hangs until killed. Recovery runs in a fresh
// process state from the operation identity alone. Fictional data only.
const PROVIDER = 'feedback-store';
const ROOT = 'feedback/';
const OPERATION_ID = 'draft-fictional-crash-1';
const access = { scopeId: 'fictional-project', principalId: 'p_fictional_ada', initiatorId: 'p_fictional_ada' };
const draft = {
  observed: { kind: 'host', subject: { type: 'app-page', app: 'northwind-console', route: '/settings/:section' }, snapshot: 'app.dom@1', digest: `sha256:${'4f'.repeat(32)}`, policy: { version: 1, widened: [] } },
  anchors: [{ kind: 'app.element@1', signals: { testId: 'save-settings' }, fallback: 'the «Save» button' }, { kind: 'pdf.rect@7', page: 3, fallback: 'page 3' }],
  said: 'This button should be green.',
};
const target = path => ({ resource: { providerId: PROVIDER, path }, view: { kind: 'published' } });

async function open(filename, { authorized = true, publish } = {}) {
  const resources = await openWorkspaceResources(filename, PROVIDER);
  const store = createFeedbackStore({
    providerId: PROVIDER, view: { kind: 'published' }, reader: resources,
    publisher: { publish: publish ? (request, context) => publish(resources, request, context) : resources.publication.publish },
    lookup: resources.reconciliation, listFolder: resources.listFolder, capabilities: await resources.capabilities(target(ROOT.slice(0, -1)), access), root: ROOT,
    operationNamespace: 'fictional-feedback-crash', resolveAccess: () => access, authorizeSubject: () => authorized, displayName: () => 'Ada', protection: 'protected',
  });
  return { resources, store };
}

const child = process.env.BORING_FEEDBACK_CRASH_CHILD;
if (child) {
  const { store } = await open(join(child, 'feedback.sqlite'), { publish: async (resources, request, context) => {
    const result = await resources.publication.publish(request, context);
    writeFileSync(join(child, 'committed.json'), JSON.stringify(result));
    setInterval(() => {}, 1000);
    return new Promise(() => {});
  } });
  await store.create(draft, access, { id: OPERATION_ID, key: store.operationKey('create', draft, access) });
  throw new Error('The acknowledgement must never arrive');
} else {
  for (const mode of ['recover', 'changed-binding', 'revoked']) test(`feedback create recovers after SIGKILL between commit and acknowledgement: ${mode}`, { timeout: 20000 }, async t => {
    const directory = mkdtempSync(join(tmpdir(), 'boring-feedback-crash-'));
    const env = { ...process.env, BORING_FEEDBACK_CRASH_CHILD: directory }; delete env.NODE_TEST_CONTEXT;
    const worker = spawn(process.execPath, [fileURLToPath(import.meta.url)], { env, stdio: ['ignore', 'inherit', 'inherit'] });
    const terminal = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('exit', (code, signal) => resolve({ code, signal })); });
    terminal.catch(() => {});
    t.after(async () => { worker.kill('SIGKILL'); await terminal.catch(() => {}); rmSync(directory, { recursive: true, force: true }); });
    await Promise.race([
      terminal.then(result => { throw new Error(`Child exited before the crash window: ${JSON.stringify(result)}`); }),
      (async () => { const deadline = Date.now() + 15000; while (!existsSync(join(directory, 'committed.json'))) { if (Date.now() > deadline) throw new Error('Commit marker timeout'); await delay(10); } })(),
    ]);
    const committed = JSON.parse(readFileSync(join(directory, 'committed.json'), 'utf8'));
    assert.equal(committed.kind, 'committed');
    worker.kill('SIGKILL');
    assert.deepEqual(await terminal, { code: null, signal: 'SIGKILL' });

    const reportPath = committed.receipt.changes[0].after.resource.path;
    let published = 0;
    const { resources, store } = await open(join(directory, 'feedback.sqlite'), { authorized: mode !== 'revoked', publish: (provider, request, context) => { published++; return provider.publication.publish(request, context); } });
    t.after(() => resources.close());
    const caller = mode === 'changed-binding' ? { ...access, initiatorId: 'p_fictional_agent' } : access;
    // The admitted key is the one computed when the operation was first admitted, under the original access.
    const result = await store.create(draft, caller, { id: OPERATION_ID, key: store.operationKey('create', draft, access) });
    if (mode === 'recover') {
      assert.equal(result.kind, 'applied');
      assert.equal(result.operationId, committed.receipt.operationId);
      assert.equal(`${ROOT}${result.report.id}.md`, reportPath);
      assert.equal(result.revision, committed.receipt.changes[0].after.revision);
      assert.deepEqual(result.report.anchors, draft.anchors, 'the unknown anchor kind survives recovery');
    } else {
      assert.equal(result.kind, 'unknown', 'a changed binding or a revoked grant never reconciles as success');
      assert.equal(result.operationId, committed.receipt.operationId);
    }
    assert.deepEqual((await resources.listFolder(ROOT)).map(name => `${ROOT}${name}`), [reportPath], 'exactly one report: no duplicate after recovery');
    const stored = await resources.read({ target: target(reportPath), revision: { kind: 'latest' } }, access);
    assert.equal(parseFeedback(stored.snapshot.bytes).report.said, draft.said);
    assert.equal(published, 0, 'recovery publishes nothing');
  });
}
