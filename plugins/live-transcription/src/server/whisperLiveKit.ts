import WebSocket from "ws"
import { LiveTranscriptError } from "./errors"

export interface WhisperLiveKitLine {
  startSeconds: number
  speaker: number
  text: string
}

export interface WhisperLiveKitSnapshot {
  lines: WhisperLiveKitLine[]
  remainingDiarizationSeconds: number
}

const MAX_UPSTREAM_JSON_BYTES = 1_000_000
const MAX_UPSTREAM_LINES = 2_000

export function parseWhisperLiveKitSnapshot(raw: string): WhisperLiveKitSnapshot | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_UPSTREAM_JSON_BYTES) {
    throw new LiveTranscriptError("live_transcript_limit_exceeded", "WhisperLiveKit message exceeded the V0 size limit.", 413)
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit returned malformed JSON.", 502)
  }
  if (!value || typeof value !== "object") {
    throw new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit returned an invalid snapshot.", 502)
  }
  const record = value as Record<string, unknown>
  if (record.type === "config") return null
  if (!Array.isArray(record.lines) || record.lines.length > MAX_UPSTREAM_LINES) {
    throw new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit snapshot lines were invalid.", 502)
  }
  const lines = record.lines.flatMap((line): WhisperLiveKitLine[] => {
    if (!line || typeof line !== "object") throw new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit line was invalid.", 502)
    const item = line as Record<string, unknown>
    const text = typeof item.text === "string" ? item.text : ""
    const speaker = item.speaker
    const start = parseTimestampSeconds(item.beg ?? item.start)
    if (text.length > 20_000 || typeof speaker !== "number" || !Number.isInteger(speaker) || start === undefined) {
      throw new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit line fields were invalid.", 502)
    }
    // Full snapshots temporarily use negative speaker ids while Diart has not
    // attributed the segment yet. Keep the connection alive and omit that
    // provisional line; a later full snapshot restores it with a stable id.
    if (speaker < 0) return []
    return [{ text, speaker, startSeconds: Math.max(0, start) }]
  })
  const backlog = record.remaining_time_diarization
  if (backlog !== undefined && (typeof backlog !== "number" || !Number.isFinite(backlog) || backlog < 0)) {
    throw new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit backlog was invalid.", 502)
  }
  return { lines, remainingDiarizationSeconds: typeof backlog === "number" ? backlog : 0 }
}

function parseTimestampSeconds(value: unknown): number | undefined {
  if (value === undefined) return 0
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : undefined
  if (typeof value !== "string") return undefined
  const parts = value.split(":")
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return undefined
  const numbers = parts.map(Number)
  const seconds = parts.length === 3
    ? numbers[0]! * 3_600 + numbers[1]! * 60 + numbers[2]!
    : numbers[0]! * 60 + numbers[1]!
  return Number.isFinite(seconds) ? seconds : undefined
}

export class WhisperLiveKitConnection {
  private socket: WebSocket | undefined
  private backlogSeconds = 0
  private audioRevision = 0
  private snapshotAudioRevision = 0
  private receivedSnapshot = false
  private trailingSilentSamples = 0
  private closing = false

  constructor(
    private readonly url: string,
    private readonly callbacks: {
      onSnapshot: (snapshot: WhisperLiveKitSnapshot) => void
      onFailure: (error: LiveTranscriptError) => void
    },
    private readonly options: { bearerToken?: string; connectTimeoutMs?: number; highWaterBytes?: number } = {},
  ) {}

  async connect(): Promise<void> {
    const url = new URL(this.url)
    url.search = ""
    url.searchParams.set("language", "fr")
    url.searchParams.set("mode", "full")
    const socket = new WebSocket(url, {
      maxPayload: MAX_UPSTREAM_JSON_BYTES,
      ...(this.options.bearerToken ? { headers: { Authorization: `Bearer ${this.options.bearerToken}` } } : {}),
    })
    this.socket = socket
    let configured = false
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit config timed out.", 504)), this.options.connectTimeoutMs ?? 5_000)
        const rejectBeforeConfig = (error: LiveTranscriptError) => {
          if (configured) return this.fail(error)
          clearTimeout(timer)
          reject(error)
        }
        socket.on("message", (data, isBinary) => {
          if (isBinary) return rejectBeforeConfig(new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit returned binary output.", 502))
          try {
            if (!configured) {
              const raw = data.toString()
              const parsed = JSON.parse(raw) as { type?: unknown }
              if (parsed.type !== "config") {
                throw new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit did not begin with a config event.", 502)
              }
              configured = true
              clearTimeout(timer)
              resolve()
              return
            }
            const snapshot = parseWhisperLiveKitSnapshot(data.toString())
            if (!snapshot) throw new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit repeated its config event.", 502)
            this.backlogSeconds = snapshot.remainingDiarizationSeconds
            this.snapshotAudioRevision = this.audioRevision
            this.receivedSnapshot = true
            this.callbacks.onSnapshot(snapshot)
          } catch (error) {
            rejectBeforeConfig(error instanceof LiveTranscriptError
              ? error
              : new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit output failed.", 502))
          }
        })
        socket.once("error", () => rejectBeforeConfig(new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit connection failed.", 502)))
        socket.on("close", () => {
          if (!this.closing) rejectBeforeConfig(new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit closed unexpectedly.", 502))
        })
      })
    } catch (error) {
      this.closing = true
      socket.close()
      throw error
    }
  }

  async sendPcm(data: Uint8Array): Promise<void> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit is not connected.", 502)
    }
    if (socket.bufferedAmount > (this.options.highWaterBytes ?? 64 * 1024)) {
      throw new LiveTranscriptError("live_transcript_backpressure", "WhisperLiveKit socket exceeded the V0 high-water mark.", 409)
    }
    this.audioRevision += 1
    this.trailingSilentSamples = isSilentPcmFrame(data)
      ? this.trailingSilentSamples + data.byteLength / 2
      : 0
    await new Promise<void>((resolve, reject) => {
      socket.send(data, { binary: true }, (error) => error
        ? reject(new LiveTranscriptError("live_transcript_upstream_failed", "WhisperLiveKit audio send failed.", 502))
        : resolve())
    })
  }

  async drain(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    const targetAudioRevision = this.audioRevision
    // WhisperLiveKit has no causal final-frame marker and emits no new snapshot
    // for trailing silence. Always hold the complete bounded window so a stale
    // periodic snapshot cannot end the drain early. A historical snapshot may
    // cover later audio only when at least one second of detected silence ends
    // the stream; voiced post-snapshot audio still requires a newer snapshot.
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))))
    }
    const snapshotCoversAudio = this.snapshotAudioRevision >= targetAudioRevision
    const hasTrailingSilence = this.trailingSilentSamples >= 16_000
    if (this.receivedSnapshot && (
      (snapshotCoversAudio && this.backlogSeconds <= 0.1)
      // WhisperLiveKit also stops publishing backlog changes during silence.
      // After one second of measured silence plus the complete drain window,
      // its historical backlog value is stale and cannot be polled to zero.
      || hasTrailingSilence
    )) return
    throw new LiveTranscriptError(
      "live_transcript_upstream_failed",
      "WhisperLiveKit did not produce a drained final snapshot in time.",
      504,
    )
  }

  close(): void {
    this.closing = true
    this.socket?.close()
  }

  private fail(error: LiveTranscriptError): void {
    if (this.closing) return
    this.closing = true
    this.socket?.close()
    this.callbacks.onFailure(error)
  }
}

function isSilentPcmFrame(data: Uint8Array): boolean {
  if (data.byteLength < 2 || data.byteLength % 2 !== 0) return false
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let sumSquares = 0
  for (let offset = 0; offset < data.byteLength; offset += 2) {
    const sample = view.getInt16(offset, true)
    sumSquares += sample * sample
  }
  return Math.sqrt(sumSquares / (data.byteLength / 2)) < 256
}
