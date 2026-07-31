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
})
