import { defineDoc } from '@earendil-works/pi-durable';
import type { ConversationDocToken, ToolExecutionResult, Tx } from '@earendil-works/pi-durable';
import type { Context, JsonValue } from '@earendil-works/chord';
import { Check, Errors } from 'typebox/schema';

/**
 * The result protocol of a one-call run: the agent answers by calling one result tool (or in plain text), the host validates it and
 * spends a repair budget on a wrong answer, in the run's own conversation. The pure half (`resultState`) and the settle loop are the
 * same for every home, so they live here once. Pi owns the turns and the transcript; this reads the host's whole transcript and only
 * submits a native follow-up input to ask for a corrected result.
 */

/** A message of the host's transcript as the protocol reads it (the pi-ai message, kept structural). */
export interface ResultMessage {
  readonly role: string;
  readonly content?: unknown;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly isError?: boolean;
  readonly details?: unknown;
}
export interface ResultCall { readonly id: string; readonly name: string; readonly arguments: unknown }

/** `result:` of an agent card: the schema of the answer, the host operation that checks it, and how many repairs it may spend. */
export interface ResultConfig {
  readonly schema?: JsonObjectSchema;
  readonly validate?: string;
  readonly repairs: number;
}
export interface JsonObjectSchema { readonly type: 'object'; readonly properties?: Readonly<Record<string, unknown>>; readonly [keyword: string]: unknown }
/** The result tool of a card (`tool.json`). */
export interface ResultTool { readonly name: string; readonly description?: string; readonly input: JsonObjectSchema }
/** What the protocol needs of an agent card: its name, the result tool (structured results) and the `result:` settings. */
export interface ResultCard { readonly name: string; readonly output?: ResultTool; readonly result?: ResultConfig }

/** The host's call of a result validator (an operation), as the person whose run it is. `key` makes the call once. */
export type ResultInvoke = (operation: string, input: unknown, key: string) => Promise<unknown>;
export type ResultValidation = { readonly valid: boolean; readonly hint?: string };
/** The tool results a run obtained, as a validator sees them. */
export interface ResultEvidence { readonly name: string; readonly arguments: unknown; readonly results: { readonly content: unknown; readonly isError: boolean } }
export type RunAnswer = { readonly output: Record<string, unknown> } | { readonly text: string };
/** Why a run did not produce its result: `end` is the run's end status (`invalid_output`, `interrupted`, `revoked` or `error`). */
export type ResultFailure = { readonly error: string; readonly end: string };
export type SettledResult =
  | { readonly result?: RunAnswer; readonly validation?: ResultValidationRecord; readonly error?: undefined; readonly end?: undefined }
  | ResultFailure;
/** What delivery re-checks: the card and the evidence the result was accepted on. */
export interface ResultValidationRecord { readonly card: ResultCard; readonly evidence: readonly ResultEvidence[] }

const MAX_HINT = 1000;
const OPERATION = /^[A-Za-z][\w.-]{0,80}$/;
/** A settled submission that was cut short (aborted, reset, superseded) is `interrupted`; any other non-answer is an `error`. */
const INTERRUPTED: ReadonlySet<string> = new Set(['aborted', 'reset', 'stale']);

/**
 * The per-conversation count of repair attempts that left no result call (a model that answered in text instead of the tool).
 * Defined without `history` and `fork`, exactly as the homes that ran this protocol before persisted it: pi-durable refuses a token
 * whose semantics differ from the stored record, so adding them here would break every existing run store.
 */
export const ResultBudget = defineDoc({ kind: 'boring.result-budget', checkpointWhen: () => false, version: 1, scope: 'conversation', initial: () => ({ misses: 0 }) } as unknown as Parameters<typeof defineDoc<{ misses: number }>>[0]) as unknown as ConversationDocToken<{ misses: number }>;

/** Parse `result:` of a card. `legacy` is the card's `tool.json`, whose input is the default schema. Throws a plain Error naming the agent. */
export function resultConfig(value: unknown, legacy: { readonly input?: JsonObjectSchema } | undefined, name: string): ResultConfig {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error(`agents/${name}: result is { schema?, validate?, repairs? }`);
  const result = (value ?? {}) as { schema?: unknown; validate?: unknown; repairs?: unknown };
  if (result.validate !== undefined && (typeof result.validate !== 'string' || !OPERATION.test(result.validate))) throw new Error(`agents/${name}: result.validate names an operation`);
  const repairs = result.repairs === undefined ? 2 : result.repairs;
  if (typeof repairs !== 'number' || !Number.isSafeInteger(repairs) || repairs < 0 || repairs > 10) throw new Error(`agents/${name}: result.repairs is an integer from 0 to 10`);
  const schema = result.schema === undefined ? legacy?.input : result.schema;
  if (schema !== undefined && (!schema || typeof schema !== 'object' || Array.isArray(schema) || (schema as { type?: unknown }).type !== 'object')) throw new Error(`agents/${name}: result.schema is an object JSON Schema`);
  return { ...(schema ? { schema: schema as JsonObjectSchema } : {}), ...(typeof result.validate === 'string' ? { validate: result.validate } : {}), repairs };
}

export const callsOf = (messages: readonly ResultMessage[]): ResultCall[] =>
  messages.flatMap(m => m.role === 'assistant' && Array.isArray(m.content) ? (m.content as readonly { type?: string }[]).filter(p => p.type === 'toolCall') as unknown as ResultCall[] : []);

export interface ResultState {
  /** The last result call a host tool result accepted, or null. */
  readonly accepted: Record<string, unknown> | null;
  readonly error?: string;
  readonly end?: string;
  /** Result calls made so far, plus the misses recorded for answers that made none. */
  readonly attempts: number;
  /** No attempt left and nothing accepted (or more attempts than the budget allows). */
  readonly exhausted: boolean;
}

/** The state of a run's result from its transcript. Only a host tool result can accept a call; a later rejected call cannot replace an accepted one. */
export function resultState(card: ResultCard, messages: readonly ResultMessage[], misses = 0): ResultState {
  if (!card.result) return { accepted: null, attempts: 0, exhausted: false };
  const all = callsOf(messages), calls = all.filter(c => c.name === card.output?.name);
  const acceptedIds = new Set<string>();
  let accepted: Record<string, unknown> | null = null, error: string | undefined, end: string | undefined;
  for (const message of messages) {
    if (message.role !== 'toolResult' || message.toolName !== card.output?.name) continue;
    const checked = (message.details as { resultValidation?: { error?: string; end?: string; valid?: boolean } } | undefined)?.resultValidation;
    if (checked?.error) { error = checked.error; end = checked.end ?? 'error'; }
    if (!message.isError && checked?.valid === true && message.toolCallId !== undefined) acceptedIds.add(message.toolCallId);
  }
  for (const call of calls) {
    if (acceptedIds.has(call.id) && all.filter(c => c.id === call.id).length === 1 && card.output && Check(card.output.input, call.arguments)) accepted = call.arguments as Record<string, unknown>;
  }
  const attempts = calls.length + misses;
  return { accepted, ...(error !== undefined ? { error } : {}), ...(end !== undefined ? { end } : {}), attempts, exhausted: attempts > card.result.repairs + 1 || (attempts === card.result.repairs + 1 && !accepted) };
}

/** The message of a one-call run: the input as JSON, and how to answer. */
export function runMessage(card: Pick<ResultCard, 'output'>, input: unknown): string {
  const data = typeof input === 'string' ? input : `Input:\n${JSON.stringify(input ?? {}, null, 2)}`;
  return card.output ? `${data}\n\nReturn the result by calling the tool ${card.output.name} exactly once. No text outside that call.` : data;
}

/** A run's answer: only the last host-accepted result call, else the last markdown reply. */
export function runResult(card: ResultCard, messages: readonly ResultMessage[] | undefined): RunAnswer | null {
  if (card.output) {
    const state = resultState(card, messages ?? []);
    return state.accepted && !state.error && !state.exhausted ? { output: state.accepted } : null;
  }
  let text = '';
  for (const message of messages ?? []) {
    if (message?.role !== 'assistant') continue;
    const parts: readonly { type?: string; text?: string }[] = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : Array.isArray(message.content) ? message.content : [];
    const said = parts.filter(p => p.type === 'text' && p.text).map(p => p.text).join('');
    if (said) text = said;
  }
  return text ? { text } : null;
}

/** The model sees the complete result schema as the tool's parameters (nested items, descriptions, required), like a production tool. */
export function resultParameters(card: Required<Pick<ResultCard, 'output'>>): JsonObjectSchema {
  return { ...card.output.input, type: 'object', properties: card.output.input.properties ?? {} };
}
export const resultDescription = (card: Required<Pick<ResultCard, 'output'>>): string => card.output.description ?? '';

/** The conversation of a run, as the protocol needs it: a native `Conversation` of a Harness satisfies it. */
export interface ResultConversation {
  readonly id: number;
  commit<T>(fn: (tx: Tx) => Promise<T> | T, context: Context): Promise<T>;
  submit(draft: { readonly type: 'input'; readonly content: string; readonly requestId?: string }, context: Context): Promise<ResultSubmission>;
}
export interface ResultSubmission { wait(context: Context): Promise<{ readonly status: string; readonly reason?: string }> }

/** Read the host's whole transcript, not a compacted model context or model-provided evidence. */
export async function resultMessages(reader: Pick<Tx, 'scanEntries'>, conversationId: number): Promise<ResultMessage[]> {
  const entries: { readonly model?: readonly unknown[] }[] = [];
  let cursor: unknown;
  do {
    const page = await reader.scanEntries({ conversationId, order: 'ascending' } as never, 500, cursor as never) as { items: readonly { model?: readonly unknown[] }[]; next?: unknown };
    entries.push(...page.items); cursor = page.next;
  } while (cursor);
  return entries.flatMap(e => (e.model ?? []) as ResultMessage[]);
}

/** The tool results a run obtained (every call but the result tool's own), with the arguments that actually executed. */
export function evidenceOf(card: ResultCard, messages: readonly ResultMessage[]): ResultEvidence[] {
  const all = callsOf(messages), calls = all.filter(c => c.name !== card.output?.name);
  return messages.filter(m => m.role === 'toolResult' && calls.some(c => c.id === m.toolCallId && c.name === m.toolName) && all.filter(c => c.id === m.toolCallId).length === 1).map(m => {
    const call = calls.find(c => c.id === m.toolCallId)!;
    return { name: call.name, arguments: (m.details as { hostArguments?: unknown } | undefined)?.hostArguments ?? call.arguments, results: { content: m.content, isError: Boolean(m.isError) } };
  });
}

/**
 * Check a result: the schema first (no coercion), then the card's `result.validate` operation, called through `invoke` with the
 * evidence. `phase` is `attempt` while the agent answers and `delivery` for the check made again just before the run is delivered;
 * `key` must be fresh for a delivery check. Throws when the validator answers something else than `{ valid, hint? }`.
 */
export async function validateResult(card: ResultCard, output: unknown, evidence: readonly ResultEvidence[], invoke: ResultInvoke, phase: 'attempt' | 'delivery', key: string): Promise<ResultValidation> {
  if (card.output && !Check(card.output.input, output)) {
    const [, errors] = Errors(card.output.input, output);
    return { valid: false, hint: errors.map(e => `${e.instancePath || '/'}: ${e.message}`).join('; ').slice(0, MAX_HINT) };
  }
  if (!card.result?.validate) return { valid: true };
  const checked = await invoke(card.result.validate, { output, evidence, ...(phase === 'delivery' ? { phase } : {}) }, key) as { valid?: unknown; hint?: unknown } | null | undefined;
  if (!checked || typeof checked.valid !== 'boolean' || (checked.hint !== undefined && typeof checked.hint !== 'string')) throw new Error(`result.validate ${card.result.validate}: expected { valid: boolean, hint?: string }`);
  return { valid: checked.valid, hint: checked.hint?.slice(0, MAX_HINT) ?? 'Return a supported result.' };
}

/** `end` of a run from an error thrown while validating: a refusal by the host's authority is `revoked`, anything else `error`. */
export function validationError(error: unknown): ResultFailure {
  const e = error as { message?: unknown; status?: unknown };
  return { error: String(e?.message ?? error).slice(0, 500), end: e?.status === 401 || e?.status === 403 ? 'revoked' : 'error' };
}

/** Record the arguments that actually executed (after guards and coercion), never ones invented in the final answer. */
export function withEvidence<T extends { execute: (...args: never[]) => Promise<ToolExecutionResult> }>(tool: T): T {
  const execute = tool.execute as (args: unknown, api: unknown, context: unknown) => Promise<ToolExecutionResult>;
  return { ...tool, async execute(args: unknown, api: unknown, context: unknown) {
    const result = await execute.call(tool, args, api, context);
    return { ...result, details: { ...(result.details as object | undefined), hostArguments: args } as JsonValue };
  } } as T;
}

/**
 * Settle a one-call run in its own conversation: wait for the answer, read the result, check it, and while it is wrong and the card's
 * repair budget lasts, ask for a corrected result with a native follow-up input (`repair:<conversation>:<n>`, so a replay finds the
 * same submission). A result that passes is checked once more with phase `delivery` before it is returned. Not durable by itself:
 * the caller records the end; a process that dies in the middle ends the run `interrupted`.
 */
export async function settleResult(options: {
  card: ResultCard; conversation: ResultConversation; submission: ResultSubmission; invoke: ResultInvoke; context: Context;
  readResult?: (card: ResultCard, messages: readonly ResultMessage[]) => RunAnswer | null;
}): Promise<SettledResult> {
  const { card, conversation, invoke, context, readResult = runResult } = options;
  let submission = options.submission, previousAttempts = 0;
  for (let attempt = 0; ; attempt++) {
    const settled = await submission.wait(context);
    const messages = await conversation.commit(tx => resultMessages(tx, conversation.id), context);
    const budget = await conversation.commit(async tx => ({ misses: (await tx.doc(ResultBudget, conversation.id as never)).misses }), context);
    const state = resultState(card, messages, budget.misses);
    if (state.error) return { error: state.error, end: state.end ?? 'error' };
    if (card.output && state.exhausted) return { error: `${card.name} returned no result matching tool.json: repair budget exhausted`, end: 'invalid_output' };
    if (settled.status !== 'done') return { error: `${card.name} did not answer (${settled.reason ?? settled.status})`, end: INTERRUPTED.has(settled.reason ?? '') ? 'interrupted' : 'error' };
    const result = readResult(card, messages);
    // A card without `result:` keeps its own result reader: no host validation, no repairs.
    if (!card.result) return result ? { result } : {};
    const checked: ResultValidation = result
      ? (card.output ? { valid: true } : await validateResult(card, (result as { text: string }).text, evidenceOf(card, messages), invoke, 'attempt', `result:${conversation.id}:markdown:${attempt}`))
      : { valid: false, hint: card.output ? `Return the result using ${card.output.name}.` : 'Return a non-empty answer.' };
    if (checked.valid && result) {
      const validation: ResultValidationRecord = { card, evidence: evidenceOf(card, messages) };
      const fresh = await validateResult(card, 'output' in result ? result.output : result.text, validation.evidence, invoke, 'delivery', `result-delivery:${conversation.id}:${crypto.randomUUID()}`);
      return fresh.valid ? { result, validation } : { error: fresh.hint ?? 'Return a supported result.', end: 'invalid_output' };
    }
    const hint = checked.hint ?? 'Return a supported result.';
    const attempts = card.output ? state.attempts + (state.attempts === previousAttempts ? 1 : 0) : attempt + 1;
    if (attempts >= card.result.repairs + 1) return { error: hint, end: 'invalid_output' };
    if (card.output && state.attempts === previousAttempts) await conversation.commit(async tx => { (await tx.doc(ResultBudget, conversation.id as never)).misses++; }, context);
    previousAttempts = attempts;
    submission = await conversation.submit({ type: 'input', content: `Invalid result: ${hint}\nReturn a corrected result.`, requestId: `repair:${conversation.id}:${attempt + 1}` }, context);
  }
}

/** What the result tool's `execute` is given by the Harness (`api`): the invocation's conversation, call and task, and its transaction. */
export interface ResultToolApi {
  readonly conversationId: number;
  readonly callId: string;
  readonly taskId: number;
  commit<T>(fn: (tx: Tx) => Promise<T> | T, context: Context): Promise<T>;
  snapshot(token: typeof ResultBudget, conversationId: number, context: Context): Promise<{ readonly misses: number } | undefined>;
}

/** The `execute` of the result tool: validates the call the model made, spends the repair budget, and ends the turn when the budget is gone. */
export function resultExecutor(card: ResultCard & { readonly output: ResultTool; readonly result: ResultConfig }, invoke: ResultInvoke) {
  return async (args: unknown, api: ResultToolApi, context: Context) => {
    const messages = await api.commit(tx => resultMessages(tx, api.conversationId), context);
    const budget = await api.snapshot(ResultBudget, api.conversationId, context);
    const state = resultState(card, messages, budget?.misses ?? 0);
    const calls = callsOf(messages).filter(c => c.id === api.callId);
    const output = calls[0]?.arguments ?? args;
    let checked: ResultValidation;
    try {
      checked = calls.length > 1 ? { valid: false, hint: 'Use a unique result call id.' }
        : state.attempts > card.result.repairs + 1 ? { valid: false, hint: 'Result repair budget exhausted' }
        : await validateResult(card, output, evidenceOf(card, messages), invoke, 'attempt', `result:${api.conversationId}:${api.taskId}`);
    } catch (error) {
      return { output: [{ type: 'text' as const, text: 'Result validation failed.' }], isError: true, details: { resultValidation: validationError(error) }, control: { terminate: true as const } };
    }
    return {
      output: [{ type: 'text' as const, text: checked.valid ? 'Saved.' : `Invalid result: ${checked.hint}` }],
      isError: !checked.valid, details: { resultValidation: { valid: checked.valid } },
      ...(!checked.valid && state.attempts >= card.result.repairs + 1 ? { control: { terminate: true as const } } : {}),
    };
  };
}
