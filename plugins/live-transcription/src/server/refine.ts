import { readFile, stat } from "node:fs/promises"
import { basename } from "node:path"
import { randomUUID } from "node:crypto"
import type { LifecycleClient } from "./computeLifecycle"
import { LiveTranscriptError } from "./errors"
import { groupKyutaiTranscriptSnapshot } from "./kyutaiTranscript"
import { renderTranscriptMarkdown, type ProjectedTranscriptLine, type TranscriptDocument } from "./projector"
import type { WhisperLiveKitLine } from "./whisperLiveKit"

/** Refuse to stream recordings larger than this to the offline refine service. */
export const MAX_REFINE_AUDIO_BYTES = 200 * 1024 * 1024
const HEARTBEAT_INTERVAL_MS = 30_000
const RETRY_DELAY_MS = 5_000
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60_000

export interface TranscriptRefinerOptions {
  refineUrl: string
  bearerToken: string
  lifecycle?: LifecycleClient
  fetch?: typeof fetch
  now?: () => number
  /** Overridable for tests; defaults to a real `setTimeout`-based delay. */
  sleep?: (ms: number) => Promise<void>
  /** Per-attempt HTTP deadline; defaults to ten minutes. */
  requestTimeoutMs?: number
}

interface RefineMetadata {
  title: string
  startedAt: string
  language?: string
}

export type RefineInput = RefineMetadata & (
  | { audioAbsolutePath: string; audioBytes?: never; audioFilename?: never }
  | { audioAbsolutePath?: never; audioBytes: Uint8Array; audioFilename: string }
)

export interface RefineResult {
  markdown: string
  words: number
  speakers: number
  durationSeconds: number
}

interface RefineWord {
  text: string
  startSeconds: number
  endSeconds: number
  speaker: number
  correctedFrom?: string
}

interface RefineCorrection {
  from: string
  to: string
  startSeconds: number
}

interface RefineResponse {
  durationSeconds: number
  language: string
  model: string
  wallSeconds: number
  words: RefineWord[]
  corrections: RefineCorrection[]
}

/** Streams a completed local recording to the offline GPU batch refine service. */
export class TranscriptRefiner {
  constructor(private readonly options: TranscriptRefinerOptions) {}

  async refine(input: RefineInput): Promise<RefineResult> {
    let size: number
    if (input.audioBytes) {
      size = input.audioBytes.byteLength
    } else {
      try {
        size = (await stat(input.audioAbsolutePath)).size
      } catch {
        throw new LiveTranscriptError("live_transcript_attachment_invalid", "Recording file was not found.", 400)
      }
    }
    if (size > MAX_REFINE_AUDIO_BYTES) {
      throw new LiveTranscriptError("live_transcript_limit_exceeded", "Recording exceeded the offline refine size limit.", 413)
    }

    let leaseId: string | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    try {
      if (this.options.lifecycle) {
        const lease = await this.options.lifecycle.acquire(`refine:${randomUUID()}`)
        leaseId = lease.id
        heartbeat = setInterval(() => {
          void this.options.lifecycle?.heartbeat(lease.id).catch(() => undefined)
        }, HEARTBEAT_INTERVAL_MS)
      }
      return await this.refineWithLease(input)
    } finally {
      if (heartbeat) clearInterval(heartbeat)
      if (leaseId) await this.options.lifecycle?.release(leaseId).catch(() => undefined)
    }
  }

  private async refineWithLease(input: RefineInput): Promise<RefineResult> {
    let bytes: Uint8Array
    let filename: string
    if (input.audioBytes) {
      bytes = input.audioBytes
      filename = input.audioFilename
    } else {
      try {
        bytes = new Uint8Array(await readFile(input.audioAbsolutePath))
      } catch {
        throw new LiveTranscriptError("live_transcript_attachment_invalid", "Recording file could not be read.", 400)
      }
      filename = basename(input.audioAbsolutePath)
    }
    const form = new FormData()
    form.set("file", new Blob([new Uint8Array(bytes)]), filename)
    form.set("language", input.language?.trim() || "fr")

    const payload = await this.postRefineWithRetry(form)
    const parsed = parseRefineResponse(payload)

    const displaySpeakers = new Map<number, number>()
    const lines: WhisperLiveKitLine[] = parsed.words.map((word) => {
      if (word.speaker < 0) {
        return { text: word.text, startSeconds: word.startSeconds, endSeconds: word.endSeconds, speaker: 0 }
      }
      let speaker = displaySpeakers.get(word.speaker)
      if (!speaker) {
        speaker = displaySpeakers.size + 1
        displaySpeakers.set(word.speaker, speaker)
      }
      return { text: word.text, startSeconds: word.startSeconds, endSeconds: word.endSeconds, speaker }
    })
    const grouped = groupKyutaiTranscriptSnapshot({ lines, remainingDiarizationSeconds: 0 })
    const projected: ProjectedTranscriptLine[] = grouped.lines.map((line) => ({
      startSeconds: line.startSeconds,
      speaker: line.speaker,
      text: line.text,
    }))

    const words = parsed.words.length
    const speakers = displaySpeakers.size
    const document: TranscriptDocument = {
      title: input.title,
      startedAt: input.startedAt,
      state: "complete",
      showSpeakerLabels: true,
      refinedAt: new Date(this.now()).toISOString(),
      refinedNote: `${parsed.model}, ${words} words, ${speakers} speakers`,
      corrections: uniqueCorrectionPairs(parsed.corrections),
      lines: projected,
    }
    return {
      markdown: renderTranscriptMarkdown(document),
      words,
      speakers,
      durationSeconds: parsed.durationSeconds,
    }
  }

  /**
   * POSTs the form to the refine service. A network failure, or a 500/503
   * whose body mentions "out of memory" or "CUDA" (the GPU box is shared and
   * these are the transient failure modes worth a retry), gets one retry
   * after a fixed delay before the caller sees an error.
   */
  private async postRefineWithRetry(form: FormData): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let response: Response
      let successPayload: unknown
      let errorBody: { text: string; payload: { error?: unknown } | null } | undefined
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(),
        this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      )
      try {
        response = await (this.options.fetch ?? fetch)(`${this.options.refineUrl}/refine`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.options.bearerToken}` },
          body: form,
          signal: controller.signal,
        })
        if (response.ok) {
          successPayload = await readSuccessBody(response, controller.signal)
        } else {
          errorBody = await readErrorBody(response, controller.signal)
        }
      } catch {
        if (controller.signal.aborted) {
          throw new LiveTranscriptError("live_transcript_upstream_failed", "Transcript refine service timed out.", 504)
        }
        if (attempt === 0) {
          await this.delay(RETRY_DELAY_MS)
          continue
        }
        throw new LiveTranscriptError("live_transcript_upstream_failed", "Transcript refine service was unavailable.", 502)
      } finally {
        clearTimeout(timeout)
      }
      if (response.ok) return successPayload
      if (attempt === 0 && isRetryableFailure(response.status, errorBody!.text)) {
        await this.delay(RETRY_DELAY_MS)
        continue
      }
      throw mapError(response.status, errorBody!.payload)
    }
  }

  private async delay(ms: number): Promise<void> {
    await (this.options.sleep ?? defaultSleep)(ms)
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readSuccessBody(response: Response, signal: AbortSignal): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (signal.aborted) throw error
    return null
  }
}

async function readErrorBody(response: Response, signal: AbortSignal): Promise<{ text: string; payload: { error?: unknown } | null }> {
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    if (signal.aborted) throw error
    text = ""
  }
  let payload: { error?: unknown } | null = null
  try {
    payload = JSON.parse(text) as { error?: unknown }
  } catch {
    payload = null
  }
  return { text, payload }
}

function isRetryableFailure(status: number, body: string): boolean {
  if (status !== 500 && status !== 503) return false
  return /out of memory|cuda/i.test(body)
}

function mapError(status: number, payload: { error?: unknown } | null): LiveTranscriptError {
  const message = typeof payload?.error === "string" ? payload.error : "Transcript refine service rejected the request."
  if (status === 429) return new LiveTranscriptError("live_transcript_already_active", message, 409)
  if (status === 413) return new LiveTranscriptError("live_transcript_limit_exceeded", message, 413)
  return new LiveTranscriptError("live_transcript_upstream_failed", message, 502)
}

function parseRefineResponse(payload: unknown): RefineResponse {
  if (!payload || typeof payload !== "object") throw invalidResponse()
  const record = payload as Record<string, unknown>
  if (!isFiniteNumber(record.durationSeconds) || !isFiniteNumber(record.wallSeconds)) throw invalidResponse()
  if (typeof record.language !== "string" || typeof record.model !== "string") throw invalidResponse()
  if (!Array.isArray(record.words)) throw invalidResponse()
  const words = record.words.map((raw): RefineWord => {
    if (!raw || typeof raw !== "object") throw invalidResponse()
    const word = raw as Record<string, unknown>
    if (typeof word.text !== "string") throw invalidResponse()
    if (!isFiniteNumber(word.startSeconds) || !isFiniteNumber(word.endSeconds)) throw invalidResponse()
    if (typeof word.speaker !== "number" || !Number.isInteger(word.speaker) || word.speaker < -1 || word.speaker > 3) {
      throw invalidResponse()
    }
    if (word.corrected_from !== undefined && typeof word.corrected_from !== "string") throw invalidResponse()
    return {
      text: word.text,
      startSeconds: word.startSeconds,
      endSeconds: word.endSeconds,
      speaker: word.speaker,
      ...(typeof word.corrected_from === "string" ? { correctedFrom: word.corrected_from } : {}),
    }
  })
  const corrections = record.corrections === undefined ? [] : parseCorrections(record.corrections)
  return {
    durationSeconds: record.durationSeconds,
    language: record.language,
    model: record.model,
    wallSeconds: record.wallSeconds,
    words,
    corrections,
  }
}

function parseCorrections(raw: unknown): RefineCorrection[] {
  if (!Array.isArray(raw)) throw invalidResponse()
  return raw.map((entry): RefineCorrection => {
    if (!entry || typeof entry !== "object") throw invalidResponse()
    const record = entry as Record<string, unknown>
    if (typeof record.from !== "string" || typeof record.to !== "string") throw invalidResponse()
    if (!isFiniteNumber(record.startSeconds)) throw invalidResponse()
    return { from: record.from, to: record.to, startSeconds: record.startSeconds }
  })
}

function uniqueCorrectionPairs(corrections: RefineCorrection[]): { from: string; to: string }[] {
  const seen = new Set<string>()
  const pairs: { from: string; to: string }[] = []
  for (const correction of corrections) {
    const key = `${correction.from} ${correction.to}`
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push({ from: correction.from, to: correction.to })
  }
  return pairs
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function invalidResponse(): LiveTranscriptError {
  return new LiveTranscriptError("live_transcript_upstream_failed", "Transcript refine service returned an invalid response.", 502)
}
