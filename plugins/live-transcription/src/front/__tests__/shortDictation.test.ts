import { afterEach, describe, expect, it, vi } from "vitest"
import { LiveTranscriptBrowserController } from "../controller"
import { liveTranscriptBrowserState } from "../state"

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported = () => true
  static emitData = true
  readonly mimeType: string
  state: RecordingState = "inactive"
  ondataavailable: ((event: BlobEvent) => void) | null = null

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super()
    this.mimeType = options?.mimeType ?? "audio/webm"
  }

  start(): void { this.state = "recording" }
  stop(): void {
    this.state = "inactive"
    if (FakeMediaRecorder.emitData) {
      const data = new Event("dataavailable") as BlobEvent
      Object.defineProperty(data, "data", { value: new Blob(["audio"], { type: this.mimeType }) })
      this.ondataavailable?.(data)
    }
    this.dispatchEvent(new Event("stop"))
  }
}

afterEach(() => {
  FakeMediaRecorder.emitData = true
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
