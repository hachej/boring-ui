import { describe, expect, it, vi } from "vitest"
import { SessionCreationCoordinator } from "../sessionCreationCoordinator"

interface Session { id: string; agentTypeId?: string }

describe("session creation coordinator", () => {
  it("serializes tasks and deduplicates matching queued intent", async () => {
    const coordinator = new SessionCreationCoordinator<Session>("source")
    const first = coordinator.coordinate({ dedupeKey: "first", create: vi.fn() })
    const duplicate = coordinator.coordinate({ dedupeKey: "first", create: vi.fn() })
    const second = coordinator.coordinate({ dedupeKey: "second", create: vi.fn() })
    expect(duplicate).toBe(first)
    const firstTask = coordinator.takeNext()!
    expect(coordinator.takeNext()).toBeNull()
    expect(coordinator.finish(firstTask, { value: { id: "first" } })).toBe(true)
    const secondTask = coordinator.takeNext()!
    expect(secondTask.dedupeKey).toBe("second")
    expect(coordinator.finish(secondTask, { value: { id: "second" } })).toBe(true)
    await expect(first).resolves.toEqual({ id: "first" })
    await expect(second).resolves.toEqual({ id: "second" })
  })

  it("cancels active and queued work before settlement callbacks can re-enter", async () => {
    const coordinator = new SessionCreationCoordinator<Session>("source")
    let reentrant!: Promise<Session | undefined>
    const active = coordinator.coordinate({ dedupeKey: "active", create: vi.fn() })
    const queued = coordinator.coordinate({
      dedupeKey: "queued", create: vi.fn(),
      onSettled: () => { reentrant = coordinator.coordinate({ dedupeKey: "reentrant", create: vi.fn() }) },
    })
    coordinator.takeNext()
    coordinator.cancel(() => true)
    await expect(active).resolves.toBeUndefined()
    await expect(queued).resolves.toBeUndefined()
    expect(coordinator.takeNext()?.dedupeKey).toBe("reentrant")
    coordinator.cancel(() => true)
    await expect(reentrant).resolves.toBeUndefined()
  })

  it("rejects reentrant settlement work while resetting", async () => {
    const coordinator = new SessionCreationCoordinator<Session>("source")
    let duringReset!: Promise<Session | undefined>
    const resetTask = coordinator.coordinate({
      dedupeKey: "reset", create: vi.fn(),
      onSettled: () => { duringReset = coordinator.coordinate({ dedupeKey: "during-reset", create: vi.fn() }) },
    })
    coordinator.reset("next")
    await expect(resetTask).resolves.toBeUndefined()
    await expect(duringReset).rejects.toMatchObject({ code: "SESSION_CREATE_COORDINATOR_UNAVAILABLE" })
    expect(coordinator.sourceKey).toBe("next")
  })

  it("detaches the active task before canonical callbacks run", async () => {
    const coordinator = new SessionCreationCoordinator<Session>("source")
    let next!: Promise<Session | undefined>
    const creation = coordinator.coordinate({
      dedupeKey: "first", create: vi.fn(),
      onResolved: () => { next = coordinator.coordinate({ dedupeKey: "next", create: vi.fn() }) },
    })
    const task = coordinator.takeNext()!
    coordinator.finish(task, { value: { id: "created" } })
    await expect(creation).resolves.toEqual({ id: "created" })
    expect(coordinator.takeNext()?.dedupeKey).toBe("next")
    coordinator.cancel(() => true)
    await expect(next).resolves.toBeUndefined()
  })

  it("runs onSettled and rejects with an onResolved failure while leaving the queue available", async () => {
    const coordinator = new SessionCreationCoordinator<Session>("source")
    const callbackError = new Error("resolved callback failed")
    const onSettled = vi.fn()
    const creation = coordinator.coordinate({
      dedupeKey: "first", create: vi.fn(), onResolved: () => { throw callbackError }, onSettled,
    })
    coordinator.finish(coordinator.takeNext()!, { value: { id: "created" } })
    await expect(creation).rejects.toBe(callbackError)
    expect(onSettled).toHaveBeenCalledOnce()
    const retry = coordinator.coordinate({ dedupeKey: "retry", create: vi.fn() })
    coordinator.finish(coordinator.takeNext()!, { value: { id: "retry" } })
    await expect(retry).resolves.toEqual({ id: "retry" })
  })

  it("runs onSettled and rejects with an onError failure", async () => {
    const coordinator = new SessionCreationCoordinator<Session>("source")
    const transportError = new Error("transport failed")
    const callbackError = new Error("error callback failed")
    const onSettled = vi.fn()
    const creation = coordinator.coordinate({
      dedupeKey: "first", create: vi.fn(), onError: () => { throw callbackError }, onSettled,
    })
    coordinator.finish(coordinator.takeNext()!, { error: transportError })
    await expect(creation).rejects.toBe(callbackError)
    expect(onSettled).toHaveBeenCalledOnce()
  })
})
