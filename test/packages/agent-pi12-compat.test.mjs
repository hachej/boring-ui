// Pi 1.2 compatibility: nested tool callers and records written under Pi 1.1.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Harness, MemoryStorage, createRegistry, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { createAskUserTool } from '@hachej/boring-agent/ask-user';
import { createBrowserTaskTool } from '@hachej/boring-agent/browser-task';
import { requireApproval } from '@hachej/boring-agent/approval';
import { createConversationTextReceiver } from '@hachej/boring-agent/projection';
import { admitDocumentTool, toolResultText } from '../fixtures/native-document.mjs';

// The wait tools bind to the calling model entry and call id, which a nested `api.executeTool` caller does not have.
// Pi's caller check must refuse the nested call up front, with a clear error, instead of a throw inside the binding.
test('ask_user, browser tasks and approval-gated tools refuse nested callers through Pi’s callers metadata', { timeout: 15000 }, async t => {
  const gated = requireApproval(defineTool({ name: 'gated_change', description: 'Fictional change.', parameters: Type.Object({}), replay: 'safe',
    execute: async () => ({ output: [{ type: 'text', text: 'changed' }] }) }), { summarize: () => 'Change it' });
  const browser = createBrowserTaskTool({ name: 'fictional_browser', description: 'Fictional browser task.', parameters: Type.Object({}) });
  const attempts = {};
  const driver = defineTool({ name: 'nested_driver', description: 'Calls each wait tool as a nested caller.', parameters: Type.Object({}), replay: 'safe',
    execute: async (_args, api, ctx) => {
      for (const [name, args] of [['ask_user', { question: 'Which?', options: ['a', 'b'] }], ['fictional_browser', {}], ['gated_change', {}]]) {
        try { attempts[name] = JSON.stringify(await api.executeTool(name, args, ctx)); } catch (error) { attempts[name] = String(error?.message ?? error); }
      }
      return { output: [{ type: 'text', text: JSON.stringify(attempts) }] };
    } });
  const registry = createRegistry();
  registry.install(defineExtension({ name: 'fixture.nested', tools: [createAskUserTool(), browser, gated, driver] }));
  const harness = await Harness.open(new MemoryStorage(), { registry, models: createModels() }, context);
  t.after(() => harness.close(context));
  const conversation = await harness.root(context);
  const taskId = await admitDocumentTool(conversation, {}, 'nested_driver');
  const { text } = await toolResultText(harness, conversation, taskId);
  const seen = JSON.parse(text);
  for (const name of ['ask_user', 'fictional_browser', 'gated_change']) {
    const result = JSON.parse(seen[name]);
    assert.equal(result.isError, true, `${name} must not run for a nested caller`);
    assert.deepEqual(result.diagnostics.map(d => d.code), ['tool_unavailable'], name);
  }
});

const identity = { runtimeId: 'fictional-runtime', scopeId: 'fictional-team', principalId: 'fictional-reader', conversationId: 1 };
test('a conversation-text frame from a Pi 1.1 server is accepted', () => {
  const frame = { schema: 'boring.conversation-text', version: 2, nativeVersion: 'pi-durable@1.1.0', source: { ...identity }, kind: 'snapshot',
    connection: { id: '11111111-1111-4111-8111-111111111111', frame: 0, observedAt: '2026-10-03T00:00:00.000Z' }, window: { truncated: false },
    messages: [{ conversationId: 1, entryId: 2, messageIndex: 0, role: 'user', content: [{ blockIndex: 0, text: 'Fictional' }], clipped: false }] };
  const view = createConversationTextReceiver(identity).read(JSON.stringify(frame) + '\n');
  assert.equal(view.messages.length, 1);
});
