import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry, defineExtension } from '@earendil-works/pi-durable';
import { createModels } from '@earendil-works/pi-ai/models';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createPresentationTool } from '@hachej/boring-agent/presentation';
import { connectCanvasPresentation } from '../../examples/shared/canvas-transport-client.mjs';
import { createCanvasTransport } from '../../examples/shared/canvas-transport-server.mjs';
import { schema, version } from '../../examples/shared/canvas-transport-protocol.mjs';
import { admitDocumentTool, toolResultText } from '../fixtures/native-document.mjs';
const target = { instanceId: 'viewer', epoch: 'mount', subject: { scopeId: 'fictional', base: { kind: 'revision', target: { resource: { providerId: 'fictional', path: 'board.canvas' }, view: { kind: 'published' }, revision: 'r1' } }, bufferVersion: 0, mountId: 'm1', pageId: 'page:one' } };

for (const lost of [false, true]) test(`native Harness and transport with simulated browser, lost reply ${lost}`, async t => {
  const revoked = new AbortController();
  const bridge = createCanvasTransport({ timeoutMs: 1000, authenticate: async () => ({
    identity: { runtimeId: 'native', conversationId: '1', scopeId: 'fictional', principalId: 'browser' }, revoked: revoked.signal,
  }), authorize: () => true });
  let effects = 0, polls = 0;
  const tools = { getTarget: () => target, select: { invoke: async (selected, input) => {
    assert.deepEqual(selected, target);
    assert.deepEqual(input.shapeIds, ['shape:reviewed']);
    effects++;
    return { kind: 'applied', value: undefined };
  } } };
  const client = await connectCanvasPresentation({ endpoint: 'https://fictional.invalid/canvas', tools, fetch: async request => {
    const op = new URL(request.url).searchParams.get('op');
    if (op === 'poll') polls++;
    if (op === 'result' && lost) throw new Error('lost reply');
    return bridge.handle(request);
  } });
  const connection = bridge.getConnection(client.id);
  const registry = createRegistry();
  const tool = createPresentationTool({ name: 'remote_select', description: 'Simulated browser select through actual transport',
    parameters: Type.Object({ shapeIds: Type.Array(Type.String()) }), command: connection.select, target,
    prepareInput: args => ({ ...args, expiresAt: Date.now() + 1000 }), authorize: () => true,
    formatResult: result => ({ content: [{ type: 'text', text: JSON.stringify(result) }] }),
  });
  const extension = defineExtension({ name: 'fixture.remote', tools: [tool] });
  registry.install(extension);
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(async () => { await client.close(); bridge.close(); await harness.close(context); });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(polls > 0);
  const conversation = await harness.root(context);
  await conversation.configure({ extensions: [extension] }, context);
  const task = await admitDocumentTool(conversation, { shapeIds: ['shape:reviewed'] }, tool.name);
  const outcome = await toolResultText(harness, conversation, task);
  assert.equal(JSON.parse(outcome.text).kind, lost ? 'unknown' : 'applied');
  assert.equal(effects, 1);
});

test('duplicate request never invokes twice', async () => {
  let count = 0, sends = 0;
  const envelope = { schema, version, connectionId: 'connection', requestId: 'request', command: 'select', target,
    input: { expiresAt: Date.now() + 1000, shapeIds: [] } };
  const client = await connectCanvasPresentation({ endpoint: 'https://fictional.invalid',
    tools: { getTarget: () => target, select: { invoke: async () => { count++; return { kind: 'applied' }; } } },
    fetch: async request => {
      const op = new URL(request.url).searchParams.get('op'); sends++;
      if (op === 'open') return Response.json({ schema, version, connectionId: 'connection', target });
      if (op === 'poll') return Response.json(envelope);
      return new Response(null, { status: 204 });
    },
  });
  await client.closed;
  assert.equal(count, 1);
  assert.ok(sends < 10);
});

test('close interrupts injected stalled poll and preserves borrowed tools', async () => {
  let disposed = 0;
  const client = await connectCanvasPresentation({ endpoint: 'https://fictional.invalid',
    tools: { getTarget: () => target, dispose: () => disposed++ },
    fetch: async request => {
      const op = new URL(request.url).searchParams.get('op');
      if (op === 'open') return Response.json({ schema, version, connectionId: 'connection', target });
      if (op === 'poll') return new Promise(() => {});
      return new Response(null, { status: 204 });
    },
  });
  await client.close();
  assert.equal(disposed, 0);
});
