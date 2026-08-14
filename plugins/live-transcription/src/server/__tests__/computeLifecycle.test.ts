// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { ComputeLifecycleCoordinator, validateLifecycleUrl, type LifecycleClient } from "../computeLifecycle"

afterEach(() => vi.useRealTimers())

describe("ComputeLifecycleCoordinator", () => {
  it("warms once, adopts, heartbeats, and releases after capture ends", async () => {
    vi.useFakeTimers()
    const client = fakeClient()
    const coordinator = new ComputeLifecycleCoordinator(client)
    let active = true
    coordinator.setActiveChecker(() => active)
    const preparation = coordinator.prepare("live")
    expect(preparation.state).toBe("warming")
    await vi.waitFor(() => expect(coordinator.status(preparation.preparationId).state).toBe("ready"))
    const lease = coordinator.take(preparation.preparationId, "live")
    coordinator.adopt(lease)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(client.heartbeat).toHaveBeenCalled()
    active = false
    await vi.advanceTimersByTimeAsync(2_000)
    expect(client.release).toHaveBeenCalledWith("lease-1")
    await coordinator.close()
  })

  it("releases a ready preparation that is cancelled", async () => {
    const client = fakeClient()
    const coordinator = new ComputeLifecycleCoordinator(client)
    const preparation = coordinator.prepare("composer")
    await vi.waitFor(() => expect(coordinator.status(preparation.preparationId).state).toBe("ready"))
    await coordinator.cancel(preparation.preparationId)
    expect(client.release).toHaveBeenCalledWith("lease-1")
  })

  it("rejects wrong kinds and unsafe lifecycle authorities", async () => {
    const coordinator = new ComputeLifecycleCoordinator(fakeClient())
    const preparation = coordinator.prepare("live")
    await vi.waitFor(() => expect(coordinator.status(preparation.preparationId).state).toBe("ready"))
    expect(() => coordinator.take(preparation.preparationId, "composer")).toThrow(expect.objectContaining({ code: "live_transcript_upstream_failed" }))
    expect(validateLifecycleUrl("http://127.0.0.1:18882/v1")).toBe("http://127.0.0.1:18882/v1")
    expect(() => validateLifecycleUrl("https://remote.example/v1")).toThrow(expect.objectContaining({ code: "live_transcript_local_only" }))
  })
})

function fakeClient(): LifecycleClient & { acquire: ReturnType<typeof vi.fn>; heartbeat: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } {
  return {
    acquire: vi.fn(async () => ({ id: "lease-1" })),
    heartbeat: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  }
}
