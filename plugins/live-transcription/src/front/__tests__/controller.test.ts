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

  it("leaves composer idle when stop cancels GPU preparation", async () => {
    let resolvePreparation!: (response: Response) => void
    const preparation = new Promise<Response>((resolve) => { resolvePreparation = resolve })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/compute/prepare")
      ? await preparation
      : ({ ok: true, json: async () => ({ cancelled: true }) } as Response)))
    const controller = new LiveTranscriptBrowserController()
    const starting = controller.startComposer(vi.fn())
    await vi.waitFor(() => expect(liveTranscriptBrowserState.getSnapshot().phase).toBe("starting"))
    await controller.stopComposer()
    resolvePreparation({ ok: true, json: async () => ({ preparationId: "prep-1", state: "ready" }) } as Response)
    await expect(starting).resolves.toBeUndefined()
    expect(liveTranscriptBrowserState.getSnapshot().phase).toBe("idle")
  })

  it("interrupts a live session when stop wins during the start request", async () => {
    let resolveStart!: (response: Response) => void
    const startResponse = new Promise<Response>((resolve) => { resolveStart = resolve })
    const stopTrack = vi.fn()
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream)) } })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/compute/prepare")) return { ok: true, json: async () => ({ preparationId: "prep-1", state: "ready" }) } as Response
      if (url.endsWith("/compute/cancel")) return { ok: true, json: async () => ({ cancelled: true }) } as Response
      if (url.endsWith("/interrupt")) return { ok: true, json: async () => ({ state: "interrupted" }) } as Response
      return await startResponse
    })
    vi.stubGlobal("fetch", fetchMock)
    const controller = new LiveTranscriptBrowserController()
    const starting = controller.start("chat-1")
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await expect(controller.stop()).resolves.toContain("stopped during GPU preparation")
    resolveStart({ ok: true, json: async () => ({ liveSessionId: "live-1", transcriptPath: "live-transcripts/a.md", socketNonce: "nonce", reviewIntervalMs: 60_000, state: "setup" }) } as Response)
    await expect(starting).resolves.toContain("stopped before microphone attachment")
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/interrupt"))).toBe(true)
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(liveTranscriptBrowserState.getSnapshot().phase).toBe("idle")
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
