import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import type WebSocket from "ws"
import { LIVE_NONCE_BYTES, LIVE_PCM_FRAME_BYTES, LIVE_SOCKET_HIGH_WATER_BYTES } from "../shared"
import { LiveTranscriptError } from "./errors"
import { KyutaiConnection } from "./kyutai"
import type { WhisperLiveKitSnapshot } from "./whisperLiveKit"

interface ComposerUpstream {
  connect(): Promise<void>
  sendPcm(data: Uint8Array): Promise<void>
  drain(timeoutMs: number): Promise<void>
  close(): void
}

interface ComposerSession {
  id: string
  nonce?: Uint8Array
  phase: "setup" | "active" | "stopping" | "terminal"
  socket?: WebSocket
  upstream?: ComposerUpstream
  words: string[]
  publishedWords: number
  audioBytes: number
  setupTimer?: ReturnType<typeof setTimeout>
  stopPromise?: Promise<{ text: string }>
}

const encoder = new TextEncoder()

/** Routes the shared Kyutai stream into ephemeral composer Word events. */
export class KyutaiComposerManager {
  private active: ComposerSession | undefined
  private closing = false

  constructor(private readonly options: {
    upstreamUrl: string
    apiKey?: string
    setupTimeoutMs?: number
    drainTimeoutMs?: number
    maxDurationMs?: number
    createUpstreamForTest?: (callbacks: {
      onSnapshot: (snapshot: WhisperLiveKitSnapshot) => void
      onFailure: (error: LiveTranscriptError) => void
    }) => ComposerUpstream
  }) {}

  get isActive(): boolean { return this.active !== undefined }

  start(): { composerStreamId: string; socketNonce: string } {
    if (this.closing) throw new LiveTranscriptError("live_transcript_disabled", "Composer dictation manager is closing.", 503)
    if (this.active) throw new LiveTranscriptError("live_transcript_already_active", "A microphone stream is already active.", 409)
    const id = randomUUID()
    const socketNonce = randomBytes(LIVE_NONCE_BYTES).toString("base64url")
    const session: ComposerSession = {
      id,
      nonce: encoder.encode(socketNonce),
      phase: "setup",
      words: [],
      publishedWords: 0,
      audioBytes: 0,
    }
    session.setupTimer = setTimeout(() => this.terminate(session), this.options.setupTimeoutMs ?? 30_000)
    this.active = session
    return { composerStreamId: id, socketNonce }
  }

  handleSocket(id: string, socket: WebSocket): void {
    const session = this.active
    if (!session || session.id !== id || session.phase === "terminal") return socket.close(4404, "live_transcript_not_active")
    let redeemed = false
    let processing = false
    socket.on("message", (raw, isBinary) => {
      if (processing) return this.fail(session, "live_transcript_backpressure")
      processing = true
      void (async () => {
        if (!isBinary) return this.fail(session, "live_transcript_invalid_audio")
        const data = rawDataBytes(raw)
        if (!redeemed) {
          if (!session.nonce || !sameBytes(data, session.nonce)) return socket.close(4401, "live_transcript_attachment_invalid")
          redeemed = true
          session.nonce = undefined
          session.socket = socket
          this.clearSetupTimer(session)
          const callbacks = {
            onSnapshot: (snapshot: WhisperLiveKitSnapshot) => this.publishWords(session, snapshot),
            onFailure: () => this.fail(session, "live_transcript_upstream_failed"),
          }
          session.upstream = this.options.createUpstreamForTest?.(callbacks) ?? new KyutaiConnection(
            this.options.upstreamUrl,
            callbacks,
            { apiKey: this.options.apiKey, highWaterBytes: LIVE_SOCKET_HIGH_WATER_BYTES },
          )
          try { await session.upstream.connect() } catch { return this.fail(session, "live_transcript_upstream_failed") }
          session.phase = "active"
          await sendAck(socket)
          return
        }
        if (session.phase !== "active") return
        if (data.byteLength !== LIVE_PCM_FRAME_BYTES || data.byteLength % 2 !== 0) return this.fail(session, "live_transcript_invalid_audio")
        session.audioBytes += data.byteLength
        const maxAudioBytes = Math.floor((this.options.maxDurationMs ?? 30 * 60 * 1_000) * 32)
        if (session.audioBytes > maxAudioBytes) return this.fail(session, "live_transcript_limit_exceeded")
        try {
          await session.upstream?.sendPcm(data)
          await sendAck(socket)
        } catch (error) {
          return this.fail(session, error instanceof LiveTranscriptError ? error.code : "live_transcript_upstream_failed")
        }
      })().finally(() => { processing = false })
    })
    socket.on("close", () => { if (redeemed && session.phase !== "stopping" && session.phase !== "terminal") this.terminate(session) })
    socket.on("error", () => { if (redeemed) this.terminate(session) })
  }

  async stop(id: string): Promise<{ text: string }> {
    const session = this.active
    if (!session || session.id !== id) throw new LiveTranscriptError("live_transcript_not_active", "No matching composer stream is active.", 404)
    if (session.stopPromise) return await session.stopPromise
    session.stopPromise = (async () => {
      session.phase = "stopping"
      this.clearSetupTimer(session)
      try { await session.upstream?.drain(this.options.drainTimeoutMs ?? 8_000) } catch {
        this.terminate(session)
        throw new LiveTranscriptError("live_transcript_upstream_failed", "Kyutai composer stream did not finalize.", 502)
      }
      const result = { text: session.words.join(" ").trim() }
      this.terminate(session)
      return result
    })()
    return await session.stopPromise
  }

  close(): void {
    this.closing = true
    if (this.active) this.terminate(this.active)
  }

  private publishWords(session: ComposerSession, snapshot: WhisperLiveKitSnapshot): void {
    if (session.phase !== "active" && session.phase !== "stopping") return
    session.words = snapshot.lines.map((line) => line.text.trim()).filter(Boolean)
    const added = session.words.slice(session.publishedWords)
    session.publishedWords = session.words.length
    const socket = session.socket
    if (!socket || socket.readyState !== socket.OPEN) return
    for (const text of added) socket.send(JSON.stringify({ type: "word", text }))
  }

  private fail(session: ComposerSession, code: ConstructorParameters<typeof LiveTranscriptError>[0]): void {
    if (session.phase === "terminal") return
    const socket = session.socket
    if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: "error", code }))
    this.terminate(session)
  }

  private terminate(session: ComposerSession): void {
    if (session.phase === "terminal") return
    session.phase = "terminal"
    this.clearSetupTimer(session)
    session.upstream?.close()
    try { session.socket?.close() } catch {}
    if (this.active === session) this.active = undefined
  }

  private clearSetupTimer(session: ComposerSession): void {
    if (!session.setupTimer) return
    clearTimeout(session.setupTimer)
    session.setupTimer = undefined
  }
}

function rawDataBytes(raw: WebSocket.RawData): Uint8Array {
  if (Array.isArray(raw)) { const size = raw.reduce((total, part) => total + part.byteLength, 0); const merged = new Uint8Array(size); let offset = 0; for (const part of raw) { merged.set(part, offset); offset += part.byteLength }; return merged }
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
}
function sameBytes(left: Uint8Array, right: Uint8Array): boolean { return left.byteLength === right.byteLength && timingSafeEqual(left, right) }
async function sendAck(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => socket.send(new Uint8Array([1]), { binary: true }, (error) => error ? reject(error) : resolve()))
}
