import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
import { Harness, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { Type } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createPresentationTool } from '@hachej/boring-agent/presentation';
import { createCanvasTransport } from '../../examples/shared/canvas-transport-server.mjs';
import { schema, version } from '../../examples/shared/canvas-transport-protocol.mjs';
import { admitDocumentTool } from './native-document.mjs';

const [directory, phase] = process.argv.slice(2), keepAlive = setInterval(() => {}, 1000);
const target = { instanceId: 'viewer', epoch: 'epoch', subject: { scopeId: 'fictional-scope', base: { kind: 'absent', target: { resource: { providerId: 'fictional', path: 'board.tldraw' }, view: { kind: 'published' } } }, bufferVersion: 0, mountId: 'mount', pageId: 'page:one' } };
const revoked = new AbortController();
const host = createCanvasTransport({ timeoutMs: 60_000, authenticate: async () => ({ identity: { runtimeId: 'fictional', conversationId: 'fictional', scopeId: 'fictional-scope', principalId: 'fictional' }, revoked: revoked.signal }), authorize: () => true });
const request = (op, body, id) => new Request(`https://fictional.test/?op=${op}${id ? `&connectionId=${id}` : ''}`, { method: op === 'poll' ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const opened = await (await host.handle(request('open', { schema, version, target }))).json();
const connection = host.getConnection(opened.connectionId);
const tool = createPresentationTool({ name: 'fixture_select', description: 'Fictional remote selection', parameters: Type.Object({}), target, command: connection.select,
  prepareInput: () => ({ expiresAt: Date.now() + 60_000, shapeIds: ['shape:one'] }), authorize: () => true, formatResult: result => ({ content: [{ type: 'text', text: result.kind }] }) });
const registry = createRegistry(); registry.install(defineExtension({ name: 'fixture.remote-presentation', tools: [tool] }));
const harness = await Harness.open(await openNodeSqliteStorage(join(directory, 'native.sqlite')), { registry, models: createModels() }, context);
const conversation = await harness.root(context);
const receiving = host.handle(request('poll', undefined, opened.connectionId)).then(async response => {
  if (response.status !== 200) return;
  const envelope = await response.json();
  // This callback models transport delivery, not an actual browser editor effect.
  appendFileSync(join(directory, 'effects'), JSON.stringify(envelope.input.shapeIds) + '\n');
  if (phase === 'hold') { writeFileSync(join(directory, 'ready'), 'effect-before-ack'); return; }
  await host.handle(request('result', { schema, version, connectionId: opened.connectionId, requestId: envelope.requestId, result: { kind: 'applied' } }));
});
await turn();
let taskId;
if (phase === 'hold') {
  taskId = await admitDocumentTool(conversation, {}, tool.name);
  writeFileSync(join(directory, 'task.json'), JSON.stringify(taskId));
} else taskId = JSON.parse(readFileSync(join(directory, 'task.json'), 'utf8'));
const terminal = await harness.waitForTask(taskId, context);
writeFileSync(join(directory, 'recovered.json'), JSON.stringify(terminal));
host.close(); await receiving; await harness.close(context); clearInterval(keepAlive);
