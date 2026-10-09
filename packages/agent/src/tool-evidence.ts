import { AssistantEntry, ToolResultEntry, ToolTask } from '@earendil-works/pi-durable';
import type { ConversationId, EntryId, Harness, TaskId, ToolDiagnostic, Tx } from '@earendil-works/pi-durable';
import type { ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { Context, JsonValue } from '@earendil-works/chord';

export interface NativeToolEvidence {
  readonly entryId: EntryId;
  readonly taskId: TaskId;
  readonly assistantId: EntryId;
  readonly conversationId: ConversationId;
  readonly call: ToolCall;
  readonly result: ToolResultMessage;
  readonly diagnostics: readonly ToolDiagnostic[];
}

function object(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function entryId(value: JsonValue | undefined): value is EntryId {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

async function ownedBy(tx: Tx, id: TaskId, owner: TaskId): Promise<boolean> {
  const visited = new Set<TaskId>();
  let current: TaskId | undefined = id;
  while (current !== undefined && !visited.has(current) && visited.size < 128) {
    if (current === owner) return (await tx.task(owner)) !== undefined;
    visited.add(current);
    const task = await tx.task(current);
    if (!task) return false;
    current = task.owner ?? (await tx.conversation(task.conversationId))?.owner?.taskId;
  }
  return false;
}

export async function readToolEvidence(harness: Harness, owner: TaskId, ids: readonly EntryId[], context: Context): Promise<NativeToolEvidence[]> {
  return harness.commit(async tx => {
    const evidence: NativeToolEvidence[] = [];
    for (const id of ids) {
      const entry = await tx.entry(ToolResultEntry, id);
      if (!entry?.byTaskId || entry.model?.length !== 1) throw new Error('Missing native tool result');
      const task = await tx.task(entry.byTaskId);
      if (!task || task.kind !== ToolTask.definition.name || task.version !== ToolTask.definition.version
        || task.conversationId !== entry.conversationId || task.state.status !== 'terminal'
        || task.state.outcome.status !== 'completed' || !object(task.state.outcome.result)
        || task.state.outcome.result.entryId !== id || !object(task.input)
        || !entryId(task.input.assistant) || typeof task.input.callId !== 'string'
        || !await ownedBy(tx, task.id, owner)) throw new Error('Unbound native tool result');
      const result = entry.model[0];
      if (result?.role !== 'toolResult' || result.isError || result.toolCallId !== task.input.callId
        || entry.data.diagnostics.length !== 0) throw new Error('Unusable native tool result');
      const assistant = await tx.entry(AssistantEntry, task.input.assistant);
      if (!assistant || assistant.conversationId !== entry.conversationId || assistant.model?.length !== 1
        || assistant.model[0]?.role !== 'assistant') throw new Error('Missing native tool call');
      const calls = assistant.model[0].content.filter(item => item.type === 'toolCall' && item.id === result.toolCallId);
      const call = calls[0];
      if (calls.length !== 1 || call?.type !== 'toolCall' || call.name !== result.toolName) throw new Error('Mismatched native tool call');
      evidence.push(structuredClone({ entryId: id, taskId: task.id, assistantId: assistant.id,
        conversationId: entry.conversationId, call, result, diagnostics: entry.data.diagnostics }));
    }
    return evidence;
  }, context);
}
