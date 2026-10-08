import { AssistantEntry, ToolTask, ToolResultEntry, defineTool } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';

export async function admitDocumentTool(conversation, args, name = 'save_note') {
  return conversation.commit(async tx => {
    const entry = await tx.appendEntry(AssistantEntry, conversation.id, { model: [{
      role: 'assistant', content: [{ type: 'toolCall', id: 'fixture-call', name, arguments: args }],
      api: 'fixture', provider: 'fixture', model: 'fictional-no-model', timestamp: 1, stopReason: 'toolUse',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }] });
    return tx.createTask(ToolTask, { assistant: entry.id, callId: 'fixture-call' }, { ownership: { kind: 'conversation' } });
  }, context);
}

export async function documentToolResult(harness, conversation, taskId) {
  const terminal = await harness.waitForTask(taskId, context);
  if (terminal.state.outcome.status !== 'completed') throw new Error(JSON.stringify(terminal.state.outcome));
  const entry = await conversation.commit(tx => tx.entry(ToolResultEntry, terminal.state.outcome.result.entryId), context);
  const message = entry.model[0];
  return { terminal, entry, result: JSON.parse(message.content.find(item => item.type === 'text').text) };
}

/** The text of a tool result (JSON or not) and whether it is an error. */
export async function toolResultText(harness, conversation, taskId) {
  const terminal = await harness.waitForTask(taskId, context);
  // A tool that throws still ends with a result entry (an error result); only a task without one is a harness failure.
  const entryId = terminal.state.outcome.result?.entryId;
  if (entryId === undefined) throw new Error(JSON.stringify(terminal.state.outcome));
  const entry = await conversation.commit(tx => tx.entry(ToolResultEntry, entryId), context);
  const message = entry.model[0];
  return { isError: message.isError === true, text: message.content.filter(item => item.type === 'text').map(item => item.text).join('') };
}

/**
 * A fixture tool that publishes a note conditionally (create when absent, else replace the exact revision). It stands in for "a host
 * tool that publishes through a resource provider" in tests of the native runtime, definitions and transports; the agent's own file
 * tools are Pi's read, write and edit behind `@hachej/boring-agent/file-guard`.
 */
export function createSaveNoteTool({ target, publisher, operationNamespace, resolveAccess, replay = 'unsafe' }) {
  const parameters = { type: 'object', additionalProperties: false, required: ['text', 'expected'], properties: {
    text: { type: 'string' },
    expected: { anyOf: [
      { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'absent' } } },
      { type: 'object', additionalProperties: false, required: ['kind', 'revision'], properties: { kind: { const: 'revision' }, revision: { type: 'string', minLength: 1 } } },
    ] },
  } };
  return defineTool({
    name: 'save_note', description: 'Fixture: save a note against its exact revision, or create it only if absent.', parameters, replay,
    execute: async (args, api, ctx) => {
      const access = await resolveAccess(api, ctx);
      const bytes = new TextEncoder().encode(args.text);
      const change = args.expected.kind === 'absent'
        ? { kind: 'create', target, expected: { kind: 'absent' }, bytes, mediaType: 'text/markdown' }
        : { kind: 'replace', target: { ...target, revision: args.expected.revision }, bytes, mediaType: 'text/markdown' };
      const result = await publisher.publish({ operationId: JSON.stringify([operationNamespace, api.taskId]), atomicity: 'all-or-nothing', changes: [change] }, access);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  });
}
