import { defineDocFamily, defineTool } from '@earendil-works/pi-durable';
import type { Conversation, ToolExecutionApi, ToolPark, ToolRegistration, TaskId } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Context } from '@earendil-works/chord/context';
import { AmbiguousCall, CallSettled, UnknownCall, callBinding, callBindingId, ownBindingKey } from './call-binding.js';
import { arr, bool, obj, opt, str } from '@earendil-works/pi-schema';

export const ASK_USER_TOOL = 'ask_user';
export const ASK_USER_MAX_ANSWER = 2000;

type AskState = { kind: 'pending' } | { kind: 'answered'; answer: string } | { kind: 'cancelled' };
type AskDocument = { question: { prompt: string; options: string[]; allowFreeText: boolean; taskId: TaskId; state: AskState } | null };
export type AskUserAnswer = { kind: 'answered' } | { kind: 'denied' | 'conflict' | 'unknown-question'; reason?: string };

/** One member per assistant entry and tool call, in the asking conversation. */
const documents = defineDocFamily<AskDocument, null>({
  kind: 'boring.ask-user.question', checkpointWhen: () => false, version: 1, scope: 'conversation', history: 'latest', fork: 'initial', family: true,
  initial: () => ({ question: null }),
});

/** Bind an answer to the exact assistant entry that asked it. */
export const askUserQuestionId = callBindingId;

function refusal(options: readonly string[] | undefined, allowFreeText: boolean | undefined): string | undefined {
  if (options !== undefined && (options.length < 2 || options.length > 6 || options.some(option => typeof option !== 'string' || !option.trim() || option.length > 200)
    || new Set(options).size !== options.length)) return 'options must be 2 to 6 distinct short strings';
  if (options === undefined && allowFreeText === false) return 'give options, or allow free text';
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
    description: options.description ?? 'Ask the person a question and wait for their answer. Give 2 to 6 short options when the answer is a choice; the person may also answer in their own words unless allowFreeText is false. To ask several related questions at once, give them as `questions` (up to 8, each with its own options): the person answers them in one form, may skip some, and the answer lists each question with its answer.',
    parameters: obj({ question: str({ minLength: 1, maxLength: 1000 }), options: opt(arr(str({ minLength: 1, maxLength: 200 }), { minItems: 2, maxItems: 6 })), allowFreeText: opt(bool()), questions: opt(arr(obj({ question: str({ minLength: 1, maxLength: 1000 }), options: opt(arr(str({ minLength: 1, maxLength: 200 }), { minItems: 2, maxItems: 6 })) }), { minItems: 1, maxItems: 8 })) }),
    replay: 'safe',
    // The wait binds to the calling model entry and call id; a nested `api.executeTool` caller has neither (see call-binding.ts).
    callers: ['model'],
    cancel: (_args, api, context) => cancelQuestion(api, context),
    execute: async (args, api, context) => {
      // A form (`questions`) is answered as one free text that lists each question and its answer.
      const form = args.questions?.length ? args.questions : undefined;
      const problem = form ? form.map(item => refusal(item.options, true)).find(Boolean) : refusal(args.options, args.allowFreeText);
      if (problem) return { isError: true, output: [{ type: 'text', text: `Invalid question: ${problem}.` }] };
      const prompt = form ? [args.question, ...form.map((item, i) => `${i + 1}. ${item.question}`)].join('\n') : args.question;
      const asked = await askPerson(api, context, { prompt, ...(form || args.options === undefined ? {} : { options: args.options }), allowFreeText: form ? true : args.allowFreeText !== false });
      if (!('answer' in asked)) return asked;
      return { output: [{ type: 'text', text: JSON.stringify({ kind: 'answered', answer: asked.answer }) }] };
    },
  });
}

/** What `askPerson` gives back: the answer, or the park the tool returns so Pi holds the call until the answer arrives. */
export type Asked = { readonly answer: string } | ToolPark;

/**
 * Ask the person from inside a running native tool. The question is a conversation document bound to the asking assistant entry and
 * tool call (`askUserQuestionId`). While it is pending the tool returns the park this gives back (`{ sleep: { signals } }`): Pi holds
 * no invocation and no model request, a restart keeps the call asleep, and `answerUserQuestion(conversation, questionId, answer)`
 * (one of `options`, or any text when `allowFreeText`) settles the document and wakes the call, which runs again and gets the answer.
 * Throws when the question is cancelled. Pair it with `cancel: cancelQuestion` on the tool. `createAskUserTool` asks this way.
 * With `hold`, the call stays running and watches the document until it is settled, then resolves with the answer, never a park:
 * `requireApproval` asks this way because Pi lets a tool wrapper (`createApprovalExtension`) return only its base's park, never its own.
 * Remove `hold` once Pi offers a parking wrapper.
 */
export async function askPerson(api: ToolExecutionApi, context: Context, question: { readonly prompt: string; readonly options?: readonly string[]; readonly allowFreeText?: boolean },
  options: { readonly hold?: boolean } = {}): Promise<Asked> {
  const { key, state } = await api.commit(async tx => {
    const key = await ownBindingKey(tx, api);
    const document = await tx.doc(documents, api.conversationId, key, null);
    if (!document.question) {
      const legacy = await tx.doc(documents, api.conversationId, api.callId, null);
      document.question = legacy.question?.taskId === api.taskId ? { ...legacy.question, options: [...legacy.question.options], state: { ...legacy.question.state } }
        : { prompt: question.prompt, options: [...(question.options ?? [])], allowFreeText: question.allowFreeText === true, taskId: api.taskId, state: { kind: 'pending' } };
    }
    if (document.question.taskId !== api.taskId) throw new Error('Question identity belongs to another task');
    return { key, state: { ...document.question.state } };
  }, context);
  const settled = state.kind === 'pending' && options.hold ? await holdForAnswer(api, key, context) : state;
  if (settled.kind === 'answered') return { answer: settled.answer };
  if (settled.kind === 'cancelled') throw new Error('Question cancelled');
  return { sleep: { signals: [CallSettled.key(key)] } };
}

/** Watches the question document inside the running call until it is settled; stopping the call cancels the question. */
async function holdForAnswer(api: ToolExecutionApi, key: string, context: Context): Promise<AskState> {
  const watch = await api.watchDoc(documents, api.conversationId, key, context);
  if (!watch) throw new Error('Question record is missing');
  const signal = context.abortSignal;
  const settledState = (value: Readonly<AskDocument> | null | undefined): AskState | undefined => value?.question && value.question.state.kind !== 'pending' ? value.question.state : undefined;
  try {
    return await new Promise<AskState>((resolve, reject) => {
      const already = settledState(watch.value);
      if (already) return resolve(already);
      if (signal?.aborted) return reject(signal.reason ?? new Error('Question cancelled'));
      signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('Question cancelled')), { once: true });
      void watch.closed.then(() => reject(new Error('Question observation closed')));
      watch.start(async call => { const next = call.kind === 'value' ? settledState(call.retired ? null : call.value) : undefined; if (next) resolve(next); });
    });
  } catch (error) {
    if (signal?.aborted) await cancelQuestion(api, BACKGROUND_CONTEXT).catch(() => undefined);
    throw error;
  } finally { await watch.stop(); }
}

/** The `cancel` of a tool that asks through `askPerson`: stopping the conversation cancels the pending question. */
export async function cancelQuestion(api: ToolExecutionApi, context: Context): Promise<void> {
  await api.commit(async tx => {
    const { question } = await tx.doc(documents, api.conversationId, await ownBindingKey(tx, api), null);
    if (question?.state.kind === 'pending') question.state = { kind: 'cancelled' };
  }, context);
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
      if (await tx.signal(task.id, CallSettled, binding.key, {}) === 'closed') return { kind: 'conflict', reason: 'The question was cancelled' };
      question.state = { kind: 'answered', answer: text };
      return { kind: 'answered' };
    }, context) as AskUserAnswer;
  } catch (error) {
    if (error instanceof AmbiguousCall) return { kind: 'conflict', reason: 'Use the assistant-entry-bound question ID' };
    if (error instanceof UnknownCall) return { kind: 'unknown-question' };
    throw error;
  }
}
