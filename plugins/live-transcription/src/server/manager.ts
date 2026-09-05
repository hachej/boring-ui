import type { FastifyRequest } from "fastify"
import type { WorkspaceAgentDispatcherBinding, WorkspaceAgentDispatcherResolver } from "@hachej/boring-agent/server"
import type { LeaseBoundWorkspaceAgent, Workspace } from "@hachej/boring-agent/shared"
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import type WebSocket from "ws"
import {
  KYUTAI_PCM_FRAME_BYTES,
  LIVE_NONCE_BYTES,
  LIVE_PCM_FRAME_BYTES,
  LIVE_SERVER_PENDING_FRAMES,
  LIVE_SOCKET_HIGH_WATER_BYTES,
  type LiveTranscriptErrorCode,
  type LiveTranscriptStartResponse,
  type LiveTranscriptStatusResponse,
  type LiveTranscriptTerminalResponse,
} from "../shared"
import { LiveTranscriptError } from "./errors"
import { LiveTranscriptProjector, renderTranscriptMarkdown, type ProjectedTranscriptLine, type TranscriptDocument } from "./projector"
import { KyutaiConnection } from "./kyutai"
import { KyutaiDiarizedConnection } from "./kyutaiDiarized"
import { groupKyutaiTranscriptSnapshot } from "./kyutaiTranscript"
import { WhisperLiveKitConnection, type WhisperLiveKitSnapshot } from "./whisperLiveKit"
import { LiveReviewBroker } from "./reviewBroker"
import { LocalAudioRecorder } from "./audioRecorder"
import type { TranscriptRefiner } from "./refine"
import { join as joinPath } from "node:path"
import { realpath, stat as fsStat } from "node:fs/promises"

interface UpstreamConnection {
  connect(): Promise<void>
  sendPcm(data: Uint8Array): Promise<void>
  drain(timeoutMs: number): Promise<void>
  close(): void
}

interface LiveSession {
  id: string
  transcriptPath: string
  audioPath?: string
  audioRecorder?: LocalAudioRecorder
  originatingSessionId: string
  startedAt: string
  title: string
  phase: "setup" | "active" | "stopping" | "terminal"
  nonce?: Uint8Array
  setupTimer?: ReturnType<typeof setTimeout>
  browserSocket?: WebSocket
  upstream?: UpstreamConnection
  projector: LiveTranscriptProjector
  reviewBroker?: LiveReviewBroker
  reviewTarget?: PiSessionVisibleUserTurnTarget
  workspace: Workspace
  lines: ProjectedTranscriptLine[]
  speakerLabels: Map<number, number>
  audioBytes: number
  upstreamMessages: number
  stopPromise?: Promise<LiveTranscriptTerminalResponse>
  terminalPromise?: Promise<LiveTranscriptTerminalResponse>
  releaseWorkspaceLease?: () => void
  removeWorkspaceAbortListener?: () => void
  refinePromise?: Promise<void>
}

type PiSessionVisibleUserTurnTarget = Awaited<
  ReturnType<NonNullable<WorkspaceAgentDispatcherBinding["bindPiSession"]>>
>["visibleUserMessageTarget"]

export interface LiveTranscriptManagerOptions {
  dispatcherResolver: WorkspaceAgentDispatcherResolver
  /** Addressed Agent target used by direct callback-scoped hosts. Omit only for compatibility hosts. */
  agentTypeId?: string
  actorResolver: (request: FastifyRequest) => Promise<{ workspaceId: string; userId: string }> | { workspaceId: string; userId: string }
  upstreamUrl: string
  upstreamProvider?: "whisperlivekit" | "kyutai"
  upstreamBearerToken?: string
  diarizerUrl?: string
  diarizerBearerToken?: string
  setupTimeoutMs?: number
  drainTimeoutMs?: number
  maxDurationMs?: number
  maxTranscriptBytes?: number
  maxUpstreamMessages?: number
  /** Optional trusted local directory for streaming AAC/M4A consultation recordings. */
  audioRecordingDirectory?: string
  audioRecordingFfmpegPath?: string
  now?: () => number
  reviewIntervalMs?: number
  reviewRetryMs?: number
  /** Optional offline GPU refine pass that replaces the live transcript once a session completes. */
  refiner?: TranscriptRefiner
  /** Swallows errors raised while refining a completed session; refinement must never throw from terminate(). */
  onRefineError?: (error: unknown) => void
  createUpstreamForTest?: (callbacks: {
    onSnapshot: (snapshot: WhisperLiveKitSnapshot) => void
    onFailure: (error: LiveTranscriptError) => void
  }) => UpstreamConnection
}

const encoder = new TextEncoder()
const REVIEW_INSTRUCTIONS_PATH = ".agents/live-transcription/review.md"
const MAX_REVIEW_INSTRUCTIONS_BYTES = 32 * 1024

export class LiveTranscriptManager {
  private active: LiveSession | undefined
  private leasePending = false
  private tombstone: LiveTranscriptTerminalResponse | undefined
  private closing = false
  private readonly reviewBrokers = new Set<LiveReviewBroker>()
  private transcribeFileActive = false

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
    try {
      const actor = await this.options.actorResolver(request)
      if (this.options.agentTypeId) {
        return await this.startDirect(request, actor, sessionId, input.title)
      }
      if (!this.options.dispatcherResolver.resolveWithWorkspace) {
        throw new LiveTranscriptError("live_transcript_disabled", "Trusted Workspace resolver is unavailable.", 503)
      }
      const binding = await this.options.dispatcherResolver.resolveWithWorkspace(actor, { request })
      if (!binding.bindPiSession) {
        throw new LiveTranscriptError("live_transcript_disabled", "Trusted Pi session binding is unavailable.", 503)
      }
      let boundSession: Awaited<ReturnType<NonNullable<typeof binding.bindPiSession>>>
      try {
        boundSession = await binding.bindPiSession(sessionId, actor)
      } catch (error) {
        if ((error as { code?: unknown })?.code !== "SESSION_NOT_FOUND") throw error
        throw new LiveTranscriptError("live_transcript_session_not_found", "Originating Pi session was not found.", 404)
      }
      const reviewTarget = boundSession.visibleUserMessageTarget
      if (!reviewTarget) {
        throw new LiveTranscriptError("live_transcript_disabled", "Visible transcript review is unavailable.", 503)
      }
      if (!binding.workspace.writeFileWithStat || !binding.workspace.readBinaryFile) {
        throw new LiveTranscriptError("live_transcript_disabled", "Workspace guarded file operations are unavailable.", 503)
      }
      return await this.createSession(binding.workspace, sessionId, input.title, reviewTarget)
    } finally {
      this.leasePending = false
    }
  }

  private async startDirect(
    request: FastifyRequest,
    actor: { workspaceId: string; userId: string },
    sessionId: string,
    title?: string,
  ): Promise<LiveTranscriptStartResponse> {
    let resolveSetup!: (response: LiveTranscriptStartResponse) => void
    let rejectSetup!: (error: unknown) => void
    const setup = new Promise<LiveTranscriptStartResponse>((resolve, reject) => {
      resolveSetup = resolve
      rejectSetup = reject
    })
    let releaseLease!: () => void
    const leaseLifetime = new Promise<void>((resolve) => { releaseLease = resolve })
    let setupSettled = false
    const run = this.options.dispatcherResolver.runWithWorkspaceAgent({
      agentTypeId: this.options.agentTypeId!,
      context: actor,
      requestId: `live-transcript:${randomUUID()}`,
      request,
    }, async (binding: LeaseBoundWorkspaceAgent) => {
      try {
        const response = await this.createSession(
          binding.workspace,
          sessionId,
          title,
          createLeaseReviewTarget(binding, sessionId),
        )
        const session = this.active
        if (!session || session.id !== response.liveSessionId) {
          throw new LiveTranscriptError("live_transcript_disabled", "Live transcript lease was not published.", 503)
        }
        session.releaseWorkspaceLease = releaseLease
        if (session.phase === "terminal") releaseLease()
        const onAbort = () => { void this.terminate(session, "interrupted", "live_transcript_attachment_failed") }
        binding.signal.addEventListener("abort", onAbort, { once: true })
        session.removeWorkspaceAbortListener = () => binding.signal.removeEventListener("abort", onAbort)
        setupSettled = true
        resolveSetup(response)
        await leaseLifetime
      } catch (error) {
        if (!setupSettled) {
          setupSettled = true
          rejectSetup(error)
        }
        throw error
      }
    })
    void run.catch((error) => {
      if (!setupSettled) {
        setupSettled = true
        rejectSetup(error)
        return
      }
      const session = this.active
      if (session) void this.terminate(session, "interrupted", "live_transcript_attachment_failed")
    })
    return await setup
  }

  private async createSession(
    workspace: Workspace,
    sessionId: string,
    inputTitle?: string,
    reviewTarget?: PiSessionVisibleUserTurnTarget,
  ): Promise<LiveTranscriptStartResponse> {
    if (!workspace.writeFileWithStat || !workspace.readBinaryFile) {
      throw new LiveTranscriptError("live_transcript_disabled", "Workspace guarded file operations are unavailable.", 503)
    }
    const title = cleanTitle(inputTitle)
    const startedAt = new Date(this.now()).toISOString()
    const stem = `${startedAt.slice(0, 10)}-${randomBytes(12).toString("hex")}`
    const path = `live-transcripts/${stem}.md`
    const audioPath = this.options.audioRecordingDirectory ? `live-transcripts/${stem}.m4a` : undefined
    await workspace.mkdir("live-transcripts", { recursive: true })
    const initialDocument: TranscriptDocument = {
      title,
      startedAt,
      state: "active",
      showSpeakerLabels: this.options.upstreamProvider !== "kyutai" || Boolean(this.options.diarizerUrl),
      lines: [],
    }
    const markdown = renderTranscriptMarkdown(initialDocument)
    const stat = await workspace.writeFileWithStat(path, markdown)
    const id = randomUUID()
    const socketNonce = randomBytes(LIVE_NONCE_BYTES).toString("base64url")
    const session: LiveSession = {
      id,
      transcriptPath: path,
      audioPath,
      originatingSessionId: sessionId,
      startedAt,
      title,
      phase: "setup",
      nonce: encoder.encode(socketNonce),
      projector: undefined as never,
      reviewTarget,
      workspace,
      lines: [],
      speakerLabels: new Map(),
      audioBytes: 0,
      upstreamMessages: 0,
    }
    session.projector = new LiveTranscriptProjector(workspace, path, { markdown, mtimeMs: stat.mtimeMs }, {
      now: () => this.now(),
      onError: (error) => { void this.interruptFromFailure(session, error) },
    })
    if (reviewTarget) {
      let broker: LiveReviewBroker
      broker = new LiveReviewBroker({
        transcriptPath: path,
        target: reviewTarget,
        getProjectionRevision: () => session.projector.projectionRevision,
        getReviewInstructions: () => readReviewInstructions(workspace),
        intervalMs: this.options.reviewIntervalMs,
        retryMs: this.options.reviewRetryMs,
        onTerminalFailure: () => { void this.terminate(session, "interrupted", "live_transcript_session_not_found") },
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
      ...(audioPath ? { audioPath } : {}),
      socketNonce,
      reviewIntervalMs: this.options.reviewIntervalMs ?? 60_000,
      state: "setup",
    }
  }

  status(id?: string): LiveTranscriptStatusResponse {
    const session = this.active
    if (session && (!id || id === session.id)) {
      return {
        active: session.phase !== "terminal",
        liveSessionId: session.id,
        transcriptPath: session.transcriptPath,
        ...(session.audioPath ? { audioPath: session.audioPath } : {}),
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
        return await this.terminate(session, "interrupted", "live_transcript_upstream_failed")
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
    let pending = 0
    let chain: Promise<void> = Promise.resolve()
    socket.on("message", (raw, isBinary) => {
      // Frames are processed strictly in order. The browser keeps several
      // frames in flight, so a short queue is normal; only a sustained stall
      // of the upstream send (about 3 s of audio) is backpressure.
      if ((redeemed && pending >= LIVE_SERVER_PENDING_FRAMES) || (!redeemed && pending > 0)) {
        if (redeemed) void this.terminate(session, "interrupted", "live_transcript_backpressure")
        else socket.close(4401, "live_transcript_attachment_invalid")
        return
      }
      pending += 1
      chain = chain.then(async () => {
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
          session.upstream = this.options.createUpstreamForTest?.(callbacks) ?? this.createUpstream(callbacks)
          try {
            await session.upstream.connect()
            if (session.audioPath && this.options.audioRecordingDirectory) {
              session.audioRecorder = new LocalAudioRecorder({
                directory: this.options.audioRecordingDirectory,
                filename: session.audioPath.slice("live-transcripts/".length),
                sampleRate: this.options.upstreamProvider === "kyutai" ? 24_000 : 16_000,
                ffmpegPath: this.options.audioRecordingFfmpegPath,
              })
              await session.audioRecorder.start()
            }
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
        const expectedFrameBytes = this.options.upstreamProvider === "kyutai" ? KYUTAI_PCM_FRAME_BYTES : LIVE_PCM_FRAME_BYTES
        if (data.byteLength !== expectedFrameBytes || data.byteLength % 2 !== 0) {
          await this.terminate(session, "interrupted", "live_transcript_invalid_audio")
          return
        }
        session.audioBytes += data.byteLength
        const bytesPerMillisecond = expectedFrameBytes / 100
        const maxAudioBytes = Math.floor((this.options.maxDurationMs ?? 4 * 60 * 60 * 1_000) * bytesPerMillisecond)
        if (session.audioBytes > maxAudioBytes) {
          await this.terminate(session, "interrupted", "live_transcript_limit_exceeded")
          return
        }
        if (socket.bufferedAmount > LIVE_SOCKET_HIGH_WATER_BYTES) {
          await this.terminate(session, "interrupted", "live_transcript_backpressure")
          return
        }
        try {
          await session.audioRecorder?.write(data)
          await session.upstream?.sendPcm(data)
          await sendAck(socket)
        } catch (error) {
          const code = error instanceof LiveTranscriptError ? error.code : "live_transcript_upstream_failed"
          await this.terminate(session, "interrupted", code)
        }
      }).catch(() => {
        void this.terminate(session, "interrupted", "live_transcript_upstream_failed")
      }).finally(() => {
        pending -= 1
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

  getAgentReloadBlock(): { code: string; message: string } | undefined {
    if (!this.active) return undefined
    return {
      code: "live_transcript_already_active",
      message: "Stop the active transcription before reloading the Agent.",
    }
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

  /** Refines a workspace-relative recording that already exists (not the live capture pipeline). */
  async transcribeFile(
    request: FastifyRequest,
    input: { path: string; title?: string; overwrite?: boolean },
  ): Promise<{ transcriptPath: string; words: number; speakers: number; durationSeconds: number }> {
    const refiner = this.options.refiner
    if (!refiner) throw new LiveTranscriptError("live_transcript_disabled", "Offline transcript refinement is not configured.", 503)
    if (this.transcribeFileActive) {
      throw new LiveTranscriptError("live_transcript_already_active", "A file transcription job is already running.", 409)
    }
    this.transcribeFileActive = true
    try {
      const actor = await this.options.actorResolver(request)
      if (this.options.agentTypeId) {
        type TranscribeFileResult = { transcriptPath: string; words: number; speakers: number; durationSeconds: number }
        let settled = false
        return await new Promise<TranscribeFileResult>((resolve, reject) => {
          const run = this.options.dispatcherResolver.runWithWorkspaceAgent({
            agentTypeId: this.options.agentTypeId!,
            context: actor,
            requestId: `live-transcript-file:${randomUUID()}`,
            request,
          }, async (binding: LeaseBoundWorkspaceAgent) => {
            try {
              const value = await this.runTranscribeFile(binding.workspace, refiner, input)
              settled = true
              resolve(value)
            } catch (error) {
              settled = true
              reject(error)
            }
          })
          run.catch((error) => { if (!settled) reject(error) })
        })
      }
      if (!this.options.dispatcherResolver.resolveWithWorkspace) {
        throw new LiveTranscriptError("live_transcript_disabled", "Trusted Workspace resolver is unavailable.", 503)
      }
      const binding = await this.options.dispatcherResolver.resolveWithWorkspace(actor, { request })
      return await this.runTranscribeFile(binding.workspace, refiner, input)
    } finally {
      this.transcribeFileActive = false
    }
  }

  private async runTranscribeFile(
    workspace: Workspace,
    refiner: TranscriptRefiner,
    input: { path: string; title?: string; overwrite?: boolean },
  ): Promise<{ transcriptPath: string; words: number; speakers: number; durationSeconds: number }> {
    if (!workspace.writeFileWithStat) {
      throw new LiveTranscriptError("live_transcript_disabled", "Workspace guarded file operations are unavailable.", 503)
    }
    const relPath = validateWorkspaceAudioPath(input.path)
    if (!this.options.audioRecordingDirectory) {
      throw new LiveTranscriptError("live_transcript_disabled", "No local audio recording directory is configured for file transcription.", 503)
    }
    const absolutePath = await resolveRecordingAbsolutePath(this.options.audioRecordingDirectory, relPath)
    const transcriptRelPath = `${relPath.replace(/\.[^./\\]+$/, "")}.transcript.md`
    if (!input.overwrite) {
      const exists = await workspace.stat(transcriptRelPath).then(() => true, () => false)
      if (exists) {
        throw new LiveTranscriptError("live_transcript_revision_conflict", "A transcript already exists for this recording.", 409)
      }
    }
    const title = cleanTitle(input.title)
    const startedAt = new Date(this.now()).toISOString()
    const result = await refiner.refine({ audioAbsolutePath: absolutePath, title, startedAt })
    await workspace.writeFileWithStat(transcriptRelPath, result.markdown)
    return {
      transcriptPath: transcriptRelPath,
      words: result.words,
      speakers: result.speakers,
      durationSeconds: result.durationSeconds,
    }
  }

  private refineCompletedSession(session: LiveSession): Promise<void> {
    const refiner = this.options.refiner
    const recorder = session.audioRecorder
    const workspace = session.workspace
    if (!refiner || !recorder || !workspace.writeFileWithStat) return Promise.resolve()
    return (async () => {
      try {
        const result = await refiner.refine({
          audioAbsolutePath: recorder.outputPath,
          title: session.title,
          startedAt: session.startedAt,
        })
        await workspace.writeFileWithStat!(session.transcriptPath, result.markdown)
        if (session.reviewTarget) {
          try {
            await session.reviewTarget.sendIfIdle({
              requestId: `refine:${session.id}`,
              message: `Transcript refined with the offline pass: ${session.transcriptPath}`,
            })
          } catch {
            // Best-effort notification only; the refined transcript is already on disk.
          }
        }
      } catch (error) {
        this.options.onRefineError?.(error)
      }
    })()
  }

  private createUpstream(callbacks: {
    onSnapshot: (snapshot: WhisperLiveKitSnapshot) => void
    onFailure: (error: LiveTranscriptError) => void
  }): UpstreamConnection {
    if (this.options.upstreamProvider === "kyutai") {
      if (this.options.diarizerUrl) {
        return new KyutaiDiarizedConnection(this.options.upstreamUrl, this.options.diarizerUrl, callbacks, {
          kyutaiApiKey: this.options.upstreamBearerToken,
          diarizerBearerToken: this.options.diarizerBearerToken,
          highWaterBytes: LIVE_SOCKET_HIGH_WATER_BYTES,
        })
      }
      return new KyutaiConnection(this.options.upstreamUrl, callbacks, {
        apiKey: this.options.upstreamBearerToken,
        highWaterBytes: LIVE_SOCKET_HIGH_WATER_BYTES,
      })
    }
    return new WhisperLiveKitConnection(this.options.upstreamUrl, callbacks, {
      bearerToken: this.options.upstreamBearerToken,
      highWaterBytes: LIVE_SOCKET_HIGH_WATER_BYTES,
    })
  }

  private acceptSnapshot(session: LiveSession, snapshot: WhisperLiveKitSnapshot): void {
    if (session.phase !== "active" && session.phase !== "stopping") return
    session.upstreamMessages += 1
    if (session.upstreamMessages > (this.options.maxUpstreamMessages ?? 100_000)) {
      void this.terminate(session, "interrupted", "live_transcript_limit_exceeded")
      return
    }
    const sinkSnapshot = this.options.upstreamProvider === "kyutai"
      ? groupKyutaiTranscriptSnapshot(snapshot)
      : snapshot
    const lines = sinkSnapshot.lines.map((line) => {
      if (line.speaker < 0) return { startSeconds: line.startSeconds, speaker: 0, text: line.text }
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
      let audioStored = false
      if (session.audioRecorder) {
        try {
          await session.audioRecorder.finalize()
          audioStored = true
        } catch {
          finalState = "interrupted"
          finalOutcome = "live_transcript_upstream_failed"
          await session.audioRecorder.abort()
        }
      }
      if (finalState === "complete") await session.reviewBroker?.final()
      else session.reviewBroker?.interrupt()
      if (finalState === "complete" && audioStored) {
        session.refinePromise = this.refineCompletedSession(session)
      }
      session.upstream?.close()
      const result: LiveTranscriptTerminalResponse = {
        liveSessionId: session.id,
        transcriptPath: session.transcriptPath,
        ...(audioStored && session.audioPath ? { audioPath: session.audioPath } : {}),
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
    const release = () => {
      session.removeWorkspaceAbortListener?.()
      session.releaseWorkspaceLease?.()
    }
    session.terminalPromise
      .catch(() => undefined)
      .then(() => {
        void (session.refinePromise ?? Promise.resolve()).catch(() => undefined).then(release)
      })
    return session.terminalPromise
  }

  private document(
    session: LiveSession,
    state: "active" | "complete" | "interrupted",
    lines: ProjectedTranscriptLine[],
  ): TranscriptDocument {
    return {
      title: session.title,
      startedAt: session.startedAt,
      state,
      showSpeakerLabels: this.options.upstreamProvider !== "kyutai" || Boolean(this.options.diarizerUrl),
      lines,
    }
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

function createLeaseReviewTarget(
  binding: LeaseBoundWorkspaceAgent,
  sessionId: string,
): PiSessionVisibleUserTurnTarget {
  return {
    // Admission is atomic in dispatch; this advisory answer avoids a separate,
    // racy state read while preserving the broker's busy retry behavior.
    async isIdle() { return true },
    async sendIfIdle(input) {
      return await new Promise((resolve, reject) => {
        let accepted = false
        void binding.dispatch({
          sessionId,
          requestId: input.requestId,
          clientNonce: input.requestId,
          content: input.message,
          ...(input.displayMessage ? { displayMessage: input.displayMessage } : {}),
        }, async () => {}, ({ receipt }) => {
          accepted = true
          resolve({
            status: "accepted",
            cursor: receipt.cursor,
            ...(receipt.duplicate ? { duplicate: true } : {}),
          })
        }).catch((error) => {
          if (accepted) return
          const code = (error as { code?: unknown })?.code
          if (code === "AGENT_COMMAND_INVALID_STATE") return resolve({ status: "busy" })
          if (code === "AGENT_SESSION_NOT_FOUND" || code === "AGENT_SCOPE_DENIED") {
            return resolve({ status: "gone" })
          }
          reject(error)
        })
      })
    },
  }
}

const ALLOWED_AUDIO_EXTENSIONS = new Set(["m4a", "mp3", "wav", "webm", "ogg", "mp4", "aac", "flac"])
const RECORDING_FOLDER = "live-transcripts"
const RECORDING_NAME_PATTERN = /^[A-Za-z0-9._-]+$/

/**
 * File transcription only ever reads recordings that were themselves written into the
 * workspace's `live-transcripts/` folder (see createSession / LocalAudioRecorder), so this
 * validates the workspace-relative path down to a single, plain file name inside that folder.
 */
function validateWorkspaceAudioPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new LiveTranscriptError("live_transcript_attachment_invalid", "Recording path is required.", 400)
  }
  const path = raw.trim()
  const segments = path.split(/[/\\]/)
  if (segments.length !== 2 || segments[0] !== RECORDING_FOLDER) {
    throw new LiveTranscriptError(
      "live_transcript_attachment_invalid",
      `Recording path must be a file directly under ${RECORDING_FOLDER}/.`,
      400,
    )
  }
  const name = segments[1]
  if (!name || name === ".." || !RECORDING_NAME_PATTERN.test(name)) {
    throw new LiveTranscriptError("live_transcript_attachment_invalid", "Recording file name is invalid.", 400)
  }
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  if (!ALLOWED_AUDIO_EXTENSIONS.has(extension)) {
    throw new LiveTranscriptError("live_transcript_attachment_invalid", "Recording file extension is unsupported.", 400)
  }
  return `${RECORDING_FOLDER}/${name}`
}

/**
 * Resolves a validated `live-transcripts/<name>` path to its real host path inside the plugin's
 * own `audioRecordingDirectory` (an absolute host directory — never the sandbox-canonical
 * `workspace.root`, which does not exist in the host Node process running this plugin).
 */
async function resolveRecordingAbsolutePath(audioRecordingDirectory: string, relPath: string): Promise<string> {
  const name = relPath.slice(`${RECORDING_FOLDER}/`.length)
  const candidate = joinPath(audioRecordingDirectory, name)
  let real: string
  let realDirectory: string
  try {
    ;[real, realDirectory] = await Promise.all([realpath(candidate), realpath(audioRecordingDirectory)])
  } catch {
    throw new LiveTranscriptError("live_transcript_attachment_invalid", "Recording file was not found or is inaccessible.", 400)
  }
  if (real !== realDirectory && !real.startsWith(`${realDirectory}/`)) {
    throw new LiveTranscriptError("live_transcript_attachment_invalid", "Recording path escaped the recordings directory.", 400)
  }
  const stats = await fsStat(real).catch(() => undefined)
  if (!stats || !stats.isFile()) {
    throw new LiveTranscriptError("live_transcript_attachment_invalid", "Recording path is not a regular file.", 400)
  }
  return real
}

function cleanTitle(value: string | undefined): string {
  return (value?.trim() || "Live transcript")
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .slice(0, 120)
}

async function readReviewInstructions(workspace: Workspace): Promise<string | undefined> {
  try {
    if (!workspace.readBinaryFile) return undefined
    const bytes = await workspace.readBinaryFile(REVIEW_INSTRUCTIONS_PATH)
    if (bytes.byteLength > MAX_REVIEW_INSTRUCTIONS_BYTES) return undefined
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim()
    return text || undefined
  } catch {
    return undefined
  }
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
