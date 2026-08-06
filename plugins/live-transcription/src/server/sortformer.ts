import WebSocket from "ws"
import { LiveTranscriptError } from "./errors"
import type { WhisperLiveKitSnapshot } from "./whisperLiveKit"

const PROTOCOL = "boring.sortformer.v1"
const MAX_MESSAGE_BYTES = 1_000_000
const MAX_SEGMENTS = 2_000
const FRAME_BYTES = 3_200

export interface SortformerSnapshot {
  revision: number
  throughSeconds: number
  lines: Array<{ speaker: number; startSeconds: number; endSeconds: number; text: "" }>
}

interface Callbacks {
  onSnapshot: (snapshot: WhisperLiveKitSnapshot) => void
  onFailure: (error: LiveTranscriptError) => void
}

/** Speaker-only 16 kHz PCM client for the project-owned Sortformer sidecar. */
export class SortformerConnection {
  private socket: WebSocket | undefined
  private closing = false
  private ready = false
  private revision = 0
  private stopId = 0
  private pendingStop: Promise<void> | undefined
  private resolveStop: (() => void) | undefined
  private rejectStop: ((error: LiveTranscriptError) => void) | undefined

  constructor(
    private readonly url: string,
    private readonly callbacks: Callbacks,
    private readonly options: { bearerToken?: string; connectTimeoutMs?: number; highWaterBytes?: number } = {},
  ) {}

  async connect(): Promise<void> {
    const url = new URL(this.url)
    url.search = ""
    if (url.pathname !== "/v1/diarize") throw failure("Sortformer URL must target /v1/diarize.")
    const socket = new WebSocket(url, {
      maxPayload: MAX_MESSAGE_BYTES,
      ...(this.options.bearerToken ? { headers: { Authorization: `Bearer ${this.options.bearerToken}` } } : {}),
    })
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(failure("Sortformer connection timed out.", 504)), this.options.connectTimeoutMs ?? 5_000)
      socket.once("open", () => {
        socket.send(JSON.stringify({
          type: "start",
          protocol: PROTOCOL,
          encoding: "pcm_s16le",
          sampleRateHz: 16_000,
          channels: 1,
          frameDurationMs: 100,
        }))
      })
      socket.on("message", (data, isBinary) => {
        if (isBinary) return this.fail(failure("Sortformer returned binary output."))
        try {
          const message = parseSortformerMessage(data.toString())
          if (message.type === "ready") {
            if (message.protocol !== PROTOCOL) throw failure("Sortformer protocol did not match.")
            this.ready = true
            clearTimeout(timer)
            resolve()
          } else if (message.type === "snapshot") {
            if (!this.ready || message.revision <= this.revision) return
            this.revision = message.revision
            this.callbacks.onSnapshot({ lines: message.lines, remainingDiarizationSeconds: 0 })
          } else if (message.type === "stopped" && message.id === this.stopId) {
            this.closing = true
            this.resolveStop?.()
          }
        } catch (error) {
          this.fail(error instanceof LiveTranscriptError ? error : failure("Sortformer output failed."))
        }
      })
      socket.once("error", () => { clearTimeout(timer); reject(failure("Sortformer connection failed.")) })
      socket.once("close", () => {
        clearTimeout(timer)
        if (!this.ready) reject(failure("Sortformer closed before becoming ready."))
        else if (!this.closing) this.fail(failure("Sortformer closed unexpectedly."))
      })
    }).catch((error) => {
      this.closing = true
      socket.close()
      throw error
    })
  }

  async sendPcm(data: Uint8Array): Promise<void> {
    if (data.byteLength !== FRAME_BYTES) throw new LiveTranscriptError("live_transcript_invalid_audio", "Sortformer requires one 100 ms PCM frame.", 400)
    await this.send(data, true)
  }

  async drain(timeoutMs: number): Promise<void> {
    if (this.pendingStop) return await this.pendingStop
    const id = ++this.stopId
    this.pendingStop = new Promise<void>((resolve, reject) => { this.resolveStop = resolve; this.rejectStop = reject })
    try {
      await this.send(new TextEncoder().encode(JSON.stringify({ type: "stop", id })), false)
      await Promise.race([
        this.pendingStop,
        new Promise<never>((_, reject) => setTimeout(() => reject(failure("Sortformer did not finalize before timeout.", 504)), timeoutMs)),
      ])
    } finally {
      this.pendingStop = undefined
      this.resolveStop = undefined
      this.rejectStop = undefined
    }
  }

  close(): void {
    this.closing = true
    this.socket?.close()
  }

  private async send(data: Uint8Array, binary: boolean): Promise<void> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.ready) throw failure("Sortformer is not connected.")
    if (socket.bufferedAmount + data.byteLength > (this.options.highWaterBytes ?? 4 * 1024 * 1024)) {
      throw new LiveTranscriptError("live_transcript_backpressure", "Sortformer socket exceeded the high-water mark.", 409)
    }
    await new Promise<void>((resolve, reject) => socket.send(data, { binary }, (error) => error ? reject(failure("Sortformer send failed.")) : resolve()))
  }

  private fail(error: LiveTranscriptError): void {
    if (this.closing) return
    this.closing = true
    this.socket?.close()
    this.rejectStop?.(error)
    this.callbacks.onFailure(error)
  }
}

export function parseSortformerMessage(raw: string):
  | { type: "ready"; protocol: string }
  | { type: "snapshot"; revision: number; throughSeconds: number; lines: SortformerSnapshot["lines"] }
  | { type: "stopped"; id: number } {
  if (new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) throw new LiveTranscriptError("live_transcript_limit_exceeded", "Sortformer message exceeded the size limit.", 413)
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw failure("Sortformer returned malformed JSON.") }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("Sortformer returned an invalid message.")
  const record = value as Record<string, unknown>
  if (record.type === "ready" && typeof record.protocol === "string") return { type: "ready", protocol: record.protocol }
  if (record.type === "stopped" && isInteger(record.id)) return { type: "stopped", id: record.id }
  if (record.type !== "snapshot" || !isInteger(record.revision) || record.revision < 1 || !isFiniteNumber(record.throughSeconds) || record.throughSeconds < 0 || !Array.isArray(record.segments) || record.segments.length > MAX_SEGMENTS) {
    throw failure("Sortformer snapshot was invalid.")
  }
  const throughSeconds = record.throughSeconds
  const lines = record.segments.map((segment) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) throw failure("Sortformer segment was invalid.")
    const item = segment as Record<string, unknown>
    if (!isInteger(item.speaker) || item.speaker < 0 || item.speaker > 3 || !isFiniteNumber(item.startSeconds) || !isFiniteNumber(item.endSeconds) || item.startSeconds < 0 || item.endSeconds <= item.startSeconds || item.endSeconds > throughSeconds) {
      throw failure("Sortformer segment fields were invalid.")
    }
    return { speaker: item.speaker, startSeconds: item.startSeconds, endSeconds: item.endSeconds, text: "" as const }
  })
  return { type: "snapshot", revision: record.revision, throughSeconds, lines }
}

function isInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) }
function failure(message: string, statusCode = 502): LiveTranscriptError { return new LiveTranscriptError("live_transcript_upstream_failed", message, statusCode) }
