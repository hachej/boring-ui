// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LiveTranscriptBrowserController } from "../controller"
import { liveTranscriptBrowserState } from "../state"

vi.mock("@hachej/boring-workspace", () => ({ postUiCommand: vi.fn() }))

describe("LiveTranscriptBrowserController live attachment", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    liveTranscriptBrowserState.set({})
  })

  it("leaves starting state when composer stream creation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: { code: "live_transcript_upstream_failed", message: "offline" } }),
    } as Response)))
    const controller = new LiveTranscriptBrowserController()

    await expect(controller.startComposer(vi.fn())).rejects.toThrow("offline")
    expect(liveTranscriptBrowserState.getSnapshot()).toMatchObject({
      recordingKind: "composer",
      phase: "error",
    })
  })

  it("cannot reacquire the microphone after stop wins during attachment", async () => {
    let resolveStream!: (stream: MediaStream) => void
    const streamPromise = new Promise<MediaStream>((resolve) => { resolveStream = resolve })
    const stopTrack = vi.fn()
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(() => streamPromise) } })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const payload = url.endsWith("/compute/prepare")
        ? { preparationId: "disabled", state: "ready" }
        : url.endsWith("/stop")
          ? { liveSessionId: "live-1", transcriptPath: "live-transcripts/a.md", state: "complete" }
          : {
              liveSessionId: "live-1",
              transcriptPath: "live-transcripts/a.md",
              socketNonce: "nonce",
              reviewIntervalMs: 60_000,
              state: "setup",
            }
      return { ok: true, json: async () => payload } as Response
    }))

    const controller = new LiveTranscriptBrowserController()
    const starting = controller.start("chat-1")
    await vi.waitFor(() => expect(liveTranscriptBrowserState.getSnapshot().phase).toBe("starting"))
    const stopping = controller.stop()
    resolveStream(stream)

    await expect(stopping).resolves.toContain("stopped during GPU preparation")
    await expect(starting).resolves.toContain("stopped during GPU preparation")
    expect(stopTrack).not.toHaveBeenCalled()
    expect(liveTranscriptBrowserState.getSnapshot().phase).not.toBe("recording")
  })
})
