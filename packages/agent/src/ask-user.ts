import { defineDocFamily, defineTool } from '@earendil-works/pi-durable';
import type { Conversation, ToolExecutionApi, ToolRegistration, TaskId } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Context } from '@earendil-works/chord';
import { AmbiguousCall, UnknownCall, callBinding, callBindingId, ownBindingKey, waitForDocument } from './durable-wait.js';

export const ASK_USER_TOOL = 'ask_user';
export const ASK_USER_MAX_ANSWER = 2000;

type AskState = { kind: 'pending' } | { kind: 'answered'; answer: string } | { kind: 'cancelled' };
type AskDocument = { question: { prompt: string; options: string[]; allowFreeText: boolean; taskId: TaskId; state: AskState } | null };
export type AskUserAnswer = { kind: 'answered' } | { kind: 'denied' | 'conflict' | 'unknown-question'; reason?: string };

/** One member per assistant entry and tool call, in the asking conversation. */
const documents = defineDocFamily<AskDocument, null>({
  kind: 'boring.ask-user.question', version: 1, scope: 'conversation', history: 'latest', fork: 'initial', family: true,
  initial: () => ({ question: null }),
});

/** Bind an answer to the exact assistant entry that asked it. */
export const askUserQuestionId = callBindingId;

function refusal(options: readonly string[] | undefined, allowFreeText: boolean | undefined): string | undefined {
  if (options !== undefined && (options.length < 2 || options.length > 6 || options.some(option => typeof option !== 'string' || !option.trim() || option.length > 200)
    || new Set(options).size !== options.length)) return 'options must be 2 to 6 distinct short strings';
  if (options === undefined && allowFreeText !== true) return 'give options, or set allowFreeText to true';
  return undefined;
}

/**
 * A native Pi tool that asks the person a question and waits for the answer without holding a model request.
 * The question is bound to its native assistant entry and tool call, so a pending question survives a restart
 * (the replay-safe call re-attaches to it) and is cancelled with the call when the conversation is stopped.
 * The result is the text `{"kind":"answered","answer":"..."}`. Answer it with `answerUserQuestion`.
 */
export function createAskUserTool(options: { readonly description?: string } = {}): ToolRegistration {
  return defineTool({
    name: ASK_USER_TOOL,
    description: options.description ?? 'Ask the person a question and wait for their answer. Give 2 to 6 short options, or allow free text, or both.',
    parameters: Type.Object({
      question: Type.String({ minLength: 1, maxLength: 1000 }),
      options: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 2, maxItems: 6 })),
      allowFreeText: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    replay: 'safe',
    execute: async (args, api, context) => {
      const problem = refusal(args.options, args.allowFreeText);
      if (problem) return { isError: true, content: [{ type: 'text', text: `Invalid question: ${problem}.` }] };
      const answer = await askPerson(api, context, { prompt: args.question, ...(args.options === undefined ? {} : { options: args.options }), allowFreeText: args.allowFreeText === true });
      return { content: [{ type: 'text', text: JSON.stringify({ kind: 'answered', answer }) }] };
    },
  });
}

/**
 * Ask the person from inside a running native tool and wait for the answer. The question is a conversation document bound
 * to the asking assistant entry and tool call (`askUserQuestionId`), so it survives a restart (a replay-safe call
 * re-attaches to it) and is cancelled with the call. Answer it with `answerUserQuestion(conversation, questionId, answer)`,
 * which accepts one of `options` (or any text when `allowFreeText`). Resolves with the answer; throws when the question is
 * cancelled. `createAskUserTool` and `requireApproval` (`@hachej/boring-agent/approval`) both ask through this.
 */
export async function askPerson(api: ToolExecutionApi, context: Context, question: { readonly prompt: string; readonly options?: readonly string[]; readonly allowFreeText?: boolean }): Promise<string> {
  const key = await api.commit(async tx => {
    const key = await ownBindingKey(tx, api);
    const document = await tx.doc(documents, api.conversationId, key, null);
    if (!document.question) {
      const legacy = await tx.doc(documents, api.conversationId, api.callId, null);
      document.question = legacy.question?.taskId === api.taskId ? { ...legacy.question, options: [...legacy.question.options], state: { ...legacy.question.state } }
        : { prompt: question.prompt, options: [...(question.options ?? [])], allowFreeText: question.allowFreeText === true, taskId: api.taskId, state: { kind: 'pending' } };
    }
    if (document.question.taskId !== api.taskId) throw new Error('Question identity belongs to another task');
    return key;
  }, context);
  const final = await waitForDocument(api, documents, key, context, value => value?.question?.state.kind !== 'pending', async tx => {
    const { question: record } = await tx.doc(documents, api.conversationId, key, null);
    if (record?.state.kind === 'pending') record.state = { kind: 'cancelled' };
  }, 'Question');
  const state = final?.question?.state;
  if (state?.kind !== 'answered') throw new Error('Question cancelled');
  return state.answer;
}

/**
 * Resolve an `ask_user` question using `askUserQuestionId(assistantEntryId, callId)` after authenticating the person.
 * Unscoped model call IDs are accepted only when exactly one native task used them in this conversation.
 * Exactly one answer is accepted; repeating it is idempotent.
 */
export async function answerUserQuestion(conversation: Conversation, callId: string, answer: string, context: Context = BACKGROUND_CONTEXT): Promise<AskUserAnswer> {
  if (typeof callId !== 'string' || !callId || callId.length > 1024) return { kind: 'unknown-question' };
  if (typeof answer !== 'string') return { kind: 'denied', reason: 'The answer must be text' };
  const text = answer.trim();
  try {
    return await conversation.commit(async tx => {
      const binding = await callBinding(tx, conversation, callId);
      const task = await tx.task(binding.taskId);
      if (!task) return { kind: 'conflict', reason: 'The question task is unavailable' };
      const document = await tx.doc(documents, conversation.id, binding.key, null);
      if (!document.question) {
        const legacy = await tx.doc(documents, conversation.id, binding.callId, null);
        // Throwing rolls back the empty drafts created by an unknown question lookup.
        if (legacy.question?.taskId !== task.id) throw new UnknownCall();
        document.question = { ...legacy.question, options: [...legacy.question.options], state: { ...legacy.question.state } };
      }
      const question = document.question;
      if (question.taskId !== task.id) return { kind: 'conflict', reason: 'The question belongs to another task' };
      if (task.abortRequested) { question.state = { kind: 'cancelled' }; return { kind: 'conflict', reason: 'The question was cancelled' }; }
      if (question.state.kind === 'answered') return question.state.answer === text ? { kind: 'answered' } : { kind: 'conflict', reason: 'The question was already answered' };
      if (question.state.kind === 'cancelled') return { kind: 'conflict', reason: 'The question was cancelled' };
      if (task.state.status === 'terminal') { question.state = { kind: 'cancelled' }; return { kind: 'conflict', reason: 'The question was cancelled' }; }
      if (!text) return { kind: 'denied', reason: 'The answer is empty' };
      if (text.length > ASK_USER_MAX_ANSWER) return { kind: 'denied', reason: `The answer is longer than ${ASK_USER_MAX_ANSWER} characters` };
      if (!question.allowFreeText && !question.options.includes(text)) return { kind: 'denied', reason: 'The answer is not one of the options' };
      question.state = { kind: 'answered', answer: text };
      return { kind: 'answered' };
    }, context) as AskUserAnswer;
  } catch (error) {
    if (error instanceof AmbiguousCall) return { kind: 'conflict', reason: 'Use the assistant-entry-bound question ID' };
    if (error instanceof UnknownCall) return { kind: 'unknown-question' };
    throw error;
  }
}
