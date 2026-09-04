// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import { KyutaiDiarizedConnection, downsamplePcm24kTo16k, mergeKyutaiWordsWithSpeakers } from "../kyutaiDiarized"
import type { WhisperLiveKitSnapshot } from "../whisperLiveKit"

const snapshot = (lines: WhisperLiveKitSnapshot["lines"]): WhisperLiveKitSnapshot => ({ lines, remainingDiarizationSeconds: 0 })

describe("Kyutai + raw Sortformer diarization", () => {
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
        { text: "wrong transcript one", startSeconds: 0, endSeconds: 0.9, speaker: 0 },
        { text: "wrong transcript two", startSeconds: 0.9, endSeconds: 2, speaker: 1 },
      ]),
    )
    expect(merged.lines).toEqual([
      { text: "Bonjour", startSeconds: 0, endSeconds: 0.8, speaker: 0 },
      { text: "docteur", startSeconds: 0.8, endSeconds: 1.4, speaker: 1 },
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
    expect(onSnapshot).toHaveBeenLastCalledWith(snapshot([{ text: "Salut", startSeconds: 1, endSeconds: 1.5, speaker: -1 }]))
    diarizerCallbacks.onSnapshot(snapshot([{ text: "ignored", startSeconds: 0, endSeconds: 2, speaker: 0 }]))
    expect(onSnapshot).toHaveBeenLastCalledWith(snapshot([{ text: "Salut", startSeconds: 1, endSeconds: 1.5, speaker: 0 }]))
    diarizerCallbacks.onSnapshot(snapshot([{ text: "revised", startSeconds: 0, endSeconds: 2, speaker: 1 }]))
    expect(onSnapshot).toHaveBeenLastCalledWith(snapshot([{ text: "Salut", startSeconds: 1, endSeconds: 1.5, speaker: 1 }]))
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

describe("Kyutai + Sortformer merge on a measured two-voice bench", () => {
  // Recorded on the RTX 3080 Ti box (2026-09-04): Kyutai's public French
  // sample cut into six 4 s turns, voice B pitch-shifted, streamed to both
  // services in real time. Truth: speaker = turn index mod 2.
  const bench = JSON.parse(readFileSync(new URL("./fixtures.sortformerTwoVoices.json", import.meta.url), "utf8")) as {
    turnSeconds: number
    words: WhisperLiveKitSnapshot["lines"]
    segments: WhisperLiveKitSnapshot["lines"]
  }
  const truth = bench.words.map((word) => Math.floor(word.startSeconds / bench.turnSeconds) % 2)
  const score = (lines: WhisperLiveKitSnapshot["lines"]) => {
    const mappings = [{ 0: 0, 1: 1 }, { 0: 1, 1: 0 }] as Array<Record<number, number>>
    const accuracy = Math.max(...mappings.map((map) => lines.filter((line, index) => line.speaker >= 0 && map[line.speaker] === truth[index]).length / lines.length))
    const runs = lines.reduce((count, line, index) => count + (index > 0 && line.speaker !== lines[index - 1]!.speaker ? 1 : 0), 1)
    return { accuracy, runs }
  }

  it("beats the uncompensated per-word merge on accuracy and turn count", () => {
    const before = score(mergeKyutaiWordsWithSpeakers(snapshot(bench.words), snapshot(bench.segments), { lagSeconds: 0 }).lines)
    const after = score(mergeKyutaiWordsWithSpeakers(snapshot(bench.words), snapshot(bench.segments)).lines)
    expect(before.accuracy).toBeLessThan(0.95)
    expect(after.accuracy).toBeGreaterThanOrEqual(0.95)
    expect(after.runs).toBe(6)
  })

  it("carries the previous speaker over uncovered words and smooths one-word flickers", () => {
    const merged = mergeKyutaiWordsWithSpeakers(
      snapshot([
        { text: "bonjour", startSeconds: 0, endSeconds: 0.4, speaker: -1 },
        { text: "docteur", startSeconds: 0.4, endSeconds: 0.8, speaker: -1 },
        { text: "je", startSeconds: 0.8, endSeconds: 0.9, speaker: -1 },
        { text: "viens", startSeconds: 0.9, endSeconds: 1.3, speaker: -1 },
        { text: "pour", startSeconds: 3.0, endSeconds: 3.3, speaker: -1 },
      ]),
      snapshot([
        { text: "", startSeconds: 0.5, endSeconds: 1.3, speaker: 1 },
        { text: "", startSeconds: 1.3, endSeconds: 1.4, speaker: 0 },
        { text: "", startSeconds: 1.4, endSeconds: 1.8, speaker: 1 },
      ]),
      { lagSeconds: 0 },
    )
    expect(merged.lines.map((line) => line.speaker)).toEqual([-1, 1, 1, 1, 1])
  })
})
