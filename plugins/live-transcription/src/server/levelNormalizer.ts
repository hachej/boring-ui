/**
 * Upward-only automatic gain for 16-bit PCM frames.
 *
 * Measured on the RTX 3080 Ti box with SimSAMU (French dispatch calls whose
 * audio peaks around -27 dBFS): Kyutai `stt-1b-en_fr` emitted *no words at
 * all* for a whole two-minute recording, while the same audio multiplied by
 * four transcribed normally. Browser AGC usually keeps a headset in range, but
 * a distant or badly configured microphone must not produce an empty
 * transcript, so the server raises quiet input towards a target peak before
 * it reaches the transcriber and the diarizer. Loud input is left untouched.
 */
export interface LevelNormalizerOptions {
  /** Peak level (0..1) the envelope is raised towards. */
  targetPeak?: number
  /** Never amplify more than this (linear). */
  maxGain?: number
  /** Peaks below this (0..1) are treated as silence: the gain holds instead of ramping up on noise. */
  noiseFloor?: number
  /** Multiplier applied to the peak envelope every frame (100 ms): slow release so gain does not pump. */
  release?: number
}

export class LevelNormalizer {
  private envelope = 0
  private gain = 1
  private readonly targetPeak: number
  private readonly maxGain: number
  private readonly noiseFloor: number
  private readonly release: number

  constructor(options: LevelNormalizerOptions = {}) {
    this.targetPeak = options.targetPeak ?? 0.5
    this.maxGain = options.maxGain ?? 16
    this.noiseFloor = options.noiseFloor ?? 0.004
    this.release = options.release ?? 0.97
  }

  /** Current linear gain (for diagnostics and tests). */
  get currentGain(): number {
    return this.gain
  }

  /** Returns the frame with gain applied; the input is not modified. Frames at or above target pass through unchanged. */
  process(frame: Uint8Array): Uint8Array {
    if (frame.byteLength === 0 || frame.byteLength % 2 !== 0) return frame
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    const samples = frame.byteLength / 2
    let peak = 0
    for (let index = 0; index < samples; index += 1) {
      const magnitude = Math.abs(view.getInt16(index * 2, true))
      if (magnitude > peak) peak = magnitude
    }
    const normalizedPeak = peak / 0x8000
    const previousGain = this.gain
    // Silence neither releases the envelope nor raises the gain: room noise in
    // a pause must not be amplified into something the transcriber hears.
    if (normalizedPeak >= this.noiseFloor) {
      this.envelope = Math.max(normalizedPeak, this.envelope * this.release)
      this.gain = Math.min(this.maxGain, Math.max(1, this.targetPeak / this.envelope))
    }
    if (previousGain === 1 && this.gain === 1) return frame
    const output = new Uint8Array(frame.byteLength)
    const outputView = new DataView(output.buffer)
    for (let index = 0; index < samples; index += 1) {
      // Ramp linearly across the frame so a gain change never clicks.
      const gain = previousGain + (this.gain - previousGain) * (index / samples)
      const value = Math.round(view.getInt16(index * 2, true) * gain)
      outputView.setInt16(index * 2, Math.max(-32_768, Math.min(32_767, value)), true)
    }
    return output
  }
}
