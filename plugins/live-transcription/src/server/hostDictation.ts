import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  HOST_DICTATION_MAX_DURATION_MS,
  HOST_DICTATION_SAMPLE_RATE,
  HOST_DICTATION_SETTINGS_PATH_ENV,
} from "../shared"
import { LiveTranscriptError } from "./errors"

/**
 * Server-side host-microphone dictation engine. Reuses the pi-transcribe
 * mechanism without its TUI trigger: pvrecorder captures 16 kHz mono Int16
 * frames on the server host, a transcribe-cpp session decodes the buffered
 * PCM against the model resolved from pi-transcribe settings (~/.pi/agent/
 * pi-transcribe.json), and the decoded text is returned to the caller.
 *
 * All external effects are injectable so unit tests run without a real
 * microphone, model, or native bindings.
 */

export interface HostDictationConfig {
  /** Absolute path to the GGUF model snapshot. */
  modelPath: string
  /** Transcription language; omit or "auto" for model default. */
  language?: string
}

export type HostDictationSettingsLoader = () => Promise<HostDictationConfig>

/** Frames are undefined once the device is closed or exhausted. */
export interface HostDictationRecorderHandle {
  read(): Promise<Int16Array | undefined>
  stop(): void
  release(): void
}

export type HostDictationRecorderFactory = (sampleRate: number) => Promise<HostDictationRecorderHandle>

export type HostDictationTranscribeFn = (pcm: Float32Array) => Promise<string>

export interface HostDictationEngineOptions {
  loadSettings?: HostDictationSettingsLoader
  createRecorder?: HostDictationRecorderFactory
  createTranscriber?: (config: HostDictationConfig) => Promise<HostDictationTranscribeFn>
  maxDurationMs?: number
}

export type HostDictationEngineState = "idle" | "recording" | "decoding"

function int16ToFloat32(frame: Int16Array): Float32Array {
  const out = new Float32Array(frame.length)
  for (let i = 0; i < frame.length; i++) out[i] = frame[i] / 32768
  return out
}

function unavailable(message: string, cause?: unknown): LiveTranscriptError {
  const error = new LiveTranscriptError(
    "live_dictation_unavailable",
    message,
    503,
  )
  if (cause !== undefined) error.cause = cause
  return error
}

/**
 * Resolves the configured model from the same settings file the pi-transcribe
 * extension writes (`~/.pi/agent/pi-transcribe.json`, overridable via env).
 * Only `model.path` and the optional transcription language are consumed.
 */
export function createPiTranscribeSettingsLoader(
  settingsPath?: string,
): HostDictationSettingsLoader {
  return async () => {
    const path =
      settingsPath ??
      (process.env[HOST_DICTATION_SETTINGS_PATH_ENV]?.trim() ||
        join(homedir(), ".pi", "agent", "pi-transcribe.json"))
    let raw: unknown
    try {
      raw = JSON.parse(await readFile(path, "utf8"))
    } catch (error) {
      throw unavailable(
        "Host dictation needs a configured transcription model. Run /transcribe once in any Pi session to choose one.",
        error,
      )
    }
    const model = (raw as { model?: { path?: unknown } } | null)?.model
    const modelPath = typeof model?.path === "string" ? model.path : ""
    if (!modelPath) {
      throw unavailable("pi-transcribe settings have no usable model path.")
    }
    try {
      await stat(modelPath)
    } catch (error) {
      throw unavailable(`The configured dictation model is missing at ${modelPath}.`, error)
    }
    const languageRaw = (raw as { transcriptionLanguage?: unknown }).transcriptionLanguage
    return {
      modelPath,
      ...(typeof languageRaw === "string" && languageRaw !== "auto"
        ? { language: languageRaw }
        : {}),
    }
  }
}

interface DefaultPvRecorder {
  start(): void
  read(): Promise<Int16Array>
  stop(): void
  release(): void
  readonly sampleRate: number
}

/** Default recorder: pvrecorder on the server host (lazy native import). */
export function createPvRecorderFactory(): HostDictationRecorderFactory {
  return async (sampleRate) => {
    let PvRecorderCtor: new (frameLength: number, deviceIndex: number) => DefaultPvRecorder
    try {
      const mod = await import("@picovoice/pvrecorder-node")
      PvRecorderCtor = mod.PvRecorder
    } catch (error) {
      throw unavailable("The host dictation recorder is not installed.", error)
    }
    let recorder: DefaultPvRecorder
    try {
      recorder = new PvRecorderCtor(512, -1)
      recorder.start()
    } catch (error) {
      throw unavailable(
        "No usable microphone on the server host. Host dictation requires local folder mode.",
        error,
      )
    }
    if (recorder.sampleRate !== sampleRate) {
      try {
        recorder.release()
      } catch {
        // best effort cleanup on a mismatched device
      }
      throw unavailable(
        `Host microphone reported ${recorder.sampleRate} Hz; expected ${sampleRate} Hz.`,
      )
    }
    return {
      read: () => recorder.read(),
      stop: () => recorder.stop(),
      release: () => recorder.release(),
    }
  }
}

/** Default decoder: transcribe-cpp against the resolved GGUF snapshot. */
export function createTranscribeCppTranscriber(): (
  config: HostDictationConfig,
) => Promise<HostDictationTranscribeFn> {
  return async (config) => {
    const { TranscribeModel } = await import("transcribe-cpp")
    const model = await TranscribeModel.load(config.modelPath)
    const session = model.createSession({ nThreads: 2 })
    return async (pcm) => {
      const result = await session.run(pcm, {
        timestamps: "none",
        ...(config.language ? { language: config.language } : {}),
      })
      return result.text.trim()
    }
  }
}

export interface HostDictationEngine {
  getState(): HostDictationEngineState
  /** Milliseconds of PCM captured in the active session (for elapsed UI). */
  getBufferedMs(): number
  start(): Promise<void>
  /** Finish capture and decode; resolves with the transcript text. */
  stop(): Promise<string>
  /** Discard the active capture; the engine returns to idle. */
  cancel(): void
}

export function createHostDictationEngine(
  options: HostDictationEngineOptions = {},
): HostDictationEngine {
  const loadSettings = options.loadSettings ?? createPiTranscribeSettingsLoader()
  const createRecorder = options.createRecorder ?? createPvRecorderFactory()
  const createTranscriber = options.createTranscriber ?? createTranscribeCppTranscriber()
  const maxDurationMs = options.maxDurationMs ?? HOST_DICTATION_MAX_DURATION_MS

  let state: HostDictationEngineState = "idle"
  let captureToken = 0
  let chunks: Float32Array[] = []
  let sampleCount = 0
  let loopDone: Promise<boolean | undefined> | undefined
  let pendingDecode: Promise<string> | undefined
  let autoResult: Promise<string> | undefined
  let cancelled = false
  let transcribe: HostDictationTranscribeFn | undefined

  const assertIdle = (): void => {
    if (state !== "idle") {
      throw new LiveTranscriptError(
        "live_transcript_already_active",
        "A host dictation capture is already active.",
        409,
      )
    }
  }

  function concatBufferedPcm(): Float32Array {
    const pcm = new Float32Array(sampleCount)
    let offset = 0
    for (const chunk of chunks) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }
    return pcm
  }

  function decodeBuffered(): Promise<string> {
    return (async () => {
      if (cancelled) {
        throw new LiveTranscriptError("live_transcript_not_active", "Capture was cancelled.", 409)
      }
      if (!transcribe) {
        throw new LiveTranscriptError(
          "live_transcript_upstream_failed",
          "Decoder was not initialized.",
          500,
        )
      }
      const pcm = concatBufferedPcm()
      if (pcm.length === 0) {
        throw new LiveTranscriptError(
          "live_transcript_invalid_audio",
          "Host dictation captured no audio.",
          400,
        )
      }
      try {
        return await transcribe(pcm)
      } catch (error) {
        if (error instanceof LiveTranscriptError) throw error
        throw new LiveTranscriptError(
          "live_transcript_upstream_failed",
          "Host dictation decoding failed.",
          502,
        )
      }
    })()
  }

  function settleDecode(promise: Promise<string>, isAuto: boolean): void {
    state = "decoding"
    pendingDecode = promise.finally(() => {
      if (pendingDecode === promise) pendingDecode = undefined
      if (isAuto && autoResult === promise) {
        // Keep the auto-submitted result readable by exactly one stop().
      } else {
        autoResult = undefined
      }
      state = "idle"
      chunks = []
      sampleCount = 0
      cancelled = false
    })
  }

  async function runCaptureLoop(
    token: number,
    recorder: HostDictationRecorderHandle,
  ): Promise<boolean> {
    // Resolves true when the duration cap auto-submits the capture.
    const maxSamples = Math.max(1, Math.floor((HOST_DICTATION_SAMPLE_RATE * maxDurationMs) / 1000))
    try {
      while (captureToken === token && !cancelled) {
        const frame = await recorder.read()
        if (frame === undefined || captureToken !== token || cancelled) break
        const pcm = int16ToFloat32(frame)
        chunks.push(pcm)
        sampleCount += pcm.length
        if (sampleCount >= maxSamples) return true
      }
    } catch (error) {
      chunks = []
      sampleCount = 0
      throw error
    } finally {
      try {
        recorder.stop()
      } catch {
        // device may already be closed
      }
      try {
        recorder.release()
      } catch {
        // idempotent best-effort cleanup
      }
    }
    return false
  }

  return {
    getState: () => state,

    getBufferedMs: () => Math.round((sampleCount / HOST_DICTATION_SAMPLE_RATE) * 1000),

    async start() {
      assertIdle()
      const config = await loadSettings().catch((error) => {
        if (error instanceof LiveTranscriptError) throw error
        throw unavailable("Could not resolve the dictation model configuration.", error)
      })
      assertIdle()
      if (!transcribe) {
        transcribe = await createTranscriber(config).catch((error) => {
          if (error instanceof LiveTranscriptError) throw error
          throw unavailable("Could not load the dictation model.", error)
        })
      }
      assertIdle()
      const token = ++captureToken
      let recorder: HostDictationRecorderHandle
      try {
        recorder = await createRecorder(HOST_DICTATION_SAMPLE_RATE)
      } catch (error) {
        if (error instanceof LiveTranscriptError) throw error
        throw unavailable("Could not open the host microphone.", error)
      }
      state = "recording"
      cancelled = false
      chunks = []
      sampleCount = 0
      autoResult = undefined
      loopDone = runCaptureLoop(token, recorder).catch(() => undefined)
      loopDone.then((capped) => {
        if (token !== captureToken || cancelled || state !== "recording") return
        if (capped) {
          const promise = decodeBuffered()
          autoResult = promise
          // Never-consumed auto results must not surface as unhandled rejections.
          void promise.catch(() => undefined)
          settleDecode(promise, true)
        }
      })
    },

    async stop() {
      if (autoResult) {
        const text = await autoResult
        autoResult = undefined
        return text
      }
      if (state === "decoding" && pendingDecode) return pendingDecode
      if (state !== "recording" || !loopDone) {
        throw new LiveTranscriptError(
          "live_transcript_not_active",
          "No host dictation capture is active.",
          409,
        )
      }
      captureToken++
      const failure = loopDone.then(async (capped) => {
        if (cancelled) {
          throw new LiveTranscriptError("live_transcript_not_active", "Capture was cancelled.", 409)
        }
        if (capped) {
          // The cap handler owns submission; wait for it instead of decoding twice.
          if (autoResult) return autoResult
        }
        return decodeBuffered()
      })
      settleDecode(failure.then(undefined, (error) => {
        throw error
      }), false)
      return pendingDecode!
    },

    cancel() {
      if (state !== "recording") return
      cancelled = true
      captureToken++
      chunks = []
      sampleCount = 0
      state = "idle"
      void loopDone
    },
  }
}
