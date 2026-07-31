import { describe, expect, it, vi } from "vitest"
import { SessionCreationCoordinator, selectCreatedSessionCandidate } from "../sessionCreationCoordinator"

interface Row {
  id: string
  agentTypeId?: string
}

const keyFor = (row: Row) => `${row.agentTypeId ?? "legacy"}:${row.id}`

describe("session creation coordinator", () => {
  it("serializes tasks and gives a withdrawn attempt a distinct queue identity", async () => {
    const coordinator = new SessionCreationCoordinator<Row>("source")
    const oldSettled = vi.fn()
    const old = coordinator.coordinate({ dedupeKey: "auto-submit:1", create: vi.fn(), onSettled: oldSettled })
    const oldTask = coordinator.takeNext(new Set(["legacy:existing"]))
    expect(oldTask?.dedupeKey).toBe("auto-submit:1")

    coordinator.cancel((task) => task.dedupeKey === "auto-submit:1")
    const next = coordinator.coordinate({ dedupeKey: "auto-submit:2", create: vi.fn() })
    const nextTask = coordinator.takeNext(new Set(["legacy:existing"]))

    await expect(old).resolves.toBeUndefined()
    expect(oldSettled).toHaveBeenCalledOnce()
    expect(nextTask?.dedupeKey).toBe("auto-submit:2")
    expect(coordinator.finish(nextTask!, { value: "created" })).toBe(true)
    await expect(next).resolves.toBe("created")
  })

  it("prefers the newly active unseen addressed row in an unrelated colliding batch", () => {
    const rows = [
      { id: "unrelated", agentTypeId: "alpha" },
      { id: "collision", agentTypeId: "beta" },
      { id: "collision", agentTypeId: "alpha" },
    ]

    expect(selectCreatedSessionCandidate({
      rows,
      knownKeys: new Set<string>(),
      activeKey: "alpha:collision",
      keyFor,
    })).toEqual({ id: "collision", agentTypeId: "alpha" })
  })

  it("does not assign an arbitrary row when an unseen batch is ambiguous", () => {
    expect(selectCreatedSessionCandidate({
      rows: [{ id: "first" }, { id: "second" }],
      knownKeys: new Set<string>(),
      activeKey: null,
      keyFor,
    })).toBeUndefined()
  })

  it("merges the invocation-boundary inventory without treating it as candidate history", () => {
    const coordinator = new SessionCreationCoordinator<Row>("source")
    void coordinator.coordinate({ dedupeKey: "void", create: vi.fn() })
    const task = coordinator.takeNext(["legacy:existing"])!

    coordinator.beginInvocation(task, ["legacy:existing", "legacy:unrelated"])
    coordinator.settleInvocation(task, ["legacy:existing", "legacy:unrelated"])
    coordinator.markAwaitingRow(task)

    expect(task.candidateKeys).toEqual(new Set())
    expect(coordinator.selectCandidate({
      task,
      rows: [{ id: "unrelated" }, { id: "existing" }],
      activeKey: "legacy:unrelated",
      keyFor,
    })).toBeUndefined()
    expect(coordinator.selectCandidate({
      task,
      rows: [{ id: "created" }, { id: "unrelated" }, { id: "existing" }],
      activeKey: "legacy:created",
      keyFor,
    })).toEqual({ id: "created" })
  })

  it("retains pre-settlement ambiguous candidate history when one row later disappears", () => {
    const coordinator = new SessionCreationCoordinator<Row>("source")
    void coordinator.coordinate({ dedupeKey: "void", create: vi.fn() })
    const task = coordinator.takeNext([])!
    coordinator.beginInvocation(task, [])

    expect(coordinator.selectCandidate({
      task,
      rows: [{ id: "first" }, { id: "second" }],
      activeKey: null,
      keyFor,
    })).toBeUndefined()
    coordinator.settleInvocation(task, ["legacy:first"])
    coordinator.markAwaitingRow(task)
    expect(coordinator.selectCandidate({
      task,
      rows: [{ id: "first" }],
      activeKey: "legacy:first",
      keyFor,
    })).toBeUndefined()
    expect(task.candidateKeys).toEqual(new Set(["legacy:first", "legacy:second"]))
  })

  it("keeps transport uncertainty after queue expiry and cleans it after a settlement horizon", async () => {
    vi.useFakeTimers()
    try {
      const coordinator = new SessionCreationCoordinator<Row>("source")
      const old = coordinator.coordinate({ dedupeKey: "auto-submit:1", create: vi.fn() })
      const oldTask = coordinator.takeNext(["legacy:existing"])!
      coordinator.beginInvocation(oldTask, ["legacy:existing"])
      coordinator.cancel(
        (task) => task === oldTask,
        ["legacy:existing"],
        { timeoutMs: 100 },
      )

      void coordinator.coordinate({ dedupeKey: "auto-submit:2", create: vi.fn() })
      const renewedTask = coordinator.takeNext(["legacy:existing"])!
      coordinator.beginInvocation(renewedTask, ["legacy:existing"])
      coordinator.settleInvocation(renewedTask, ["legacy:existing"])
      coordinator.markAwaitingRow(renewedTask)

      expect(vi.getTimerCount()).toBe(0)
      vi.advanceTimersByTime(100)
      expect(coordinator.hasOrphanAttributionBarrier).toBe(true)
      expect(coordinator.selectCandidate({
        task: renewedTask,
        rows: [{ id: "old-late-row" }],
        activeKey: "legacy:old-late-row",
        keyFor,
      })).toBeUndefined()

      coordinator.settleInvocation(oldTask, ["legacy:old-late-row"])
      expect(vi.getTimerCount()).toBe(1)
      expect(coordinator.hasOrphanAttributionBarrier).toBe(true)
      vi.advanceTimersByTime(100)
      expect(vi.getTimerCount()).toBe(0)
      expect(coordinator.hasOrphanAttributionBarrier).toBe(false)
      expect(coordinator.selectCandidate({
        task: renewedTask,
        rows: [{ id: "old-late-row" }],
        activeKey: "legacy:old-late-row",
        keyFor,
      })).toBeUndefined()
      expect(coordinator.selectCandidate({
        task: renewedTask,
        rows: [{ id: "old-late-row" }, { id: "safe-row" }],
        activeKey: "legacy:safe-row",
        keyFor,
      })).toEqual({ id: "safe-row" })
      await expect(old).resolves.toBeUndefined()
      coordinator.dispose()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("retains overlap until the last staggered orphan horizon releases", async () => {
    vi.useFakeTimers()
    try {
      const coordinator = new SessionCreationCoordinator<Row>("source")
      const firstRelease = vi.fn()
      const secondRelease = vi.fn()
      const first = coordinator.coordinate({ dedupeKey: "first-orphan", create: vi.fn() })
      const firstTask = coordinator.takeNext(["legacy:existing"])!
      coordinator.beginInvocation(firstTask, ["legacy:existing"])
      coordinator.settleInvocation(firstTask, ["legacy:existing"])
      coordinator.cancel(
        (task) => task === firstTask,
        ["legacy:existing"],
        { timeoutMs: 100, onRelease: firstRelease },
      )

      vi.advanceTimersByTime(50)
      const second = coordinator.coordinate({ dedupeKey: "second-orphan", create: vi.fn() })
      const secondTask = coordinator.takeNext(["legacy:existing"])!
      coordinator.beginInvocation(secondTask, ["legacy:existing"])
      coordinator.settleInvocation(secondTask, ["legacy:existing"])
      coordinator.cancel(
        (task) => task === secondTask,
        ["legacy:existing"],
        { timeoutMs: 100, onRelease: secondRelease },
      )
      coordinator.observeRows(["legacy:existing", "legacy:second-late"])

      vi.advanceTimersByTime(50)
      expect(coordinator.hasOrphanAttributionBarrier).toBe(true)
      expect(firstRelease).toHaveBeenCalledOnce()

      const canonical = coordinator.coordinate({ dedupeKey: "canonical", create: vi.fn() })
      const canonicalTask = coordinator.takeNext(["legacy:existing"])!
      expect(canonicalTask.knownKeys).not.toContain("legacy:second-late")
      coordinator.beginInvocation(canonicalTask, ["legacy:existing"])
      coordinator.settleInvocation(canonicalTask, ["legacy:existing"])
      expect(coordinator.finish(canonicalTask, { value: { id: "canonical" } })).toBe(true)

      vi.advanceTimersByTime(50)
      expect(coordinator.hasOrphanAttributionBarrier).toBe(false)
      expect(firstRelease).toHaveBeenCalledOnce()
      expect(secondRelease).toHaveBeenCalledOnce()
      expect(coordinator.canEvict).toBe(false)

      const renewed = coordinator.coordinate({ dedupeKey: "renewed", create: vi.fn() })
      const renewedTask = coordinator.takeNext(["legacy:existing"])!
      expect(renewedTask.knownKeys).toContain("legacy:second-late")
      coordinator.beginInvocation(renewedTask, ["legacy:existing"])
      coordinator.settleInvocation(renewedTask, ["legacy:existing"])
      coordinator.markAwaitingRow(renewedTask)
      expect(coordinator.selectCandidate({
        task: renewedTask,
        rows: [{ id: "second-late" }],
        activeKey: "legacy:second-late",
        keyFor,
      })).toBeUndefined()
      expect(coordinator.selectCandidate({
        task: renewedTask,
        rows: [{ id: "safe" }, { id: "second-late" }],
        activeKey: "legacy:safe",
        keyFor,
      })).toEqual({ id: "safe" })
      expect(coordinator.finish(renewedTask, { value: { id: "safe" } })).toBe(true)
      expect(coordinator.canEvict).toBe(true)

      await expect(first).resolves.toBeUndefined()
      await expect(second).resolves.toBeUndefined()
      await expect(canonical).resolves.toEqual({ id: "canonical" })
      await expect(renewed).resolves.toEqual({ id: "safe" })
    } finally {
      vi.useRealTimers()
    }
  })

  it("rejects a finished task when its settlement callback throws", async () => {
    const coordinator = new SessionCreationCoordinator<Row>("source")
    const callbackError = new Error("settlement callback failed")
    const creation = coordinator.coordinate({
      dedupeKey: "callback",
      create: vi.fn(),
      onSettled: () => { throw callbackError },
    })
    const task = coordinator.takeNext([])!

    expect(coordinator.finish(task, { value: { id: "created" } })).toBe(true)
    await expect(creation).rejects.toBe(callbackError)
    expect(coordinator.active).toBeNull()
    expect(task.phase).toBe("finished")
  })

  it("settles all canceled tasks when their settlement callbacks throw", async () => {
    const coordinator = new SessionCreationCoordinator<Row>("source")
    const activeError = new Error("active settlement failed")
    const queuedError = new Error("queued settlement failed")
    const active = coordinator.coordinate({
      dedupeKey: "active",
      create: vi.fn(),
      onSettled: () => { throw activeError },
    })
    const queued = coordinator.coordinate({
      dedupeKey: "queued",
      create: vi.fn(),
      onSettled: () => { throw queuedError },
    })
    const activeTask = coordinator.takeNext([])!

    coordinator.reset("next-source")

    await expect(active).rejects.toBe(activeError)
    await expect(queued).rejects.toBe(queuedError)
    expect(activeTask.phase).toBe("finished")
    expect(coordinator.active).toBeNull()
    expect(coordinator.queue).toEqual([])
    expect(coordinator.sourceKey).toBe("next-source")
  })

  it("rejects reentrant coordinates from queued settlement callbacks during reset", async () => {
    const coordinator = new SessionCreationCoordinator<Row>("source")
    const active = coordinator.coordinate({ dedupeKey: "active", create: vi.fn() })
    let reentrant!: Promise<unknown>
    const queued = coordinator.coordinate({
      dedupeKey: "queued",
      create: vi.fn(),
      onSettled: () => {
        reentrant = coordinator.coordinate({ dedupeKey: "reentrant", create: vi.fn() })
      },
    })
    coordinator.takeNext([])

    coordinator.reset("next-source")

    await expect(active).resolves.toBeUndefined()
    await expect(queued).resolves.toBeUndefined()
    await expect(reentrant).rejects.toMatchObject({ code: "SESSION_CREATE_COORDINATOR_UNAVAILABLE" })
    expect(coordinator.queue).toEqual([])
    expect(coordinator.sourceKey).toBe("next-source")
  })

  it("rejects reentrant coordinates from queued settlement callbacks during dispose", async () => {
    const coordinator = new SessionCreationCoordinator<Row>("source")
    let reentrant!: Promise<unknown>
    const queued = coordinator.coordinate({
      dedupeKey: "queued",
      create: vi.fn(),
      onSettled: () => {
        reentrant = coordinator.coordinate({ dedupeKey: "reentrant", create: vi.fn() })
      },
    })

    coordinator.dispose()

    await expect(queued).resolves.toBeUndefined()
    await expect(reentrant).rejects.toMatchObject({ code: "SESSION_CREATE_COORDINATOR_UNAVAILABLE" })
    await expect(coordinator.coordinate({ dedupeKey: "after-dispose", create: vi.fn() }))
      .rejects.toMatchObject({ code: "SESSION_CREATE_COORDINATOR_UNAVAILABLE" })
    expect(coordinator.queue).toEqual([])
  })

  it("lets an explicit canonical result finish while an orphan invocation remains", async () => {
    const coordinator = new SessionCreationCoordinator<Row>("source")
    void coordinator.coordinate({ dedupeKey: "old", create: vi.fn() })
    const oldTask = coordinator.takeNext([])!
    coordinator.beginInvocation(oldTask, [])
    coordinator.cancel((task) => task === oldTask, [], { timeoutMs: 100 })

    const renewed = coordinator.coordinate({ dedupeKey: "renewed", create: vi.fn() })
    const renewedTask = coordinator.takeNext([])!
    coordinator.beginInvocation(renewedTask, [])
    coordinator.settleInvocation(renewedTask, [])
    expect(coordinator.hasOrphanAttributionBarrier).toBe(true)
    expect(coordinator.finish(renewedTask, { value: { id: "canonical" } })).toBe(true)
    await expect(renewed).resolves.toEqual({ id: "canonical" })
    coordinator.dispose()
  })
})
