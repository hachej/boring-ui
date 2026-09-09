// @vitest-environment node
import { describe, expect, it } from "vitest"
import { LIVE_FRAMES_IN_FLIGHT } from "../../shared"
import { LIVE_TRANSCRIPT_WORKLET_SOURCE } from "../worklet"

class FakePort { messages: Array<{ type: string; data?: ArrayBuffer }> = []; onmessage: ((event: { data: unknown }) => void) | undefined; postMessage(message: { type: string; data?: ArrayBuffer }) { this.messages.push(message) } }
class FakeProcessor { port = new FakePort() }

function instantiate(processorOptions: Record<string, unknown> = {}) {
  let registered: new (options: unknown) => { port: FakePort; process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean }
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", LIVE_TRANSCRIPT_WORKLET_SOURCE)(FakeProcessor, (_name: string, ctor: typeof registered) => { registered = ctor }, 16_000)
  return new registered!({ processorOptions: { outputSampleRate: 16_000, frameSamples: 160, ...processorOptions } })
}

const oneFrame = () => [[new Float32Array(160).fill(0.1)]]

describe("live transcript worklet flow control", () => {
  it("keeps several frames in flight before requiring an ACK, then queues", () => {
    const node = instantiate()
    for (let index = 0; index < LIVE_FRAMES_IN_FLIGHT + 3; index += 1) node.process(oneFrame(), [])
    expect(node.port.messages.filter((message) => message.type === "frame")).toHaveLength(LIVE_FRAMES_IN_FLIGHT)
    node.port.onmessage!({ data: { type: "ack" } })
    expect(node.port.messages.filter((message) => message.type === "frame")).toHaveLength(LIVE_FRAMES_IN_FLIGHT + 1)
    expect(node.port.messages.some((message) => message.type === "overflow")).toBe(false)
  })

  it("reports overflow only once the bounded queue is full", () => {
    const node = instantiate({ maxInFlight: 1 })
    const overflows = () => node.port.messages.filter((message) => message.type === "overflow").length
    let calls = 0
    while (overflows() === 0 && calls < 100) { node.process(oneFrame(), []); calls += 1 }
    // one frame in flight + a 30-frame queue, then the 32nd frame overflows
    expect(calls).toBeGreaterThanOrEqual(32)
    expect(node.port.messages.filter((message) => message.type === "frame")).toHaveLength(1)
    for (let index = 0; index < 5; index += 1) node.process(oneFrame(), [])
    expect(overflows()).toBe(1)
  })
})
