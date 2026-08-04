import { describe, expect, it, vi } from "vitest"
import { SessionCreationCoordinator, type SessionCreationCoordinatorRuntime } from "../sessionCreationCoordinator"

interface Session { id: string; agentTypeId?: string }
function runtime(sourceKey = "source"): SessionCreationCoordinatorRuntime<Session> {
  return {
    sourceKey,
    validateResult: (value) => value as Session,
    ownerIsCurrent: () => true,
    ownershipReady: true,
    mounted: true,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}


describe("session creation coordinator", () => {
  it("serializes tasks and deduplicates matching intent", async () => {
    const coordinator = new SessionCreationCoordinator(runtime())
    const gate = deferred<Session>()
    const firstCreate = vi.fn(() => gate.promise)
    const secondCreate = vi.fn(() => ({ id: "second" }))
    const first = coordinator.coordinate({ dedupeKey: "first", create: firstCreate })
    const duplicate = coordinator.coordinate({ dedupeKey: "first", create: vi.fn() })
    const second = coordinator.coordinate({ dedupeKey: "second", create: secondCreate })
    expect(duplicate).toBe(first)
    await vi.waitFor(() => expect(firstCreate).toHaveBeenCalledOnce())
    expect(secondCreate).not.toHaveBeenCalled()
    gate.resolve({ id: "first" })
    await expect(first).resolves.toEqual({ id: "first" })
    await expect(second).resolves.toEqual({ id: "second" })
  })

  it("cancels active and queued work before settlement callbacks can re-enter", async () => {
    const coordinator = new SessionCreationCoordinator(runtime())
    const gate = deferred<Session>()
    let reentrant!: Promise<Session | undefined>
    const active = coordinator.coordinate({ dedupeKey: "active", create: () => gate.promise })
    const queued = coordinator.coordinate({
      dedupeKey: "queued",
      create: vi.fn(),
      onSettled: () => { reentrant = coordinator.coordinate({ dedupeKey: "reentrant", create: () => ({ id: "reentrant" }) }) },
    })
    coordinator.cancel(() => true)
    await expect(active).resolves.toBeUndefined()
    await expect(queued).resolves.toBeUndefined()
    await expect(reentrant).resolves.toEqual({ id: "reentrant" })
    gate.resolve({ id: "late" })
  })

  it("rejects reentrant settlement work while changing source", async () => {
    const coordinator = new SessionCreationCoordinator(runtime())
    let duringReset!: Promise<Session | undefined>
    const resetTask = coordinator.coordinate({
      dedupeKey: "reset",
      create: vi.fn(),
      onSettled: () => { duringReset = coordinator.coordinate({ dedupeKey: "during-reset", create: vi.fn() }) },
    })
    coordinator.update(runtime("next"))
    await expect(resetTask).resolves.toBeUndefined()
    await expect(duringReset).rejects.toMatchObject({ code: "SESSION_CREATE_COORDINATOR_UNAVAILABLE" })
  })

  it("detaches the active task before canonical callbacks run", async () => {
    const coordinator = new SessionCreationCoordinator(runtime())
    let next!: Promise<Session | undefined>
    const creation = coordinator.coordinate({
      dedupeKey: "first",
      create: () => ({ id: "created" }),
      onResolved: () => { next = coordinator.coordinate({ dedupeKey: "next", create: () => ({ id: "next" }) }) },
    })
    await expect(creation).resolves.toEqual({ id: "created" })
    await expect(next).resolves.toEqual({ id: "next" })
  })

  it("runs onSettled and rejects with an onResolved failure while leaving the queue available", async () => {
    const coordinator = new SessionCreationCoordinator(runtime())
    const callbackError = new Error("resolved callback failed")
    const onSettled = vi.fn()
    const creation = coordinator.coordinate({
      dedupeKey: "first",
      create: () => ({ id: "created" }),
      onResolved: () => { throw callbackError },
      onSettled,
    })
    await expect(creation).rejects.toBe(callbackError)
    expect(onSettled).toHaveBeenCalledOnce()
    await expect(coordinator.coordinate({ dedupeKey: "retry", create: () => ({ id: "retry" }) }))
      .resolves.toEqual({ id: "retry" })
  })

  it("runs onSettled and rejects with an onError failure", async () => {
    const coordinator = new SessionCreationCoordinator(runtime())
    const callbackError = new Error("error callback failed")
    const onSettled = vi.fn()
    const creation = coordinator.coordinate({
      dedupeKey: "first",
      create: () => { throw new Error("transport failed") },
      onError: () => { throw callbackError },
      onSettled,
    })
    await expect(creation).rejects.toBe(callbackError)
    expect(onSettled).toHaveBeenCalledOnce()
  })
})
