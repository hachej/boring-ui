import type { LiveTranscriptError } from "./errors"
import { KyutaiConnection } from "./kyutai"
import { SortformerConnection } from "./sortformer"
import type { WhisperLiveKitLine, WhisperLiveKitSnapshot } from "./whisperLiveKit"

interface StreamingUpstream {
  connect(): Promise<void>
  sendPcm(data: Uint8Array): Promise<void>
  drain(timeoutMs: number): Promise<void>
  close(): void
}

const DIARIZER_CONNECT_TIMEOUT_MS = 5_000
const DIARIZER_HIGH_WATER_BYTES = 4 * 1024 * 1024

interface UpstreamCallbacks {
  onSnapshot: (snapshot: WhisperLiveKitSnapshot) => void
  onFailure: (error: LiveTranscriptError) => void
}

/** Kyutai text authority enriched by best-effort raw Sortformer speaker intervals. */
export class KyutaiDiarizedConnection implements StreamingUpstream {
  private readonly kyutai: StreamingUpstream
  private diarizer: StreamingUpstream | undefined
  private kyutaiSnapshot: WhisperLiveKitSnapshot | undefined
  private diarizerSnapshot: WhisperLiveKitSnapshot | undefined
  private closed = false

  constructor(
    kyutaiUrl: string,
    diarizerUrl: string,
    private readonly callbacks: UpstreamCallbacks,
    options: {
      kyutaiApiKey?: string
      diarizerBearerToken?: string
      highWaterBytes?: number
      createKyutaiForTest?: (callbacks: UpstreamCallbacks) => StreamingUpstream
      createDiarizerForTest?: (callbacks: UpstreamCallbacks) => StreamingUpstream
    } = {},
  ) {
    const kyutaiCallbacks: UpstreamCallbacks = {
      onSnapshot: (snapshot) => {
        this.kyutaiSnapshot = snapshot
        this.publishMergedSnapshot()
      },
      onFailure: (error) => callbacks.onFailure(error),
    }
    const diarizerCallbacks: UpstreamCallbacks = {
      onSnapshot: (snapshot) => {
        this.diarizerSnapshot = snapshot
        this.publishMergedSnapshot()
      },
      onFailure: () => this.disableDiarizer(),
    }
    this.kyutai = options.createKyutaiForTest?.(kyutaiCallbacks) ?? new KyutaiConnection(
      kyutaiUrl,
      kyutaiCallbacks,
      { apiKey: options.kyutaiApiKey, highWaterBytes: options.highWaterBytes },
    )
    this.diarizer = options.createDiarizerForTest?.(diarizerCallbacks) ?? new SortformerConnection(
      diarizerUrl,
      diarizerCallbacks,
      {
        bearerToken: options.diarizerBearerToken,
        highWaterBytes: Math.max(options.highWaterBytes ?? 0, DIARIZER_HIGH_WATER_BYTES),
      },
    )
  }

  async connect(): Promise<void> {
    const diarizer = this.diarizer
    const diarizerConnect = diarizer
      ? settleWithin(diarizer.connect(), DIARIZER_CONNECT_TIMEOUT_MS)
      : Promise.resolve(true)
    try {
      await this.kyutai.connect()
    } catch (error) {
      this.close()
      throw error
    }
    if (!await diarizerConnect) this.disableDiarizer()
  }

  async sendPcm(data: Uint8Array): Promise<void> {
    await this.kyutai.sendPcm(data)
    const diarizer = this.diarizer
    if (!diarizer) return
    try {
      await diarizer.sendPcm(downsamplePcm24kTo16k(data))
    } catch {
      this.disableDiarizer()
    }
  }

  async drain(timeoutMs: number): Promise<void> {
    const diarizer = this.diarizer
    const diarizerDrain = diarizer?.drain(timeoutMs).catch(() => this.disableDiarizer()) ?? Promise.resolve()
    await Promise.all([this.kyutai.drain(timeoutMs), diarizerDrain])
    this.publishMergedSnapshot()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.kyutai.close()
    this.diarizer?.close()
    this.diarizer = undefined
  }

  private disableDiarizer(): void {
    const diarizer = this.diarizer
    if (!diarizer) return
    this.diarizer = undefined
    // Preserve the last trustworthy covered intervals. Future words outside
    // that coverage remain unknown while Kyutai continues fail-open.
    diarizer.close()
    this.publishMergedSnapshot()
  }

  private publishMergedSnapshot(): void {
    const snapshot = this.kyutaiSnapshot
    if (!snapshot || this.closed) return
    this.callbacks.onSnapshot(mergeKyutaiWordsWithSpeakers(snapshot, this.diarizerSnapshot))
  }
}

export function downsamplePcm24kTo16k(data: Uint8Array): Uint8Array {
  if (data.byteLength === 0 || data.byteLength % 6 !== 0) throw new Error("24 kHz PCM frame must contain a whole number of 3-sample groups")
  const input = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const inputSamples = data.byteLength / 2
  const output = new Uint8Array(inputSamples * 2 / 3 * 2)
  const view = new DataView(output.buffer)
  for (let index = 0; index < output.byteLength / 2; index += 1) {
    const position = index * 3 / 2
    const left = Math.floor(position)
    const right = Math.min(inputSamples - 1, left + 1)
    const fraction = position - left
    const sample = input.getInt16(left * 2, true) * (1 - fraction) + input.getInt16(right * 2, true) * fraction
    view.setInt16(index * 2, Math.max(-32_768, Math.min(32_767, Math.round(sample))), true)
  }
  return output
}

/**
 * Streaming Sortformer reports speaker changes late: on a two-voice bench with
 * turns at known instants, its change points trailed the truth by 0.42–0.67 s
 * (median 0.50 s — one 1 s chunk decoded with a 400 ms confirmation window).
 * Words spoken in that lag were credited to the previous speaker. Shifting the
 * intervals back by this amount took per-word accuracy from 89 % to 96 %.
 */
export const DIARIZATION_LAG_SECONDS = 0.5

export function mergeKyutaiWordsWithSpeakers(
  kyutai: WhisperLiveKitSnapshot,
  diarization: WhisperLiveKitSnapshot | undefined,
  options: { lagSeconds?: number } = {},
): WhisperLiveKitSnapshot {
  const intervals = speakerIntervals(diarization?.lines ?? [], options.lagSeconds ?? DIARIZATION_LAG_SECONDS)
  const words = kyutai.lines
  const raw = words.map((word, index) => bestSpeaker(word, words[index + 1], intervals))
  // A word Sortformer has no evidence for keeps the speaker of the previous
  // word: a turn does not change silently in the middle of a sentence. Only
  // words before any evidence stay unknown.
  const carried: number[] = []
  let last = -1
  for (const speaker of raw) {
    if (speaker !== undefined) last = speaker
    carried.push(last)
  }
  // One word labelled differently from both of its neighbours is a decoder
  // flicker, not a one-word interjection: give it the neighbours' speaker.
  const smoothed = carried.slice()
  for (let index = 1; index < smoothed.length - 1; index += 1) {
    if (carried[index - 1] === carried[index + 1] && carried[index] !== carried[index - 1]) smoothed[index] = carried[index - 1]!
  }
  return {
    ...kyutai,
    lines: words.map((word, index) => ({ ...word, speaker: smoothed[index] ?? -1 })),
  }
}

async function settleWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise.then(() => true, () => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function speakerIntervals(lines: readonly WhisperLiveKitLine[], lagSeconds: number): Array<WhisperLiveKitLine & { endSeconds: number }> {
  const sorted = [...lines].sort((left, right) => left.startSeconds - right.startSeconds || left.speaker - right.speaker)
  // Streaming Sortformer speaker slots are arrival-ordered and stable for one
  // socket session. Preserve them rather than renumbering each revised snapshot.
  return sorted.flatMap((line, index) => {
    const endSeconds = line.endSeconds ?? sorted[index + 1]?.startSeconds
    if (endSeconds === undefined || endSeconds < line.startSeconds) return []
    return [{ ...line, startSeconds: Math.max(0, line.startSeconds - lagSeconds), endSeconds: Math.max(0, endSeconds - lagSeconds) }]
  })
}

function bestSpeaker(
  word: WhisperLiveKitLine,
  nextWord: WhisperLiveKitLine | undefined,
  intervals: readonly (WhisperLiveKitLine & { endSeconds: number })[],
): number | undefined {
  const end = word.endSeconds ?? nextWord?.startSeconds
  if (end === undefined || end <= word.startSeconds) {
    return intervals.find((segment) => segment.startSeconds <= word.startSeconds && word.startSeconds < segment.endSeconds)?.speaker
  }
  let best: { speaker: number; overlap: number; start: number } | undefined
  for (const segment of intervals) {
    const overlap = Math.max(0, Math.min(end, segment.endSeconds) - Math.max(word.startSeconds, segment.startSeconds))
    if (overlap <= 0) continue
    if (!best || overlap > best.overlap || (overlap === best.overlap && (segment.startSeconds < best.start || (segment.startSeconds === best.start && segment.speaker < best.speaker)))) {
      best = { speaker: segment.speaker, overlap, start: segment.startSeconds }
    }
  }
  return best?.speaker
}
