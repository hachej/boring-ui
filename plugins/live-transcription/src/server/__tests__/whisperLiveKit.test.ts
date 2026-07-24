// @vitest-environment node
import { WebSocketServer } from "ws"
import { describe, expect, it, vi } from "vitest"
import { parseWhisperLiveKitSnapshot, WhisperLiveKitConnection } from "../whisperLiveKit"

describe("WhisperLiveKit mode=full snapshots", () => {
  it("accepts config and strict speaker-tagged full snapshots", () => {
    expect(parseWhisperLiveKitSnapshot(JSON.stringify({ type: "config", sample_rate: 16000 }))).toBeNull()
    expect(parseWhisperLiveKitSnapshot(JSON.stringify({
      lines: [
        { beg: 3.25, end: 5, text: "Bonjour", speaker: 7 },
        { start: "00:00:08.500", text: "Oui", speaker: 11 },
      ],
      remaining_time_diarization: 2.5,
    }))).toEqual({
      lines: [
        { startSeconds: 3.25, text: "Bonjour", speaker: 7 },
        { startSeconds: 8.5, text: "Oui", speaker: 11 },
      ],
      remainingDiarizationSeconds: 2.5,
    })
  })

  it("connects only with mode=full and streams binary PCM through the loopback adapter", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    if (typeof address === "string" || !address) throw new Error("missing test WebSocket address")
    const snapshots: unknown[] = []
    const pcm: Uint8Array[] = []
    let requestUrl = ""
    let authorization = ""
    server.on("connection", (socket, request) => {
      requestUrl = request.url ?? ""
      authorization = request.headers.authorization ?? ""
      socket.send(JSON.stringify({ type: "config", sample_rate: 16_000 }))
      socket.on("message", (data, isBinary) => {
        if (isBinary) pcm.push(new Uint8Array(data as Buffer))
        socket.send(JSON.stringify({
          lines: [{ beg: 1, text: "Bonjour", speaker: 3 }],
          remaining_time_diarization: 0,
        }))
      })
    })
    const onFailure = vi.fn()
    const connection = new WhisperLiveKitConnection(
      `ws://127.0.0.1:${address.port}/asr?token=must-not-forward&mode=diff`,
      { onSnapshot: (snapshot) => snapshots.push(snapshot), onFailure },
      { bearerToken: "server-owned" },
    )
    try {
      await connection.connect()
      await connection.sendPcm(new Uint8Array([1, 0]))
      await vi.waitFor(() => expect(snapshots).toHaveLength(1))
      expect(requestUrl).toBe("/asr?language=fr&mode=full")
      expect(authorization).toBe("Bearer server-owned")
      expect(pcm).toEqual([new Uint8Array([1, 0])])
      expect(onFailure).not.toHaveBeenCalled()
    } finally {
      connection.close()
      for (const client of server.clients) client.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("rejects malformed/diff-shaped/oversized output", () => {
    expect(() => parseWhisperLiveKitSnapshot("not json")).toThrow(expect.objectContaining({ code: "live_transcript_upstream_failed" }))
    expect(() => parseWhisperLiveKitSnapshot(JSON.stringify({ diff: [] }))).toThrow(expect.objectContaining({ code: "live_transcript_upstream_failed" }))
    expect(() => parseWhisperLiveKitSnapshot(JSON.stringify({ lines: [{ text: "x", speaker: "SPEAKER_00" }] }))).toThrow(expect.objectContaining({ code: "live_transcript_upstream_failed" }))
    expect(() => parseWhisperLiveKitSnapshot(JSON.stringify({ lines: [], padding: "x".repeat(1_000_000) }))).toThrow(expect.objectContaining({ code: "live_transcript_limit_exceeded" }))
  })
})
