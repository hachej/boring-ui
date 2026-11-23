// The acknowledgement that a `present` call's file is on screen (the opt-in `ack` of `createPresentTool`, ./artifacts.ts). It is the
// same park as `ask_user` and browser tasks (./call-binding.ts): a conversation document keyed by the call's
// `[assistantEntryId, callId]` holds the pending view, the page answers after its panel has mounted the revision, and a stored
// deadline (the park's `until`) ends the wait. It is a sibling of ./browser-task.ts, not a second channel: the page answers through the chat transport's
// `?op=answer`. Presentation outcomes (`createPresentationTool`, ./presentation.ts) are a different contract and stay separate.
import { defineDocFamily } from '@earendil-works/pi-durable';
import type { Conversation, TaskId, ToolExecutionApi, ToolPark } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Context } from '@earendil-works/chord/context';
import { AmbiguousCall, CallSettled, UnknownCall, callBinding, ownBindingKey } from './call-binding.js';
import type { AskUserAnswer } from './ask-user.js';
import { parseTaskSubject, taskSubjectKey } from './task-artifacts.js';
import type { TaskSubject } from './task-artifacts.js';

/** How long a view may take to be confirmed by a page before the result says `unconfirmed` (a UI ack, not a person's decision). */
export const VIEW_OPEN_TIMEOUT_MS = 15_000;
/** The tool whose calls the view-open record belongs to, unless a host renamed `present`. */
export const PRESENT_TOOL = 'present';

/** What the page reports after its panel mounted the revision, or that it refused to open it. */
export type ViewOpenAnswer =
  | { readonly kind: 'opened'; readonly instanceId: string; readonly path: string; readonly revision: string }
  | { readonly kind: 'opened'; readonly instanceId: string; readonly subject: TaskSubject }
  | { readonly kind: 'refused'; readonly reason: string };

/** What `present` reports for the view: the result's `opened`, `refused` or `viewer` fields (see ./artifacts.ts). */
export type ViewOpenOutcome =
  | { readonly kind: 'opened'; readonly viewer: string }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'unconfirmed'; readonly timeoutMs: number }
  | { readonly kind: 'none' };

export interface ViewOpenOptions {
  /** Default `VIEW_OPEN_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /** Whether a page watches this conversation. False: `none` at once, nothing is waited for. Absent: the timeout bounds the wait. */
  readonly viewers?: (api: ToolExecutionApi, context: Context) => boolean | Promise<boolean>;
}

type ViewState = { kind: 'pending' } | { kind: 'opened'; viewer: string } | { kind: 'refused'; reason: string } | { kind: 'unconfirmed' } | { kind: 'cancelled' };
type ViewBinding = { readonly path: string; readonly revision: string } | { readonly subject: TaskSubject };
type ViewRecord = { tool: string; taskId: TaskId; startedAt: number; timeoutMs: number; state: ViewState } & ViewBinding;
type ViewDocument = { view: ViewRecord | null };

/** One member per assistant entry and tool call, in the calling conversation. */
const documents = defineDocFamily<ViewDocument, null>({
  kind: 'boring.view-open', checkpointWhen: () => false, version: 1, scope: 'conversation', history: 'latest', fork: 'initial', family: true,
  initial: () => ({ view: null }),
});

const MAX_REASON = 200;
const MAX_ID = 128;
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Strict shape of the page's answer. Returns undefined for anything else. */
export function parseViewOpenAnswer(value: unknown): ViewOpenAnswer | undefined {
  if (!isObject(value)) return undefined;
  if (value['kind'] === 'opened' && Object.keys(value).every(key => ['kind', 'instanceId', 'path', 'revision'].includes(key))) {
    const { instanceId, path, revision } = value;
    if (typeof instanceId !== 'string' || !instanceId || instanceId.length > MAX_ID) return undefined;
    if (typeof path !== 'string' || !path || path.length > 512) return undefined;
    if (typeof revision !== 'string' || !revision || revision.length > 256) return undefined;
    return { kind: 'opened', instanceId, path, revision };
  }
  if (value['kind'] === 'opened' && Object.keys(value).every(key => ['kind', 'instanceId', 'subject'].includes(key))) {
    const instanceId = value['instanceId'], subject = parseTaskSubject(value['subject']);
    if (typeof instanceId !== 'string' || !instanceId || instanceId.length > MAX_ID || !subject) return undefined;
    return { kind: 'opened', instanceId, subject };
  }
  if (value['kind'] === 'refused' && Object.keys(value).every(key => ['kind', 'reason'].includes(key))) {
    const { reason } = value;
    if (typeof reason !== 'string' || !reason || reason.length > MAX_REASON) return undefined;
    return { kind: 'refused', reason };
  }
  return undefined;
}

/**
 * Records the pending view of a `present` call. While the page has not answered, the tool returns the park this gives back
 * (`{ sleep: { until, signals } }`); the answer, or the stored deadline, wakes the call and it runs again. The deadline is stored with
 * the record, so a call re-attached after a restart keeps the time it started with. Returns the revision the record holds: on a replay
 * after the file changed, that is the revision that was acknowledged, not the current one, so the result never pairs a new file
 * revision with an old acknowledgement. Pair it with `cancel: cancelViewOpen` on the tool.
 */
export async function awaitViewOpen(api: ToolExecutionApi, context: Context, view: { readonly tool: string; readonly path: string; readonly revision: string },
  options: ViewOpenOptions = {}): Promise<{ readonly outcome: ViewOpenOutcome; readonly revision: string } | ToolPark> {
  const result = await awaitPresentation(api, context, view, options);
  if (!('binding' in result)) return result;
  if (!('revision' in result.binding)) throw new Error('The presentation belongs to a task reference');
  return { outcome: result.outcome, revision: result.binding.revision };
}

/** A record viewer confirms the exact task or filter, never a fabricated file revision. */
export async function awaitTaskViewOpen(api: ToolExecutionApi, context: Context, view: { readonly tool: string; readonly subject: TaskSubject },
  options: ViewOpenOptions = {}): Promise<{ readonly outcome: ViewOpenOutcome; readonly subject: TaskSubject } | ToolPark> {
  const result = await awaitPresentation(api, context, view, options);
  if (!('binding' in result)) return result;
  if (!('subject' in result.binding)) throw new Error('The presentation belongs to a file');
  return { outcome: result.outcome, subject: result.binding.subject };
}

/** The `cancel` of a tool that waits through `awaitViewOpen`: stopping the conversation cancels the pending view. */
export async function cancelViewOpen(api: ToolExecutionApi, context: Context): Promise<void> {
  await api.commit(async tx => {
    const { view } = await tx.doc(documents, api.conversationId, await ownBindingKey(tx, api), null);
    if (view?.state.kind === 'pending') view.state = { kind: 'cancelled' };
  }, context);
}

async function awaitPresentation(api: ToolExecutionApi, context: Context, view: ViewBinding & { readonly tool: string },
  options: ViewOpenOptions): Promise<{ readonly outcome: ViewOpenOutcome; readonly binding: ViewBinding } | ToolPark> {
  const timeoutMs = options.timeoutMs ?? VIEW_OPEN_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('The view-open timeout must be a positive integer of milliseconds');
  if (options.viewers && !(await options.viewers(api, context))) return { outcome: { kind: 'none' }, binding: view };
  const { key, record } = await api.commit(async tx => {
    const key = await ownBindingKey(tx, api);
    const document = await tx.doc(documents, api.conversationId, key, null);
    if (!document.view) document.view = { ...view, taskId: api.taskId, startedAt: Date.now(), timeoutMs, state: { kind: 'pending' } };
    if (document.view.taskId !== api.taskId) throw new Error('View-open identity belongs to another task');
    // A wake with the page still silent is the deadline: the park's `until` came first.
    if (document.view.state.kind === 'pending' && (api.wake !== undefined || Date.now() >= document.view.startedAt + document.view.timeoutMs)) document.view.state = { kind: 'unconfirmed' };
    return { key, record: JSON.parse(JSON.stringify(document.view)) as ViewRecord };
  }, context);
  const { state } = record;
  if (state.kind === 'pending') return { sleep: { until: record.startedAt + record.timeoutMs, signals: [CallSettled.key(key)] } };
  if (state.kind === 'opened') return { outcome: { kind: 'opened', viewer: state.viewer }, binding: record };
  if (state.kind === 'refused') return { outcome: { kind: 'refused', reason: state.reason }, binding: record };
  if (state.kind === 'unconfirmed') return { outcome: { kind: 'unconfirmed', timeoutMs: record.timeoutMs }, binding: record };
  throw new Error('View open cancelled');
}

const same = (a: ViewState, b: ViewState) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Settles a pending view with the page's answer (JSON text) after the host authenticated the person. `id` is the answer ID of the
 * call (`[assistantEntryId, callId]`, or a raw call ID used by one task). An `opened` answer must name the path and revision the
 * call recorded; the first valid answer wins, an identical repeat is idempotent, any other answer after that is `conflict`.
 * Returns the `ask_user` outcome kinds, so one chat transport `answer` can serve questions, browser tasks and views.
 */
export async function answerViewOpen(conversation: Conversation, id: string, answer: string, options: { readonly tool?: string; readonly context?: Context } = {}): Promise<AskUserAnswer> {
  const tool = options.tool ?? PRESENT_TOOL;
  if (typeof id !== 'string' || !id || id.length > 1024) return { kind: 'unknown-question' };
  if (typeof answer !== 'string' || answer.length > 4096) return { kind: 'denied', reason: 'The answer must be JSON text of at most 4096 characters' };
  let value: unknown;
  try { value = JSON.parse(answer); } catch { return { kind: 'denied', reason: 'The answer is not JSON' }; }
  const parsed = parseViewOpenAnswer(value);
  if (!parsed) return { kind: 'denied', reason: 'The answer must name an opened file revision or task subject with instanceId, or be { kind: "refused", reason }' };
  const next: ViewState = parsed.kind === 'opened' ? { kind: 'opened', viewer: parsed.instanceId } : { kind: 'refused', reason: parsed.reason };
  try {
    return await conversation.commit(async tx => {
      const binding = await callBinding(tx, conversation, id);
      const task = await tx.task(binding.taskId);
      if (!task) return { kind: 'conflict', reason: 'The view is unavailable' };
      const document = await tx.doc(documents, conversation.id, binding.key, null);
      // Throwing rolls back the empty draft an unknown or foreign call would leave behind.
      if (!document.view || document.view.tool !== tool) throw new UnknownCall();
      const record = document.view;
      if (record.taskId !== task.id) return { kind: 'conflict', reason: 'The view belongs to another task' };
      if (parsed.kind === 'opened' && ('subject' in parsed
        ? !('subject' in record) || taskSubjectKey(parsed.subject) !== taskSubjectKey(record.subject)
        : !('path' in record) || parsed.path.replace(/^\.\//, '') !== record.path || parsed.revision !== record.revision)) {
        return { kind: 'denied', reason: 'The acknowledgement names another subject or revision than the one presented' };
      }
      if (record.state.kind !== 'pending') return same(record.state, next) ? { kind: 'answered' } : { kind: 'conflict', reason: 'The view was already decided' };
      if (task.abortRequested || task.state.status === 'terminal') { record.state = { kind: 'cancelled' }; return { kind: 'conflict', reason: 'The view was cancelled' }; }
      if (Date.now() >= record.startedAt + record.timeoutMs) { record.state = { kind: 'unconfirmed' }; return { kind: 'conflict', reason: 'The view was not confirmed in time' }; }
      if (await tx.signal(task.id, CallSettled, binding.key, {}) === 'closed') return { kind: 'conflict', reason: 'The view was cancelled' };
      record.state = next;
      return { kind: 'answered' };
    }, options.context ?? BACKGROUND_CONTEXT) as AskUserAnswer;
  } catch (error) {
    if (error instanceof AmbiguousCall) return { kind: 'conflict', reason: 'Use the assistant-entry-bound call ID' };
    if (error instanceof UnknownCall) return { kind: 'unknown-question' };
    throw error;
  }
}
