import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createTaskListTools } from '../../examples/shared/task-list-tools.mjs';
import { openSqliteWorkspaces } from '../../examples/shared/sqlite-workspaces.mjs';
import { applyTaskListOperations, readTaskList, serializeTaskList, taskListMediaType } from '../../registry/task-list-viewer/task-list-document.ts';
import { admitDocumentTool, documentToolResult } from './native-document.mjs';

const [directory, phase, mode] = process.argv.slice(2), keepAlive = setInterval(() => {}, 1000);
const access = { principalId: 'fictional-agent', scopeId: 'fictional-scope', initiatorId: 'fictional-human' };
const target = { resource: { providerId: 'fictional-tasks', path: 'tasks.json' }, view: { kind: 'published' } };
const owner = openSqliteWorkspaces({ filename: join(directory, 'files.sqlite'), providerId: target.resource.providerId, authorize: () => !(phase === 'recover' && mode === 'revoked') });
const actual = owner.workspace(access.scopeId);
if (phase === 'recover' && mode === 'newer') {
  const current = await actual.read({ target, revision: { kind: 'latest' } }, access);
  const next = applyTaskListOperations(readTaskList(new TextDecoder().decode(current.snapshot.bytes)), [{ kind: 'add', id: 'human', title: 'Later human task' }]);
  await actual.publication.publish({ operationId: 'later-human', atomicity: 'all-or-nothing', changes: [{ kind: 'replace', target: current.snapshot.ref, mediaType: taskListMediaType, bytes: new TextEncoder().encode(serializeTaskList(next)) }] }, access);
}
const binding = { bindingId: phase === 'recover' && mode === 'binding' ? 'replacement' : 'fictional-original', target,
  access: phase === 'recover' && mode === 'actor' ? { ...access, principalId: 'different-person' } : access,
  reader: owner,
  publisher: { publish: async (request, granted) => {
    appendFileSync(join(directory, 'attempts'), 'publish\n');
    writeFileSync(join(directory, 'request.json'), JSON.stringify({ operationId: request.operationId, text: new TextDecoder().decode(request.changes[0].bytes) }));
    const result = mode === 'missing' ? undefined : await owner.publication.publish(request, granted);
    if (phase === 'hold') { writeFileSync(join(directory, 'ready'), 'attempted'); await new Promise(() => {}); }
    return result;
  } },
  lookup: { lookup: (id, granted) => { appendFileSync(join(directory, 'lookups'), 'lookup\n'); return owner.reconciliation.lookup(id, granted); } },
};
const registry = createRegistry(); registry.install(defineExtension({ name: 'fixture.task-list-recovery', tools: createTaskListTools({ namespace: 'fictional-task-list', resolve: () => binding }) }));
const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
const conversation = await harness.root(context);
let taskId;
if (phase === 'hold') {
  taskId = await admitDocumentTool(conversation, { expected: { kind: 'absent' }, operations: [{ kind: 'add', id: 'native', title: 'Original native task' }] }, 'edit_task_list');
  writeFileSync(join(directory, 'task.json'), JSON.stringify(taskId));
} else taskId = JSON.parse(readFileSync(join(directory, 'task.json'), 'utf8'));
const settled = await documentToolResult(harness, conversation, taskId);
const read = await actual.read({ target, revision: { kind: 'latest' } }, access);
writeFileSync(join(directory, 'recovered.json'), JSON.stringify({ result: settled.result, saved: read.kind === 'available' ? { revision: read.snapshot.ref.revision, document: readTaskList(new TextDecoder().decode(read.snapshot.bytes)) } : read }));
await harness.close(context); owner.close(); clearInterval(keepAlive);
