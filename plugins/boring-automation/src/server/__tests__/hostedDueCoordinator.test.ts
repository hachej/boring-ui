import { describe, expect, it, vi } from "vitest"
import { HostedDueCoordinator } from "../hostedDueCoordinator"
import type { HostedDueRunResult } from "../hostedDueRunService"

const RESULT: HostedDueRunResult = {
  now: "2026-07-23T09:00:00.000Z",
  outcomes: [],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe("HostedDueCoordinator", () => {
  it("shares one due evaluation across overlapping timer and HTTP wake-ups", async () => {
    const first = deferred<HostedDueRunResult>()
    const runDue = vi.fn()
      .mockImplementationOnce(async () => await first.promise)
      .mockResolvedValue(RESULT)
    const coordinator = new HostedDueCoordinator({ runDue })
    const request = { id: "request-1" } as never

    const timerRun = coordinator.runDue()
    const endpointRun = coordinator.runDue(request)
    expect(runDue).toHaveBeenCalledOnce()
    expect(endpointRun).toBe(timerRun)

    first.resolve(RESULT)
    await expect(Promise.all([timerRun, endpointRun])).resolves.toEqual([RESULT, RESULT])

    await expect(coordinator.runDue(request)).resolves.toEqual(RESULT)
    expect(runDue).toHaveBeenCalledTimes(2)
    expect(runDue).toHaveBeenLastCalledWith(request)
  })

  it("clears rejected evaluations so later ticks can retry", async () => {
    const runDue = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue(RESULT)
    const coordinator = new HostedDueCoordinator({ runDue })

    await expect(coordinator.runDue()).rejects.toThrow("temporary")
    await expect(coordinator.runDue()).resolves.toEqual(RESULT)
    expect(runDue).toHaveBeenCalledTimes(2)
  })
})
