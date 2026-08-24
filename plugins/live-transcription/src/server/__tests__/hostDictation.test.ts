// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createHostDictationEngine,
  createPiTranscribeSettingsLoader,
  type HostDictationRecorderFactory,
} from "../hostDictation"

const FRAME = new Int16Array(1600) // 100 ms at 16 kHz

function fakeRecorder(frames: number | "error") {
  let remaining = frames === "error" ? Number.POSITIVE_INFINITY : (frames as number)
  const released = { stopped: false, released: false }
  const factory: HostDictationRecorderFactory = async () => ({
    read: async () => {
      if (frames === "error") throw new Error("device vanished")
      if (remaining <= 0) return undefined
      remaining--
      return FRAME
    },
    stop: () => {
      released.stopped = true
    },
    release: () => {
      released.released = true
    },
  })
  return { factory, released }
}

function fakeEngineOptions(overrides: Record<string, unknown> = {}) {
  const transcribed: number[] = []
  return {
    options: {
      loadSettings: async () => ({ modelPath: "/fake/model.gguf" }),
      createTranscriber: async () => async (pcm: Float32Array) => {
        transcribed.push(pcm.length)
        return "hello dictation"
      },
      ...overrides,
    } as Parameters<typeof createHostDictationEngine>[0],
    transcribed,
  }
}

describe("createHostDictationEngine", () => {
  afterEach(async () => {
    await Promise.resolve()
  })

  it("records on start and returns decoded text on stop", async () => {
    const { factory, released } = fakeRecorder(10)
    const { options, transcribed } = fakeEngineOptions({ createRecorder: factory })
    const engine = createHostDictationEngine(options)
    expect(engine.getState()).toBe("idle")
    expect(engine.getBufferedMs()).toBe(0)
    await engine.start()
    expect(engine.getState()).toBe("recording")
    // Let the capture loop drain all scripted frames before stopping.
    await vi.waitUntil(() => engine.getBufferedMs() >= 1_000, { timeout: 2_000 })
    await expect(engine.stop()).resolves.toBe("hello dictation")
    expect(engine.getState()).toBe("idle")
    // 10 frames x 1600 samples reached the decoder.
    expect(transcribed).toEqual([16_000])
    expect(released.stopped).toBe(true)
    expect(released.released).toBe(true)
  })

  it("rejects a second concurrent capture", async () => {
    const { factory } = fakeRecorder(Number.POSITIVE_INFINITY)
    const { options } = fakeEngineOptions({ createRecorder: factory })
    const engine = createHostDictationEngine(options)
    await engine.start()
    await expect(engine.start()).rejects.toMatchObject({
      code: "live_transcript_already_active",
    })
    engine.cancel()
  })

  it("cancel discards the buffer and stop then reports not-active", async () => {
    const { factory } = fakeRecorder(Number.POSITIVE_INFINITY)
    const { options, transcribed } = fakeEngineOptions({ createRecorder: factory })
    const engine = createHostDictationEngine(options)
    await engine.start()
    engine.cancel()
    expect(engine.getState()).toBe("idle")
    await expect(engine.stop()).rejects.toMatchObject({
      code: "live_transcript_not_active",
    })
    expect(transcribed).toEqual([])
  })

  it("auto-submits when the duration cap is reached", async () => {
    const { factory } = fakeRecorder(Number.POSITIVE_INFINITY)
    const { options } = fakeEngineOptions({ createRecorder: factory, maxDurationMs: 250 })
    const engine = createHostDictationEngine(options)
    await engine.start()
    await expect(engine.stop()).resolves.toBe("hello dictation")
    expect(engine.getState()).toBe("idle")
  })

  it("surfaces a clean failure when the device errors mid-capture", async () => {
    const { factory } = fakeRecorder("error")
    const { options } = fakeEngineOptions({ createRecorder: factory })
    const engine = createHostDictationEngine(options)
    await engine.start()
    await expect(engine.stop()).rejects.toMatchObject({
      code: "live_transcript_invalid_audio",
    })
    expect(engine.getState()).toBe("idle")
  })

  it("reports an empty capture as invalid audio", async () => {
    const { factory } = fakeRecorder(0)
    const { options } = fakeEngineOptions({ createRecorder: factory })
    const engine = createHostDictationEngine(options)
    await engine.start()
    await expect(engine.stop()).rejects.toMatchObject({
      code: "live_transcript_invalid_audio",
    })
  })

  it("fails start with live_dictation_unavailable when settings cannot be resolved", async () => {
    const { factory } = fakeRecorder(1)
    const { options } = fakeEngineOptions({
      createRecorder: factory,
      loadSettings: async () => {
        throw Object.assign(new Error("nope"), { code: "live_dictation_unavailable" })
      },
    })
    const engine = createHostDictationEngine(options)
    await expect(engine.start()).rejects.toMatchObject({
      code: "live_dictation_unavailable",
    })
    // Engine returned to idle after the failed start.
    expect(engine.getState()).toBe("idle")
  })

  it("reports buffered milliseconds during capture", async () => {
    // Finite frames: an instant-resolving infinite fake would starve timers
    // and race to the duration cap before any waitUntil poll.
    const { factory } = fakeRecorder(20)
    const { options } = fakeEngineOptions({ createRecorder: factory })
    const engine = createHostDictationEngine(options)
    await engine.start()
    await vi.waitUntil(() => engine.getBufferedMs() >= 500, { timeout: 2_000 })
    engine.cancel()
    expect(engine.getBufferedMs()).toBe(0)
  })

  it("stop without start reports not-active", async () => {
    const { options } = fakeEngineOptions({})
    const engine = createHostDictationEngine(options)
    await expect(engine.stop()).rejects.toMatchObject({
      code: "live_transcript_not_active",
    })
  })
})

describe("createPiTranscribeSettingsLoader", () => {
  let dir: string
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it("resolves model path and non-auto language from a settings file", async () => {
    dir = await mkdtemp(join(tmpdir(), "host-dict-"))
    const modelPath = join(dir, "model.gguf")
    await writeFile(modelPath, "gguf")
    const settingsPath = join(dir, "pi-transcribe.json")
    await writeFile(
      settingsPath,
      JSON.stringify({
        version: 2,
        backend: { type: "transcribe-cpp" },
        model: { source: "catalog", id: "whisper-tiny", path: modelPath },
        transcriptionLanguage: "fr",
      }),
    )
    await expect(createPiTranscribeSettingsLoader(settingsPath)()).resolves.toEqual({
      modelPath,
      language: "fr",
    })
  })

  it("treats auto language as absent", async () => {
    dir = await mkdtemp(join(tmpdir(), "host-dict-"))
    const modelPath = join(dir, "model.gguf")
    await writeFile(modelPath, "gguf")
    const settingsPath = join(dir, "pi-transcribe.json")
    await writeFile(
      settingsPath,
      JSON.stringify({ model: { source: "catalog", id: "x", path: modelPath }, transcriptionLanguage: "auto" }),
    )
    await expect(createPiTranscribeSettingsLoader(settingsPath)()).resolves.toEqual({ modelPath })
  })

  it("reports unavailable when the settings file or model file is missing", async () => {
    dir = await mkdtemp(join(tmpdir(), "host-dict-"))
    await expect(createPiTranscribeSettingsLoader(join(dir, "missing.json"))()).rejects.toMatchObject({
      code: "live_dictation_unavailable",
    })
    const settingsPath = join(dir, "pi-transcribe.json")
    await writeFile(
      settingsPath,
      JSON.stringify({ model: { source: "catalog", id: "x", path: join(dir, "gone.gguf") } }),
    )
    await expect(createPiTranscribeSettingsLoader(settingsPath)()).rejects.toMatchObject({
      code: "live_dictation_unavailable",
    })
  })
})
