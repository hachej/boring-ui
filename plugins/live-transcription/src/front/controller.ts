import type { SlashCommand } from "@hachej/boring-agent/front"
import { postUiCommand } from "@hachej/boring-workspace"
import {
  LIVE_PCM_FRAME_BYTES,
  LIVE_SOCKET_HIGH_WATER_BYTES,
  LIVE_TRANSCRIPT_BASE_PATH,
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
  private mounted = 0

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
        description: "Review the active transcript (available in Slice 3)",
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

  async start(sessionId: string, title?: string): Promise<string> {
    if (this.active) return "live_transcript_already_active: A live transcript is already active."
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
    })
    postUiCommand({
      kind: "openSurface",
      params: { kind: "workspace.open.path", target: started.transcriptPath },
    })

    try {
      await this.attach(started)
      liveTranscriptBrowserState.set({
        liveSessionId: started.liveSessionId,
        transcriptPath: started.transcriptPath,
        state: "active",
      })
      return `Live transcript started: ${started.transcriptPath}`
    } catch (error) {
      const permissionDenied = error instanceof DOMException && error.name === "NotAllowedError"
      try {
        await postJson(`${LIVE_TRANSCRIPT_BASE_PATH}/${encodeURIComponent(started.liveSessionId)}/interrupt`, {
          reason: permissionDenied ? "permission_denied" : "attachment_failed",
        })
      } catch {}
      await this.cleanup(started.liveSessionId)
      return permissionDenied
        ? "live_transcript_permission_denied: Microphone permission was denied."
        : formatError(error, "live_transcript_attachment_failed: Microphone attachment failed.")
    }
  }

  async stop(): Promise<string> {
    const active = this.active
    if (!active) return "live_transcript_not_active: No live transcript is active."
    this.stopping = true
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
        liveTranscriptBrowserState.set({
          liveSessionId: status.liveSessionId,
          transcriptPath: status.transcriptPath,
          state: status.state,
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
      const result = await postJson<{ message: string }>(
        `${LIVE_TRANSCRIPT_BASE_PATH}/${encodeURIComponent(active.liveSessionId)}/review`,
        {},
      )
      return result.message
    } catch (error) {
      return formatError(error)
    }
  }

  async dispose(): Promise<void> {
    const active = this.active
    await this.stopInput()
    try { this.socket?.close() } catch {}
    this.socket = undefined
    this.active = undefined
    if (active) liveTranscriptBrowserState.clear(active.liveSessionId)
  }

  private async runLiveCommand(args: string, sessionId: string): Promise<string> {
    const trimmed = args.trim()
    const separator = trimmed.indexOf(" ")
    const subcommand = separator < 0 ? trimmed : trimmed.slice(0, separator)
    const remainder = separator < 0 ? "" : trimmed.slice(separator + 1).trim()
    if (subcommand === "start") return await this.start(sessionId, remainder || undefined)
    if (subcommand === "stop" && !remainder) return await this.stop()
    if (subcommand === "status" && !remainder) return await this.status()
    return "Usage: /live start [optional title] | /live stop | /live status"
  }

  private async attach(started: LiveTranscriptStartResponse): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true },
      video: false,
    })
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      const socket = new WebSocket(`${protocol}//${window.location.host}${LIVE_TRANSCRIPT_BASE_PATH}/${encodeURIComponent(started.liveSessionId)}/audio`)
    socket.binaryType = "arraybuffer"
    this.socket = socket
    await waitForSocketOpen(socket)

    let resolveNonceAck: (() => void) | undefined
    let rejectNonceAck: ((error: Error) => void) | undefined
    const nonceAck = new Promise<void>((resolve, reject) => {
      resolveNonceAck = resolve
      rejectNonceAck = reject
    })
    let noncePending = true
    socket.onmessage = (event) => {
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
    socket.onerror = () => rejectNonceAck?.(new Error("Live transcript socket failed."))
    socket.onclose = () => {
      rejectNonceAck?.(new Error("Live transcript socket closed."))
      if (!this.stopping) void this.cleanup(started.liveSessionId)
    }
    socket.send(new TextEncoder().encode(started.socketNonce))
    await nonceAck

    const Context = window.AudioContext
    const context = new Context()
    const workletUrl = createLiveTranscriptWorkletUrl()
    await context.audioWorklet.addModule(workletUrl)
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
    } catch (error) {
      if (this.capture?.stream !== stream) {
        for (const track of stream.getTracks()) track.stop()
      }
      throw error
    }
  }

  private async failCapture(_message: string): Promise<void> {
    try { this.socket?.close() } catch {}
    await this.stopInput()
    const active = this.active
    if (active) liveTranscriptBrowserState.clear(active.liveSessionId)
    this.active = undefined
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

  private async cleanup(id?: string): Promise<void> {
    await this.stopInput()
    try { this.socket?.close() } catch {}
    this.socket = undefined
    if (!id || this.active?.liveSessionId === id) this.active = undefined
    liveTranscriptBrowserState.clear(id)
  }
}

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

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true })
    socket.addEventListener("error", () => reject(new Error("Live transcript socket failed to open.")), { once: true })
    socket.addEventListener("close", () => reject(new Error("Live transcript socket closed before attachment.")), { once: true })
  })
}

export const liveTranscriptController = new LiveTranscriptBrowserController()
export const liveTranscriptCommands = liveTranscriptController.commands()
