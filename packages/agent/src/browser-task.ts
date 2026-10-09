// @hachej/boring-agent/browser-task: a native Pi tool that hands a task to the person's open page and waits, durably, for the page's
// structured answer: the same wait as `ask_user` (./durable-wait.ts) with a JSON object for an answer instead of a short text.
// The page finds the pending call in the conversation it already watches (the tool call with no result yet), does the task with
// the person (for example a live preview of a change, `browser_preview` in `@hachej/boring-feedback/agent`) and answers through the same
// authenticated path as a question: the chat transport's `?op=answer`, with the call's `[assistantEntryId, callId]` binding.
// Nothing runs in the page because of this tool alone; the host decides which page code picks the task up.
import { defineDocFamily, defineTool } from '@earendil-works/pi-durable';
import type { Conversation, JsonObject, TaskId, ToolRegistration } from '@earendil-works/pi-durable';
import type { TSchema } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Context } from '@earendil-works/chord';
import { AmbiguousCall, UnknownCall, callBinding, callBindingId, ownBindingKey, waitForDocument } from './durable-wait.js';
import type { AskUserAnswer } from './ask-user.js';

/** Upper bound on an answer's UTF-8 JSON, by default. */
export const BROWSER_TASK_MAX_ANSWER = 16_384;

type TaskState = { kind: 'pending' } | { kind: 'answered'; answer: JsonObject } | { kind: 'cancelled' };
type TaskDocument = { task: { tool: string; taskId: TaskId; state: TaskState } | null };

/** One member per assistant entry and tool call, in the calling conversation. */
const documents = defineDocFamily<TaskDocument, null>({
  kind: 'boring.browser-task', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', family: true,
  initial: () => ({ task: null }),
});

/** The answer ID of a browser task call: the same `[assistantEntryId, callId]` binding as `askUserQuestionId`. */
export const browserTaskId = callBindingId;

export interface BrowserTaskOptions<P extends TSchema> {
  readonly name: string;
  readonly description: string;
  /** The task the page receives, as the tool's parameters (the page reads them from the call). */
  readonly parameters: P;
  /** Refuses an answer the page sent: return the reason, or nothing to accept it. Runs before anything is stored. */
  readonly checkAnswer: (answer: JsonObject) => string | undefined;
  /** Default `BROWSER_TASK_MAX_ANSWER`. */
  readonly maxAnswerBytes?: number;
}

const encoder = new TextEncoder();
const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A native Pi tool that waits for the person's page to answer, without holding a model request. Pending calls survive a restart
 * (the replay-safe call re-attaches to its record) and are cancelled with the call when the conversation is stopped. The result
 * text is the page's answer, as JSON. Answer it with `answerBrowserTask`.
 */
export function createBrowserTaskTool<P extends TSchema>(options: BrowserTaskOptions<P>): ToolRegistration {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(options.name)) throw new TypeError('A browser task needs a snake_case tool name');
  return defineTool({
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    replay: 'safe',
    execute: async (_args, api, context) => {
      const key = await api.commit(async tx => {
        const key = await ownBindingKey(tx, api);
        const document = await tx.doc(documents, api.conversationId, key, null);
        if (!document.task) document.task = { tool: options.name, taskId: api.taskId, state: { kind: 'pending' } };
        if (document.task.taskId !== api.taskId) throw new Error('Browser task identity belongs to another task');
        return key;
      }, context);
      const final = await waitForDocument(api, documents, key, context, value => value?.task?.state.kind !== 'pending', async tx => {
        const { task } = await tx.doc(documents, api.conversationId, key, null);
        if (task?.state.kind === 'pending') task.state = { kind: 'cancelled' };
      }, 'Browser task');
      const state = final?.task?.state;
      if (state?.kind !== 'answered') throw new Error('Browser task cancelled');
      return { content: [{ type: 'text', text: JSON.stringify(state.answer) }] };
    },
  });
}

/**
 * Settles a pending browser task with the page's answer (a JSON object as text) after the host authenticated the person. `id` is
 * `browserTaskId(assistantEntryId, callId)` (an unscoped call ID only when exactly one native task used it). The answer goes through
 * the tool's own `checkAnswer` (pass the same options as the tool). Exactly one answer is accepted; repeating it is idempotent.
 * Returns the `ask_user` outcome kinds, so one chat transport `answer` serves both.
 */
export async function answerBrowserTask(conversation: Conversation, tool: Pick<BrowserTaskOptions<TSchema>, 'name' | 'checkAnswer' | 'maxAnswerBytes'>,
  id: string, answer: string, context: Context = BACKGROUND_CONTEXT): Promise<AskUserAnswer> {
  if (typeof id !== 'string' || !id || id.length > 1024) return { kind: 'unknown-question' };
  if (typeof answer !== 'string') return { kind: 'denied', reason: 'The answer must be JSON text' };
  const max = tool.maxAnswerBytes ?? BROWSER_TASK_MAX_ANSWER;
  if (encoder.encode(answer).length > max) return { kind: 'denied', reason: `The answer is larger than ${max} bytes` };
  let value: unknown;
  try { value = JSON.parse(answer); } catch { return { kind: 'denied', reason: 'The answer is not JSON' }; }
  if (!isObject(value)) return { kind: 'denied', reason: 'The answer must be a JSON object' };
  const parsed = value;
  try {
    return await conversation.commit(async tx => {
      const binding = await callBinding(tx, conversation, id);
      const task = await tx.task(binding.taskId);
      if (!task) return { kind: 'conflict', reason: 'The browser task is unavailable' };
      const document = await tx.doc(documents, conversation.id, binding.key, null);
      // Throwing rolls back the empty draft an unknown or foreign call would leave behind.
      if (!document.task || document.task.tool !== tool.name) throw new UnknownCall();
      const record = document.task;
      if (record.taskId !== task.id) return { kind: 'conflict', reason: 'The browser task belongs to another task' };
      if (task.abortRequested) { record.state = { kind: 'cancelled' }; return { kind: 'conflict', reason: 'The browser task was cancelled' }; }
      if (record.state.kind === 'answered') return JSON.stringify(record.state.answer) === JSON.stringify(parsed) ? { kind: 'answered' } : { kind: 'conflict', reason: 'The browser task was already answered' };
      if (record.state.kind === 'cancelled') return { kind: 'conflict', reason: 'The browser task was cancelled' };
      if (task.state.status === 'terminal') { record.state = { kind: 'cancelled' }; return { kind: 'conflict', reason: 'The browser task was cancelled' }; }
      const problem = tool.checkAnswer(parsed);
      if (problem) return { kind: 'denied', reason: problem };
      record.state = { kind: 'answered', answer: parsed };
      return { kind: 'answered' };
    }, context) as AskUserAnswer;
  } catch (error) {
    if (error instanceof AmbiguousCall) return { kind: 'conflict', reason: 'Use the assistant-entry-bound call ID' };
    if (error instanceof UnknownCall) return { kind: 'unknown-question' };
    throw error;
  }
}

