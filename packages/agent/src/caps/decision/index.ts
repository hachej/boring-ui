// A decision in one call: questions about a state (choose, score, yes or no), each answered with a confidence, by a classifier through
// pi-ai's `Models.classify`. `run` answers or refuses as a value; `pickOne` (one choice against a threshold) never throws or refuses;
// `decisionTool` is the pi-durable tool built from `run`. Plain imports: no host, no Effect, no environment; a key comes only from
// `options.keys`. The limits and answer checks are boring-factory's services/decide/port.mjs. An answer is a hint for the app's own
// rule, never a permission.
import type { ClassifierAnswer, ClassifierQuestion, JsonObject, Models, Usage } from '@earendil-works/pi-ai';
import { createModels } from '@earendil-works/pi-ai/models';
import { jsonSchemaTool } from '../../json-schema-tool.js';
import { call, refusedText, toolKey, usageOf } from '../shared.js';
import type { Answered, CapOptions, Provider, Refusal, Send } from '../shared.js';
import { fakeProvider } from './fixtures.js';
import type { FixtureRow } from './fixtures.js';

export type { FixtureRow };
export type Question =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'yes_no'; instructions: string };
export type Answer = { type: 'choice'; choice: string; confidence: number } | { type: 'score'; score: number; confidence: number } | { type: 'yes_no'; answer: boolean; confidence: number };
export type DecisionInput = { state: JsonObject; questions: Record<string, Question> };
/** `providers`: in order, among `typesafe`, `openrouter-jev` and `fake`. `models` replaces pi-ai's own providers (tests script it); `fixtures` are read by `fake` only. */
export type DecisionOptions = CapOptions & { models?: Models; fixtures?: readonly FixtureRow[] };
export type Decision = { answers: Record<string, Answer>; untrusted: true };
export type Pick = { choice: string; confidence: number; provider: string; counted: boolean }
  | { choice: 'none'; confidence: number; reason: 'below-threshold' | 'timeout' | 'error'; code?: string; counted: boolean };

/** Name -> [pi-ai provider, model, key name, region, the provider's loader]. */
const PROVIDERS = {
  typesafe: ['typesafe', 'jev-latest', 'TYPESAFE_API_KEY', 'us', () => import('@earendil-works/pi-ai/providers/typesafe').then((m) => m.typesafeProvider())],
  'openrouter-jev': ['openrouter', 'typesafe/jev-1.14', 'OPENROUTER_API_KEY', 'us', () => import('@earendil-works/pi-ai/providers/openrouter').then((m) => m.openrouterProvider())],
  fake: ['fake', 'fake', undefined, 'none', undefined],
} as const;
const TABLE: Record<string, Provider> = Object.fromEntries(Object.entries(PROVIDERS).map(([name, [, , key, region]]) => [name, { name, region, ...(key && { key }) }]));
const refusal = (kind: string): Refusal => ({ ok: false, kind, retryable: false });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim() !== '' && v.length <= max;

/** What `run` refuses before anything is sent, as the kind. */
function limits(input: unknown): string | undefined {
  if (!isObject(input) || !isObject(input.state)) return 'decision-state:24000';
  let size = Infinity;
  try { size = JSON.stringify(input.state).length; } catch { /* not plain JSON */ }
  if (size > 24_000) return 'decision-state:24000';
  const questions = isObject(input.questions) ? Object.entries(input.questions) : [];
  if (!questions.length || questions.length > 8) return 'decision-questions:8';
  for (const [key, q] of questions) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(key)) return 'decision-key';
    if (!isObject(q) || !['choice', 'score', 'yes_no'].includes(q.type as string)) return 'decision-question';
    if (!text(q.instructions, 2000)) return 'decision-instructions:2000';
    if (q.type === 'yes_no') continue;
    const options = q.type === 'choice' ? (isObject(q.criteria) ? Object.entries(q.criteria) : []) : (Array.isArray(q.criteria) ? q.criteria.map((d, i) => [String(i), d]) : []);
    if (options.length < 2 || options.length > 12 || options.some(([o]) => !o || o.length > 64)) return 'decision-options:12';
    if (options.some(([, d]) => !text(d, 400))) return 'decision-instructions:2000';
  }
  return undefined;
}

const toPi = (q: Question): ClassifierQuestion => q.type === 'yes_no' ? { type: 'bool', instructions: q.instructions, criteria: { true: 'yes', false: 'no' } } : q;
const sure = (c: unknown): c is number => typeof c === 'number' && c >= 0 && c <= 1;
/** Only the questions asked, each in its own type, an offered option, a level in range and a confidence in [0, 1]; anything else is dropped. */
function checked(questions: Record<string, Question>, said: Record<string, ClassifierAnswer> = {}): Record<string, Answer> {
  const answers: Record<string, Answer> = {};
  for (const [key, q] of Object.entries(questions)) {
    const a = Object.hasOwn(said, key) ? said[key] : undefined;
    if (q.type === 'choice' && a?.type === 'choice' && sure(a.confidence) && Object.hasOwn(q.criteria, a.choice)) answers[key] = { type: 'choice', choice: a.choice, confidence: a.confidence };
    if (q.type === 'score' && a?.type === 'score' && sure(a.confidence) && Number.isFinite(a.score) && a.score >= 0 && a.score <= q.criteria.length - 1) answers[key] = { type: 'score', score: a.score, confidence: a.confidence };
    if (q.type === 'yes_no' && a?.type === 'bool' && sure(a.probability)) answers[key] = { type: 'yes_no', answer: a.probability > 0.5, confidence: a.probability > 0.5 ? a.probability : 1 - a.probability };
  }
  return answers;
}

async function exec(input: DecisionInput, options: DecisionOptions, tool?: string): Promise<(Decision & { usage: Usage } & Answered) | Refusal> {
  const kind = limits(input);
  if (kind) return refusal(kind);
  let registry = options.models;
  if (!registry) {
    const made = createModels();
    for (const name of new Set(options.providers)) { const load = (PROVIDERS as Record<string, (typeof PROVIDERS)[keyof typeof PROVIDERS]>)[name]?.[4]; if (load) made.setProvider(await load()); }
    registry = made;
  }
  const real = registry, context = { state: input.state, questions: Object.fromEntries(Object.entries(input.questions).map(([k, q]) => [k, toPi(q)])) };
  const send: Send<Decision & { usage: Usage }> = async (provider, key, signal, record) => {
    const [pi, id] = PROVIDERS[provider.name as keyof typeof PROVIDERS];
    let models = real;
    if (provider.name === 'fake') { const fake = createModels(); fake.setProvider(fakeProvider(options.fixtures)); models = fake; }
    const model = models.getModelOfType('classifier', pi, id);
    if (!model) throw new Error('no such classifier');
    const said = await models.classify(model, context, { signal, maxRetries: 0, ...(key && { apiKey: key }), ...(options.fetch && { fetch: options.fetch }) });
    if (said.usage) await record({ bucket: `model:${model.provider}/${model.id}`, usage: said.usage, amountMicros: Math.ceil(said.usage.cost.total * 1_000_000) });
    if (said.stopReason !== 'stop') throw new Error(said.stopReason);
    return { answers: checked(input.questions, said.answers), untrusted: true, usage: said.usage ?? usageOf(0) };
  };
  return call('decision', input, { ...options, timeoutMs: options.timeoutMs ?? 60_000 }, TABLE, send, tool);
}

/** Answers each question, or a refusal `{ ok: false, kind, retryable }`; never throws for an expected failure. */
export async function run(input: DecisionInput, options: DecisionOptions): Promise<(Decision & Answered) | Refusal> {
  const result = await exec(input, options);
  if (!result.ok) return result;
  const { usage: _usage, ...rest } = result;
  return rest;
}

/** One choice against the app's threshold within `timeoutMs` (the whole call). Every failure is `choice: "none"` with a reason: never a throw, never a refusal. */
export async function pickOne(input: { state: JsonObject; options: Record<string, string>; threshold: number; timeoutMs: number; instructions?: string }, options: DecisionOptions): Promise<Pick> {
  const none = (reason: 'below-threshold' | 'timeout' | 'error', confidence = 0, code?: string, counted = false): Pick => ({ choice: 'none', confidence, reason, ...(code && { code }), counted });
  try {
    const { state, options: choices, threshold, timeoutMs, instructions = 'Which option fits the state?' } = input ?? {};
    if (typeof threshold !== 'number' || !(threshold >= 0 && threshold <= 1)) return none('error', 0, 'decision-threshold');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) return none('error', 0, 'decision-timeout:60000');
    if (isObject(choices) && Object.hasOwn(choices, 'none')) return none('error', 0, 'decision-none');
    const result = await run({ state, questions: { pick: { type: 'choice', instructions, criteria: choices } } }, { ...options, timeoutMs });
    if (!result.ok) return result.kind === 'timeout' ? none('timeout') : none('error', 0, result.kind);
    const answer = result.answers.pick as Extract<Answer, { type: 'choice' }> | undefined;
    if (answer && answer.confidence >= threshold) return { choice: answer.choice, confidence: answer.confidence, provider: result.provider, counted: result.counted };
    return none('below-threshold', answer?.confidence ?? 0, undefined, result.counted);
  } catch {
    return none('error', 0, 'thrown');
  }
}

const QUESTION = {
  type: 'object', additionalProperties: false, required: ['type', 'instructions'],
  properties: { type: { enum: ['choice', 'score', 'yes_no'] }, instructions: { type: 'string' }, criteria: { anyOf: [{ type: 'object', additionalProperties: { type: 'string' } }, { type: 'array', items: { type: 'string' } }] } },
};
const OWN_INPUT = /^decision-(state|questions|key|question|options|instructions)/;
/** The tool `decide`. The app fixed providers, keys, meter and fixtures; a tool built with a `meter` reports no `usage`, so a conversation's meter never counts the call twice. */
export function decisionTool(options: DecisionOptions) {
  return jsonSchemaTool<DecisionInput>({
    name: 'decide',
    description: 'Answer up to 8 questions about a state at once, each with a confidence from 0 to 1: `choice` (criteria: { option: meaning }, 2 to 12), `score` (criteria: one meaning per level, 2 to 12) or `yes_no`. The answer is a hint for the app\'s own rule, never a permission.',
    parameters: { type: 'object', additionalProperties: false, required: ['state', 'questions'], properties: { state: { type: 'object' }, questions: { type: 'object', additionalProperties: QUESTION } } },
    replay: 'safe',
    execute: async (args, api) => {
      const result = await exec(args, options, toolKey(api));
      if (!result.ok) return { isError: true, output: [{ type: 'text', text: OWN_INPUT.test(result.kind) ? `refused: ${result.kind}. Fix the arguments and call again.` : refusedText(result) }] };
      return { output: [{ type: 'text', text: JSON.stringify({ answers: result.answers }) }], ...(options.meter ? {} : { usage: result.usage }) };
    },
  });
}
