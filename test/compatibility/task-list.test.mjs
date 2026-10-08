import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { applyTaskListOperations, emptyTaskList, parseTaskList, parseTaskListOperations, readTaskList, serializeTaskList, taskListKind, taskListMediaType } from '../../registry/task-list-viewer/task-list-document.ts';
import { createTaskListTools } from '../../examples/shared/task-list-tools.mjs';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { admitDocumentTool, documentToolResult } from '../fixtures/native-document.mjs';

const root = new URL('../../', import.meta.url).pathname;
mkdirSync(join(root, '.cache'), { recursive: true });
const compiled = mkdtempSync(join(root, '.cache/task-list-test-'));
await build({ entryPoints: [join(root, 'registry/task-list-viewer/task-list-controller.ts')], bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: join(compiled, 'controller.mjs') });
const { createTaskListController, createTaskListFeature } = await import(pathToFileURL(join(compiled, 'controller.mjs')).href);
test.after(() => rmSync(compiled, { recursive: true, force: true }));
const access = { principalId: 'fictional-agent', scopeId: 'fictional-project', initiatorId: 'fictional-human' };
const target = { resource: { providerId: 'fictional-tasks', path: 'tasks.json' }, view: { kind: 'published' } };
const add = (id, title = id) => ({ kind: 'add', id, title });
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-task-list-'));
  let authorized = true;
  const owner = openSqliteWorkspaces({ filename: join(directory, 'files.sqlite'), providerId: target.resource.providerId, authorize: () => authorized });
  const calls = { publish: 0 };
  const control = { publish: async (request, granted) => { calls.publish++; return owner.publication.publish(request, granted); }, lookup: (id, granted) => owner.reconciliation.lookup(id, granted) };
  const client = { read: request => owner.read(request, access), publish: request => control.publish(request, access), lookup: id => control.lookup(id, access) };
  const resolver = { bindingId: 'fictional-persistent-incarnation', reader: owner, publisher: { publish: (request, granted) => control.publish(request, granted) }, lookup: { lookup: (id, granted) => control.lookup(id, granted) }, target, access };
  const tools = createTaskListTools({ namespace: 'fixture-tasks', resolve: () => resolver });
  const registry = createRegistry(); registry.install(defineExtension({ name: 'fixture.tasks', tools }));
  const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
  const conversation = await harness.root(context);
  const controllers = [];
  const options = source => ({ identity: access, instanceId: `viewer-${controllers.length}`, epoch: 'epoch-1', client, source: source ?? { kind: 'new', target } });
  const create = (source, extra = {}) => { const controller = createTaskListController({ ...options(source), ...extra }); controllers.push(controller); return controller; };
  const run = async (name, args = {}) => (await documentToolResult(harness, conversation, await admitDocumentTool(conversation, args, name))).result;
  const read = () => owner.read({ target, revision: { kind: 'latest' } }, access);
  t.after(async () => { for (const controller of controllers) controller.dispose(); await harness.close(context); owner.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, owner, client, control, calls, options, create, run, read, resolver, revoke: () => { authorized = false; } };
}

test('strict immutable domain rejects malformed, oversized and conflicting batches without changing input', () => {
  const empty = emptyTaskList(), document = applyTaskListOperations(empty, [add('one'), add('two')]);
  assert.deepEqual(empty.items, []);
  assert.ok(Object.isFrozen(document) && Object.isFrozen(document.items) && Object.isFrozen(document.items[0]));
  assert.throws(() => applyTaskListOperations(document, [{ kind: 'rename', id: 'one', title: 'changed' }, add('two')]));
  assert.equal(document.items[0].title, 'one');
  for (const invalid of [{ ...document, version: 2 }, { ...document, extra: true }, { ...document, items: [document.items[0], document.items[0]] }, { ...document, items: [{ id: 'x', title: '\ud800', completed: false }] }]) assert.throws(() => parseTaskList(invalid));
  assert.throws(() => parseTaskListOperations([{ ...add('one'), extra: true }]));
  assert.throws(() => parseTaskListOperations(Array(101).fill(add('one'))));
  assert.throws(() => parseTaskList({ ...empty, items: Array.from({ length: 100 }, (_, id) => ({ id: String(id), title: 'x'.repeat(2048), completed: false })) }));
  assert.deepEqual(readTaskList(serializeTaskList(document)), document);
  assert.equal(applyTaskListOperations(document, [{ kind: 'set-completed', id: 'one', completed: true }]).items[0].completed, true);
});

test('human and native operations share transforms and real conditional resource publication', async t => {
  const f = await fixture(t), controller = f.create();
  assert.equal(f.calls.publish, 0);
  const old = controller.actions.selection();
  assert.equal(controller.actions.edit(old, [add('one')]).kind, 'applied');
  assert.equal(controller.actions.edit(old, [add('stale')]).kind, 'stale');
  assert.equal((await controller.flush(old)).kind, 'conflict');
  const saved = await controller.flush(controller.actions.selection());
  assert.equal(saved.kind, 'saved'); assert.equal(f.calls.publish, 1);
  assert.equal(saved.receipt.changes[0].after.revision, (await f.read()).snapshot.ref.revision);
  const read = await f.run('read_task_list');
  assert.deepEqual(read.document, controller.getSnapshot().document);
  const edited = await f.run('edit_task_list', { expected: { kind: 'revision', revision: read.revision }, operations: [{ kind: 'set-completed', id: 'one', completed: true }] });
  assert.equal(edited.kind, 'saved');
  await controller.actions.refresh();
  assert.equal(controller.getSnapshot().document.items[0].completed, true);
  const stale = await f.run('edit_task_list', { expected: { kind: 'revision', revision: read.revision }, operations: [add('old')] });
  assert.equal(stale.kind, 'conflict'); assert.equal(f.calls.publish, 2);
});

test('dirty refresh and late save acknowledgement preserve human changes', async t => {
  const f = await fixture(t), controller = f.create();
  controller.actions.edit(controller.actions.selection(), [add('one')]);
  let release, committed;
  const ready = new Promise(resolve => { committed = resolve; });
  f.control.publish = async (request, granted) => { const result = await f.owner.publication.publish(request, granted); committed(); await new Promise(resolve => { release = resolve; }); return result; };
  const saving = controller.flush(controller.actions.selection()); await ready;
  controller.actions.edit(controller.actions.selection(), [{ kind: 'rename', id: 'one', title: 'later human edit' }]);
  release(); assert.equal((await saving).kind, 'saved');
  assert.equal(controller.getSnapshot().dirty, true); assert.equal(controller.getSnapshot().document.items[0].title, 'later human edit');
  f.control.publish = (request, granted) => f.owner.publication.publish(request, granted);
  const current = await f.run('read_task_list');
  const native = await f.run('edit_task_list', { expected: { kind: 'revision', revision: current.revision }, operations: [add('native')] });
  assert.equal(native.kind, 'saved');
  await controller.actions.refresh();
  assert.equal(controller.getSnapshot().remote.target.revision, native.revision);
  assert.equal(controller.getSnapshot().document.items.length, 1);
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'conflict');
  await controller.actions.discardToRemote();
  assert.deepEqual(controller.getSnapshot().document.items.map(item => item.id), ['one', 'native']);
  assert.equal(controller.getSnapshot().dirty, false);
});

test('unknown saves use receipt lookup without a second write; native loss uses the same authority', async t => {
  const f = await fixture(t), controller = f.create();
  controller.actions.edit(controller.actions.selection(), [add('one')]);
  let writes = 0;
  f.control.publish = async (request, granted) => { writes++; await f.owner.publication.publish(request, granted); throw new Error('Fictional lost acknowledgement'); };
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unknown');
  assert.equal((await controller.actions.reconcile()).kind, 'saved'); assert.equal(writes, 1);
  const current = await f.run('read_task_list');
  const saved = await f.run('edit_task_list', { expected: { kind: 'revision', revision: current.revision }, operations: [add('two')] });
  assert.equal(saved.kind, 'saved'); assert.equal(writes, 2);
  assert.deepEqual(saved.document.items.map(item => item.id), ['one', 'two']);
  f.control.publish = async () => { writes++; throw new Error('Fictional no receipt'); };
  const unresolved = await f.run('edit_task_list', { expected: { kind: 'revision', revision: saved.revision }, operations: [add('three')] });
  assert.equal(unresolved.kind, 'unknown'); assert.equal(writes, 3);
  assert.deepEqual(readTaskList(new TextDecoder().decode((await f.read()).snapshot.bytes)).items.map(item => item.id), ['one', 'two']);
});

test('readonly, inspection expiry, malformed remote bytes and disposal refuse without stealing ownership', async t => {
  const f = await fixture(t), editable = f.create(), readOnly = f.create(undefined, { readOnly: true });
  assert.equal(readOnly.actions.edit(readOnly.actions.selection(), [add('no')]).kind, 'denied');
  assert.equal((await readOnly.flush(readOnly.actions.selection())).kind, 'denied');
  editable.actions.edit(editable.actions.selection(), [add('one')]);
  assert.equal((await editable.tools.inspect.invoke(editable.actions.selection().target, { expiresAt: 0 })).kind, 'stale');
  const inspected = await editable.tools.inspect.invoke(editable.actions.selection().target, { expiresAt: Date.now() + 1000 });
  assert.equal(inspected.kind, 'applied'); assert.equal(inspected.value.dirty, true);
  const saved = await editable.flush(editable.actions.selection());
  await f.owner.publication.publish({ operationId: 'invalid-remote', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: saved.ref, bytes: new TextEncoder().encode('{"kind":"unknown"}'), mediaType: taskListMediaType }] }, access);
  assert.equal((await editable.actions.refresh()).kind, 'unavailable');
  assert.equal(editable.getSnapshot().document.items[0].id, 'one');
  editable.dispose();
  assert.equal(editable.actions.edit(editable.actions.selection(), [add('no')]).kind, 'unavailable');
  assert.equal(readOnly.getSnapshot().lifecycle, 'active'); assert.equal((await f.read()).kind, 'available');
});

test('feature rejects schema/version/source substitution and retains concrete controller capabilities', async t => {
  const f = await fixture(t), options = f.options();
  const feature = createTaskListFeature(options);
  const descriptor = feature.descriptor.parse({ kind: taskListKind, version: 1, source: target });
  for (const value of [{ ...descriptor, kind: 'unknown' }, { ...descriptor, version: 2 }, { ...descriptor, credentials: 'forbidden' }]) assert.throws(() => feature.descriptor.parse(value));
  assert.throws(() => feature.createController({ ...descriptor, source: { ...target, resource: { ...target.resource, path: 'other.json' } } }));
  options.source.target = { ...target, resource: { ...target.resource, path: 'mutated.json' } };
  const controller = feature.createController(descriptor); t.after(() => controller.dispose());
  assert.equal(controller.actions.selection().target.subject.base.target.resource.path, 'tasks.json');
  controller.actions.edit(controller.actions.selection(), [add('one')]);
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'saved');
  f.revoke();
  const denied = await f.run('read_task_list'); assert.equal(denied.kind, 'denied');
});

for (const mode of ['committed', 'newer', 'missing', 'binding', 'actor', 'revoked']) test(`native SQLite SIGKILL recovery uses only retained receipt lookup: ${mode}`, { timeout: 20000 }, async t => {
  const { readFile, access: exists } = await import('node:fs/promises');
  const { spawn } = await import('node:child_process'), { once } = await import('node:events');
  const directory = mkdtempSync(join(tmpdir(), 'fictional-task-list-crash-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const child = phase => spawn(process.execPath, [new URL('../fixtures/task-list-crash-child.mjs', import.meta.url).pathname, directory, phase, mode], { stdio: ['ignore', 'ignore', 'pipe'] });
  const holding = child('hold'); let errors = ''; holding.stderr.on('data', data => { errors += data; });
  const exited = once(holding, 'exit'); t.after(() => holding.kill('SIGKILL'));
  const deadline = Date.now() + 10000;
  while (true) {
    try { await exists(join(directory, 'ready')); await exists(join(directory, 'task.json')); break; }
    catch { assert.equal(holding.exitCode, null, errors); assert.ok(Date.now() < deadline, 'publication attempt was never reached'); await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  const request = JSON.parse(await readFile(join(directory, 'request.json'), 'utf8'));
  holding.kill('SIGKILL'); assert.deepEqual(await exited, [null, 'SIGKILL']);
  const recovering = child('recover'); recovering.stderr.on('data', data => { errors += data; }); t.after(() => recovering.kill('SIGKILL'));
  assert.deepEqual(await once(recovering, 'exit'), [0, null], errors);
  assert.equal(await readFile(join(directory, 'attempts'), 'utf8'), 'publish\n');
  const { result, saved } = JSON.parse(await readFile(join(directory, 'recovered.json'), 'utf8'));
  if (mode === 'committed' || mode === 'newer') {
    assert.equal(result.kind, 'saved');
    assert.equal(result.receipt.operationId, request.operationId);
    assert.equal(serializeTaskList(result.document), request.text);
    assert.deepEqual(result.document.items.map(item => item.id), ['native']);
    if (mode === 'newer') { assert.notEqual(result.revision, saved.revision); assert.deepEqual(saved.document.items.map(item => item.id), ['native', 'human']); }
    else assert.equal(result.revision, saved.revision);
  } else {
    assert.equal(result.kind, 'unknown'); assert.equal(result.operationId, request.operationId);
    if (mode === 'missing') assert.equal(saved.kind, 'missing');
    else assert.deepEqual(saved.document.items.map(item => item.id), ['native']);
    if (mode === 'binding' || mode === 'actor') await assert.rejects(readFile(join(directory, 'lookups')), { code: 'ENOENT' });
  }
});

test('a forged receipt cannot manufacture task-list save evidence', async t => {
  const f = await fixture(t);
  f.control.publish = async (request, granted) => {
    const result = await f.owner.publication.publish(request, granted);
    return { ...result, receipt: { ...result.receipt, argumentDigest: 'forged' } };
  };
  f.control.lookup = async () => ({ kind: 'not-found' });
  const result = await f.run('edit_task_list', { expected: { kind: 'absent' }, operations: [add('one')] });
  assert.equal(result.kind, 'unknown');
  assert.deepEqual(readTaskList(new TextDecoder().decode((await f.read()).snapshot.bytes)).items.map(item => item.id), ['one']);
});

test('an unreceipted viewer save preserves its draft and can be abandoned without replay', async t => {
  const f = await fixture(t), controller = f.create();
  let writes = 0;
  f.control.publish = async () => { writes++; throw new Error('Fictional disconnected publisher'); };
  controller.actions.edit(controller.actions.selection(), [add('draft')]);
  assert.equal((await controller.flush(controller.actions.selection())).kind, 'unknown');
  assert.equal((await controller.actions.reconcile()).kind, 'unknown');
  assert.equal((await controller.actions.abandon()).kind, 'missing');
  assert.equal(controller.getSnapshot().dirty, true);
  assert.deepEqual(controller.getSnapshot().document.items.map(item => item.id), ['draft']);
  assert.equal(writes, 1);
});
