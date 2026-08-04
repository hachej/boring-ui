import { LIVE_PCM_SAMPLE_RATE } from "../shared"

/** Pure reference converter used by tests and mirrored inside the AudioWorklet. */
export function downmixAndResample(
  channels: readonly Float32Array[],
  inputSampleRate: number,
  outputSampleRate = LIVE_PCM_SAMPLE_RATE,
): Int16Array {
  if (channels.length === 0 || inputSampleRate <= 0 || outputSampleRate <= 0) return new Int16Array()
  const length = Math.min(...channels.map((channel) => channel.length))
  const mono = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    let sample = 0
    for (const channel of channels) sample += channel[index] ?? 0
    mono[index] = sample / channels.length
  }
  const outputLength = Math.floor(length * outputSampleRate / inputSampleRate)
  const output = new Int16Array(outputLength)
  const ratio = inputSampleRate / outputSampleRate
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio
    const leftIndex = Math.floor(position)
    const rightIndex = Math.min(length - 1, leftIndex + 1)
    const fraction = position - leftIndex
    const sample = (mono[leftIndex] ?? 0) * (1 - fraction) + (mono[rightIndex] ?? 0) * fraction
    const clipped = Math.max(-1, Math.min(1, sample))
    output[index] = clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff)
  }
  return output
}
