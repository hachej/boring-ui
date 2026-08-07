// @vitest-environment node
import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { LiveTranscriptError } from "../errors"
import { KyutaiComposerManager } from "../kyutaiComposer"
import type { WhisperLiveKitSnapshot } from "../whisperLiveKit"

class FakeSocket extends EventEmitter {
  OPEN = 1
  readyState = 1
  bufferedAmount = 0
  sent: Array<Uint8Array | string> = []
  send(data: Uint8Array | string, options?: unknown, callback?: (error?: Error) => void): void {
    this.sent.push(data)
    const done = typeof options === "function" ? options : callback
    done?.()
  }
  close(): void { this.readyState = 3; this.emit("close") }
}

describe("KyutaiComposerManager", () => {
  it("routes incremental words to the browser without a transcript sink and flushes on stop", async () => {
    let callbacks!: {
      onSnapshot(snapshot: WhisperLiveKitSnapshot): void
      onFailure(error: LiveTranscriptError): void
    }
    const sendPcm = vi.fn(async () => {})
    const drain = vi.fn(async () => {
      callbacks.onSnapshot({
        lines: [
          { text: "Bonjour", startSeconds: 0, speaker: 0 },
          { text: "le monde", startSeconds: 1, speaker: 0 },
        ],
        remainingDiarizationSeconds: 0,
      })
    })
    const manager = new KyutaiComposerManager({
      upstreamUrl: "ws://127.0.0.1:18880/api/asr-streaming",
      createUpstreamForTest: (next) => {
        callbacks = next
        return { connect: async () => {}, sendPcm, drain, close: vi.fn() }
      },
    })
    const started = manager.start()
    const socket = new FakeSocket()
    manager.handleSocket(started.composerStreamId, socket as never)
    socket.emit("message", Buffer.from(started.socketNonce), true)
    await vi.waitFor(() => expect(socket.sent).toContainEqual(new Uint8Array([1])))

    callbacks.onSnapshot({
      lines: [{ text: "Bonjour", startSeconds: 0, speaker: 0 }],
      remainingDiarizationSeconds: 0,
    })
    expect(socket.sent).toContain(JSON.stringify({ type: "word", text: "Bonjour" }))

    socket.emit("message", Buffer.alloc(4_800), true)
    await vi.waitFor(() => expect(sendPcm).toHaveBeenCalledOnce())
    await expect(manager.stop(started.composerStreamId)).resolves.toEqual({ text: "Bonjour le monde" })
    expect(socket.sent).toContain(JSON.stringify({ type: "word", text: "le monde" }))
    expect(drain).toHaveBeenCalledOnce()
  })
})
