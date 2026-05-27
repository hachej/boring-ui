/**
 * Single-prompt eval. Posts a chat through `app.inject`, captures every
 * tool call in the streamed response, and matches against the expected
 * shape.
 *
 * The Fastify routes are exercised in-process (no real network for /chat
 * itself), but the LLM call inside the harness IS real — that's the whole
 * point. Cost lives at the model API boundary; control via model choice +
 * retry budget + suite-level concurrency.
 */
import type { FastifyInstance } from "fastify"
import { randomUUID } from "node:crypto"
import {
  someCallMatches,
  firstCallMatches,
  noToolCallMatches,
} from "./matcher"
import { DEFAULT_EVAL_MODEL, DEFAULT_TIMEOUT_MS } from "./evalConfig"
import type {
  EvalPromptOptions,
  EvalResult,
  ToolCall,
} from "./types"

interface CapturedStream {
  toolCalls: ToolCall[]
  text: string
  usage?: { input: number; output: number }
  errorText?: string
}

export async function evalAgentPrompt(opts: EvalPromptOptions): Promise<EvalResult> {
  validateMutuallyExclusive(opts)

  const sessionId = opts.sessionId ?? randomUUID()
  const model = parseModelString(opts.model ?? DEFAULT_EVAL_MODEL)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRetries = opts.retries ?? 0

  let attempts = 0
  let lastResult: EvalResult | null = null

  while (attempts <= maxRetries) {
    attempts += 1
    let captured: CapturedStream
    try {
      captured = await runOnce(opts.app, {
        sessionId: `${sessionId}-attempt-${attempts}`,
        prompt: opts.prompt,
        systemPrompt: opts.systemPrompt,
        model,
        timeoutMs,
      })
    } catch (err) {
      lastResult = {
        ok: false,
        actual: [],
        text: "",
        attempts,
        reason: `transport: ${err instanceof Error ? err.message : String(err)}`,
      }
      if (attempts > maxRetries) return lastResult
      continue
    }

    if (captured.errorText) {
      lastResult = {
        ok: false,
        actual: captured.toolCalls,
        text: captured.text,
        usage: captured.usage,
        attempts,
        reason: `stream: ${captured.errorText}`,
      }
      if (attempts > maxRetries) return lastResult
      continue
    }

    const matchResult = matchExpectations(opts, captured.toolCalls)
    lastResult = {
      ok: matchResult.ok,
      actual: captured.toolCalls,
      text: captured.text,
      usage: captured.usage,
      attempts,
      reason: matchResult.ok ? undefined : matchResult.reason,
    }
    if (matchResult.ok) return lastResult
  }

  return lastResult ?? {
    ok: false,
    actual: [],
    text: "",
    attempts,
    reason: "no attempts ran",
  }
}

// ----- internals -----

function validateMutuallyExclusive(opts: EvalPromptOptions): void {
  const set = [
    opts.expect !== undefined,
    opts.expectFirst !== undefined,
    opts.expectNoToolCall === true,
  ].filter(Boolean).length
  if (set === 0) {
    throw new Error(
      "evalAgentPrompt: provide one of `expect`, `expectFirst`, or `expectNoToolCall: true`",
    )
  }
  if (set > 1) {
    throw new Error(
      "evalAgentPrompt: `expect`, `expectFirst`, and `expectNoToolCall` are mutually exclusive",
    )
  }
}

function matchExpectations(
  opts: EvalPromptOptions,
  actual: ToolCall[],
): { ok: boolean; reason?: string } {
  if (opts.expectNoToolCall) {
    return noToolCallMatches(actual)
  }
  if (opts.expectFirst) {
    return firstCallMatches(opts.expectFirst, actual)
  }
  return someCallMatches(opts.expect!, actual)
}

interface RunOnceOpts {
  sessionId: string
  prompt: string
  systemPrompt?: string
  model: { provider: string; id: string }
  timeoutMs: number
}

async function runOnce(
  app: FastifyInstance,
  opts: RunOnceOpts,
): Promise<CapturedStream> {
  // Register the session so the harness has somewhere to attach the turn.
  // Some harness impls auto-create on chat.send; pre-creating is safe in
  // both cases and lets the cleanup DELETE find a real row.
  await app.inject({
    method: "POST",
    url: "/api/v1/agent/sessions",
    payload: { id: opts.sessionId },
  })

  // System prompt path: the agent's chat schema doesn't accept a system
  // prompt directly today (it lives on the harness or model config). For
  // now we pre-pend it to the user message with a separator the LLM
  // typically respects. If we land a /system route or extend the schema
  // this path becomes a structured field.
  const userMessage = opts.systemPrompt
    ? `[SYSTEM]\n${opts.systemPrompt}\n[/SYSTEM]\n\n${opts.prompt}`
    : opts.prompt

  let res
  try {
    res = await withTimeout(
      app.inject({
        method: "POST",
        url: "/api/v1/agent/chat",
        payload: {
          sessionId: opts.sessionId,
          message: userMessage,
          model: opts.model,
        },
      }),
      opts.timeoutMs,
      `chat request exceeded ${opts.timeoutMs}ms`,
    )
  } finally {
    // Best-effort cleanup. Ignore failures — the test harness session
    // store is in-memory and ephemeral.
    void app
      .inject({
        method: "DELETE",
        url: `/api/v1/agent/sessions/${encodeURIComponent(opts.sessionId)}`,
      })
      .catch(() => {})
  }

  if (res.statusCode !== 200) {
    throw new Error(
      `chat returned ${res.statusCode}: ${res.body.slice(0, 256)}`,
    )
  }

  return parseSseStream(res.body)
}

/**
 * Extract tool calls + text + usage from the SSE response body produced
 * by /api/v1/agent/chat. Each SSE event line is `data: <json>\n` where
 * json is a UIMessageChunk. We watch for:
 * - `tool-input-available`: { toolName, input } → ToolCall
 * - `text-delta`: { delta } → accumulate into text buffer
 * - `data-usage`: { data: { input, output } } → usage totals
 * - `error`: provider/harness stream errors → fail with visible reason
 * - `[DONE]` sentinel marks end of stream
 */
function parseSseStream(body: string): CapturedStream {
  const toolCalls: ToolCall[] = []
  const textParts: string[] = []
  const errorParts: string[] = []
  let usage: CapturedStream["usage"] | undefined

  for (const line of body.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("data:")) continue
    const payload = trimmed.slice("data:".length).trim()
    if (!payload || payload === "[DONE]") continue
    let chunk: Record<string, unknown>
    try {
      chunk = JSON.parse(payload) as Record<string, unknown>
    } catch {
      continue
    }
    const type = chunk.type
    if (type === "tool-input-available") {
      const toolName = chunk.toolName
      if (typeof toolName !== "string") continue
      const input = chunk.input
      const params =
        input && typeof input === "object" && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {}
      toolCalls.push({ tool: toolName, params })
    } else if (type === "text-delta") {
      const delta = chunk.delta
      if (typeof delta === "string") textParts.push(delta)
    } else if (type === "data-usage") {
      const data = chunk.data
      if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>
        if (typeof obj.input === "number" && typeof obj.output === "number") {
          usage = { input: obj.input, output: obj.output }
        }
      }
    } else if (type === "error") {
      const text = stringifyStreamError(chunk)
      if (text) errorParts.push(text)
    }
  }

  return {
    toolCalls,
    text: textParts.join(""),
    usage,
    errorText: errorParts.length ? errorParts.join("\n") : undefined,
  }
}

function stringifyStreamError(chunk: Record<string, unknown>): string {
  for (const key of ["errorText", "message", "error"]) {
    const value = chunk[key]
    if (typeof value === "string" && value.trim()) return value
    if (value && typeof value === "object") {
      const message = (value as Record<string, unknown>).message
      if (typeof message === "string" && message.trim()) return message
    }
  }
  return "unknown stream error"
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * Accept either "claude-haiku-4-5-20251001" or { provider, id } shape and
 * normalize to the chat schema's expected `{provider, id}` form. Defaults
 * the provider to "anthropic" when the bare model id is recognizable.
 */
function parseModelString(input: string | { provider: string; id: string }): {
  provider: string
  id: string
} {
  if (typeof input === "object") return input
  if (input.startsWith("claude-")) return { provider: "anthropic", id: input }
  if (input.startsWith("gpt-")) return { provider: "openai", id: input }
  if (input.startsWith("qwen/")) return { provider: "openrouter", id: input }
  // Preserve the historical fallback for bare model ids; new eval defaults
  // use the explicit { provider, id } shape instead of relying on this path.
  return { provider: "anthropic", id: input }
}
