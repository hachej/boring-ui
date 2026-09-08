// @vitest-environment node
import { WebSocketServer } from "ws"
import { afterEach, describe, expect, it, vi } from "vitest"
import { parseSortformerMessage, SortformerConnection } from "../sortformer"

const servers: WebSocketServer[] = []
afterEach(() => { for (const server of servers.splice(0)) server.close() })

describe("SortformerConnection", () => {
  it("streams exact binary PCM and publishes monotonic speaker-only snapshots", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0, path: "/v1/diarize" })
    servers.push(server)
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address() as { port: number }
    const received: Array<{ data: Buffer; binary: boolean }> = []
    server.on("connection", (socket) => socket.on("message", (data, binary) => {
      received.push({ data: Buffer.from(data as Buffer), binary })
      if (received.length === 1) socket.send(JSON.stringify({ type: "ready", protocol: "boring.sortformer.v1" }))
      if (received.length === 2) {
        socket.send(JSON.stringify({ type: "snapshot", revision: 1, throughSeconds: 0.1, segments: [{ speaker: 0, startSeconds: 0, endSeconds: 0.1 }] }))
        socket.send(JSON.stringify({ type: "snapshot", revision: 1, throughSeconds: 0.1, segments: [] }))
      }
      if (!binary && received.length === 3) socket.send(JSON.stringify({ type: "stopped", id: 1 }), () => socket.close())
    }))
    const onSnapshot = vi.fn()
    const connection = new SortformerConnection(`ws://127.0.0.1:${address.port}/v1/diarize`, { onSnapshot, onFailure: vi.fn() })
    await connection.connect()
    const frame = new Uint8Array(3_200).fill(7)
    await connection.sendPcm(frame)
    await vi.waitFor(() => expect(onSnapshot).toHaveBeenCalledOnce())
    await connection.drain(1_000)
    expect(JSON.parse(received[0]!.data.toString())).toMatchObject({ type: "start", sampleRateHz: 16_000, frameDurationMs: 100 })
    expect(received[1]).toMatchObject({ binary: true })
    expect(received[1]!.data).toEqual(Buffer.from(frame))
    expect(onSnapshot).toHaveBeenCalledWith({ lines: [{ speaker: 0, startSeconds: 0, endSeconds: 0.1, text: "" }], remainingDiarizationSeconds: 0 })
    connection.close()
  })

  it("applies delta snapshots from the sidecar's fromIndex onto the session list", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0, path: "/v1/diarize" })
    servers.push(server)
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address() as { port: number }
    server.on("connection", (socket) => socket.on("message", (_data, binary) => {
      if (!binary) return socket.send(JSON.stringify({ type: "ready", protocol: "boring.sortformer.v1" }))
      socket.send(JSON.stringify({ type: "snapshot", revision: 1, throughSeconds: 1, fromIndex: 0, segments: [{ speaker: 0, startSeconds: 0, endSeconds: 0.6 }, { speaker: 1, startSeconds: 0.6, endSeconds: 1 }] }))
      // second chunk extends the last segment and adds one
      socket.send(JSON.stringify({ type: "snapshot", revision: 2, throughSeconds: 2, fromIndex: 1, segments: [{ speaker: 1, startSeconds: 0.6, endSeconds: 1.5 }, { speaker: 0, startSeconds: 1.5, endSeconds: 2 }] }))
    }))
    const onSnapshot = vi.fn()
    const connection = new SortformerConnection(`ws://127.0.0.1:${address.port}/v1/diarize`, { onSnapshot, onFailure: vi.fn() })
    await connection.connect()
    await connection.sendPcm(new Uint8Array(3_200))
    await vi.waitFor(() => expect(onSnapshot).toHaveBeenCalledTimes(2))
    expect(onSnapshot.mock.calls[1]?.[0].lines).toEqual([
      { speaker: 0, startSeconds: 0, endSeconds: 0.6, text: "" },
      { speaker: 1, startSeconds: 0.6, endSeconds: 1.5, text: "" },
      { speaker: 0, startSeconds: 1.5, endSeconds: 2, text: "" },
    ])
    connection.close()
  })

  it("strictly parses known speaker segments", () => {
    expect(parseSortformerMessage(JSON.stringify({
      type: "snapshot",
      revision: 2,
      throughSeconds: 3,
      segments: [{ speaker: 1, startSeconds: 1, endSeconds: 2 }],
    }))).toEqual({
      type: "snapshot",
      revision: 2,
      throughSeconds: 3,
      lines: [{ speaker: 1, startSeconds: 1, endSeconds: 2, text: "" }],
    })
  })

  it("rejects malformed, unsupported, or out-of-range output", () => {
    for (const raw of [
      "not json",
      JSON.stringify({ type: "other" }),
      JSON.stringify({ type: "snapshot", revision: 1, throughSeconds: 1, segments: [{ speaker: 4, startSeconds: 0, endSeconds: 1 }] }),
      JSON.stringify({ type: "snapshot", revision: 1, throughSeconds: 1, segments: [{ speaker: 0, startSeconds: 1, endSeconds: 0 }] }),
    ]) expect(() => parseSortformerMessage(raw)).toThrow(expect.objectContaining({ code: "live_transcript_upstream_failed" }))
  })
})
