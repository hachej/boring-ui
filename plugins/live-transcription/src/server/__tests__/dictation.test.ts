// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { transcribeShortDictation } from "../dictation"

describe("transcribeShortDictation", () => {
  it("forwards bounded in-memory audio to the loopback REST transcription endpoint", async () => {
    const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe("http://127.0.0.1:18772/v1/audio/transcriptions")
      expect(init?.method).toBe("POST")
      expect(init?.body).toBeInstanceOf(FormData)
      return new Response(JSON.stringify({ text: "bonjour le monde" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    await expect(transcribeShortDictation({
      upstreamWebSocketUrl: "ws://127.0.0.1:18772/asr?ignored=1",
      mimeType: "audio/webm;codecs=opus",
      audioBase64: Buffer.from("audio").toString("base64"),
      fetch: fetch as typeof globalThis.fetch,
    })).resolves.toEqual({ text: "bonjour le monde" })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("rejects malformed, empty, unsupported, and oversized audio before fetch", async () => {
    const fetch = vi.fn()
    await expect(transcribeShortDictation({
      upstreamWebSocketUrl: "ws://127.0.0.1:18772/asr",
      mimeType: "audio/webm",
      audioBase64: "not-base64",
      fetch: fetch as typeof globalThis.fetch,
    })).rejects.toMatchObject({ code: "live_transcript_invalid_audio" })
    await expect(transcribeShortDictation({
      upstreamWebSocketUrl: "ws://127.0.0.1:18772/asr",
      mimeType: "video/webm",
      audioBase64: Buffer.from("audio").toString("base64"),
      fetch: fetch as typeof globalThis.fetch,
    })).rejects.toMatchObject({ code: "live_transcript_invalid_audio" })
    expect(fetch).not.toHaveBeenCalled()
  })
})
