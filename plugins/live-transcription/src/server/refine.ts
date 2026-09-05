import { readFile, stat } from "node:fs/promises"
import { basename } from "node:path"
import { randomUUID } from "node:crypto"
import type { LifecycleClient } from "./computeLifecycle"
import { LiveTranscriptError } from "./errors"
import { groupKyutaiTranscriptSnapshot } from "./kyutaiTranscript"
import { renderTranscriptMarkdown, type ProjectedTranscriptLine, type TranscriptDocument } from "./projector"
import type { WhisperLiveKitLine } from "./whisperLiveKit"

/** Refuse to stream recordings larger than this to the offline refine service. */
const MAX_AUDIO_BYTES = 200 * 1024 * 1024
const HEARTBEAT_INTERVAL_MS = 30_000

export interface TranscriptRefinerOptions {
  refineUrl: string
  bearerToken: string
  lifecycle?: LifecycleClient
  fetch?: typeof fetch
  now?: () => number
}

export interface RefineInput {
  audioAbsolutePath: string
  title: string
  startedAt: string
  language?: string
}

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
}

interface RefineResponse {
  durationSeconds: number
  language: string
  model: string
  wallSeconds: number
  words: RefineWord[]
}

/** Streams a completed local recording to the offline GPU batch refine service. */
export class TranscriptRefiner {
  constructor(private readonly options: TranscriptRefinerOptions) {}

  async refine(input: RefineInput): Promise<RefineResult> {
    let size: number
    try {
      size = (await stat(input.audioAbsolutePath)).size
    } catch {
      throw new LiveTranscriptError("live_transcript_attachment_invalid", "Recording file was not found.", 400)
    }
    if (size > MAX_AUDIO_BYTES) {
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
    let buffer: Buffer
    try {
      buffer = await readFile(input.audioAbsolutePath)
    } catch {
      throw new LiveTranscriptError("live_transcript_attachment_invalid", "Recording file could not be read.", 400)
    }
    const form = new FormData()
    form.set("file", new Blob([new Uint8Array(buffer)]), basename(input.audioAbsolutePath))
    form.set("language", input.language?.trim() || "fr")

    let response: Response
    try {
      response = await (this.options.fetch ?? fetch)(`${this.options.refineUrl}/refine`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.options.bearerToken}` },
        body: form,
      })
    } catch {
      throw new LiveTranscriptError("live_transcript_upstream_failed", "Transcript refine service was unavailable.", 502)
    }
    if (!response.ok) throw await mapErrorResponse(response)

    const payload = await response.json().catch(() => null)
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
      lines: projected,
    }
    return {
      markdown: renderTranscriptMarkdown(document),
      words,
      speakers,
      durationSeconds: parsed.durationSeconds,
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

async function mapErrorResponse(response: Response): Promise<LiveTranscriptError> {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null
  const message = typeof payload?.error === "string" ? payload.error : "Transcript refine service rejected the request."
  if (response.status === 429) return new LiveTranscriptError("live_transcript_already_active", message, 409)
  if (response.status === 413) return new LiveTranscriptError("live_transcript_limit_exceeded", message, 413)
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
    return { text: word.text, startSeconds: word.startSeconds, endSeconds: word.endSeconds, speaker: word.speaker }
  })
  return {
    durationSeconds: record.durationSeconds,
    language: record.language,
    model: record.model,
    wallSeconds: record.wallSeconds,
    words,
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function invalidResponse(): LiveTranscriptError {
  return new LiveTranscriptError("live_transcript_upstream_failed", "Transcript refine service returned an invalid response.", 502)
}
