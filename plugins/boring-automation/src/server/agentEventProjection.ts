import type { AgentEvent } from "@hachej/boring-agent/shared"

export interface UsageTotals {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface UsageAccumulator {
  input: number | null
  output: number | null
}

export function sessionIdFromEvent(event: unknown): string | null {
  if (!event || typeof event !== "object") return null
  const sessionId = (event as { sessionId?: unknown }).sessionId
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : null
}

function chunkFromEvent(event: unknown): AgentEvent["chunk"] | null {
  if (!event || typeof event !== "object") return null
  const chunk = (event as { chunk?: unknown }).chunk
  if (!chunk || typeof chunk !== "object") return null
  return chunk as AgentEvent["chunk"]
}

export function aggregateUsage(accumulator: UsageAccumulator, event: unknown): void {
  const chunk = chunkFromEvent(event)
  if (!chunk || chunk.type !== "usage") return
  const usage = chunk.usage
  if (!usage || typeof usage !== "object") return
  const record = usage as Record<string, unknown>
  const input = sumObservedNumbers(record.input, record.inputTokens, record.cacheRead, record.cacheReadTokens, record.cacheWrite, record.cacheWriteTokens)
  const output = sumObservedNumbers(record.output, record.outputTokens)
  if (input !== null) accumulator.input = (accumulator.input ?? 0) + input
  if (output !== null) accumulator.output = (accumulator.output ?? 0) + output
}

function sumObservedNumbers(...values: unknown[]): number | null {
  let observed = false
  let total = 0
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue
    observed = true
    total += Math.trunc(value)
  }
  return observed ? total : null
}

export function finalizeUsage(usage: UsageAccumulator): UsageTotals {
  if (usage.input === null && usage.output === null) {
    return { inputTokens: null, outputTokens: null, totalTokens: null }
  }
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: (usage.input ?? 0) + (usage.output ?? 0),
  }
}

export function terminalOutcomeFromEvent(event: unknown): { status: "succeeded" | "failed" | "cancelled"; error: string | null } | null {
  const chunk = chunkFromEvent(event)
  if (!chunk) return null
  if (chunk.type === "agent-end" && !chunk.willRetry) {
    if (chunk.status === "ok") return { status: "succeeded", error: null }
    if (chunk.status === "aborted") return { status: "cancelled", error: null }
    return { status: "failed", error: "Automation run failed" }
  }
  if (chunk.type === "error") return { status: "failed", error: safeErrorMessage(chunk.error) }
  return null
}

export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "Automation run failed"
  const firstLine = raw.split(/\r?\n/u)[0]?.trim() || "Automation run failed"
  return firstLine.length > 300 ? `${firstLine.slice(0, 297)}...` : firstLine
}
