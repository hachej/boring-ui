// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { transcribeShortDictation } from "../dictation"

describe("transcribeShortDictation", () => {
  it("forwards bounded in-memory audio to the loopback REST transcription endpoint", async () => {
    const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe("http://127.0.0.1:18772/v1/audio/transcriptions")
      expect(init?.method).toBe("POST")
      expect(init?.headers).toEqual({ Authorization: "Bearer server-owned" })
      expect(init?.body).toBeInstanceOf(FormData)
      const form = init!.body as FormData
      expect(form.get("model")).toBe("tiny")
      expect(form.get("language")).toBe("fr")
      const file = form.get("file") as File
      expect(file.name).toBe("dictation.webm")
      expect(file.type).toBe("audio/webm;codecs=opus")
      expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("audio")
      return new Response(JSON.stringify({ text: "bonjour le monde" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    })
    await expect(transcribeShortDictation({
      upstreamWebSocketUrl: "ws://127.0.0.1:18772/asr?token=browser-must-not-forward",
      bearerToken: "server-owned",
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
    await expect(transcribeShortDictation({
      upstreamWebSocketUrl: "ws://127.0.0.1:18772/asr",
      mimeType: "audio/webm",
      audioBase64: "",
      fetch: fetch as typeof globalThis.fetch,
    })).rejects.toMatchObject({ code: "live_transcript_limit_exceeded" })
    await expect(transcribeShortDictation({
      upstreamWebSocketUrl: "ws://127.0.0.1:18772/asr",
      mimeType: "audio/webm",
      audioBase64: Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64"),
      fetch: fetch as typeof globalThis.fetch,
    })).rejects.toMatchObject({ code: "live_transcript_limit_exceeded" })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ["unavailable", vi.fn(async () => { throw new Error("offline") })],
    ["rejected", vi.fn(async () => new Response("decode failed", { status: 500 }))],
    ["invalid payload", vi.fn(async () => new Response(JSON.stringify({ text: 7 }), { status: 200 }))],
  ])("normalizes %s upstream failures without exposing response bodies", async (_label, fetch) => {
    await expect(transcribeShortDictation({
      upstreamWebSocketUrl: "ws://127.0.0.1:18772/asr",
      mimeType: "audio/webm",
      audioBase64: Buffer.from("audio-sentinel").toString("base64"),
      fetch: fetch as typeof globalThis.fetch,
    })).rejects.toMatchObject({
      code: "live_transcript_upstream_failed",
      message: expect.not.stringContaining("decode failed"),
    })
  })
})
