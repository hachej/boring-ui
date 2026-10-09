import assert from 'node:assert/strict';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { lastReadRevisions } from '@hachej/boring-agent/file-guard';
import { createCanvasTools } from '../../examples/shared/canvas-tools.mjs';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { admitDocumentTool, toolResultText } from './native-document.mjs';

const [directory, phase, mode, operation] = process.argv.slice(2);
assert.ok(directory && ['hold', 'recover'].includes(phase) && ['add', 'remove', 'create'].includes(operation));
const keepalive = setInterval(() => {}, 1000);
const originalAccess = { scopeId: 'fictional-canvas', principalId: 'fictional-agent', initiatorId: 'fictional-reviewer', authorizationRef: 'fictional-grant-v1' };
const access = { ...originalAccess };
if (phase === 'recover') {
  if (mode === 'changed-principal') access.principalId = 'other-agent';
  if (mode === 'changed-scope') access.scopeId = 'other-scope';
  if (mode === 'changed-initiator') access.initiatorId = 'other-reviewer';
  if (mode === 'changed-authorization') access.authorizationRef = 'fictional-grant-v2';
}
const target = { resource: { providerId: 'canvas-crash', path: 'board.tldraw' }, view: { kind: 'published' } };
let authorizationDenials = 0;
const owner = openSqliteWorkspaces({ filename: join(directory, 'documents.sqlite'), providerId: target.resource.providerId,
  authorize: action => {
    if (phase === 'recover' && mode === 'lookup-denied' && action === 'lookup') { authorizationDenials++; return false; }
    return true;
  } });
const actual = owner.workspace(originalAccess.scopeId);
let harness, taskId, armed = phase === 'recover';
let publishes = 0, providerPublications = 0, reads = 0;
const lookups = [];
async function hold(request, result) {
  const task = await harness.getTask(taskId, context);
  const baseline = (await harness.snapshot(lastReadRevisions, task.conversationId, context))?.revisions['canvas-crash:board.tldraw'];
  writeFileSync(join(directory, 'ready.tmp'), JSON.stringify({ taskId, task, request: { ...request,
    changes: request.changes.map(change => ({ ...change, bytes: [...change.bytes] })) }, result, baseline, publishes, providerPublications }));
  renameSync(join(directory, 'ready.tmp'), join(directory, 'ready.json'));
  await new Promise(() => {});
}
const files = { ...actual,
  read: async (...args) => { if (armed) reads++; return actual.read(...args); },
  publication: { ...actual.publication, publish: async (request, granted) => {
    if (!armed) return actual.publication.publish(request, granted);
    publishes++;
    if (phase === 'hold' && mode === 'before-publication') await hold(request, null);
    providerPublications++;
    const result = await actual.publication.publish(request, granted);
    if (phase === 'hold') await hold(request, result);
    return result;
  } },
  reconciliation: { ...actual.reconciliation, lookup: async (operationId, granted) => {
    lookups.push({ operationId, principalId: granted.principalId, scopeId: granted.scopeId,
      initiatorId: granted.initiatorId, authorizationRef: granted.authorizationRef });
    if (phase === 'recover' && mode === 'missing-receipt') return { kind: 'not-found' };
    if (phase === 'recover' && mode === 'lookup-throws') throw new Error('Fictional reconciliation transport is unavailable');
    return owner.reconciliation.lookup(operationId, granted);
  } },
};
const tools = createCanvasTools({ workspace: () => {
  if (phase === 'recover' && mode === 'resolver-throws') throw new Error('Fictional original workspace expired');
  return phase === 'recover' && mode === 'revoked' ? undefined
    : { files, root: phase === 'recover' && mode === 'changed-root' ? '/other-workspace' : '/workspace', access };
}, namespace: phase === 'recover' && mode === 'changed-namespace' ? 'canvas-crash-v2' : 'canvas-crash-v1',
path: phase === 'recover' && mode === 'changed-path' ? 'other-board.tldraw' : 'board.tldraw' });
const registry = createRegistry();
registry.install(defineExtension({ name: 'fixture.canvas-crash', docs: [lastReadRevisions], tools }));
try {
  harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
  const conversation = await harness.root(context);
  if (phase === 'hold') {
    if (operation !== 'create') {
      const initial = await admitDocumentTool(conversation, { shapes: [
        { id: 'first', kind: 'rectangle', text: 'Fictional first', x: 0, y: 0 },
        { id: 'outside', kind: 'rectangle', text: 'Fictional outside', x: 300, y: 0 },
      ], arrows: [{ from: 'first', to: 'outside' }] }, 'add_canvas_shapes');
      const seeded = await toolResultText(harness, conversation, initial);
      assert.equal(seeded.isError, false, seeded.text);
      assert.equal(JSON.parse(seeded.text).kind, 'saved');
    }
    armed = true;
    taskId = await admitDocumentTool(conversation, operation === 'add' ? {
      shapes: [{ id: 'second', kind: 'rectangle', text: 'Fictional durable second', x: 600, y: 0 }],
      arrows: [{ from: 'outside', to: 'second' }],
    } : operation === 'create' ? {
      shapes: [{ id: 'created', kind: 'rectangle', text: 'Fictional created board', x: 0, y: 0 }],
    } : { ids: ['first'] }, operation === 'remove' ? 'remove_canvas_shapes' : 'add_canvas_shapes');
  } else taskId = JSON.parse(readFileSync(join(directory, 'ready.json'), 'utf8')).taskId;
  const settled = await toolResultText(harness, conversation, taskId);
  const terminal = await harness.getTask(taskId, context);
  const baseline = (await harness.snapshot(lastReadRevisions, conversation.id, context))?.revisions['canvas-crash:board.tldraw'];
  writeFileSync(join(directory, 'recovered.json'), JSON.stringify({ ...settled, terminal, baseline, publishes, providerPublications, reads, lookups, authorizationDenials }));
} finally {
  if (harness) await harness.close(context);
  owner.close();
  clearInterval(keepalive);
}
