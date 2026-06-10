/**
 * Single-prompt eval. Posts a Pi-native chat through `app.inject`, captures
 * tool calls from the canonical session snapshot, and matches against the expected
 * shape.
 *
 * The Fastify routes are exercised in-process (no real network for Pi chat
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
        headers: opts.headers,
        query: opts.query,
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
  headers?: Record<string, string>
  query?: Record<string, string | number | boolean | undefined>
}

async function runOnce(
  app: FastifyInstance,
  opts: RunOnceOpts,
): Promise<CapturedStream> {
  const querySuffix = formatQuerySuffix(opts.query)

  // Register the session so the harness has somewhere to attach the turn.
  // Some harness impls auto-create on prompt; pre-creating is safe in
  // both cases and lets the cleanup DELETE find a real row.
  await app.inject({
    method: "POST",
    url: `/api/v1/agent/sessions${querySuffix}`,
    headers: opts.headers,
    payload: { id: opts.sessionId },
  })

  // System prompt path: the agent's prompt schema doesn't accept a system
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
        url: `/api/v1/agent/pi-chat/${encodeURIComponent(opts.sessionId)}/prompt${querySuffix}`,
        headers: opts.headers,
        payload: {
          message: userMessage,
          clientNonce: `eval-${opts.sessionId}`,
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
        url: `/api/v1/agent/sessions/${encodeURIComponent(opts.sessionId)}${querySuffix}`,
        headers: opts.headers,
      })
      .catch(() => {})
  }

  if (res.statusCode !== 200) {
    throw new Error(
      `Pi chat prompt returned ${res.statusCode}: ${res.body.slice(0, 256)}`,
    )
  }

  const state = await app.inject({
    method: "GET",
    url: `/api/v1/agent/pi-chat/${encodeURIComponent(opts.sessionId)}/state${querySuffix}`,
    headers: opts.headers,
  })
  if (state.statusCode !== 200) {
    throw new Error(`Pi chat state returned ${state.statusCode}: ${state.body.slice(0, 256)}`)
  }
  return capturePiChatSnapshot(JSON.parse(state.body) as Record<string, unknown>)
}

function capturePiChatSnapshot(snapshot: Record<string, unknown>): CapturedStream {
  const toolCalls: ToolCall[] = []
  const textParts: string[] = []
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : []
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue
    const parts = Array.isArray((message as { parts?: unknown }).parts) ? (message as { parts: unknown[] }).parts : []
    for (const part of parts) {
      if (typeof part !== 'object' || part === null) continue
      const rec = part as Record<string, unknown>
      if (rec.type === 'text' && typeof rec.text === 'string') textParts.push(rec.text)
      if (rec.type === 'tool-call' && typeof rec.toolName === 'string') {
        toolCalls.push({ tool: rec.toolName, params: typeof rec.input === 'object' && rec.input !== null ? rec.input as Record<string, unknown> : {} })
      }
    }
  }
  return { toolCalls, text: textParts.join('') }
}

function formatQuerySuffix(query: RunOnceOpts["query"]): string {
  if (!query) return ""
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    params.set(key, String(value))
  }
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ""
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
