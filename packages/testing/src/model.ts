// A scripted, keyless model: answers come from prompt rules instead of a real model, so an app's agent and UI run the same way
// every time. It is a native pi-ai provider (registered in a `Models` collection) whose messages are built with pi-ai's faux
// builders. pi-ai's `fauxProvider` already answers from a fixed queue of messages; use it directly for that. This adds what the
// queue lacks: answers chosen by the prompt they reply to, explicit stream chunks and pacing, abortable delays, usage priced at the
// model's rates, failures, and turns a test drives by hand (`createFakeChatModel`).
//
// Script: `{ 'text in the user message': turns }`, or named `sources` of entries. The turns answer that message in order: a user
// message starts turn 0 and every tool result starts the next one. A turn is
//   'text'                                   a final answer
//   { text, reasoning, tools, delay, hold }  text and/or reasoning, then tool calls [{ name, args, id?, ms? }] (`ms` streams the arguments); `delay` waits first,
//                                            `hold` keeps the turn open after the calls (ms)
//   { ..., usage: { input, output } }        the token counts it reports (default: about four characters per token), priced at the model's `cost`
//   { text: { chunks: [...], ms } }          streamed in those chunks, `ms` apart (abortable); `chunks` may be an async iterable
//   { error: 'message' }                     the model fails this turn (stop reason `error`)
//   ctx => turn                              decided from what happened so far (see `TurnContext`)
// Which source answers: the conversation's user messages name it (the source that answers most of them); the last user message
// names the entry. A message nothing answers is a miss: the model says so in the transcript and `misses` records it.
import type { AssistantMessage, AssistantMessageEvent, Message, Model, SimpleStreamOptions, TextContent, ThinkingContent, ToolCall, ToolResultMessage, TranscriptContext } from '@earendil-works/pi-ai';
import { createModels, createProvider, type MutableModels } from '@earendil-works/pi-ai/models';
import { createFauxCore, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall, type FauxModelDefinition } from '@earendil-works/pi-ai/providers/faux';
import { createAssistantMessageEventStream, type AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { parseStreamingJson } from '@earendil-works/pi-ai/utils/json-parse';
import { getCurrentSystemPrompt, getCurrentTools } from '@earendil-works/pi-ai/utils/transcript';

/** One tool result of the transcript, as a script reads it. */
export interface ScriptedResult {
  readonly name: string;
  readonly args: unknown;
  readonly text: string;
  /** `text` parsed as JSON, when it is JSON. */
  readonly json: any;
  readonly isError: boolean;
  readonly details: unknown;
}

/** What a turn function sees. */
export interface TurnContext {
  /** The typed text of the user message this turn answers. */
  readonly user: string;
  /** That whole native message content (attached files and images are parts of it). */
  readonly input: unknown;
  /** Tool results since that message, and the last of them. */
  readonly results: readonly ScriptedResult[];
  readonly last: ScriptedResult | undefined;
  /** Tool results since the start of the conversation. */
  readonly history: readonly ScriptedResult[];
  readonly messages: readonly Message[];
  /** The tool names this request offers, and its system prompt, as the model receives them. */
  readonly tools: readonly string[];
  readonly system: string | undefined;
  /** The native request and its abort signal. */
  readonly context: TranscriptContext;
  readonly signal: AbortSignal | undefined;
}

export interface ScriptedToolCall {
  readonly name: string;
  readonly args?: unknown;
  /** A fixed call id (default: a fresh one). */
  readonly id?: string;
  /** Stream the arguments' JSON in small chunks this many ms apart (abortable), as a provider does: until the call ends, the
   * live message holds partial arguments (an options list still growing, a string cut short). Default: the call arrives whole. */
  readonly ms?: number;
}

export interface TurnObject {
  text?: string | { readonly chunks: Iterable<string> | AsyncIterable<string>; readonly ms?: number };
  reasoning?: string;
  tools?: readonly ScriptedToolCall[];
  delay?: number;
  hold?: number;
  usage?: { readonly input?: number; readonly output?: number };
  error?: string;
}
export type Turn = string | TurnObject | ((ctx: TurnContext) => string | TurnObject);

export interface ScriptEntry { readonly match: string; readonly turns: readonly Turn[] }
export interface ScriptSource { readonly name: string; readonly entries: readonly ScriptEntry[] }
/** A rule over the user text that needs no script: `turns(found)` for a match of `match`. */
export interface GenericRule { readonly match: RegExp; readonly turns: (found: RegExpExecArray) => readonly Turn[] }

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function numberWords(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : '');
  return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`;
}
/** Pace of a streamed essay line: long enough for a journey to act while it works, short enough to keep the run fast. */
const LINE_MS = 130;

/** Mechanical prompts answered without a script: "Reply with exactly: X" and a streamed essay "write the numbers from 1 to N in English words ... end with the exact line: X". */
export const GENERIC_RULES: readonly GenericRule[] = [
  { match: /reply with exactly: ([A-Za-z0-9-]+)/i, turns: found => [found[1]!] },
  { match: /write the numbers from 1 to (\d+) in english words.*?(?:end with the exact line: ([^.]+))?\.?\s*$/is, turns: found => {
    const lines = Array.from({ length: Number(found[1]) }, (_, at) => `${numberWords(at + 1)}\n`);
    if (found[2]) lines.push(found[2]);
    return [{ text: { chunks: lines, ms: LINE_MS } }];
  } },
];
/** Whether a prompt is answered by a generic rule (no script needed). */
export const answeredGenerically = (prompt: string): boolean => GENERIC_RULES.some(rule => rule.match.test(prompt));

export interface ScriptedModelOptions {
  /** `{ 'text in the user message': turns }`: one unnamed source. */
  readonly script?: Readonly<Record<string, readonly Turn[]>>;
  /** Named scripts; the conversation's user messages choose one. */
  readonly sources?: readonly ScriptSource[];
  /** Rules tried when no script answers (default `GENERIC_RULES`). */
  readonly generic?: readonly GenericRule[];
  /** Answers every call nothing else answers, instead of a miss. */
  readonly fallback?: (ctx: TurnContext) => string | TurnObject;
  /** pi-ai's faux model definitions (`cost` is the USD per million tokens a turn's usage is priced at). Default: one free `scripted` model. */
  readonly models?: readonly FauxModelDefinition[];
  readonly provider?: string;
  readonly api?: string;
  /** Where misses are recorded (default: a new array). */
  readonly misses?: string[];
}

export interface ScriptedModel {
  readonly models: MutableModels;
  /** The first model, as an agent definition names it. */
  readonly model: { readonly provider: string; readonly modelId: string };
  readonly definitions: readonly Model<string>[];
  /** Messages no script answered, and failures of the model itself. A journey asserts this is empty. */
  readonly misses: string[];
}

type Content = TextContent | ThinkingContent | ToolCall;
const textOf = (message: Message): string => typeof message.content === 'string' ? message.content
  : (message.content as readonly { type: string; text?: string }[]).filter(part => part.type === 'text' && !part.text!.startsWith('<file path="')).map(part => part.text).join('');
/** Characters of a streamed tool call's JSON per `toolcall_delta`. */
const TOOL_CHUNK = 8;
const sleep = (ms: number, signal: AbortSignal | undefined) => new Promise<void>(resolve => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});
const tokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

/** Earliest occurrence in the message wins (a background report quotes its task further down), then the longest key. */
function pick(entries: readonly ScriptEntry[], text: string): ScriptEntry | undefined {
  const found = entries.map(entry => ({ entry, at: text.indexOf(entry.match) })).filter(item => item.at >= 0);
  found.sort((a, b) => a.at - b.at || b.entry.match.length - a.entry.match.length);
  return found[0]?.entry;
}

export function createScriptedModel(options: ScriptedModelOptions = {}): ScriptedModel {
  const sources = [...options.sources ?? [], ...options.script ? [{ name: 'script', entries: Object.entries(options.script).map(([match, turns]) => ({ match, turns })) }] : []];
  const generic = options.generic ?? GENERIC_RULES;
  const misses = options.misses ?? [];
  const provider = options.provider ?? 'scripted';
  // pi-ai's faux core normalizes the model definitions; its queue and stream are not used.
  const definitions = createFauxCore({ api: options.api ?? 'scripted', provider, models: [...options.models ?? [{ id: 'scripted', name: 'Scripted' }]] }).models;
  let calls = 0;

  type Chosen = { user: string; turns?: readonly Turn[]; source?: string; problem?: string };
  function turnsFor(messages: readonly Message[]): Chosen {
    const texts = messages.filter(message => message.role === 'user').map(textOf);
    const user = texts.at(-1) ?? '';
    const score = (source: ScriptSource) => texts.filter(text => pick(source.entries, text)).length;
    const best = Math.max(0, ...sources.map(score));
    const named = best === 0 ? [] : sources.filter(source => score(source) === best);
    const entries = named.map(source => pick(source.entries, user)).filter(entry => entry !== undefined);
    if (entries.length > 0) {
      if (entries.some(entry => entry.turns !== entries[0]!.turns)) return { user, problem: `ambiguous script: ${named.map(source => source.name).join(' and ')} answer "${user.slice(0, 80)}" differently` };
      return { user, turns: entries[0]!.turns, source: named.find(source => pick(source.entries, user))!.name };
    }
    for (const rule of generic) { const found = rule.match.exec(user); if (found) return { user, turns: rule.turns(found), source: 'generic' }; }
    return { user, problem: `no script answers "${user.slice(0, 120)}"${named[0] ? ` in ${named.map(source => source.name).join(' or ')}` : ''}` };
  }

  const stream = (chosen: Model<string>, context: TranscriptContext, streamOptions: SimpleStreamOptions = {}): AssistantMessageEventStream => {
    const events = createAssistantMessageEventStream();
    const message: AssistantMessage = { ...fauxAssistantMessage([], { timestamp: 1 }), api: chosen.api, provider: chosen.provider, model: chosen.id };
    message.usage = structuredClone(message.usage);
    const content = message.content as Content[];
    const push = (event: AssistantMessageEvent) => events.push(event);
    const signal = streamOptions.signal;
    let finished = false;
    const end = (reason: 'aborted' | 'error', errorMessage: string) => {
      if (finished) return;
      finished = true;
      message.stopReason = reason; message.errorMessage = errorMessage;
      push({ type: 'error', reason, error: message }); events.end(message);
    };
    const abort = () => end('aborted', 'Scripted provider cancelled');
    const run = async () => {
      push({ type: 'start', partial: message });
      const messages = context.messages as readonly Message[];
      const lastUser = messages.map(item => item.role).lastIndexOf('user');
      const { user, turns, problem, source } = turnsFor(messages);
      const after = messages.slice(lastUser + 1);
      const resultOf = (result: ToolResultMessage): ScriptedResult => {
        const call = messages.flatMap(item => item.role === 'assistant' ? item.content : []).find(part => part.type === 'toolCall' && part.id === result.toolCallId) as ToolCall | undefined;
        const text = result.content.map(part => part.type === 'text' ? part.text : '').join('');
        let json; try { json = JSON.parse(text); } catch { /* not JSON */ }
        return { name: result.toolName, args: call?.arguments, text, json, isError: result.isError, details: result.details };
      };
      const results = after.filter(item => item.role === 'toolResult').map(resultOf);
      const ctx: TurnContext = { user, input: messages[lastUser]?.content, results, last: results.at(-1), messages, context, signal,
        history: messages.filter(item => item.role === 'toolResult').map(resultOf),
        tools: getCurrentTools(messages).map(tool => tool.name), system: getCurrentSystemPrompt(messages) };
      const index = after.filter(item => item.role === 'assistant').length;
      let turn: Turn | undefined = problem ? undefined : turns?.[index];
      if (turn === undefined && options.fallback) turn = options.fallback;
      if (turn === undefined) {
        const why = problem ?? `the script of ${source} has no turn ${index} (it answered ${index} times already)`;
        misses.push(why); console.error(`scripted model: ${why}`);
        turn = `[scripted model: ${why}]`;
      }
      if (typeof turn === 'function') turn = turn(ctx);
      const step: TurnObject = typeof turn === 'string' ? { text: turn } : turn;
      if (step.delay) await sleep(step.delay, signal);
      if (signal?.aborted) return abort();
      if (step.error !== undefined) return end('error', step.error);
      if (step.reasoning) {
        const at = content.push(fauxThinking('')) - 1;
        push({ type: 'thinking_start', contentIndex: at, partial: message });
        (content[at] as ThinkingContent).thinking = step.reasoning;
        push({ type: 'thinking_delta', contentIndex: at, delta: step.reasoning, partial: message });
        push({ type: 'thinking_end', contentIndex: at, content: step.reasoning, partial: message });
      }
      if (step.text !== undefined) {
        const chunks = typeof step.text === 'string' ? [step.text] : step.text.chunks, ms = typeof step.text === 'string' ? 0 : step.text.ms ?? 0;
        const at = content.push(fauxText('')) - 1, part = content[at] as TextContent;
        push({ type: 'text_start', contentIndex: at, partial: message });
        for await (const chunk of chunks) {
          if (signal?.aborted || finished) return abort();
          part.text += chunk;
          push({ type: 'text_delta', contentIndex: at, delta: chunk, partial: message });
          if (ms) await sleep(ms, signal);
        }
        if (signal?.aborted) return abort();
        push({ type: 'text_end', contentIndex: at, content: part.text, partial: message });
      }
      for (const tool of step.tools ?? []) {
        const args = typeof tool.args === 'function' ? tool.args(ctx) : tool.args ?? {};
        const call = fauxToolCall(tool.name, args, { id: tool.id ?? `call_${++calls}` });
        if (!tool.ms) {
          const at = content.push(call) - 1;
          push({ type: 'toolcall_start', contentIndex: at, partial: message });
          push({ type: 'toolcall_end', contentIndex: at, toolCall: call, partial: message });
          continue;
        }
        const json = JSON.stringify(args), streamed: ToolCall = { ...call, arguments: {} };
        const at = content.push(streamed) - 1;
        push({ type: 'toolcall_start', contentIndex: at, partial: message });
        for (let sent = 0; sent < json.length;) {
          const delta = json.slice(sent, sent + TOOL_CHUNK); sent += delta.length;
          streamed.arguments = parseStreamingJson(json.slice(0, sent));
          push({ type: 'toolcall_delta', contentIndex: at, delta, partial: message });
          await sleep(tool.ms, signal);
          if (signal?.aborted || finished) return abort();
        }
        content[at] = call;
        push({ type: 'toolcall_end', contentIndex: at, toolCall: call, partial: message });
      }
      if (step.hold) await sleep(step.hold, signal); // the call is on screen, running, before the turn ends
      if (signal?.aborted || finished) return abort();
      message.stopReason = step.tools?.length ? 'toolUse' : 'stop';
      // Token usage priced like a provider would, at the model's rates: what a metered host charges for this turn.
      const input = step.usage?.input ?? tokens(JSON.stringify(messages)), output = step.usage?.output ?? tokens(JSON.stringify(content));
      const rates = chosen.cost, cost = { input: rates.input * input / 1e6, output: rates.output * output / 1e6, cacheRead: 0, cacheWrite: 0 };
      message.usage = { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output, cost: { ...cost, total: cost.input + cost.output } };
      finished = true;
      push({ type: 'done', reason: message.stopReason, message }); events.end(message);
    };
    signal?.addEventListener('abort', abort, { once: true });
    run().catch(error => { misses.push(`the scripted model failed: ${error?.stack ?? error}`); end('error', String(error)); });
    return events;
  };
  const models = createModels();
  models.setProvider(createProvider({ id: provider, models: definitions, auth: { apiKey: { name: 'Fictional keyless provider', resolve: async () => ({ auth: {} }) } }, api: { stream, streamSimple: stream } }));
  return { models, model: { provider, modelId: definitions[0].id }, definitions, misses };
}

/** One model call of `createFakeChatModel`, waiting for the test. */
export interface FakeChatCall {
  readonly transcript: TranscriptContext;
  readonly signal: AbortSignal | undefined;
  /** Resolves once the call was aborted and the stream ended. */
  readonly aborted: Promise<void>;
  /** Streams more answer text. */
  append(text: string): void;
  /** Appends the last text and ends the answer, reporting `usage` priced at the model's rates (zero when absent). */
  respond(text: string, usage?: { readonly input?: number; readonly output?: number }): void;
}

/**
 * A model whose stream advances only when the test says so: every call waits in `nextCall()` until the test appends text and
 * responds. `cost` sets its rates (USD per million tokens). A scripted model whose every turn is a fallback the test drives.
 */
export function createFakeChatModel({ cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }: { readonly cost?: NonNullable<FauxModelDefinition['cost']> } = {}) {
  const calls: FakeChatCall[] = [], waiting: ((call: FakeChatCall) => void)[] = [], unread: FakeChatCall[] = [];
  const scripted = createScriptedModel({ provider: 'fictional-chat-provider', api: 'fictional-chat-api', generic: [],
    models: [{ id: 'fictional-chat', name: 'Fictional local chat', input: ['text', 'image'], contextWindow: 32768, maxTokens: 1024, cost }],
    fallback: ctx => {
      const queue: string[] = [], turn: TurnObject = {};
      let ended = false, wake: (() => void) | undefined, resolveAborted!: () => void;
      const aborted = new Promise<void>(resolve => { resolveAborted = resolve; });
      const notify = () => { const next = wake; wake = undefined; next?.(); };
      // Registered before the stream's own abort listener: the stream ends right after, in the same dispatch.
      const onAbort = () => { if (ended) return; ended = true; notify(); queueMicrotask(resolveAborted); };
      ctx.signal?.addEventListener('abort', onAbort, { once: true });
      if (ctx.signal?.aborted) onAbort();
      async function* chunks() {
        for (;;) {
          while (queue.length) yield queue.shift()!;
          if (ended) return;
          await new Promise<void>(resolve => { wake = resolve; });
        }
      }
      const append = (text: string) => { if (ended) throw new Error('Fictional stream already ended'); queue.push(text); notify(); };
      turn.text = { chunks: chunks() };
      const call: FakeChatCall = { transcript: structuredClone(ctx.context), signal: ctx.signal, aborted, append,
        respond: (text, usage) => {
          append(text);
          turn.usage = { input: usage?.input ?? 0, output: usage?.output ?? 0 };
          ended = true; notify();
          ctx.signal?.removeEventListener('abort', onAbort);
        } };
      calls.push(call);
      const next = waiting.shift();
      if (next) next(call); else unread.push(call);
      return turn;
    } });
  return {
    models: scripted.models, model: scripted.model, calls,
    nextCall: (): Promise<FakeChatCall> => unread.length ? Promise.resolve(unread.shift()!) : new Promise(resolve => waiting.push(resolve)),
  };
}
