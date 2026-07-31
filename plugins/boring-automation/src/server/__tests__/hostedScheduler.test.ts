import { describe, expect, it, vi } from "vitest"
import { HostedAutomationScheduler } from "../hostedScheduler"
import type { HostedDueRunResult } from "../hostedDueRunService"

const EMPTY_RESULT: HostedDueRunResult = {
  now: "2026-07-23T09:00:00.000Z",
  outcomes: [],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function logger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}

describe("HostedAutomationScheduler", () => {
  it("uses Croner to wake again at the next minute", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-23T09:00:30.000Z"))
    const runDue = vi.fn(async () => EMPTY_RESULT)
    const scheduler = new HostedAutomationScheduler({ runDue, logger: logger() as never })
    try {
      scheduler.start()
      expect(runDue).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(30_000)
      expect(runDue).toHaveBeenCalledTimes(2)
    } finally {
      scheduler.beginShutdown()
      vi.useRealTimers()
    }
  })

  it("ticks at startup, prevents overlap, and stops the Croner job", async () => {
    const first = deferred<HostedDueRunResult>()
    const runDue = vi.fn()
      .mockImplementationOnce(async () => await first.promise)
      .mockResolvedValue(EMPTY_RESULT)
    const log = logger()
    const stop = vi.fn()
    let scheduledTick: (() => Promise<void>) | undefined
    const scheduleCron = vi.fn((tick: () => Promise<void>) => {
      scheduledTick = tick
      return { stop }
    })
    const scheduler = new HostedAutomationScheduler({ runDue, logger: log as never, scheduleCron })

    scheduler.start()
    expect(scheduleCron).toHaveBeenCalledOnce()
    expect(runDue).toHaveBeenCalledOnce()

    await scheduledTick!()
    expect(runDue).toHaveBeenCalledOnce()

    first.resolve(EMPTY_RESULT)
    await vi.waitFor(() => expect(log.debug).toHaveBeenCalledOnce())
    await scheduledTick!()
    expect(runDue).toHaveBeenCalledTimes(2)

    scheduler.beginShutdown()
    expect(stop).toHaveBeenCalledOnce()
    await scheduledTick!()
    expect(runDue).toHaveBeenCalledTimes(2)
  })

  it("sanitizes tick failures and continues on the next minute", async () => {
    const runDue = vi.fn()
      .mockRejectedValueOnce(new Error("postgres://user:secret@example.test/private"))
      .mockResolvedValue(EMPTY_RESULT)
    const log = logger()
    let scheduledTick: (() => Promise<void>) | undefined
    const scheduler = new HostedAutomationScheduler({
      runDue,
      logger: log as never,
      scheduleCron: (tick) => {
        scheduledTick = tick
        return { stop: vi.fn() }
      },
    })

    scheduler.start()
    await vi.waitFor(() => expect(log.error).toHaveBeenCalledOnce())
    expect(log.error.mock.calls[0]?.[0]).toEqual({
      automationScheduler: { event: "tick-failed", errorName: "Error" },
    })
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("secret")

    await scheduledTick!()
    expect(runDue).toHaveBeenCalledTimes(2)
    expect(log.debug).toHaveBeenCalledOnce()
    scheduler.beginShutdown()
  })

  it("fences future ticks without waiting for an active durable run", async () => {
    const active = deferred<HostedDueRunResult>()
    const stopJob = vi.fn()
    const completed = vi.fn()
    const scheduler = new HostedAutomationScheduler({
      runDue: async () => {
        const result = await active.promise
        completed()
        return result
      },
      logger: logger() as never,
      scheduleCron: () => ({ stop: stopJob }),
    })
    scheduler.start()

    scheduler.beginShutdown()
    expect(stopJob).toHaveBeenCalledOnce()
    expect(completed).not.toHaveBeenCalled()

    active.resolve(EMPTY_RESULT)
    await vi.waitFor(() => expect(completed).toHaveBeenCalledOnce())
  })
})
