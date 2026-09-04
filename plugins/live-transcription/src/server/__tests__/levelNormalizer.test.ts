// @vitest-environment node
import { describe, expect, it } from "vitest"
import { LevelNormalizer } from "../levelNormalizer"

function frame(peak: number, samples = 1_600): Uint8Array {
  const bytes = new Uint8Array(samples * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < samples; index += 1) view.setInt16(index * 2, Math.round(Math.sin(index / 7) * peak * 0x7fff), true)
  return bytes
}
function peakOf(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let peak = 0
  for (let index = 0; index < bytes.byteLength / 2; index += 1) peak = Math.max(peak, Math.abs(view.getInt16(index * 2, true)))
  return peak / 0x8000
}

describe("LevelNormalizer", () => {
  it("raises quiet speech towards the target peak and passes loud audio through untouched", () => {
    const normalizer = new LevelNormalizer({ targetPeak: 0.5 })
    let output = frame(0.05)
    for (let index = 0; index < 3; index += 1) output = normalizer.process(frame(0.05))
    expect(peakOf(output)).toBeCloseTo(0.5, 1)
    const loud = frame(0.9)
    const passthrough = normalizer.process(loud)
    // gain ramps down within the frame; once settled the frame is returned as-is
    expect(normalizer.currentGain).toBe(1)
    expect(normalizer.process(loud)).toBe(loud)
    expect(passthrough.byteLength).toBe(loud.byteLength)
  })

  it("never exceeds the maximum gain and holds gain over silence", () => {
    const normalizer = new LevelNormalizer({ targetPeak: 0.5, maxGain: 4 })
    normalizer.process(frame(0.01))
    expect(normalizer.currentGain).toBe(4)
    normalizer.process(frame(0.2))
    const settled = normalizer.currentGain
    for (let index = 0; index < 5; index += 1) normalizer.process(frame(0))
    expect(normalizer.currentGain).toBe(settled)
  })

  it("keeps the envelope on the slower release so a single loud frame does not pump the gain", () => {
    const normalizer = new LevelNormalizer({ targetPeak: 0.5, release: 0.9 })
    normalizer.process(frame(0.5))
    normalizer.process(frame(0.05))
    expect(normalizer.currentGain).toBeLessThan(1.2)
  })
})
