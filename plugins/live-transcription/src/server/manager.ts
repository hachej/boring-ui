import type { FastifyRequest } from "fastify"
import type { WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import type { Workspace } from "@hachej/boring-agent/shared"
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import type WebSocket from "ws"
import {
  LIVE_NONCE_BYTES,
  LIVE_PCM_FRAME_BYTES,
  LIVE_SOCKET_HIGH_WATER_BYTES,
  type LiveTranscriptErrorCode,
  type LiveTranscriptStartResponse,
  type LiveTranscriptStatusResponse,
  type LiveTranscriptTerminalResponse,
} from "../shared"
import { LiveTranscriptError } from "./errors"
import { LiveTranscriptProjector, renderTranscriptMarkdown, type ProjectedTranscriptLine, type TranscriptDocument } from "./projector"
import { WhisperLiveKitConnection, type WhisperLiveKitSnapshot } from "./whisperLiveKit"
import { LiveReviewBroker } from "./reviewBroker"

interface UpstreamConnection {
  connect(): Promise<void>
  sendPcm(data: Uint8Array): Promise<void>
  drain(timeoutMs: number): Promise<void>
  close(): void
}

interface LiveSession {
  id: string
  transcriptPath: string
  originatingSessionId: string
  fullSessionCacheKey: string
  startedAt: string
  title: string
  phase: "setup" | "active" | "stopping" | "terminal"
  nonce?: Uint8Array
  setupTimer?: ReturnType<typeof setTimeout>
  browserSocket?: WebSocket
  upstream?: UpstreamConnection
  projector: LiveTranscriptProjector
  reviewBroker?: LiveReviewBroker
  lines: ProjectedTranscriptLine[]
  speakerLabels: Map<number, number>
  audioBytes: number
  upstreamMessages: number
  stopPromise?: Promise<LiveTranscriptTerminalResponse>
  terminalPromise?: Promise<LiveTranscriptTerminalResponse>
}

export interface LiveTranscriptManagerOptions {
  dispatcherResolver: WorkspaceAgentDispatcherResolver
  actorResolver: (request: FastifyRequest) => Promise<{ workspaceId: string; userId: string }> | { workspaceId: string; userId: string }
  upstreamUrl: string
  upstreamBearerToken?: string
  setupTimeoutMs?: number
  drainTimeoutMs?: number
  maxDurationMs?: number
  maxTranscriptBytes?: number
  maxUpstreamMessages?: number
  now?: () => number
  reviewIntervalMs?: number
  reviewRetryMs?: number
  createUpstreamForTest?: (callbacks: {
    onSnapshot: (snapshot: WhisperLiveKitSnapshot) => void
    onFailure: (error: LiveTranscriptError) => void
  }) => UpstreamConnection
}

const encoder = new TextEncoder()

export class LiveTranscriptManager {
  private active: LiveSession | undefined
  private leasePending = false
  private tombstone: LiveTranscriptTerminalResponse | undefined
  private closing = false
  private readonly reviewBrokers = new Set<LiveReviewBroker>()

  constructor(private readonly options: LiveTranscriptManagerOptions) {}

  async start(
    request: FastifyRequest,
    input: { sessionId: string; title?: string },
  ): Promise<LiveTranscriptStartResponse> {
    if (this.closing) throw new LiveTranscriptError("live_transcript_disabled", "Live transcript manager is closing.", 503)
    if (this.active || this.leasePending) {
      throw new LiveTranscriptError("live_transcript_already_active", "A live transcript is already active.", 409)
    }
    const sessionId = input.sessionId.trim()
    if (!sessionId) throw new LiveTranscriptError("live_transcript_session_not_found", "Originating Pi session is required.", 404)
    this.leasePending = true
    let created: { workspace: Workspace; path: string; markdown: string; mtimeMs: number } | undefined
    try {
      const actor = await this.options.actorResolver(request)
      if (!this.options.dispatcherResolver.resolveWithWorkspace) {
        throw new LiveTranscriptError("live_transcript_disabled", "Trusted Workspace resolver is unavailable.", 503)
      }
      const binding = await this.options.dispatcherResolver.resolveWithWorkspace(actor, { request })
      if (!binding.ensurePiSessionBound) {
        throw new LiveTranscriptError("live_transcript_disabled", "Trusted Pi session binding is unavailable.", 503)
      }
      let boundSession: Awaited<ReturnType<NonNullable<typeof binding.ensurePiSessionBound>>>
      try {
        boundSession = await binding.ensurePiSessionBound(sessionId, { workspaceId: actor.workspaceId })
      } catch {
        throw new LiveTranscriptError("live_transcript_session_not_found", "Originating Pi session was not found.", 404)
      }
      if (!binding.workspace.writeFileWithStat || !binding.workspace.readBinaryFile) {
        throw new LiveTranscriptError("live_transcript_disabled", "Workspace guarded file operations are unavailable.", 503)
      }

      const title = cleanTitle(input.title)
      const startedAt = new Date(this.now()).toISOString()
      const path = `live-transcripts/${startedAt.slice(0, 10)}-${randomBytes(12).toString("hex")}.md`
      await binding.workspace.mkdir("live-transcripts", { recursive: true })
      const initialDocument: TranscriptDocument = { title, startedAt, state: "active", lines: [] }
      const markdown = renderTranscriptMarkdown(initialDocument)
      const stat = await binding.workspace.writeFileWithStat(path, markdown)
      created = { workspace: binding.workspace, path, markdown, mtimeMs: stat.mtimeMs }

      const id = randomUUID()
      const socketNonce = randomBytes(LIVE_NONCE_BYTES).toString("base64url")
      const nonce = encoder.encode(socketNonce)
      const session: LiveSession = {
        id,
        transcriptPath: path,
        originatingSessionId: sessionId,
        fullSessionCacheKey: boundSession.fullSessionCacheKey,
        startedAt,
        title,
        phase: "setup",
        nonce,
        projector: undefined as never,
        lines: [],
        speakerLabels: new Map(),
        audioBytes: 0,
        upstreamMessages: 0,
      }
      session.projector = new LiveTranscriptProjector(binding.workspace, path, {
        markdown,
        mtimeMs: stat.mtimeMs,
      }, {
        now: () => this.now(),
        onError: (error) => { void this.interruptFromFailure(session, error) },
      })
      if (boundSession.visibleUserMessageTarget) {
        let broker: LiveReviewBroker
        broker = new LiveReviewBroker({
          transcriptPath: path,
          target: boundSession.visibleUserMessageTarget,
          getProjectionRevision: () => session.projector.projectionRevision,
          intervalMs: this.options.reviewIntervalMs,
          retryMs: this.options.reviewRetryMs,
          onDrained: () => { this.reviewBrokers.delete(broker) },
        })
        session.reviewBroker = broker
        this.reviewBrokers.add(broker)
      }
      session.setupTimer = setTimeout(() => {
        void this.terminate(session, "interrupted", "live_transcript_setup_timeout")
      }, this.options.setupTimeoutMs ?? 30_000)
      this.active = session
      this.tombstone = undefined
      return {
        liveSessionId: id,
        transcriptPath: path,
        socketNonce,
        state: "setup",
      }
    } catch (error) {
      if (created) {
        // A post-create failure is unlikely because the lease object is built
        // synchronously. Preserve the created Markdown rather than deleting it.
      }
      throw error
    } finally {
      this.leasePending = false
    }
  }

  status(id?: string): LiveTranscriptStatusResponse {
    const session = this.active
    if (session && (!id || id === session.id)) {
      return {
        active: session.phase !== "terminal",
        liveSessionId: session.id,
        transcriptPath: session.transcriptPath,
        originatingSessionId: session.originatingSessionId,
        state: session.phase === "terminal" ? "interrupted" : session.phase,
        projectionRevision: session.projector.projectionRevision,
      }
    }
    if (id && this.tombstone?.liveSessionId === id) return { active: false, ...this.tombstone }
    throw new LiveTranscriptError("live_transcript_not_active", "No matching live transcript is active.", 404)
  }

  async stop(id: string): Promise<LiveTranscriptTerminalResponse> {
    if (this.tombstone?.liveSessionId === id) return this.tombstone
    const session = this.requireActive(id)
    if (session.stopPromise) return await session.stopPromise
    if (session.terminalPromise) return await session.terminalPromise
    session.stopPromise = (async () => {
      session.phase = "stopping"
      this.clearSetupTimer(session)
      try {
        await session.upstream?.drain(this.options.drainTimeoutMs ?? 8_000)
      } catch {
        // Drain is bounded and best effort. Explicit stop still terminal-projects
        // the latest full snapshot and closes the upstream.
      }
      return await this.terminate(session, "complete")
    })()
    return await session.stopPromise
  }

  async review(id: string): Promise<{ status: "dispatched" | "pending" }> {
    const session = this.requireActive(id)
    if (!session.reviewBroker || (session.phase !== "active" && session.phase !== "stopping")) {
      throw new LiveTranscriptError("live_transcript_disabled", "Visible transcript review target is unavailable.", 503)
    }
    return { status: await session.reviewBroker.manual() }
  }

  async interruptBeforeAttachment(
    id: string,
    reason: "permission_denied" | "attachment_failed",
  ): Promise<LiveTranscriptTerminalResponse> {
    const session = this.requireActive(id)
    if (session.phase !== "setup") {
      throw new LiveTranscriptError("live_transcript_not_active", "Live transcript is already attached.", 409)
    }
    return await this.terminate(
      session,
      "interrupted",
      reason === "permission_denied" ? "live_transcript_permission_denied" : "live_transcript_attachment_failed",
    )
  }

  handleBrowserSocket(id: string, socket: WebSocket): void {
    const session = this.active
    if (!session || session.id !== id || session.phase === "terminal") {
      socket.close(4404, "live_transcript_not_active")
      return
    }
    let redeemed = false
    let processing = false
    socket.on("message", (raw, isBinary) => {
      if (processing) {
        if (redeemed) void this.terminate(session, "interrupted", "live_transcript_backpressure")
        else socket.close(4401, "live_transcript_attachment_invalid")
        return
      }
      processing = true
      void (async () => {
        if (!isBinary) {
          if (redeemed) await this.terminate(session, "interrupted", "live_transcript_invalid_audio")
          else socket.close(4401, "live_transcript_attachment_invalid")
          return
        }
        const data = rawDataBytes(raw)
        if (!redeemed) {
          if (!session.nonce || !sameBytes(data, session.nonce)) {
            socket.close(4401, "live_transcript_attachment_invalid")
            return
          }
          redeemed = true
          session.nonce = undefined
          session.browserSocket = socket
          this.clearSetupTimer(session)
          const callbacks = {
            onSnapshot: (snapshot: WhisperLiveKitSnapshot) => this.acceptSnapshot(session, snapshot),
            onFailure: (error: LiveTranscriptError) => { void this.interruptFromFailure(session, error) },
          }
          session.upstream = this.options.createUpstreamForTest?.(callbacks) ?? new WhisperLiveKitConnection(
            this.options.upstreamUrl,
            callbacks,
            { bearerToken: this.options.upstreamBearerToken, highWaterBytes: LIVE_SOCKET_HIGH_WATER_BYTES },
          )
          try {
            await session.upstream.connect()
          } catch {
            await this.terminate(session, "interrupted", "live_transcript_upstream_failed")
            return
          }
          session.phase = "active"
          session.reviewBroker?.start()
          await sendAck(socket)
          return
        }
        if (session.phase !== "active") return
        if (data.byteLength !== LIVE_PCM_FRAME_BYTES || data.byteLength % 2 !== 0) {
          await this.terminate(session, "interrupted", "live_transcript_invalid_audio")
          return
        }
        session.audioBytes += data.byteLength
        const maxAudioBytes = Math.floor((this.options.maxDurationMs ?? 4 * 60 * 60 * 1_000) * 32)
        if (session.audioBytes > maxAudioBytes) {
          await this.terminate(session, "interrupted", "live_transcript_limit_exceeded")
          return
        }
        if (socket.bufferedAmount > LIVE_SOCKET_HIGH_WATER_BYTES) {
          await this.terminate(session, "interrupted", "live_transcript_backpressure")
          return
        }
        try {
          await session.upstream?.sendPcm(data)
          await sendAck(socket)
        } catch (error) {
          const code = error instanceof LiveTranscriptError ? error.code : "live_transcript_upstream_failed"
          await this.terminate(session, "interrupted", code)
        }
      })().catch(() => {
        void this.terminate(session, "interrupted", "live_transcript_upstream_failed")
      }).finally(() => {
        processing = false
      })
    })
    socket.on("close", () => {
      if (redeemed && session.phase !== "stopping" && session.phase !== "terminal") {
        void this.terminate(session, "interrupted", "live_transcript_attachment_failed")
      }
    })
    socket.on("error", () => {
      if (redeemed && session.phase !== "terminal") {
        void this.terminate(session, "interrupted", "live_transcript_attachment_failed")
      }
    })
  }

  async interruptForSessionReplacement(): Promise<void> {
    const session = this.active
    if (session) await this.terminate(session, "interrupted", "live_transcript_attachment_failed")
    for (const broker of [...this.reviewBrokers]) broker.interrupt()
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    await this.interruptForSessionReplacement()
  }

  private acceptSnapshot(session: LiveSession, snapshot: WhisperLiveKitSnapshot): void {
    if (session.phase !== "active" && session.phase !== "stopping") return
    session.upstreamMessages += 1
    if (session.upstreamMessages > (this.options.maxUpstreamMessages ?? 100_000)) {
      void this.terminate(session, "interrupted", "live_transcript_limit_exceeded")
      return
    }
    const lines = snapshot.lines.map((line) => {
      let speaker = session.speakerLabels.get(line.speaker)
      if (!speaker) {
        speaker = session.speakerLabels.size + 1
        session.speakerLabels.set(line.speaker, speaker)
      }
      return { startSeconds: line.startSeconds, speaker, text: line.text }
    })
    const document = this.document(session, "active", lines)
    if (encoder.encode(renderTranscriptMarkdown(document)).byteLength > (this.options.maxTranscriptBytes ?? 2 * 1024 * 1024)) {
      void this.terminate(session, "interrupted", "live_transcript_limit_exceeded")
      return
    }
    session.lines = lines
    session.projector.schedule(document)
  }

  private async interruptFromFailure(session: LiveSession, error: LiveTranscriptError): Promise<void> {
    if (session.phase === "terminal") return
    await this.terminate(session, "interrupted", error.code)
  }

  private terminate(
    session: LiveSession,
    state: "complete" | "interrupted",
    outcome?: LiveTranscriptErrorCode,
  ): Promise<LiveTranscriptTerminalResponse> {
    if (session.terminalPromise) return session.terminalPromise
    session.phase = "terminal"
    this.clearSetupTimer(session)
    session.terminalPromise = (async () => {
      let finalState = state
      let finalOutcome = outcome
      try {
        await session.projector.finalize(this.document(session, state, session.lines))
      } catch (error) {
        finalState = "interrupted"
        finalOutcome = error instanceof LiveTranscriptError ? error.code : "live_transcript_upstream_failed"
      }
      if (finalState === "complete") await session.reviewBroker?.final()
      else session.reviewBroker?.interrupt()
      session.upstream?.close()
      const result: LiveTranscriptTerminalResponse = {
        liveSessionId: session.id,
        transcriptPath: session.transcriptPath,
        state: finalState,
        ...(finalOutcome ? { outcome: finalOutcome } : {}),
        projectionRevision: session.projector.projectionRevision,
      }
      try {
        session.browserSocket?.close(4000, finalOutcome ?? finalState)
      } catch {}
      if (this.active === session) this.active = undefined
      this.tombstone = result
      return result
    })()
    return session.terminalPromise
  }

  private document(
    session: LiveSession,
    state: "active" | "complete" | "interrupted",
    lines: ProjectedTranscriptLine[],
  ): TranscriptDocument {
    return { title: session.title, startedAt: session.startedAt, state, lines }
  }

  private requireActive(id: string): LiveSession {
    if (!this.active || this.active.id !== id) {
      throw new LiveTranscriptError("live_transcript_not_active", "No matching live transcript is active.", 404)
    }
    return this.active
  }

  private clearSetupTimer(session: LiveSession): void {
    if (!session.setupTimer) return
    clearTimeout(session.setupTimer)
    session.setupTimer = undefined
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

function cleanTitle(value: string | undefined): string {
  return (value?.trim() || "Live transcript")
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .slice(0, 120)
}

function rawDataBytes(raw: WebSocket.RawData): Uint8Array {
  if (Array.isArray(raw)) {
    const length = raw.reduce((total, part) => total + part.byteLength, 0)
    const merged = new Uint8Array(length)
    let offset = 0
    for (const part of raw) {
      merged.set(part, offset)
      offset += part.byteLength
    }
    return merged
  }
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

async function sendAck(socket: WebSocket): Promise<void> {
  if (socket.readyState !== socket.OPEN) {
    throw new LiveTranscriptError("live_transcript_attachment_failed", "Browser audio socket closed.", 409)
  }
  await new Promise<void>((resolve, reject) => socket.send(new Uint8Array([1]), { binary: true }, (error) => error
    ? reject(new LiveTranscriptError("live_transcript_attachment_failed", "Browser audio ACK failed.", 409))
    : resolve()))
}
