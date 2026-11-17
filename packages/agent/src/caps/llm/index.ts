// One model call outside a conversation: `complete` (text) and `structured` (an answer checked against a closed JSON schema, one corrective
// turn), plus `llmTool`, the pi-durable tool built from the same function. Plain imports: no host, no Effect, no environment. A key comes
// only from `options.keys`.
import type { AssistantMessage, ImageContent, Model, Models, TextContent, Usage } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { jsonSchemaTool } from '../../json-schema-tool.js';
import { call, refusedText, toolKey, usageOf } from '../shared.js';
import type { Answered, CapOptions, Provider, Refusal, Region, Send } from '../shared.js';
import { fakeStructured, llmOf, schemaCheck } from './structured-port.js';

export type Turn = { role: 'system'; content: string } | { role: 'user'; content: string | (TextContent | ImageContent)[] } | { role: 'assistant'; content: string };
export type Effort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type LlmInput = { purpose: string; messages: Turn[]; maxTokens?: number; effort?: Effort };
/** `providers`: "fake", or "<pi provider id>:<model id>" looked up in `models`, else in pi-ai's own provider of that id. */
export type LlmOptions = CapOptions & { models?: Models };

const BUILTIN: Record<string, readonly [key: string, region: Region, load: () => Promise<Parameters<ReturnType<typeof createModels>['setProvider']>[0]>]> = {
  anthropic: ['ANTHROPIC_API_KEY', 'us', () => import('@earendil-works/pi-ai/providers/anthropic').then((m) => m.anthropicProvider())],
  openai: ['OPENAI_API_KEY', 'us', () => import('@earendil-works/pi-ai/providers/openai').then((m) => m.openaiProvider())],
  google: ['GEMINI_API_KEY', 'us', () => import('@earendil-works/pi-ai/providers/google').then((m) => m.googleProvider())],
  mistral: ['MISTRAL_API_KEY', 'eu', () => import('@earendil-works/pi-ai/providers/mistral').then((m) => m.mistralProvider())],
  openrouter: ['OPENROUTER_API_KEY', 'us', () => import('@earendil-works/pi-ai/providers/openrouter').then((m) => m.openrouterProvider())],
  typesafe: ['TYPESAFE_API_KEY', 'us', () => import('@earendil-works/pi-ai/providers/typesafe').then((m) => m.typesafeProvider())],
};
const FIELDS = ['purpose', 'messages', 'maxTokens', 'effort'];
const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const refusal = (kind: string, retryable = false): Refusal => ({ ok: false, kind, retryable });
const add = <T>(a: T, b: unknown): T => typeof a === 'number' ? (a + ((b as number | undefined) ?? 0)) as T : Object.fromEntries(Object.entries(a as object).map(([k, v]) => [k, add(v, (b as Record<string, unknown> | undefined)?.[k])])) as T;
const chars = (turn: Turn) => typeof turn.content === 'string' ? turn.content.length : turn.content.reduce((n, part) => n + (part.type === 'text' ? part.text.length : 0), 0);
/** An object schema (at any depth) that does not say `additionalProperties: false`. */
const open = (s: Record<string, any>): boolean => [].concat(s.type ?? []).includes('object' as never) && s.additionalProperties !== false || Object.values<any>(s.properties ?? {}).some(open) || (s.items !== undefined && open(s.items));

/** What a call refuses before anything is sent, as the kind; the limits are the Factory's, `maxTokens` capped later at the model's own. */
function limits(input: Record<string, any>, options: LlmOptions, structured: boolean): string | undefined {
  const turns = input.messages;
  if (typeof input.purpose !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(input.purpose)) return 'llm-purpose';
  if (!Array.isArray(turns) || !turns.length || turns.length > 50 || turns.at(-1)?.role !== 'user' || !turns.every((t) => ['system', 'user', 'assistant'].includes(t?.role))) return 'llm-messages:50';
  if (turns.reduce((n, turn) => n + chars(turn), 0) > 200_000) return 'llm-chars:200000';
  const range = (v: unknown, max: number) => v === undefined || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max);
  if (!range(input.maxTokens, 32_000)) return 'llm-max-tokens:32000';
  if (!range(options.timeoutMs, 300_000)) return 'llm-timeout:300000';
  if (Object.keys(input).some((k) => !FIELDS.includes(k) && !(structured && k === 'schema')) || (input.effort !== undefined && !EFFORTS.includes(input.effort))) return 'llm-field';
  return structured && (schemaCheck().problem(input.schema) || open(input.schema)) ? 'invalid-schema' : undefined;
}

/** Each listed name as a provider the shared call can try, and the pi model behind it; a model `registry` does not know refuses `llm-provider`. */
async function resolve(options: LlmOptions) {
  const named = options.providers.map((name) => [name, name.slice(0, Math.max(name.indexOf(':'), 0)), name.slice(name.indexOf(':') + 1)] as const).filter(([name]) => name !== 'fake');
  let registry = options.models;
  if (!registry) {
    const made = createModels();
    for (const id of new Set(named.map(([, id]) => id))) await BUILTIN[id]?.[2]().then((p) => made.setProvider(p));
    registry = made;
  }
  const table: Record<string, Provider> = {}, targets = new Map<string, Model<any>>();
  for (const name of options.providers) {
    if (name === 'fake') { table[name] = { name, region: 'none' }; continue; }
    const [, id, modelId] = named.find(([n]) => n === name)!;
    const model = registry.getModel(id, modelId);
    if (!model) return refusal('llm-provider');
    targets.set(name, model);
    table[name] = { name, region: BUILTIN[id]?.[1] ?? 'global', ...(BUILTIN[id] && { key: BUILTIN[id][0] }) };
  }
  return { registry, table, targets };
}

function sender(kind: 'complete' | 'structured', input: Record<string, any>, registry: Models, targets: Map<string, Model<any>>, options: LlmOptions): Send<{ text?: string; value?: unknown; usage: Usage }> {
  return async (provider, key, signal, record) => {
    let total = usageOf(0);
    const step = async ({ messages }: { messages: Turn[] }) => {
      if (signal.aborted) throw new Error('stopped');
      if (provider.name === 'fake') return { text: input.schema ? fakeStructured(input.schema) : 'fake reply', usage: { input: 0, output: 0 }, model: 'fake', region: provider.region };
      const model = targets.get(provider.name)!, system = messages.filter((t) => t.role === 'system').map((t) => t.content).join('\n\n');
      const turns = messages.flatMap((t) => t.role === 'system' ? [] : [t.role === 'user' ? { role: 'user' as const, content: t.content, timestamp: Date.now() }
        : { role: 'assistant' as const, content: [{ type: 'text' as const, text: t.content }], api: model.api, provider: model.provider, model: model.id, usage: usageOf(0), stopReason: 'stop' as const, timestamp: Date.now() } satisfies AssistantMessage]);
      const reply = await registry.completeSimple(model, { ...(system && { systemPrompt: system }), messages: turns }, {
        signal, maxRetries: 2, maxTokens: Math.min(input.maxTokens ?? 1024, model.maxTokens), ...(key && { apiKey: key }), ...(options.fetch && { fetch: options.fetch }),
        ...(input.effort && input.effort !== 'off' && { reasoning: input.effort }),
      });
      if (reply.stopReason === 'error' || reply.stopReason === 'aborted') throw new Error(reply.errorMessage ?? reply.stopReason);
      await record({ bucket: `model:${model.provider}/${model.id}`, usage: reply.usage, amountMicros: Math.ceil(reply.usage.cost.total * 1_000_000) });
      total = add(total, reply.usage);
      const text = reply.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('');
      return { text, usage: { input: reply.usage.input, output: reply.usage.output }, model: model.id, region: provider.region };
    };
    if (kind === 'complete') return { text: (await step({ messages: input.messages })).text, usage: total };
    try {
      const fail = (_status: number, message: string, extra: object) => { throw Object.assign(new Error(message), extra); };
      const answer = await llmOf({ llm: step }, () => {}, fail).structured({ ...input, timeoutMs: 300_000 }) as { value: unknown };
      return { value: answer.value, usage: total };
    } catch (error) {
      const { code, retryable } = error as { code?: unknown; retryable?: unknown };
      if (typeof code === 'string' && typeof retryable === 'boolean') return refusal(code, retryable);
      throw error;
    }
  };
}

async function exec(kind: 'complete' | 'structured', input: Record<string, any>, options: LlmOptions, tool?: string) {
  const kindOfRefusal = limits(input ?? {}, options, kind === 'structured');
  if (kindOfRefusal) return refusal(kindOfRefusal);
  const found = await resolve(options);
  if ('ok' in found) return found;
  return call('llm', input, { ...options, timeoutMs: options.timeoutMs ?? 60_000 }, found.table, sender(kind, input, found.registry, found.targets, options), tool);
}
const plain = <R extends { ok: boolean }>(result: R) => { if (!result.ok) return result; const { usage: _usage, ...rest } = result as R & { usage?: Usage }; return rest; };

export const complete = async (input: LlmInput, options: LlmOptions): Promise<({ text: string } & Answered) | Refusal> => plain(await exec('complete', input, options)) as never;
export const structured = async <T = unknown>(input: LlmInput & { schema: object }, options: LlmOptions): Promise<({ value: T } & Answered) | Refusal> => plain(await exec('structured', input, options)) as never;

const OWN_INPUT = /^(invalid-schema|llm-(purpose|messages|chars|max-tokens|timeout|field))/;
type Args = { purpose: string; instructions: string; input: string; schema: object };
/** The tool the model calls with its own schema. The app fixed providers, keys, effort and tokens; a tool built with a `meter` reports no `usage`, so a conversation's meter never counts the call twice. */
export function llmTool(options: LlmOptions & Pick<LlmInput, 'effort' | 'maxTokens'>) {
  const { effort, maxTokens, ...rest } = options;
  return jsonSchemaTool<Args>({
    name: 'llm_structured',
    description: 'Ask a model once, outside this conversation, for an answer that matches a JSON schema. `instructions` is the system turn, `input` the one user turn, `schema` a closed JSON schema (every object has additionalProperties: false). Returns { value }.',
    parameters: { type: 'object', additionalProperties: false, required: ['purpose', 'instructions', 'input', 'schema'], properties: { purpose: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' }, instructions: { type: 'string' }, input: { type: 'string' }, schema: { type: 'object' } } },
    replay: 'safe',
    execute: async (args, api) => {
      const input = { purpose: args.purpose, messages: [{ role: 'system', content: args.instructions }, { role: 'user', content: args.input }], schema: args.schema, ...(effort && { effort }), ...(maxTokens && { maxTokens }) };
      const result = await exec('structured', input, rest, toolKey(api));
      if (!result.ok) return { isError: true, output: [{ type: 'text', text: OWN_INPUT.test(result.kind) ? `refused: ${result.kind}. Fix the arguments and call again.` : refusedText(result) }] };
      return { output: [{ type: 'text', text: JSON.stringify({ value: result.value }) }], ...(rest.meter ? {} : { usage: result.usage }) };
    },
  });
}
