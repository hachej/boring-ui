import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness, AssistantEntry, ToolTask, ToolResultEntry, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { openNodeConnection } from '@hachej/boring-files/sqlite';
import { openSqliteFileSystem } from '@hachej/boring-files/sqlite-filesystem';
import { createTLSchema, createShapeId } from '@tldraw/tlschema';
import { lastReadRevisions } from '@hachej/boring-agent/file-guard';
import { createCanvasTools } from '../../examples/shared/canvas-tools.mjs';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';

const access = { principalId: 'fictional-agent', initiatorId: 'alice', scopeId: 'fictional-canvas' };
const target = { resource: { providerId: 'canvas-test', path: 'board.tldraw' }, view: { kind: 'published' } };
const shape = id => ({ id, kind: 'rectangle', text: id, x: 0, y: 0 });
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'boring-canvas-publication-'));
  const owner = openSqliteWorkspaces({ filename: join(directory, 'files.sqlite'), providerId: target.resource.providerId, authorize: () => true });
  const actual = owner.workspace(access.scopeId);
  const control = { read: (request, granted) => actual.read(request, granted), publish: (request, granted) => actual.publication.publish(request, granted), lookup: (id, granted) => actual.reconciliation.lookup(id, granted) };
  const files = { ...actual, read: (request, granted) => control.read(request, granted), publication: { ...actual.publication, publish: (request, granted) => control.publish(request, granted) }, reconciliation: { lookup: (id, granted) => control.lookup(id, granted) } };
  const registry = createRegistry();
  const tools = createCanvasTools({ workspace: { files, root: '/workspace', access } });
  assert.equal(tools.find(tool => tool.name === 'add_canvas_shapes').replay, 'safe');
  registry.install(defineExtension({ name: 'fictional.canvas-publication', docs: [lastReadRevisions], tools }));
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
  t.after(async () => { await harness.close(context); owner.close(); rmSync(directory, { recursive: true, force: true }); });
  const conversation = await harness.root(context);
  async function run(name, args = {}) {
    const id = await conversation.commit(async tx => {
      const entry = await tx.appendEntry(AssistantEntry, conversation.id, { model: [{ role: 'assistant', content: [{ type: 'toolCall', id: 'call', name, arguments: args }], api: 'fixture', provider: 'fixture', model: 'fictional-no-model', timestamp: 1, stopReason: 'toolUse',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }] });
      return tx.createTask(ToolTask, { assistant: entry.id, callId: 'call' }, { ownership: { kind: 'conversation' } });
    }, context);
    const terminal = await harness.waitForTask(id, context);
    assert.equal(terminal.state.outcome.status, 'completed', JSON.stringify(terminal.state));
    const entry = await conversation.commit(tx => tx.entry(ToolResultEntry, terminal.state.outcome.result.entryId), context);
    const result = entry.model[0];
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  }
  const baseline = async () => (await harness.snapshot(lastReadRevisions, conversation.id, context))?.revisions['canvas-test:board.tldraw'];
  const read = () => actual.read({ target, revision: { kind: 'latest' } }, access);
  return { actual, control, run, baseline, read, directory };
}

test('canvas tool reconciles a committed write when publication acknowledgement throws', async t => {
  const f = await fixture(t);
  let attempts = 0;
  f.control.publish = async (request, granted) => {
    attempts++;
    const result = await f.actual.publication.publish(request, granted);
    assert.equal(result.kind, 'committed');
    throw new Error('Fictional lost acknowledgement');
  };
  const result = await f.run('add_canvas_shapes', { shapes: [shape('first')] });
  assert.equal(result.kind, 'saved');
  assert.equal(attempts, 1);
  assert.equal(result.revision, (await f.read()).snapshot.ref.revision);
  assert.equal(await f.baseline(), result.revision);
  assert.deepEqual(result.shapes.map(item => item.id), ['first']);
});

test('canvas tool reports unknown when publication throws without a receipt', async t => {
  const f = await fixture(t);
  let attempts = 0;
  f.control.publish = async () => { attempts++; throw new Error('Fictional transport failure'); };
  const result = await f.run('add_canvas_shapes', { shapes: [shape('first')] });
  assert.equal(result.kind, 'unknown');
  assert.equal(typeof result.operationId, 'string');
  assert.equal(attempts, 1);
  assert.equal((await f.read()).kind, 'missing');
  assert.equal(await f.baseline(), undefined);
});

test('canvas tool validates lookup evidence after a malformed acknowledgement', async t => {
  const f = await fixture(t);
  let attempts = 0, lookups = 0;
  f.control.publish = async (request, granted) => {
    attempts++;
    assert.equal((await f.actual.publication.publish(request, granted)).kind, 'committed');
    return { kind: 'committed' };
  };
  f.control.lookup = async (id, granted) => { lookups++; return f.actual.reconciliation.lookup(id, granted); };
  const result = await f.run('add_canvas_shapes', { shapes: [shape('first')] });
  assert.equal(result.kind, 'saved');
  assert.equal(result.revision, (await f.read()).snapshot.ref.revision);
  assert.equal(attempts, 1);
  assert.equal(lookups, 1);
});

test('canvas tool preserves a newer conversation read while settling its own publication', async t => {
  const f = await fixture(t);
  await f.run('add_canvas_shapes', { shapes: [shape('first')] });
  let ownRevision, newerRevision;
  f.control.publish = async (request, granted) => {
    const own = await f.actual.publication.publish(request, granted);
    assert.equal(own.kind, 'committed');
    ownRevision = own.receipt.changes[0].after.revision;
    const document = JSON.parse(new TextDecoder().decode(request.changes[0].bytes));
    document.store['shape:first'].x = 999;
    const human = await f.actual.publication.publish({ operationId: 'fictional-human-concurrent-read', atomicity: 'all-or-nothing', changes: [{ kind: 'replace',
      target: own.receipt.changes[0].after, mediaType: request.changes[0].mediaType, bytes: new TextEncoder().encode(JSON.stringify(document)) }] }, access);
    assert.equal(human.kind, 'committed');
    newerRevision = human.receipt.changes[0].after.revision;
    assert.equal((await f.run('read_canvas')).shapes.find(item => item.id === 'first').x, 999);
    throw new Error('Fictional lost acknowledgement after concurrent read');
  };
  const result = await f.run('add_canvas_shapes', { shapes: [shape('second')] });
  assert.equal(result.kind, 'saved');
  assert.equal(result.revision, ownRevision);
  assert.equal(result.shapes.find(item => item.id === 'first').x, 0);
  assert.equal(await f.baseline(), newerRevision);
  assert.equal((await f.read()).snapshot.ref.revision, newerRevision);
});

test('canvas tool acknowledges its own receipt and refuses a later unread edit after an intervening human publication', async t => {
  const f = await fixture(t);
  assert.equal((await f.run('add_canvas_shapes', { shapes: [shape('first')] })).kind, 'saved');
  let firstReceipt, humanReceipt;
  f.control.publish = async (request, granted) => {
    const result = await f.actual.publication.publish(request, granted);
    assert.equal(result.kind, 'committed'); firstReceipt = result.receipt;
    const change = request.changes[0], document = JSON.parse(new TextDecoder().decode(change.bytes));
    document.store['shape:first'].x = 999;
    const human = await f.actual.publication.publish({ operationId: 'fictional-human-between-commit-and-ack', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: result.receipt.changes[0].after,
      mediaType: change.mediaType, bytes: new TextEncoder().encode(JSON.stringify(document)) }] }, { ...access, principalId: 'fictional-human' });
    assert.equal(human.kind, 'committed'); humanReceipt = human.receipt;
    return result;
  };
  const added = await f.run('add_canvas_shapes', { shapes: [shape('second')] });
  assert.equal(added.kind, 'saved');
  assert.equal(added.revision, firstReceipt.changes[0].after.revision);
  assert.notEqual(added.revision, humanReceipt.changes[0].after.revision);
  assert.equal(added.shapes.find(shape => shape.id === 'first').x, 0);
  assert.equal(await f.baseline(), added.revision);
  f.control.publish = (request, granted) => f.actual.publication.publish(request, granted);
  assert.equal((await f.run('remove_canvas_shapes', { ids: ['first'] })).kind, 'conflict');
  const saved = await f.read();
  assert.equal(saved.snapshot.ref.revision, humanReceipt.changes[0].after.revision);
  assert.equal(JSON.parse(new TextDecoder().decode(saved.snapshot.bytes)).store['shape:first'].x, 999);
  const read = await f.run('read_canvas');
  assert.equal(read.shapes.find(shape => shape.id === 'first').x, 999);
  assert.equal(await f.baseline(), humanReceipt.changes[0].after.revision);
  assert.equal((await f.run('remove_canvas_shapes', { ids: ['first'] })).kind, 'saved');
});

test('canvas creation, replacement, read, removal and recreation use the exact published revisions', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.run('read_canvas'), { kind: 'missing', shapes: [] });
  assert.equal(await f.baseline(), undefined);
  const created = await f.run('add_canvas_shapes', { shapes: [shape('first')] });
  assert.equal(created.kind, 'saved');
  assert.equal(created.revision, (await f.read()).snapshot.ref.revision);
  assert.equal(await f.baseline(), created.revision);
  const replaced = await f.run('add_canvas_shapes', { shapes: [shape('second')] });
  assert.equal(replaced.kind, 'saved'); assert.notEqual(replaced.revision, created.revision);
  assert.equal(await f.baseline(), replaced.revision);
  assert.equal((await f.run('read_canvas')).shapes.length, 2);
  const removed = await f.run('remove_canvas_shapes', { ids: ['first'] });
  assert.equal(removed.kind, 'saved'); assert.deepEqual(removed.shapes.map(shape => shape.id), ['second']);
  assert.equal(await f.baseline(), removed.revision);
  const connection = openNodeConnection(join(f.directory, 'files.sqlite'));
  try {
    const fs = openSqliteFileSystem({ connection, workspace: access.scopeId, cwd: '/workspace' });
    assert.equal((await fs.remove('board.tldraw', {}, context)).ok, true);
  } finally { connection.close(); }
  assert.equal((await f.run('read_canvas')).kind, 'missing');
  const recreated = await f.run('add_canvas_shapes', { shapes: [shape('new')] });
  assert.equal(recreated.kind, 'saved');
  assert.deepEqual(recreated.shapes.map(shape => shape.id), ['new']);
  assert.equal(await f.baseline(), recreated.revision);
});

for (const kind of ['denied', 'unavailable', 'unknown', 'conflict']) test(`canvas ${kind} publication does not advance the conversation baseline`, async t => {
  const f = await fixture(t);
  const before = await f.run('add_canvas_shapes', { shapes: [shape('first')] });
  f.control.publish = async request => ({ kind, reason: 'Fictional refusal', ...(kind === 'unknown' ? { operationId: request.operationId } : kind === 'conflict' ? { current: [] } : {}) });
  assert.equal((await f.run('add_canvas_shapes', { shapes: [shape('second')] })).kind, kind);
  assert.equal(await f.baseline(), before.revision);
  assert.equal((await f.read()).snapshot.ref.revision, before.revision);
});

const mismatches = {
  malformed: result => { delete result.receipt; },
  revision: result => { delete result.receipt.changes[0].after.revision; },
  beforeTarget: result => { result.receipt.changes[0].before.resource.path += '.other'; },
  operation: result => { result.receipt.operationId += '-other'; },
  digest: result => { result.receipt.argumentDigest = '0'.repeat(64); },
  scope: result => { result.receipt.scopeId += '-other'; },
  principal: result => { result.receipt.principalId += '-other'; },
  initiator: result => { result.receipt.initiatorId += '-other'; },
  count: result => { result.receipt.changes.push(structuredClone(result.receipt.changes[0])); },
  target: result => { result.receipt.changes[0].after.resource.path += '.other'; },
  provider: result => { result.receipt.changes[0].after.resource.providerId += '-other'; },
  view: result => { result.receipt.changes[0].after.view = { kind: 'working', viewId: 'other' }; },
  before: result => { result.receipt.changes[0].before.revision += '-other'; },
  kind: result => { result.receipt.changes[0].kind = 'create'; result.receipt.changes[0].before = null; },
};
for (const [name, alter] of Object.entries(mismatches)) test(`canvas ${name} acknowledgement and lookup leave the committed write unconfirmed and preserves the prior baseline`, async t => {
  const f = await fixture(t);
  const before = await f.run('add_canvas_shapes', { shapes: [shape('first')] });
  let operationId;
  f.control.publish = async (request, granted) => {
    operationId = request.operationId;
    const result = structuredClone(await f.actual.publication.publish(request, granted));
    assert.equal(result.kind, 'committed'); alter(result); return result;
  };
  f.control.lookup = async (id, granted) => {
    const result = structuredClone(await f.actual.reconciliation.lookup(id, granted));
    assert.equal(result.kind, 'committed'); alter(result); return result;
  };
  const result = await f.run('add_canvas_shapes', { shapes: [shape('second')] });
  assert.equal(result.kind, 'unknown');
  assert.equal(result.operationId, operationId);
  assert.equal(await f.baseline(), before.revision);
  assert.notEqual((await f.read()).snapshot.ref.revision, before.revision);
  assert.equal((await f.run('remove_canvas_shapes', { ids: ['first'] })).kind, 'conflict');
});

test('a create acknowledgement claiming replacement remains unconfirmed without recording an unread baseline', async t => {
  const f = await fixture(t);
  f.control.publish = async (request, granted) => {
    const result = structuredClone(await f.actual.publication.publish(request, granted));
    assert.equal(result.kind, 'committed');
    result.receipt.changes[0].kind = 'replace';
    result.receipt.changes[0].before = { ...structuredClone(result.receipt.changes[0].after), revision: 'unrelated-before' };
    return result;
  };
  f.control.lookup = async () => ({ kind: 'not-found' });
  assert.equal((await f.run('add_canvas_shapes', { shapes: [shape('first')] })).kind, 'unknown');
  assert.equal(await f.baseline(), undefined);
  assert.equal((await f.run('add_canvas_shapes', { shapes: [shape('second')] })).kind, 'conflict');
});

async function nestedCanvas(t, { rootType = 'group', reverse = false } = {}) {
  const f = await fixture(t);
  await f.run('add_canvas_shapes', { shapes: [shape('leaf'), shape('outside-a'), shape('outside-b')] });
  const schema = createTLSchema();
  let sequence = 0;
  const rewrite = async change => {
    const saved = await f.read();
    const document = JSON.parse(new TextDecoder().decode(saved.snapshot.bytes));
    change(document);
    for (const record of Object.values(document.store)) schema.types[record.typeName].validate(record);
    const result = await f.actual.publication.publish({ operationId: `fictional-hierarchy-${sequence++}`, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: saved.snapshot.ref,
      mediaType: saved.snapshot.mediaType, bytes: new TextEncoder().encode(JSON.stringify(document)) }] }, access);
    assert.equal(result.kind, 'committed');
    await f.run('read_canvas');
  };
  await rewrite(document => {
    const page = Object.values(document.store).find(record => record.typeName === 'page');
    const container = (id, type, parentId, index = 'a1') => schema.types.shape.create({ id: createShapeId(id), type, parentId, index,
      props: type === 'frame' ? { w: 500, h: 500, name: id, color: 'black' } : {} });
    for (const record of [container('root', rootType, page.id, 'a4'), container('middle', rootType === 'group' ? 'frame' : 'group', createShapeId('root')),
      container('inner', 'group', createShapeId('middle'))]) document.store[record.id] = record;
    document.store['shape:leaf'].parentId = createShapeId('inner');
  });
  await f.run('add_canvas_shapes', { arrows: [{ from: 'leaf', to: 'outside-a' }, { from: 'middle', to: 'outside-b' },
    { from: 'outside-a', to: 'outside-b' }, { from: 'outside-a', to: 'outside-b' }] });
  await rewrite(document => {
    document.store['shape:arrow-outside-a-outside-b-2'].parentId = createShapeId('inner');
    if (reverse) document.store = Object.fromEntries(Object.entries(document.store).reverse());
  });
  const document = async () => JSON.parse(new TextDecoder().decode((await f.read()).snapshot.bytes));
  return { ...f, document };
}

for (const rootType of ['group', 'frame']) for (const reverse of [false, true]) {
  test(`removing a nested ${rootType} removes descendant arrows and bindings with ${reverse ? 'reversed' : 'forward'} record insertion`, async t => {
    const f = await nestedCanvas(t, { rootType, reverse });
    const before = await f.document();
    const result = await f.run('remove_canvas_shapes', { ids: ['root'] });
    assert.equal(result.kind, 'saved');
    assert.deepEqual(result.shapes.map(shape => shape.id).sort(), ['arrow-outside-a-outside-b', 'outside-a', 'outside-b']);
    const after = await f.document();
    const surviving = ['shape:outside-a', 'shape:outside-b', 'shape:arrow-outside-a-outside-b',
      'binding:arrow-outside-a-outside-b-start', 'binding:arrow-outside-a-outside-b-end'];
    assert.deepEqual(Object.values(after.store).filter(record => record.typeName === 'shape' || record.typeName === 'binding').map(record => record.id).sort(), [...surviving].sort());
    for (const id of surviving) assert.deepEqual(after.store[id], before.store[id]);
    for (const binding of Object.values(after.store).filter(record => record.typeName === 'binding')) {
      assert.ok(after.store[binding.fromId]); assert.ok(after.store[binding.toId]);
    }
    assert.equal(await f.baseline(), result.revision);
  });
}

test('removing an arrow removes both bindings and preserves its endpoints and unrelated records', async t => {
  const f = await nestedCanvas(t);
  const before = await f.document();
  const result = await f.run('remove_canvas_shapes', { ids: ['arrow-leaf-outside-a'] });
  assert.equal(result.kind, 'saved');
  const after = await f.document();
  const removed = new Set(['shape:arrow-leaf-outside-a', 'binding:arrow-leaf-outside-a-start', 'binding:arrow-leaf-outside-a-end']);
  assert.deepEqual(after.store, Object.fromEntries(Object.entries(before.store).filter(([id]) => !removed.has(id))));
  assert.ok(after.store['shape:leaf']); assert.ok(after.store['shape:outside-a']);
});

for (const invalid of ['parent', 'schema', 'media']) test(`canvas tools refuse invalid saved ${invalid} before recording or publishing a baseline`, async t => {
  const f = await fixture(t);
  const before = await f.run('add_canvas_shapes', { shapes: [shape('first')] });
  const read = await f.read(), document = JSON.parse(new TextDecoder().decode(read.snapshot.bytes));
  if (invalid === 'parent') document.store['shape:first'].parentId = 'page:missing';
  if (invalid === 'schema') document.schema.sequences = {};
  if (invalid === 'media') f.control.read = async (request, granted) => {
    const result = await f.actual.read(request, granted);
    return result.kind === 'available' ? { ...result, snapshot: { ...result.snapshot, mediaType: 'application/json' } } : result;
  };
  const corrupted = await f.actual.publication.publish({ operationId: `fictional-invalid-${invalid}`, atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: read.snapshot.ref,
    mediaType: read.snapshot.mediaType, bytes: new TextEncoder().encode(JSON.stringify(document)) }] }, access);
  assert.equal(corrupted.kind, 'committed');
  assert.equal((await f.run('read_canvas')).kind, 'unavailable');
  assert.equal(await f.baseline(), before.revision);
  assert.equal((await f.run('add_canvas_shapes', { shapes: [shape('second')] })).kind, 'unavailable');
  assert.equal((await f.run('remove_canvas_shapes', { ids: ['first'] })).kind, 'unavailable');
  assert.equal((await f.read()).snapshot.ref.revision, corrupted.receipt.changes[0].after.revision);
});
