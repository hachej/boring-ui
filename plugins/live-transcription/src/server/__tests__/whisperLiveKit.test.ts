// @vitest-environment node
import { once } from "node:events"
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

  it("omits provisional negative Diart speakers until a later full snapshot attributes them", () => {
    expect(parseWhisperLiveKitSnapshot(JSON.stringify({
      status: "active_transcription",
      lines: [{ start: "0:00:00.00", end: "0:00:00.10", text: "", speaker: -2 }],
      remaining_time_diarization: 0,
    }))).toEqual({ lines: [], remainingDiarizationSeconds: 0 })
  })

  it("accepts bounded trailing silence but rejects voiced audio after the latest snapshot", async () => {
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
        if (!isBinary) return
        pcm.push(new Uint8Array(data as Buffer))
        if (pcm.length === 1) {
          socket.send(JSON.stringify({
            lines: [{ beg: 1, text: "Bonjour", speaker: 3 }],
            // WhisperLiveKit does not publish the eventual zero backlog while
            // only silence follows this snapshot.
            remaining_time_diarization: 2.5,
          }))
        }
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
      const voicedFrame = new Uint8Array(3_200)
      const voicedView = new DataView(voicedFrame.buffer)
      for (let offset = 0; offset < voicedFrame.byteLength; offset += 2) voicedView.setInt16(offset, 4_096, true)
      await connection.sendPcm(voicedFrame)
      await vi.waitFor(() => expect(snapshots).toHaveLength(1))
      const quietBoundaryFrame = pcmFrame(255)
      for (let frame = 0; frame < 9; frame += 1) await connection.sendPcm(quietBoundaryFrame)
      await expect(connection.drain(25)).rejects.toMatchObject({ code: "live_transcript_upstream_failed" })
      await connection.sendPcm(quietBoundaryFrame)
      const drainStartedAt = Date.now()
      await expect(connection.drain(50)).resolves.toBeUndefined()
      expect(Date.now() - drainStartedAt).toBeGreaterThanOrEqual(40)
      const voicedBoundaryFrame = pcmFrame(256)
      await connection.sendPcm(voicedBoundaryFrame)
      await expect(connection.drain(25)).rejects.toMatchObject({ code: "live_transcript_upstream_failed" })
      expect(requestUrl).toBe("/asr?language=fr&mode=full")
      expect(authorization).toBe("Bearer server-owned")
      expect(pcm).toHaveLength(12)
      expect(pcm[0]).toEqual(voicedFrame)
      expect(pcm.slice(1, 11)).toEqual(Array.from({ length: 10 }, () => quietBoundaryFrame))
      expect(pcm[11]).toEqual(voicedBoundaryFrame)
      expect(onFailure).not.toHaveBeenCalled()
    } finally {
      connection.close()
      for (const client of server.clients) client.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("waits for a post-stop final snapshot before reporting the stream drained", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    if (typeof address === "string" || !address) throw new Error("missing test WebSocket address")
    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "config", sample_rate: 16_000 }))
      socket.on("message", (_data, isBinary) => {
        if (!isBinary) return
        setTimeout(() => socket.send(JSON.stringify({
          lines: [{ beg: 0, text: "final", speaker: 0 }],
          remaining_time_diarization: 0,
        })), 25)
      })
    })
    const onSnapshot = vi.fn()
    const connection = new WhisperLiveKitConnection(
      `ws://127.0.0.1:${address.port}/asr`,
      { onSnapshot, onFailure: vi.fn() },
    )
    try {
      await connection.connect()
      await connection.sendPcm(new Uint8Array([1, 0]))
      await connection.drain(500)
      expect(onSnapshot).toHaveBeenCalledWith(expect.objectContaining({
        lines: [expect.objectContaining({ text: "final" })],
      }))
    } finally {
      connection.close()
      for (const client of server.clients) client.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("fails config timeout and high-water backpressure with stable codes", async () => {
    const timeoutServer = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    await new Promise<void>((resolve) => timeoutServer.once("listening", resolve))
    const timeoutAddress = timeoutServer.address()
    if (typeof timeoutAddress === "string" || !timeoutAddress) throw new Error("missing test WebSocket address")
    const timedOut = new WhisperLiveKitConnection(
      `ws://127.0.0.1:${timeoutAddress.port}/asr`,
      { onSnapshot: vi.fn(), onFailure: vi.fn() },
      { connectTimeoutMs: 100 },
    )
    await expect(timedOut.connect()).rejects.toMatchObject({ code: "live_transcript_upstream_failed", statusCode: 504 })
    timedOut.close()
    for (const client of timeoutServer.clients) client.terminate()
    await new Promise<void>((resolve) => timeoutServer.close(() => resolve()))

    const pressureServer = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    await new Promise<void>((resolve) => pressureServer.once("listening", resolve))
    const pressureAddress = pressureServer.address()
    if (typeof pressureAddress === "string" || !pressureAddress) throw new Error("missing test WebSocket address")
    pressureServer.on("connection", (socket) => socket.send(JSON.stringify({ type: "config" })))
    const pressured = new WhisperLiveKitConnection(
      `ws://127.0.0.1:${pressureAddress.port}/asr`,
      { onSnapshot: vi.fn(), onFailure: vi.fn() },
      { highWaterBytes: -1 },
    )
    try {
      await pressured.connect()
      await expect(pressured.sendPcm(new Uint8Array([0, 0]))).rejects.toMatchObject({
        code: "live_transcript_backpressure",
      })
    } finally {
      pressured.close()
      for (const client of pressureServer.clients) client.terminate()
      await new Promise<void>((resolve) => pressureServer.close(() => resolve()))
    }
  })

  it.each([
    ["repeated config", (socket: import("ws").WebSocket) => socket.send(JSON.stringify({ type: "config" }))],
    ["binary output", (socket: import("ws").WebSocket) => socket.send(Buffer.from([1]), { binary: true })],
    ["premature close", (socket: import("ws").WebSocket) => socket.close()],
  ])("reports %s exactly once after configuration", async (_label, violate) => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    if (typeof address === "string" || !address) throw new Error("missing test WebSocket address")
    let acceptSocket!: (socket: import("ws").WebSocket) => void
    const serverSocket = new Promise<import("ws").WebSocket>((resolve) => { acceptSocket = resolve })
    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "config" }))
      acceptSocket(socket)
    })
    const onFailure = vi.fn()
    const connection = new WhisperLiveKitConnection(
      `ws://127.0.0.1:${address.port}/asr`,
      { onSnapshot: vi.fn(), onFailure },
    )
    try {
      await connection.connect()
      const accepted = await serverSocket
      const closed = once(accepted, "close")
      violate(accepted)
      await vi.waitFor(() => expect(onFailure).toHaveBeenCalledTimes(1))
      await closed
      expect(onFailure.mock.calls[0]![0]).toMatchObject({ code: "live_transcript_upstream_failed" })
      expect(onFailure).toHaveBeenCalledTimes(1)
    } finally {
      connection.close()
      for (const client of server.clients) client.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("fails closed when no post-stop final snapshot arrives", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    if (typeof address === "string" || !address) throw new Error("missing test WebSocket address")
    server.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "config", sample_rate: 16_000 }))
    })
    const connection = new WhisperLiveKitConnection(
      `ws://127.0.0.1:${address.port}/asr`,
      { onSnapshot: vi.fn(), onFailure: vi.fn() },
    )
    try {
      await connection.connect()
      await connection.sendPcm(new Uint8Array([1, 0]))
      await expect(connection.drain(25)).rejects.toMatchObject({ code: "live_transcript_upstream_failed" })
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

function pcmFrame(sample: number): Uint8Array {
  const frame = new Uint8Array(3_200)
  const view = new DataView(frame.buffer)
  for (let offset = 0; offset < frame.byteLength; offset += 2) view.setInt16(offset, sample, true)
  return frame
}
