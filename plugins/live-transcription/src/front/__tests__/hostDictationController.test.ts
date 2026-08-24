// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { liveTranscriptBrowserState } from "../state"
import { liveTranscriptController } from "../controller"
// Importing the controller module pulls React-free code only.

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error("unexpected extra fetch")
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "content-type": "application/json" },
    })
  })
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch)
  return fetchMock
}

describe("host dictation controller", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    liveTranscriptBrowserState.set({})
  })

  it("start/stop transitions state and returns trimmed text", async () => {
    const fetchMock = mockFetchSequence([
      { status: 200, body: { started: true } },
      { status: 200, body: { text: "  bonjour  " } },
    ])
    await expect(liveTranscriptController.startHost()).resolves.toBeUndefined()
    expect(liveTranscriptBrowserState.getSnapshot()).toMatchObject({
      recordingKind: "host",
      phase: "recording",
    })
    await expect(liveTranscriptController.stopHost()).resolves.toBe("bonjour")
    expect(liveTranscriptBrowserState.getSnapshot().phase).toBe("idle")
    const urls = fetchMock.mock.calls.map(([path]) => path)
    expect(urls[0]).toContain("/host-dictation/start")
    expect(urls[1]).toContain("/host-dictation/stop")
  })

  it("start failure lands in error phase with the server message", async () => {
    mockFetchSequence([
      { status: 503, body: { error: { code: "live_dictation_unavailable", message: "No usable microphone." } } },
    ])
    await expect(liveTranscriptController.startHost()).rejects.toThrow("No usable microphone.")
    expect(liveTranscriptBrowserState.getSnapshot()).toMatchObject({
      recordingKind: "host",
      phase: "error",
    })
  })

  it("cancel returns to idle and ignores when no host capture is active", async () => {
    const fetchMock = mockFetchSequence([
      { status: 200, body: { cancelled: true } },
    ])
    await expect(liveTranscriptController.cancelHost()).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    liveTranscriptBrowserState.set({ recordingKind: "host", phase: "recording", startedAt: Date.now() })
    await liveTranscriptController.cancelHost()
    expect(liveTranscriptBrowserState.getSnapshot().phase).toBe("idle")
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("stopHost without an active host capture is a no-op", async () => {
    const fetchMock = mockFetchSequence([])
    await expect(liveTranscriptController.stopHost()).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
