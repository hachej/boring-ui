import { describe, expect, expectTypeOf, it, vi } from "vitest"

import {
  noopTelemetry,
  safeCapture,
  type TelemetryEvent,
  type TelemetrySink,
} from "../telemetry"

describe("telemetry contract", () => {
  const event: TelemetryEvent = {
    name: "telemetry.test",
    distinctId: "user-1",
    properties: { status: "ok" },
  }

  it("noop capture accepts events without side effects", () => {
    expect(() => noopTelemetry.capture(event)).not.toThrow()
  })

  it("safeCapture forwards normal captures", () => {
    const capture = vi.fn()
    const telemetry: TelemetrySink = { capture }

    safeCapture(telemetry, event)

    expect(capture).toHaveBeenCalledWith(event)
  })

  it("safeCapture swallows synchronous capture failures", () => {
    const telemetry: TelemetrySink = {
      capture() {
        throw new Error("sync telemetry failure")
      },
    }

    expect(() => safeCapture(telemetry, event)).not.toThrow()
  })

  it("safeCapture swallows asynchronous capture rejections", async () => {
    const telemetry: TelemetrySink = {
      capture: vi.fn().mockRejectedValue(new Error("async telemetry failure")),
    }

    expect(() => safeCapture(telemetry, event)).not.toThrow()
    await Promise.resolve()
  })

  it("allows sinks to expose an optional flush hook", async () => {
    const flush = vi.fn().mockResolvedValue(undefined)
    const telemetry: TelemetrySink = {
      capture() {},
      flush,
    }

    await telemetry.flush?.()

    expect(flush).toHaveBeenCalledOnce()
  })

  it("keeps the TelemetrySink shape structural", () => {
    expectTypeOf<TelemetrySink>().toEqualTypeOf<{
      capture: (event: TelemetryEvent) => void | Promise<void>
      flush?: () => void | Promise<void>
    }>()
  })
})
