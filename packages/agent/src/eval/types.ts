/**
 * Public types for @boring/agent/eval — the eval framework.
 *
 * See packages/agent/docs/plans/AGENT_EVAL_FRAMEWORK.md for the design
 * rationale and approved contract.
 */
import type { FastifyInstance } from "fastify"

/**
 * A captured tool call from an LLM response. Anthropic / OpenAI both
 * support emitting multiple tool calls in a single response (parallel)
 * or across turns (sequential). The framework collects ALL of them; the
 * matcher then checks for existence (default) or ordering (`expectFirst`).
 */
export interface ToolCall {
  tool: string
  params: Record<string, unknown>
}

/**
 * Sentinel for "must be present at this key, any value". Use in
 * `expect.params` for fields the LLM generates (uuids, timestamps).
 *
 * In YAML fixtures: `id: !EvalAny`.
 */
export const EvalAny = Symbol.for("@boring/agent/eval/EvalAny")
export type EvalAnyType = typeof EvalAny

/**
 * Tagged regex matcher for string params. Use when the value is partially
 * structured (e.g. an id that must start with `chart:`) but the suffix
 * varies between runs.
 *
 * In YAML fixtures: `component: !EvalRegex "^chart:"`.
 */
export interface EvalRegexMatcher {
  __evalRegex: RegExp
}
export function EvalRegex(re: RegExp | string): EvalRegexMatcher {
  return { __evalRegex: typeof re === "string" ? new RegExp(re) : re }
}
export function isEvalRegex(value: unknown): value is EvalRegexMatcher {
  return (
    typeof value === "object" &&
    value !== null &&
    "__evalRegex" in value &&
    (value as EvalRegexMatcher).__evalRegex instanceof RegExp
  )
}

/**
 * Expected shape of a tool call. The matcher (matcher.ts) decides if an
 * actual ToolCall satisfies it.
 *
 * - `tool`: exact name match (required).
 * - `params`: partial match by default — every key in `expect.params` must
 *   appear in the actual call's params with a matching value. Extra keys
 *   in the actual call are allowed unless `strict: true`.
 * - Values inside `params` may be the `EvalAny` sentinel or an
 *   `EvalRegexMatcher` wildcard.
 */
export interface ExpectedCall {
  tool: string
  params?: Record<string, unknown>
  strict?: boolean
}

/**
 * Per-prompt eval options. See `evalAgentPrompt(opts)` in evalPrompt.ts.
 */
export interface EvalPromptOptions {
  /** A FastifyInstance from createAgentApp / createWorkspaceAgentApp / etc. */
  app: FastifyInstance
  /** User prompt sent to the agent. */
  prompt: string
  /**
   * Expected tool calls. Default: assert each ExpectedCall here matches
   * AT LEAST ONE call in the LLM's response (any order). Mutually
   * exclusive with `expectFirst` and `expectNoToolCall`.
   */
  expect?: ExpectedCall | ExpectedCall[]
  /**
   * Stricter alternative: assert the FIRST tool call matches.
   * Mutually exclusive with `expect` and `expectNoToolCall`.
   */
  expectFirst?: ExpectedCall
  /**
   * Negative assertion: NO tool was called (LLM answered in plain text).
   * Mutually exclusive with `expect` and `expectFirst`.
   */
  expectNoToolCall?: boolean
  /**
   * Model id. Defaults to the agent's pinned model (see evalConfig.ts).
   * Suites typically override at the suite level (in YAML).
   */
  model?: string
  /** Optional system prompt. */
  systemPrompt?: string
  /** Override the chat session id (defaults to a fresh uuid). */
  sessionId?: string
  /** Per-call timeout in ms. Defaults to 30_000. */
  timeoutMs?: number
  /** Per-prompt retry count. Default: 0. */
  retries?: number
}

export interface EvalResult {
  ok: boolean
  /** All tool calls the LLM made, in order. */
  actual: ToolCall[]
  /** Plain-text response from the LLM. */
  text: string
  /** Human-readable reason on failure. */
  reason?: string
  /** Tokens consumed. */
  usage?: { input: number; output: number }
  /** Number of attempts used (1 + retries on failure). */
  attempts: number
}

/**
 * Suite runner options. See `runEvalSuite(opts)` in runSuite.ts.
 */
export interface SuiteOptions {
  app: FastifyInstance
  /** Path to a YAML fixture file. See AGENT_EVAL_FRAMEWORK.md for format. */
  fixturesPath: string
  /** Stop on first failure. Default: false. */
  bail?: boolean
  /** Concurrency. Default: 4. */
  concurrency?: number
  /** Suite-level timeout in ms. Default: 5 * 60_000 (5 minutes). */
  suiteTimeoutMs?: number
  /** Override per-prompt model. Useful for ad-hoc model comparison runs. */
  model?: string
}

export interface SuiteFixturePrompt {
  prompt: string
  expect?: ExpectedCall | ExpectedCall[]
  expectFirst?: ExpectedCall
  expectNoToolCall?: boolean
  retries?: number
  timeoutMs?: number
  model?: string
}

export interface SuiteFixture {
  /** Pinned model for the whole suite (each prompt may override). */
  model?: string
  /** System prompt prepended to every prompt in this suite. */
  systemPrompt?: string
  /** Defaults applied to each prompt unless inline-overridden. */
  defaults?: Pick<SuiteFixturePrompt, "retries" | "timeoutMs" | "model">
  prompts: SuiteFixturePrompt[]
}

export interface SuiteReport {
  total: number
  passed: number
  failed: number
  passRate: number
  results: Array<EvalResult & { prompt: string; expected: SuiteFixturePrompt }>
  totalUsage: { input: number; output: number }
  totalDurationMs: number
  /** True iff every result is ok: true. */
  allPassed: boolean
}
