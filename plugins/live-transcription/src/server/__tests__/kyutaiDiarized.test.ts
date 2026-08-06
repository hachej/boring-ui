// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { KyutaiDiarizedConnection, downsamplePcm24kTo16k, mergeKyutaiWordsWithSpeakers } from "../kyutaiDiarized"
import type { WhisperLiveKitSnapshot } from "../whisperLiveKit"

const snapshot = (lines: WhisperLiveKitSnapshot["lines"]): WhisperLiveKitSnapshot => ({ lines, remainingDiarizationSeconds: 0 })

describe("Kyutai + WhisperLiveKit diarization", () => {
  it("forks an unchanged native 24 kHz frame and an exact 16 kHz diarizer frame", async () => {
    const input = new Uint8Array(4_800)
    const inputView = new DataView(input.buffer)
    for (let index = 0; index < 2_400; index += 1) inputView.setInt16(index * 2, index - 1_200, true)
    const kyutaiSend = vi.fn(async (_data: Uint8Array) => undefined)
    const diarizerSend = vi.fn(async (_data: Uint8Array) => undefined)
    const connection = new KyutaiDiarizedConnection("ws://kyutai", "ws://diarizer", { onSnapshot: vi.fn(), onFailure: vi.fn() }, {
      createKyutaiForTest: () => child({ sendPcm: kyutaiSend }),
      createDiarizerForTest: () => child({ sendPcm: diarizerSend }),
    })

    await connection.connect()
    await connection.sendPcm(input)

    expect(kyutaiSend).toHaveBeenCalledWith(input)
    expect(diarizerSend).toHaveBeenCalledOnce()
    expect(diarizerSend.mock.calls[0]?.[0]).toHaveLength(3_200)
  })

  it("assigns Kyutai words by maximum speaker overlap and never uses WLK text", () => {
    const merged = mergeKyutaiWordsWithSpeakers(
      snapshot([
        { text: "Bonjour", startSeconds: 0, endSeconds: 0.8, speaker: 0 },
        { text: "docteur", startSeconds: 0.8, endSeconds: 1.4, speaker: 0 },
      ]),
      snapshot([
        { text: "wrong transcript one", startSeconds: 0, endSeconds: 0.9, speaker: 7 },
        { text: "wrong transcript two", startSeconds: 0.9, endSeconds: 2, speaker: 3 },
      ]),
    )
    expect(merged.lines).toEqual([
      { text: "Bonjour", startSeconds: 0, endSeconds: 0.8, speaker: 7 },
      { text: "docteur", startSeconds: 0.8, endSeconds: 1.4, speaker: 3 },
    ])
  })

  it("relabels earlier Kyutai words when full diarization snapshots arrive", async () => {
    let kyutaiCallbacks!: Callbacks
    let diarizerCallbacks!: Callbacks
    const onSnapshot = vi.fn()
    const connection = new KyutaiDiarizedConnection("ws://kyutai", "ws://diarizer", { onSnapshot, onFailure: vi.fn() }, {
      createKyutaiForTest: (callbacks) => { kyutaiCallbacks = callbacks; return child() },
      createDiarizerForTest: (callbacks) => { diarizerCallbacks = callbacks; return child() },
    })
    await connection.connect()
    kyutaiCallbacks.onSnapshot(snapshot([{ text: "Salut", startSeconds: 1, endSeconds: 1.5, speaker: 0 }]))
    expect(onSnapshot).toHaveBeenLastCalledWith(snapshot([{ text: "Salut", startSeconds: 1, endSeconds: 1.5, speaker: 0 }]))
    diarizerCallbacks.onSnapshot(snapshot([{ text: "ignored", startSeconds: 0, endSeconds: 2, speaker: 4 }]))
    expect(onSnapshot).toHaveBeenLastCalledWith(snapshot([{ text: "Salut", startSeconds: 1, endSeconds: 1.5, speaker: 4 }]))
  })

  it("fails open when the diarizer cannot connect", async () => {
    const onFailure = vi.fn()
    const connection = new KyutaiDiarizedConnection("ws://kyutai", "ws://diarizer", { onSnapshot: vi.fn(), onFailure }, {
      createKyutaiForTest: () => child(),
      createDiarizerForTest: () => child({ connect: async () => { throw new Error("offline") } }),
    })
    await expect(connection.connect()).resolves.toBeUndefined()
    await expect(connection.sendPcm(new Uint8Array(4_800))).resolves.toBeUndefined()
    expect(onFailure).not.toHaveBeenCalled()
  })
})

it("downsamples little-endian PCM deterministically", () => {
  const input = new Uint8Array(12)
  const view = new DataView(input.buffer)
  ;[0, 1_000, 2_000, 3_000, 4_000, 5_000].forEach((value, index) => view.setInt16(index * 2, value, true))
  const output = downsamplePcm24kTo16k(input)
  expect(output).toHaveLength(8)
  const result = new DataView(output.buffer)
  expect(Array.from({ length: 4 }, (_, index) => result.getInt16(index * 2, true))).toEqual([0, 1_500, 3_000, 4_500])
})

type Callbacks = { onSnapshot: (snapshot: WhisperLiveKitSnapshot) => void; onFailure: (error: never) => void }

function child(overrides: Partial<{
  connect: () => Promise<void>
  sendPcm: (data: Uint8Array) => Promise<void>
  drain: (timeoutMs: number) => Promise<void>
  close: () => void
}> = {}) {
  return {
    connect: overrides.connect ?? (async () => undefined),
    sendPcm: overrides.sendPcm ?? (async () => undefined),
    drain: overrides.drain ?? (async () => undefined),
    close: overrides.close ?? (() => undefined),
  }
}
