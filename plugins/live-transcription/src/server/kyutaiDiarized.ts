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
  private readonly resampler = new Pcm24kTo16kResampler()

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
      await diarizer.sendPcm(this.resampler.process(data))
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

/**
 * 24 kHz to 16 kHz with anti-aliasing. Linear interpolation alone folds the
 * 8 to 12 kHz band back into the diarizer's input; this uses a windowed-sinc
 * interpolation kernel with an 8 kHz cutoff, keeping a short tail of input
 * across frames so the filter is continuous at frame boundaries.
 */
export class Pcm24kTo16kResampler {
  private static readonly HALF_TAPS = 12
  private tail = new Int16Array(0)
  private readonly kernel: Float32Array

  constructor() {
    // Windowed sinc, cutoff at fs_out/2 = 8 kHz expressed in input samples (24 kHz): 2*8/24 = 2/3.
    const taps = Pcm24kTo16kResampler.HALF_TAPS * 2 + 1
    this.kernel = new Float32Array(taps)
    let sum = 0
    for (let index = 0; index < taps; index += 1) {
      const x = index - Pcm24kTo16kResampler.HALF_TAPS
      const sinc = x === 0 ? 2 / 3 : Math.sin(Math.PI * x * 2 / 3) / (Math.PI * x)
      const window = 0.54 + 0.46 * Math.cos(Math.PI * x / Pcm24kTo16kResampler.HALF_TAPS)
      this.kernel[index] = sinc * window
      sum += this.kernel[index]!
    }
    for (let index = 0; index < taps; index += 1) this.kernel[index]! /= sum
  }

  /** Consumes one frame of little-endian PCM16 and returns the resampled frame (2/3 of the samples). */
  process(data: Uint8Array): Uint8Array {
    if (data.byteLength === 0 || data.byteLength % 6 !== 0) throw new Error("24 kHz PCM frame must contain a whole number of 3-sample groups")
    const half = Pcm24kTo16kResampler.HALF_TAPS
    const incoming = new Int16Array(data.byteLength / 2)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let index = 0; index < incoming.length; index += 1) incoming[index] = view.getInt16(index * 2, true)
    // The filter is centred `half` samples behind the newest input, so output
    // lags by half a kernel (0.5 ms); the tail carries the previous frame's end.
    const buffer = new Int16Array(this.tail.length + incoming.length)
    buffer.set(this.tail, 0)
    buffer.set(incoming, this.tail.length)
    const outputSamples = incoming.length * 2 / 3
    const output = new Uint8Array(outputSamples * 2)
    const outputView = new DataView(output.buffer)
    const base = this.tail.length - half  // position of the first input sample of this frame, minus the filter delay
    for (let index = 0; index < outputSamples; index += 1) {
      const centre = base + index * 1.5
      const left = Math.floor(centre)
      const fraction = centre - left
      let acc = 0
      for (let tap = -half; tap <= half; tap += 1) {
        const at = left + tap
        const weight = this.kernel[tap + half]! * (1 - fraction) + (this.kernel[tap + half + 1] ?? 0) * fraction
        const sample = at < 0 ? (this.tail.length ? buffer[0]! : 0) : at >= buffer.length ? buffer[buffer.length - 1]! : buffer[at]!
        acc += sample * weight
      }
      outputView.setInt16(index * 2, Math.max(-32_768, Math.min(32_767, Math.round(acc))), true)
    }
    this.tail = buffer.slice(Math.max(0, buffer.length - 2 * half - 2))
    return output
  }
}

/** Stateless single-frame convenience used by tests and one-off callers. */
export function downsamplePcm24kTo16k(data: Uint8Array): Uint8Array {
  return new Pcm24kTo16kResampler().process(data)
}

/**
 * Streaming Sortformer reports speaker changes late: the sidecar confirms a
 * switch over two 80 ms frames and only emits at chunk boundaries, so a
 * change point lands after the true turn. Measured on SimSAMU (61 French
 * two-speaker calls with word-level references) the boundary trails the
 * reference by a median 0.20 s with the 0.5 s-chunk sidecar; shifting the
 * intervals back by that amount maximises per-word speaker accuracy
 * (92.5 %; 0.1 s and 0.35 s both lose about a point). The previous 1 s-chunk,
 * five-frame sidecar needed 0.5 s.
 */
export const DIARIZATION_LAG_SECONDS = 0.2

export function mergeKyutaiWordsWithSpeakers(
  kyutai: WhisperLiveKitSnapshot,
  diarization: WhisperLiveKitSnapshot | undefined,
  options: { lagSeconds?: number } = {},
): WhisperLiveKitSnapshot {
  const intervals = cachedSpeakerIntervals(diarization, options.lagSeconds ?? DIARIZATION_LAG_SECONDS)
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

type SpeakerInterval = WhisperLiveKitLine & { endSeconds: number }

// Kyutai publishes on every Word and EndWord (about five times a second) while
// the diarizer snapshot changes about once a second. Sorting and shifting the
// intervals once per diarizer snapshot instead of per word event keeps the
// merge linear in the number of words over a long consultation.
const intervalCache = new WeakMap<WhisperLiveKitSnapshot, Map<number, SpeakerInterval[]>>()

function cachedSpeakerIntervals(diarization: WhisperLiveKitSnapshot | undefined, lagSeconds: number): SpeakerInterval[] {
  if (!diarization) return []
  let byLag = intervalCache.get(diarization)
  if (!byLag) {
    byLag = new Map()
    intervalCache.set(diarization, byLag)
  }
  let intervals = byLag.get(lagSeconds)
  if (!intervals) {
    intervals = speakerIntervals(diarization.lines, lagSeconds)
    byLag.set(lagSeconds, intervals)
  }
  return intervals
}

function speakerIntervals(lines: readonly WhisperLiveKitLine[], lagSeconds: number): SpeakerInterval[] {
  const sorted = [...lines].sort((left, right) => left.startSeconds - right.startSeconds || left.speaker - right.speaker)
  // Streaming Sortformer speaker slots are arrival-ordered and stable for one
  // socket session. Preserve them rather than renumbering each revised snapshot.
  return sorted.flatMap((line, index) => {
    const endSeconds = line.endSeconds ?? sorted[index + 1]?.startSeconds
    if (endSeconds === undefined || endSeconds < line.startSeconds) return []
    return [{ ...line, startSeconds: Math.max(0, line.startSeconds - lagSeconds), endSeconds: Math.max(0, endSeconds - lagSeconds) }]
  })
}

/** Index of the first interval starting at or after `time` (intervals sorted by start). */
function firstIntervalAtOrAfter(intervals: readonly SpeakerInterval[], time: number): number {
  let low = 0
  let high = intervals.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (intervals[middle]!.startSeconds < time) low = middle + 1
    else high = middle
  }
  return low
}

// The sidecar emits one speaker per frame, so intervals never overlap and a
// word can only touch the intervals that start before it ends and have not
// yet ended when it starts: a binary search plus a short backward scan.
function bestSpeaker(
  word: WhisperLiveKitLine,
  nextWord: WhisperLiveKitLine | undefined,
  intervals: readonly SpeakerInterval[],
): number | undefined {
  const end = word.endSeconds ?? nextWord?.startSeconds
  const point = end === undefined || end <= word.startSeconds
  const upper = firstIntervalAtOrAfter(intervals, point ? word.startSeconds + Number.EPSILON : end)
  let best: { speaker: number; overlap: number; start: number } | undefined
  for (let index = upper - 1; index >= 0; index -= 1) {
    const segment = intervals[index]!
    if (segment.endSeconds <= word.startSeconds) break
    if (point) {
      if (segment.startSeconds <= word.startSeconds && word.startSeconds < segment.endSeconds) return segment.speaker
      continue
    }
    const overlap = Math.min(end!, segment.endSeconds) - Math.max(word.startSeconds, segment.startSeconds)
    if (overlap <= 0) continue
    if (!best || overlap > best.overlap || (overlap === best.overlap && (segment.startSeconds < best.start || (segment.startSeconds === best.start && segment.speaker < best.speaker)))) {
      best = { speaker: segment.speaker, overlap, start: segment.startSeconds }
    }
  }
  return best?.speaker
}
