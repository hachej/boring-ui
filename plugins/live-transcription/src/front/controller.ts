import type { SlashCommand } from "@hachej/boring-agent/front"
import { postUiCommand } from "@hachej/boring-workspace"
import {
  LIVE_PCM_FRAME_BYTES,
  LIVE_SOCKET_HIGH_WATER_BYTES,
  LIVE_TRANSCRIPT_BASE_PATH,
  SHORT_DICTATION_MAX_BYTES,
  type LiveTranscriptStartResponse,
  type LiveTranscriptStatusResponse,
  type LiveTranscriptTerminalResponse,
} from "../shared"
import { liveTranscriptBrowserState } from "./state"
import { createLiveTranscriptWorkletUrl, LIVE_TRANSCRIPT_WORKLET_NAME } from "./worklet"

interface BrowserCapture {
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  worklet: AudioWorkletNode
  workletUrl: string
}

export class LiveTranscriptBrowserController {
  private active: LiveTranscriptStartResponse | undefined
  private socket: WebSocket | undefined
  private capture: BrowserCapture | undefined
  private stopping = false
  private attachGeneration = 0
  private mounted = 0
  private shortRecorder: MediaRecorder | undefined
  private shortStream: MediaStream | undefined
  private shortChunks: Blob[] = []
  private shortBytes = 0
  private shortLimitReached = false
  private composerStreamId: string | undefined

  commands(): SlashCommand[] {
    return [
      {
        name: "live",
        description: "Start, stop, or inspect the local live transcript",
        kind: "local",
        source: "local",
        allowWhileBusy: (args) => args.trim() === "stop" || args.trim() === "status",
        handler: async (args, context) => this.runLiveCommand(args, context.sessionId),
      },
      {
        name: "review",
        description: "Review the active transcript now",
        kind: "local",
        source: "local",
        allowWhileBusy: (args) => args.trim() === "transcript",
        handler: async (args) => args.trim() === "transcript"
          ? await this.review()
          : "Usage: /review transcript",
      },
    ]
  }

  mount(): () => void {
    this.mounted += 1
    const onPageHide = () => { void this.dispose() }
    window.addEventListener("pagehide", onPageHide)
    void this.status().catch(() => undefined)
    return () => {
      window.removeEventListener("pagehide", onPageHide)
      this.mounted -= 1
      if (this.mounted === 0) void this.dispose()
    }
  }

  getRecordingSnapshot = () => liveTranscriptBrowserState.getSnapshot()
  subscribeRecording = (listener: () => void) => liveTranscriptBrowserState.subscribe(listener)

  async startShort(): Promise<void> {
    const phase = liveTranscriptBrowserState.getSnapshot().phase
    if (this.active || this.composerStreamId || this.shortRecorder || phase === "starting" || phase === "transcribing") {
      throw new Error("Another microphone recording is already active.")
    }
    liveTranscriptBrowserState.set({ recordingKind: "short", phase: "starting" })
    let stream: MediaStream | undefined
    try {
      const capturedStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      stream = capturedStream
      const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate))
      const recorder = new MediaRecorder(capturedStream, mimeType ? { mimeType } : undefined)
      this.shortStream = capturedStream
      this.shortRecorder = recorder
      this.shortChunks = []
      this.shortBytes = 0
      this.shortLimitReached = false
      recorder.ondataavailable = (event) => {
        if (event.data.size <= 0) return
        if (this.shortBytes + event.data.size > SHORT_DICTATION_MAX_BYTES) {
          this.shortLimitReached = true
          this.shortChunks = []
          this.shortBytes = 0
          for (const track of capturedStream.getTracks()) track.stop()
          if (recorder.state !== "inactive") recorder.stop()
          this.shortRecorder = undefined
          this.shortStream = undefined
          liveTranscriptBrowserState.set({
            recordingKind: "short",
            phase: "error",
            error: "Short dictation exceeded the in-memory V0 limit.",
          })
          return
        }
        this.shortChunks.push(event.data)
        this.shortBytes += event.data.size
      }
      recorder.start(250)
      liveTranscriptBrowserState.set({ recordingKind: "short", phase: "recording", startedAt: Date.now() })
    } catch (error) {
      if (this.shortRecorder && this.shortRecorder.state !== "inactive") this.shortRecorder.stop()
      for (const track of stream?.getTracks() ?? []) track.stop()
      this.shortRecorder = undefined
      this.shortStream = undefined
      this.shortChunks = []
      this.shortBytes = 0
      this.shortLimitReached = false
      liveTranscriptBrowserState.set({ recordingKind: "short", phase: "error", error: formatError(error, "Microphone start failed.") })
      throw error
    }
  }

  async stopShort(): Promise<string | undefined> {
    const recorder = this.shortRecorder
    if (!recorder) return undefined
    const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }))
    recorder.stop()
    await stopped
    for (const track of this.shortStream?.getTracks() ?? []) track.stop()
    this.shortRecorder = undefined
    this.shortStream = undefined
    if (this.shortLimitReached) {
      this.shortChunks = []
      this.shortBytes = 0
      throw new Error("Short dictation exceeded the in-memory V0 limit.")
    }
    const blob = new Blob(this.shortChunks, { type: recorder.mimeType || "audio/webm" })
    this.shortChunks = []
    this.shortBytes = 0
    if (blob.size === 0) {
      liveTranscriptBrowserState.set({ phase: "idle" })
      return undefined
    }
    liveTranscriptBrowserState.set({ recordingKind: "short", phase: "transcribing", startedAt: Date.now() })
    try {
      const result = await postJson<{ text: string }>(`${LIVE_TRANSCRIPT_BASE_PATH}/dictate`, {
        mimeType: blob.type,
        audioBase64: arrayBufferToBase64(await blob.arrayBuffer()),
      })
      liveTranscriptBrowserState.set({ phase: "idle" })
      return result.text.trim() || undefined
    } catch (error) {
      liveTranscriptBrowserState.set({ recordingKind: "short", phase: "error", error: formatError(error) })
      throw error
    }
  }

  async startComposer(onWord: (word: string) => void): Promise<void> {
    if (this.active || this.composerStreamId || this.shortRecorder || this.capture) throw new Error("Another microphone recording is already active.")
    liveTranscriptBrowserState.set({ recordingKind: "composer", phase: "starting" })
    try {
      const started = await postJson<{ composerStreamId: string; socketNonce: string }>(`${LIVE_TRANSCRIPT_BASE_PATH}/composer`, {})
      this.composerStreamId = started.composerStreamId
      const generation = ++this.attachGeneration
      await this.attachStream({
        socketNonce: started.socketNonce,
        socketPath: `${LIVE_TRANSCRIPT_BASE_PATH}/composer/${encodeURIComponent(started.composerStreamId)}/audio`,
        generation,
        isCurrent: () => this.composerStreamId === started.composerStreamId,
        onWord,
      })
      liveTranscriptBrowserState.set({ recordingKind: "composer", phase: "recording", startedAt: Date.now() })
    } catch (error) {
      const id = this.composerStreamId
      if (id) {
        try { await postJson(`${LIVE_TRANSCRIPT_BASE_PATH}/composer/${encodeURIComponent(id)}/stop`, {}) } catch {}
      }
      await this.cleanupComposer()
      liveTranscriptBrowserState.set({ recordingKind: "composer", phase: "error", error: formatError(error, "Streaming dictation failed to start.") })
      throw error
    }
  }

  async stopComposer(): Promise<void> {
    const id = this.composerStreamId
    if (!id) return
    this.stopping = true
    this.attachGeneration += 1
    await this.stopInput()
    try {
      await postJson(`${LIVE_TRANSCRIPT_BASE_PATH}/composer/${encodeURIComponent(id)}/stop`, {})
      liveTranscriptBrowserState.set({ phase: "idle" })
    } catch (error) {
      liveTranscriptBrowserState.set({ recordingKind: "composer", phase: "error", error: formatError(error, "Streaming dictation did not finalize.") })
      throw error
    } finally {
      await this.cleanupComposer()
      this.stopping = false
    }
  }

  async stopLiveRecording(): Promise<void> {
    await this.stop()
  }

  async start(sessionId: string, title?: string): Promise<string> {
    const phase = liveTranscriptBrowserState.getSnapshot().phase
    if (this.active || this.composerStreamId || this.shortRecorder || phase === "starting" || phase === "transcribing") {
      return "live_transcript_already_active: A microphone recording is already active."
    }
    let started: LiveTranscriptStartResponse
    try {
      started = await postJson<LiveTranscriptStartResponse>(LIVE_TRANSCRIPT_BASE_PATH, {
        sessionId,
        ...(title?.trim() ? { title: title.trim() } : {}),
      })
    } catch (error) {
      return formatError(error)
    }
    this.active = started
    liveTranscriptBrowserState.set({
      liveSessionId: started.liveSessionId,
      transcriptPath: started.transcriptPath,
      state: "setup",
      recordingKind: "live",
      phase: "starting",
      startedAt: Date.now(),
      reviewIntervalMs: started.reviewIntervalMs,
    })
    postUiCommand({
      kind: "openSurface",
      params: { kind: "workspace.open.path", target: started.transcriptPath },
    })

    const attachGeneration = ++this.attachGeneration
    try {
      await this.attachLive(started, attachGeneration)
      liveTranscriptBrowserState.set({
        liveSessionId: started.liveSessionId,
        transcriptPath: started.transcriptPath,
        state: "active",
        recordingKind: "live",
        phase: "recording",
        startedAt: Date.now(),
        reviewIntervalMs: started.reviewIntervalMs,
      })
      return `Live transcript started: ${started.transcriptPath}`
    } catch (error) {
      if (error instanceof LiveAttachCancelledError) return "Live transcript stopped before microphone attachment completed."
      const permissionDenied = error instanceof DOMException && error.name === "NotAllowedError"
      try {
        await postJson(`${LIVE_TRANSCRIPT_BASE_PATH}/${encodeURIComponent(started.liveSessionId)}/interrupt`, {
          reason: permissionDenied ? "permission_denied" : "attachment_failed",
        })
      } catch {}
      await this.cleanup(started.liveSessionId)
      const message = permissionDenied
        ? "Microphone permission was denied."
        : formatError(error, "Microphone attachment failed.")
      liveTranscriptBrowserState.set({ recordingKind: "live", phase: "error", state: "interrupted", error: message })
      return permissionDenied
        ? `live_transcript_permission_denied: ${message}`
        : `live_transcript_attachment_failed: ${message}`
    }
  }

  async stop(): Promise<string> {
    const active = this.active
    if (!active) return "live_transcript_not_active: No live transcript is active."
    this.stopping = true
    this.attachGeneration += 1
    await this.stopInput()
    try {
      const result = await postJson<LiveTranscriptTerminalResponse>(
        `${LIVE_TRANSCRIPT_BASE_PATH}/${encodeURIComponent(active.liveSessionId)}/stop`,
        {},
      )
      await this.cleanup(active.liveSessionId)
      return `Live transcript complete: ${result.transcriptPath}`
    } catch (error) {
      await this.cleanup(active.liveSessionId)
      return formatError(error)
    } finally {
      this.stopping = false
    }
  }

  async status(): Promise<string> {
    try {
      const status = await postJson<LiveTranscriptStatusResponse>(`${LIVE_TRANSCRIPT_BASE_PATH}/status`, this.active
        ? { liveSessionId: this.active.liveSessionId }
        : {})
      if (status.active && status.liveSessionId && status.transcriptPath) {
        if (!this.active) {
          liveTranscriptBrowserState.clear()
          return "A live transcript from another page is stopping."
        }
        liveTranscriptBrowserState.set({
          liveSessionId: status.liveSessionId,
          transcriptPath: status.transcriptPath,
          state: status.state,
          recordingKind: "live",
          phase: status.state === "setup" ? "starting" : "recording",
          startedAt: liveTranscriptBrowserState.getSnapshot().startedAt ?? Date.now(),
          reviewIntervalMs: liveTranscriptBrowserState.getSnapshot().reviewIntervalMs,
        })
        return `Live transcript ${status.state ?? "active"}: ${status.transcriptPath}`
      }
      await this.cleanup(status.liveSessionId)
      return "No live transcript is active."
    } catch (error) {
      return formatError(error)
    }
  }

  async review(): Promise<string> {
    const active = this.active
    if (!active) return "live_transcript_not_active: No live transcript is active."
    try {
      const result = await postJson<{ status: "dispatched" | "pending" }>(
        `${LIVE_TRANSCRIPT_BASE_PATH}/${encodeURIComponent(active.liveSessionId)}/review`,
        {},
      )
      return result.status === "dispatched"
        ? "Transcript review dispatched in the originating chat."
        : "Transcript review queued until the originating chat is idle."
    } catch (error) {
      return formatError(error)
    }
  }

  async dispose(): Promise<void> {
    const active = this.active
    if (this.shortRecorder && this.shortRecorder.state !== "inactive") this.shortRecorder.stop()
    for (const track of this.shortStream?.getTracks() ?? []) track.stop()
    this.shortRecorder = undefined
    this.shortStream = undefined
    this.shortChunks = []
    this.shortBytes = 0
    this.shortLimitReached = false
    this.composerStreamId = undefined
    this.attachGeneration += 1
    await this.stopInput()
    const socket = this.socket
    this.socket = undefined
    try { socket?.close() } catch {}
    this.active = undefined
    if (active) liveTranscriptBrowserState.clear(active.liveSessionId)
  }

  private async runLiveCommand(args: string, sessionId: string): Promise<string | undefined> {
    const trimmed = args.trim()
    const separator = trimmed.indexOf(" ")
    const subcommand = separator < 0 ? trimmed : trimmed.slice(0, separator)
    const remainder = separator < 0 ? "" : trimmed.slice(separator + 1).trim()
    if (subcommand === "start") {
      const result = await this.start(sessionId, remainder || undefined)
      return result.startsWith("Live transcript started:") || result.startsWith("Live transcript stopped before")
        ? undefined
        : result
    }
    if (subcommand === "stop" && !remainder) {
      const result = await this.stop()
      return result.startsWith("Live transcript complete:") ? undefined : result
    }
    if (subcommand === "status" && !remainder) return await this.status()
    return "Usage: /live start [optional title] | /live stop | /live status"
  }

  private async attachLive(started: LiveTranscriptStartResponse, generation: number): Promise<void> {
    await this.attachStream({
      socketNonce: started.socketNonce,
      socketPath: `${LIVE_TRANSCRIPT_BASE_PATH}/${encodeURIComponent(started.liveSessionId)}/audio`,
      generation,
      isCurrent: () => this.active?.liveSessionId === started.liveSessionId,
    })
  }

  private async attachStream(input: {
    socketNonce: string
    socketPath: string
    generation: number
    isCurrent: () => boolean
    onWord?: (word: string) => void
  }): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true },
      video: false,
    })
    try {
      this.assertAttachCurrent(input)
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const socket = new WebSocket(`${protocol}//${window.location.host}${input.socketPath}`)
    socket.binaryType = "arraybuffer"
    this.socket = socket
    await waitForSocketOpen(socket)
    this.assertAttachCurrent(input)

    let resolveNonceAck: (() => void) | undefined
    let rejectNonceAck: ((error: Error) => void) | undefined
    const nonceAck = new Promise<void>((resolve, reject) => {
      resolveNonceAck = resolve
      rejectNonceAck = reject
    })
    let noncePending = true
    socket.onmessage = (event) => {
      if (typeof event.data === "string" && input.onWord) {
        try {
          const message = JSON.parse(event.data) as { type?: unknown; text?: unknown; code?: unknown }
          if (message.type === "word" && typeof message.text === "string") return input.onWord(message.text)
          if (message.type === "error") return void this.failCapture(`Streaming dictation failed: ${String(message.code ?? "upstream")}.`)
        } catch {}
        return void this.failCapture("Streaming dictation socket returned an invalid event.")
      }
      const bytes = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : undefined
      if (!bytes || bytes.byteLength !== 1 || bytes[0] !== 1) {
        void this.failCapture("Live transcript socket returned an invalid ACK.")
        return
      }
      if (noncePending) {
        noncePending = false
        resolveNonceAck?.()
      } else {
        this.capture?.worklet.port.postMessage({ type: "ack" })
      }
    }
    socket.onerror = () => {
      rejectNonceAck?.(new Error("Live transcript socket failed."))
      if (this.socket === socket && !this.stopping && !noncePending) void this.failCapture("Live transcript connection failed.")
    }
    socket.onclose = () => {
      rejectNonceAck?.(new Error("Live transcript socket closed."))
      if (this.socket === socket && !this.stopping) void this.failCapture("Live transcript connection closed unexpectedly.")
    }
    socket.send(new TextEncoder().encode(input.socketNonce))
    await nonceAck
    this.assertAttachCurrent(input)

    const Context = window.AudioContext
    const context = new Context()
    const workletUrl = createLiveTranscriptWorkletUrl()
    await context.audioWorklet.addModule(workletUrl)
    this.assertAttachCurrent(input)
    const worklet = new AudioWorkletNode(context, LIVE_TRANSCRIPT_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    const source = context.createMediaStreamSource(stream)
    this.capture = { stream, context, source, worklet, workletUrl }
    worklet.port.onmessage = (event) => {
      if (event.data?.type === "overflow") {
        void this.failCapture("Live transcript worklet backpressure limit was exceeded.")
        return
      }
      if (event.data?.type !== "frame" || !(event.data.data instanceof ArrayBuffer) || event.data.data.byteLength !== LIVE_PCM_FRAME_BYTES) {
        void this.failCapture("Live transcript worklet emitted invalid audio.")
        return
      }
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > LIVE_SOCKET_HIGH_WATER_BYTES) {
        void this.failCapture("Live transcript browser socket backpressure limit was exceeded.")
        return
      }
      socket.send(event.data.data)
    }
    source.connect(worklet)
      worklet.connect(context.destination)
      await context.resume()
      this.assertAttachCurrent(input)
    } catch (error) {
      if (this.capture?.stream === stream) await this.stopInput()
      else for (const track of stream.getTracks()) track.stop()
      throw error
    }
  }

  private assertAttachCurrent(input: { generation: number; isCurrent: () => boolean }): void {
    if (input.generation !== this.attachGeneration || !input.isCurrent() || this.stopping) throw new LiveAttachCancelledError()
  }

  private async failCapture(message: string): Promise<void> {
    const socket = this.socket
    this.socket = undefined
    try { socket?.close() } catch {}
    await this.stopInput()
    const recordingKind = this.composerStreamId ? "composer" : "live"
    this.active = undefined
    this.composerStreamId = undefined
    liveTranscriptBrowserState.set({ recordingKind, phase: "error", state: "interrupted", error: message })
  }

  private async stopInput(): Promise<void> {
    const capture = this.capture
    this.capture = undefined
    if (!capture) return
    try { capture.source.disconnect() } catch {}
    try { capture.worklet.disconnect() } catch {}
    for (const track of capture.stream.getTracks()) track.stop()
    try { await capture.context.close() } catch {}
    URL.revokeObjectURL(capture.workletUrl)
  }

  private async cleanupComposer(): Promise<void> {
    await this.stopInput()
    const socket = this.socket
    this.socket = undefined
    try { socket?.close() } catch {}
    this.composerStreamId = undefined
  }

  private async cleanup(id?: string): Promise<void> {
    await this.stopInput()
    const socket = this.socket
    this.socket = undefined
    try { socket?.close() } catch {}
    if (!id || this.active?.liveSessionId === id) this.active = undefined
    liveTranscriptBrowserState.clear(id)
  }
}

class LiveAttachCancelledError extends Error {}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
  if (!response.ok) {
    const code = payload.error?.code ?? `HTTP_${response.status}`
    throw new Error(`${code}: ${payload.error?.message ?? "Live transcript request failed."}`)
  }
  return payload as T
}

function formatError(error: unknown, fallback = "Live transcript request failed."): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true })
    socket.addEventListener("error", () => reject(new Error("Live transcript socket failed to open.")), { once: true })
    socket.addEventListener("close", () => reject(new Error("Live transcript socket closed before attachment.")), { once: true })
  })
}

export const liveTranscriptController = new LiveTranscriptBrowserController()
export const liveTranscriptCommands = liveTranscriptController.commands()
