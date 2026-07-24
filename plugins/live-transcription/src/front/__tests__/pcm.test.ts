import { describe, expect, it } from "vitest"
import { downmixAndResample } from "../pcm"

function sine(sampleRate: number, seconds: number, phase = 0): Float32Array {
  return Float32Array.from({ length: Math.floor(sampleRate * seconds) }, (_, index) =>
    Math.sin(2 * Math.PI * 440 * index / sampleRate + phase))
}

describe("PCM16 browser conversion", () => {
  it.each([44_100, 48_000])("downmixes and resamples %i Hz input to mono 16 kHz", (sampleRate) => {
    const output = downmixAndResample([sine(sampleRate, 0.1), sine(sampleRate, 0.1, Math.PI / 4)], sampleRate)
    expect(output).toHaveLength(1_600)
    expect(output.some((sample) => sample !== 0)).toBe(true)
    expect(Math.max(...output)).toBeLessThanOrEqual(32_767)
    expect(Math.min(...output)).toBeGreaterThanOrEqual(-32_768)
  })

  it("clips signed PCM16 at the exact integer range", () => {
    expect([...downmixAndResample([new Float32Array([2, -2])], 16_000)]).toEqual([32_767, -32_768])
  })
})
