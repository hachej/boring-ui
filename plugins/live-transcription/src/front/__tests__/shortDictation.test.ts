import { afterEach, describe, expect, it, vi } from "vitest"
import { SHORT_DICTATION_MAX_BYTES } from "../../shared"
import { LiveTranscriptBrowserController } from "../controller"
import { liveTranscriptBrowserState } from "../state"

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = () => true
  static emitData = true
  static last: FakeMediaRecorder | undefined
  static nextData = new Blob(["audio"], { type: "audio/webm" })
  static throwOnStart = false
  readonly mimeType: string
  state: RecordingState = "inactive"
  ondataavailable: ((event: BlobEvent) => void) | null = null

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super()
    this.mimeType = options?.mimeType ?? "audio/webm"
    FakeMediaRecorder.last = this
  }

  start(): void {
    if (FakeMediaRecorder.throwOnStart) throw new Error("start failed")
    this.state = "recording"
  }
  stop(): void {
    this.state = "inactive"
    if (FakeMediaRecorder.emitData) {
      const data = new Event("dataavailable") as BlobEvent
      Object.defineProperty(data, "data", { value: FakeMediaRecorder.nextData })
      this.ondataavailable?.(data)
    }
    this.dispatchEvent(new Event("stop"))
  }
}

afterEach(() => {
  FakeMediaRecorder.emitData = true
  FakeMediaRecorder.last = undefined
  FakeMediaRecorder.nextData = new Blob(["audio"], { type: "audio/webm" })
  FakeMediaRecorder.throwOnStart = false
  vi.unstubAllGlobals()
  liveTranscriptBrowserState.set({})
})

describe("short composer dictation", () => {
  it("records in memory, exposes recording state, and returns text for draft insertion", async () => {
    const stop = vi.fn()
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ text: "bonjour" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })))
    const controller = new LiveTranscriptBrowserController()

    await controller.startShort()
    expect(controller.getRecordingSnapshot()).toMatchObject({ recordingKind: "short", phase: "recording" })
    await expect(controller.stopShort()).resolves.toBe("bonjour")
    expect(stop).toHaveBeenCalledOnce()
    expect(controller.getRecordingSnapshot()).toMatchObject({ phase: "idle" })
  })

  it("releases the microphone when recorder startup fails", async () => {
    FakeMediaRecorder.throwOnStart = true
    const stop = vi.fn()
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
    const controller = new LiveTranscriptBrowserController()

    await expect(controller.startShort()).rejects.toThrow("start failed")
    expect(stop).toHaveBeenCalledOnce()
    expect(controller.getRecordingSnapshot()).toMatchObject({ recordingKind: "short", phase: "error" })
    await expect(controller.stopShort()).resolves.toBeUndefined()
  })

  it("stops capture before retaining audio beyond the browser memory bound", async () => {
    const stop = vi.fn()
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const controller = new LiveTranscriptBrowserController()

    await controller.startShort()
    const data = new Event("dataavailable") as BlobEvent
    Object.defineProperty(data, "data", {
      value: new Blob([new Uint8Array(SHORT_DICTATION_MAX_BYTES + 1)], { type: "audio/webm" }),
    })
    FakeMediaRecorder.last!.ondataavailable?.(data)

    expect(stop).toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(controller.getRecordingSnapshot()).toMatchObject({
      recordingKind: "short",
      phase: "error",
      error: "Short dictation exceeded the in-memory V0 limit.",
    })
    await expect(controller.stopShort()).resolves.toBeUndefined()
  })

  it("does not restore an actionable recording state owned by another page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      active: true,
      liveSessionId: "stale-live",
      transcriptPath: "live-transcripts/stale.md",
      state: "active",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })))
    liveTranscriptBrowserState.set({
      liveSessionId: "stale-live",
      transcriptPath: "live-transcripts/stale.md",
      recordingKind: "live",
      phase: "recording",
    })
    const controller = new LiveTranscriptBrowserController()

    await expect(controller.status()).resolves.toBe("A live transcript from another page is stopping.")
    expect(controller.getRecordingSnapshot()).toEqual({})
    await expect(controller.stop()).resolves.toContain("live_transcript_not_active")
  })

  it("cancels an immediate empty stop without uploading", async () => {
    FakeMediaRecorder.emitData = false
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) } })
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const controller = new LiveTranscriptBrowserController()

    await controller.startShort()
    await expect(controller.stopShort()).resolves.toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
    expect(controller.getRecordingSnapshot()).toMatchObject({ phase: "idle" })
  })
})
