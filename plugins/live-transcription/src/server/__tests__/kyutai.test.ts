// @vitest-environment node
import { WebSocketServer } from "ws"
import { describe, expect, it, vi } from "vitest"
import { KyutaiConnection, pcm16ToFloat32, resamplePcm16ToFloat32 } from "../kyutai"

describe("Kyutai moshi-server adapter", () => {
  it("normalizes native 24 kHz PCM16 without changing its sample count", () => {
    const input = new Uint8Array(4)
    const view = new DataView(input.buffer)
    view.setInt16(0, -32_768, true)
    view.setInt16(2, 32_767, true)
    expect(pcm16ToFloat32(input)).toEqual(new Float32Array([-1, 0.999969482421875]))
  })

  it("retains the compatibility 16 kHz to 24 kHz resampler", () => {
    const input = new Uint8Array(4)
    const view = new DataView(input.buffer)
    view.setInt16(0, -32_768, true)
    view.setInt16(2, 32_767, true)
    expect(resamplePcm16ToFloat32(input)).toEqual(new Float32Array([-1, 0.33331298828125, 0.999969482421875]))
  })

  it("authenticates, sends MessagePack 24 kHz audio, projects words, and drains to a marker", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    if (typeof address === "string" || !address) throw new Error("missing WebSocket address")
    let authorization = ""
    let audioFrames = 0
    server.on("connection", (socket, request) => {
      authorization = Array.isArray(request.headers["kyutai-api-key"])
        ? request.headers["kyutai-api-key"].join(",")
        : request.headers["kyutai-api-key"] ?? ""
      socket.on("message", (raw) => {
        const message = decodeMessage(new Uint8Array(raw as Buffer))
        if (message.type === "Audio") {
          audioFrames += 1
          if (audioFrames === 1) socket.send(encodeMap({ type: "Word", text: "Bonjour", start_time: 1.25 }))
          return
        }
        if (message.type === "Marker" && typeof message.id === "number") socket.send(encodeMap({ type: "Marker", id: message.id }))
      })
    })
    const onSnapshot = vi.fn()
    const connection = new KyutaiConnection(
      `ws://127.0.0.1:${address.port}/api/asr-streaming?browser-token=never-forwarded`,
      { onSnapshot, onFailure: vi.fn() },
      { apiKey: "server-owned" },
    )
    try {
      await connection.connect()
      await connection.sendPcm(new Uint8Array([0, 0, 0xff, 0x7f]))
      await vi.waitFor(() => expect(onSnapshot).toHaveBeenCalledWith({
        lines: [{ text: "Bonjour", startSeconds: 1.25, speaker: 0 }],
        remainingDiarizationSeconds: 0,
      }))
      await expect(connection.drain(1_000)).resolves.toBeUndefined()
      expect(authorization).toBe("server-owned")
      expect(audioFrames).toBe(36)
    } finally {
      connection.close()
      for (const client of server.clients) client.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it("fails closed for malformed MessagePack upstream output", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
    await new Promise<void>((resolve) => server.once("listening", resolve))
    const address = server.address()
    if (typeof address === "string" || !address) throw new Error("missing WebSocket address")
    server.on("connection", (socket) => socket.send(Buffer.from([0xc1])))
    const onFailure = vi.fn()
    const connection = new KyutaiConnection(`ws://127.0.0.1:${address.port}/api/asr-streaming`, { onSnapshot: vi.fn(), onFailure })
    try {
      await connection.connect()
      await vi.waitFor(() => expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ code: "live_transcript_upstream_failed" })))
    } finally {
      connection.close()
      for (const client of server.clients) client.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

function encodeMap(value: Record<string, string | number>): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([0x80 | Object.keys(value).length])]
  for (const [key, entry] of Object.entries(value)) {
    chunks.push(text(key))
    if (typeof entry === "string") chunks.push(text(entry))
    else { const bytes = new Uint8Array(9); bytes[0] = 0xcb; new DataView(bytes.buffer).setFloat64(1, entry, false); chunks.push(bytes) }
  }
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}
function text(value: string): Uint8Array { const bytes = new TextEncoder().encode(value); return new Uint8Array([0xa0 | bytes.length, ...bytes]) }
function decodeMessage(raw: Uint8Array): Record<string, unknown> {
  let offset = 1
  const count = raw[0]! & 0x0f
  const value: Record<string, unknown> = {}
  for (let index = 0; index < count; index += 1) {
    const keyLength = raw[offset++]! & 0x1f
    const key = new TextDecoder().decode(raw.subarray(offset, offset + keyLength)); offset += keyLength
    const prefix = raw[offset++]!
    if (prefix >= 0xa0 && prefix <= 0xbf) { const length = prefix & 0x1f; value[key] = new TextDecoder().decode(raw.subarray(offset, offset + length)); offset += length }
    else if (prefix <= 0x7f) value[key] = prefix
    else if (prefix === 0xdd) { const length = new DataView(raw.buffer, raw.byteOffset + offset, 4).getUint32(0, false); offset += 4; value[key] = length; offset += length * 5 }
  }
  return value
}
