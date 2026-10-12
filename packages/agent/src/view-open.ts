// The acknowledgement that a `present` call's file is on screen (the opt-in `ack` of `createPresentTool`, ./artifacts.ts). It is the
// same durable wait as `ask_user` and browser tasks (./durable-wait.ts): a conversation document keyed by the call's
// `[assistantEntryId, callId]` holds the pending view, the page answers after its panel has mounted the revision, and a stored
// deadline ends the wait. It is a sibling of ./browser-task.ts, not a second channel: the page answers through the chat transport's
// `?op=answer`. Presentation outcomes (`createPresentationTool`, ./presentation.ts) are a different contract and stay separate.
import { defineDocFamily } from '@earendil-works/pi-durable';
import type { Conversation, TaskId, ToolExecutionApi, Tx } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Context } from '@earendil-works/chord';
import { AmbiguousCall, UnknownCall, callBinding, ownBindingKey, waitForDocument } from './durable-wait.js';
import type { AskUserAnswer } from './ask-user.js';

/** How long a view may take to be confirmed by a page before the result says `unconfirmed` (a UI ack, not a person's decision). */
export const VIEW_OPEN_TIMEOUT_MS = 15_000;
/** The tool whose calls the view-open record belongs to, unless a host renamed `present`. */
export const PRESENT_TOOL = 'present';

/** What the page reports after its panel mounted the revision, or that it refused to open it. */
export type ViewOpenAnswer =
  | { readonly kind: 'opened'; readonly instanceId: string; readonly path: string; readonly revision: string }
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
type ViewRecord = { tool: string; taskId: TaskId; path: string; revision: string; startedAt: number; timeoutMs: number; state: ViewState };
type ViewDocument = { view: ViewRecord | null };

/** One member per assistant entry and tool call, in the calling conversation. */
const documents = defineDocFamily<ViewDocument, null>({
  kind: 'boring.view-open', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', family: true,
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
  if (value['kind'] === 'refused' && Object.keys(value).every(key => ['kind', 'reason'].includes(key))) {
    const { reason } = value;
    if (typeof reason !== 'string' || !reason || reason.length > MAX_REASON) return undefined;
    return { kind: 'refused', reason };
  }
  return undefined;
}

/**
 * Records the pending view of a `present` call, then waits for the page's acknowledgement or the deadline. The deadline is stored
 * with the record, so a re-attached call (after a restart) keeps the time it started with. Abort cancels the record.
 * Returns the revision the record holds: on a replay after the file changed, that is the revision that was acknowledged, not the
 * current one, so the result never pairs a new file revision with an old acknowledgement.
 */
export async function awaitViewOpen(api: ToolExecutionApi, context: Context, view: { readonly tool: string; readonly path: string; readonly revision: string },
  options: ViewOpenOptions = {}): Promise<{ readonly outcome: ViewOpenOutcome; readonly revision: string }> {
  const timeoutMs = options.timeoutMs ?? VIEW_OPEN_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('The view-open timeout must be a positive integer of milliseconds');
  if (options.viewers && !(await options.viewers(api, context))) return { outcome: { kind: 'none' }, revision: view.revision };
  const { key, startedAt, duration } = await api.commit(async tx => {
    const key = await ownBindingKey(tx, api);
    const document = await tx.doc(documents, api.conversationId, key, null);
    if (!document.view) document.view = { tool: view.tool, taskId: api.taskId, path: view.path, revision: view.revision, startedAt: Date.now(), timeoutMs, state: { kind: 'pending' } };
    if (document.view.taskId !== api.taskId) throw new Error('View-open identity belongs to another task');
    return { key, startedAt: document.view.startedAt, duration: document.view.timeoutMs };
  }, context);
  const expire = async (tx: Tx): Promise<ViewDocument> => {
    const document = await tx.doc(documents, api.conversationId, key, null);
    if (document.view?.state.kind === 'pending') document.view.state = { kind: 'unconfirmed' };
    return { view: document.view ? { ...document.view, state: { ...document.view.state } } : null };
  };
  const final = await waitForDocument(api, documents, key, context, value => value?.view?.state.kind !== 'pending', async tx => {
    const document = await tx.doc(documents, api.conversationId, key, null);
    if (document.view?.state.kind === 'pending') document.view.state = { kind: 'cancelled' };
  }, 'View open', { at: startedAt + duration, expire });
  const state = final?.view?.state;
  const revision = final?.view?.revision ?? view.revision;
  if (state?.kind === 'opened') return { outcome: { kind: 'opened', viewer: state.viewer }, revision };
  if (state?.kind === 'refused') return { outcome: { kind: 'refused', reason: state.reason }, revision };
  if (state?.kind === 'unconfirmed') return { outcome: { kind: 'unconfirmed', timeoutMs: duration }, revision };
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
  if (!parsed) return { kind: 'denied', reason: 'The answer must be { kind: "opened", instanceId, path, revision } or { kind: "refused", reason }' };
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
      if (record.state.kind !== 'pending') return same(record.state, next) ? { kind: 'answered' } : { kind: 'conflict', reason: 'The view was already decided' };
      if (task.abortRequested || task.state.status === 'terminal') { record.state = { kind: 'cancelled' }; return { kind: 'conflict', reason: 'The view was cancelled' }; }
      if (Date.now() >= record.startedAt + record.timeoutMs) { record.state = { kind: 'unconfirmed' }; return { kind: 'conflict', reason: 'The view was not confirmed in time' }; }
      if (parsed.kind === 'opened' && (parsed.path.replace(/^\.\//, '') !== record.path || parsed.revision !== record.revision)) {
        return { kind: 'denied', reason: 'The acknowledgement names another file or revision than the one presented' };
      }
      record.state = next;
      return { kind: 'answered' };
    }, options.context ?? BACKGROUND_CONTEXT) as AskUserAnswer;
  } catch (error) {
    if (error instanceof AmbiguousCall) return { kind: 'conflict', reason: 'Use the assistant-entry-bound call ID' };
    if (error instanceof UnknownCall) return { kind: 'unknown-question' };
    throw error;
  }
}
