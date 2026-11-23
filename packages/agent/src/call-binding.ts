// What `ask_user`, browser tasks and view-open share: an answer names the exact native tool call that asked (its assistant entry and
// call id), and settling it wakes that call from a Pi park. The call parks with `{ sleep: { signals } }`, holding no invocation and no
// model request; the authenticated answer settles the call's conversation document and delivers `CallSettled` in the same commit; the
// call runs again, reads the document and returns. Internal module: not a package export.
import { ToolTask, defineSignal } from '@earendil-works/pi-durable';
import type { Conversation, TaskId, ToolExecutionApi, Tx } from '@earendil-works/pi-durable';
import { obj } from '@earendil-works/pi-schema';

export class UnknownCall extends Error {}
export class AmbiguousCall extends Error {}

/** Delivered to a parked call under its binding key when its document is settled; the document, not the signal, carries the answer. */
export const CallSettled = defineSignal({ name: 'boring.call.settled', version: 1, schema: obj({}) });

/** Bind an answer to the exact assistant entry that made the call. */
export const callBindingId = (assistantEntryId: number, callId: string): string => JSON.stringify([assistantEntryId, callId]);

export interface CallBinding { readonly key: string; readonly callId: string; readonly taskId: TaskId }

/** The native tool task an answer ID names: `callBindingId(entry, call)`, or a raw call ID used by exactly one task. */
export async function callBinding(tx: Tx, conversation: Conversation, id: string): Promise<CallBinding> {
  let cursor;
  let match: CallBinding | undefined;
  do {
    const page = await tx.scanTasks({ conversationId: conversation.id, kind: ToolTask.definition.name }, 100, cursor);
    for (const task of page.items) {
      const input = task.input;
      if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input['callId'] !== 'string' || typeof input['assistant'] !== 'number') continue;
      const key = callBindingId(input['assistant'], input['callId']);
      if (key !== id && input['callId'] !== id) continue;
      if (match !== undefined) throw new AmbiguousCall();
      match = { key, callId: input['callId'], taskId: task.id };
    }
    cursor = page.next;
  } while (cursor !== undefined);
  if (match === undefined) throw new UnknownCall();
  return match;
}

/** The binding key of the calling tool task (its assistant entry and call id). */
export async function ownBindingKey(tx: Tx, api: Pick<ToolExecutionApi, 'taskId' | 'callId'>): Promise<string> {
  const task = await tx.task(api.taskId);
  const input = task?.input;
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input['assistant'] !== 'number') throw new Error('Tool task has no assistant entry');
  return callBindingId(input['assistant'], api.callId);
}
