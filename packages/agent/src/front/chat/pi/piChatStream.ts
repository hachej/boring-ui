import type { PiChatEvent, PiChatSnapshot, PiChatStreamFrame } from '../../../shared/chat'
import { PiChatStreamFrameSchema } from '../../../shared/chat'

export type PiChatStreamParseResult =
  | { type: 'blank' }
  | { type: 'frame'; frame: PiChatStreamFrame }
  | { type: 'malformed-json'; line: string; error: unknown }
  | { type: 'schema-error'; line: string; error: unknown }

export type PiChatStreamSeqResult =
  | { type: 'applied'; event: PiChatEvent; lastSeq: number }
  | { type: 'stale'; event: PiChatEvent; lastSeq: number }
  | { type: 'gap'; event: PiChatEvent; expectedSeq: number; actualSeq: number; lastSeq: number }

export const PI_CHAT_REPLAY_GAP_CODE = 'replay_gap'
export const PI_CHAT_CURSOR_AHEAD_CODE = 'cursor_ahead'

export type PiChatReplayRangeError = {
  type: typeof PI_CHAT_REPLAY_GAP_CODE | typeof PI_CHAT_CURSOR_AHEAD_CODE
  latestSeq: number
}

export type PiChatReplayRecovery = {
  action: 'rehydrate-state'
  reason: PiChatReplayRangeError['type']
  latestSeq: number
}

export interface PiChatStreamHandlers {
  onFrame?: (frame: PiChatStreamFrame) => void
  onProtocolError?: (error: Exclude<PiChatStreamParseResult, { type: 'blank' } | { type: 'frame' }>) => void
}

export interface PiChatFrameProcessorHandlers {
  onEvent: (event: PiChatEvent) => void
  onHeartbeat?: (heartbeat: Extract<PiChatStreamFrame, { type: 'heartbeat' }>) => void
  onStaleEvent?: (result: Extract<PiChatStreamSeqResult, { type: 'stale' }>) => void
  onSeqGap?: (result: Extract<PiChatStreamSeqResult, { type: 'gap' }>) => void
}

export function parsePiChatNdjsonLine(line: string): PiChatStreamParseResult {
  const trimmed = line.trim()
  if (!trimmed) return { type: 'blank' }

  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch (error) {
    return { type: 'malformed-json', line, error }
  }

  const parsed = PiChatStreamFrameSchema.safeParse(value)
  if (!parsed.success) {
    return { type: 'schema-error', line, error: parsed.error }
  }

  return { type: 'frame', frame: parsed.data }
}

export async function readPiChatNdjsonStream(stream: ReadableStream<Uint8Array>, handlers: PiChatStreamHandlers): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''

  const processLine = (line: string) => {
    const result = parsePiChatNdjsonLine(line)
    if (result.type === 'frame') {
      handlers.onFrame?.(result.frame)
      return
    }
    if (result.type !== 'blank') {
      handlers.onProtocolError?.(result)
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })

      let newlineIndex = buffered.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = buffered.slice(0, newlineIndex)
        buffered = buffered.slice(newlineIndex + 1)
        processLine(line)
        newlineIndex = buffered.indexOf('\n')
      }
    }

    buffered += decoder.decode()
    if (buffered.length > 0) processLine(buffered)
  } finally {
    reader.releaseLock()
  }
}

export function processPiChatSequencedEvent(lastSeq: number, event: PiChatEvent): PiChatStreamSeqResult {
  if (event.seq <= lastSeq) return { type: 'stale', event, lastSeq }
  const expectedSeq = lastSeq + 1
  if (event.seq > expectedSeq) return { type: 'gap', event, expectedSeq, actualSeq: event.seq, lastSeq }
  return { type: 'applied', event, lastSeq: event.seq }
}

export function createPiChatFrameProcessor(initialSeq: number, handlers: PiChatFrameProcessorHandlers) {
  let lastSeq = initialSeq

  return {
    getLastSeq() {
      return lastSeq
    },
    handle(frame: PiChatStreamFrame): PiChatStreamSeqResult | { type: 'heartbeat' } {
      if (frame.type === 'heartbeat') {
        handlers.onHeartbeat?.(frame)
        return { type: 'heartbeat' }
      }

      const result = processPiChatSequencedEvent(lastSeq, frame)
      if (result.type === 'applied') {
        lastSeq = result.lastSeq
        handlers.onEvent(frame)
      } else if (result.type === 'stale') {
        handlers.onStaleEvent?.(result)
      } else {
        handlers.onSeqGap?.(result)
      }
      return result
    },
  }
}

function readLatestSeq(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.latestSeq === 'number' && Number.isInteger(record.latestSeq) && record.latestSeq >= 0) return record.latestSeq
  const details = record.details
  if (typeof details === 'object' && details !== null) {
    const latestSeq = (details as Record<string, unknown>).latestSeq
    if (typeof latestSeq === 'number' && Number.isInteger(latestSeq) && latestSeq >= 0) return latestSeq
  }
  return undefined
}

export function parsePiChatReplayRangeError(status: number, body: unknown): PiChatReplayRangeError | null {
  if (status !== 409 || typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  const payload = typeof record.error === 'object' && record.error !== null ? (record.error as Record<string, unknown>) : record
  const code = payload.code
  if (code !== PI_CHAT_REPLAY_GAP_CODE && code !== PI_CHAT_CURSOR_AHEAD_CODE) return null
  const latestSeq = readLatestSeq(payload) ?? readLatestSeq(record)
  if (latestSeq === undefined) return null
  return { type: code, latestSeq }
}

export function replayRangeErrorToRecovery(error: PiChatReplayRangeError): PiChatReplayRecovery {
  return { action: 'rehydrate-state', reason: error.type, latestSeq: error.latestSeq }
}

export function buildPiChatEventsUrl({
  apiBaseUrl = '',
  sessionId,
  cursor,
}: {
  apiBaseUrl?: string
  sessionId: string
  cursor: number
}): string {
  const base = apiBaseUrl.replace(/\/$/, '')
  return `${base}/api/v1/agent/pi-chat/${encodeURIComponent(sessionId)}/events?cursor=${encodeURIComponent(String(cursor))}`
}

export function buildReloadReconnectPlan(snapshot: PiChatSnapshot, apiBaseUrl?: string) {
  return {
    sessionId: snapshot.sessionId,
    cursor: snapshot.seq,
    eventsUrl: buildPiChatEventsUrl({ apiBaseUrl, sessionId: snapshot.sessionId, cursor: snapshot.seq }),
  }
}

export function calculateJitteredBackoffDelayMs({
  attempt,
  baseMs = 1_000,
  maxMs = 30_000,
  jitterRatio = 0.25,
  random = Math.random,
}: {
  attempt: number
  baseMs?: number
  maxMs?: number
  jitterRatio?: number
  random?: () => number
}): number {
  const normalizedAttempt = Math.max(0, Math.floor(attempt))
  const exponential = Math.min(maxMs, baseMs * 2 ** normalizedAttempt)
  const jitter = Math.max(0, jitterRatio)
  const min = exponential * Math.max(0, 1 - jitter)
  const max = exponential * (1 + jitter)
  return Math.round(Math.min(maxMs, min + random() * (max - min)))
}

export function schedulePiChatReconnect({
  attempt,
  reconnect,
  baseMs,
  maxMs,
  jitterRatio,
  random,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
}: {
  attempt: number
  reconnect: () => void
  baseMs?: number
  maxMs?: number
  jitterRatio?: number
  random?: () => number
  setTimeoutFn?: typeof globalThis.setTimeout
  clearTimeoutFn?: typeof globalThis.clearTimeout
}) {
  const delayMs = calculateJitteredBackoffDelayMs({ attempt, baseMs, maxMs, jitterRatio, random })
  const timer = setTimeoutFn(reconnect, delayMs)
  return {
    delayMs,
    cancel() {
      clearTimeoutFn(timer)
    },
  }
}
