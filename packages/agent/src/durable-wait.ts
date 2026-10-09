// The durable wait shared by `ask_user` (./ask-user.ts) and browser tasks (./browser-task.ts): a native tool call parks on a
// conversation document keyed by its assistant entry and call id, and an authenticated answer later settles that document. No model
// request is held while waiting; a restart re-attaches the replay-safe call to the same document; stopping the conversation
// cancels it. Internal module: not a package export.
import { ToolTask } from '@earendil-works/pi-durable';
import type { Conversation, ConversationDocFamilyToken, JsonObject, TaskId, ToolExecutionApi, Tx } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Context } from '@earendil-works/chord';

export class UnknownCall extends Error {}
export class AmbiguousCall extends Error {}

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

/**
 * Waits until `settled(value)` holds for the document `key` of `family`, without holding a model request. When the call is aborted,
 * `cancel` runs in a background commit (`label` names the waiting thing in errors) (the answer path also refuses a call whose task has ended) and the abort is rethrown.
 */
export async function waitForDocument<T extends JsonObject>(api: ToolExecutionApi, family: ConversationDocFamilyToken<T, null>, key: string, context: Context,
  settled: (value: Readonly<T> | null | undefined) => boolean, cancel: (tx: Tx) => Promise<void>, label: string): Promise<Readonly<T> | null | undefined> {
  const watch = await api.watchDoc(family, api.conversationId, key, context);
  if (!watch) throw new Error(`${label} record is missing`);
  const signal = context.abortSignal;
  let final: Readonly<T> | null | undefined = watch.value;
  try {
    if (!settled(final)) {
      final = await new Promise<typeof final>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason ?? new Error(`${label} cancelled`));
        signal?.addEventListener('abort', () => reject(signal.reason ?? new Error(`${label} cancelled`)), { once: true });
        void watch.closed.then(() => reject(new Error(`${label} observation closed`)));
        watch.start(async value => { if (settled(value)) resolve(value); });
      });
    }
  } catch (error) {
    if (signal?.aborted) {
      try { await api.commit(cancel, BACKGROUND_CONTEXT); }
      catch { /* the answer path also refuses a call whose task has ended */ }
    }
    throw error;
  } finally { await watch.stop(); }
  return final;
}
