import { describe, expect, it, vi } from "vitest"
import { TaskSessionLinkEvents, taskSessionLinkStoreWithEvents } from "./taskSessionLinkEvents"
import type { BoringTaskSessionLink } from "../shared"
import type { TaskSessionLinkStore } from "./taskSessionLinkStore"

function memoryStore(): TaskSessionLinkStore {
  const links: BoringTaskSessionLink[] = []
  return {
    async list(adapterId, taskId) { return links.filter((link) => link.adapterId === adapterId && link.taskId === taskId) },
    async listBySessionIds(sessionIds) { return new Map(sessionIds.map((id) => [id, links.filter((link) => link.sessionId === id)])) },
    async snapshotCounts() { return [] },
    async link(input) {
      const existing = links.find((link) => link.adapterId === input.adapterId && link.taskId === input.taskId && link.agentTypeId === input.agentTypeId && link.sessionId === input.sessionId)
      if (existing) return existing
      const link = { id: `link-${links.length + 1}`, ...input, createdAt: new Date(0).toISOString() }
      links.push(link)
      return link
    },
    async unlink(linkId) {
      const index = links.findIndex((link) => link.id === linkId)
      return links.splice(index, 1)[0]!
    },
  }
}

describe("TaskSessionLinkEvents", () => {
  it("publishes redacted workspace-scoped counts after durable mutations", async () => {
    const events = new TaskSessionLinkEvents()
    const workspaceA = vi.fn()
    const workspaceB = vi.fn()
    events.subscribe("workspace-a", workspaceA)
    events.subscribe("workspace-b", workspaceB)
    const store = taskSessionLinkStoreWithEvents(memoryStore(), "workspace-a", events)

    const link = await store.link({ adapterId: "github", taskId: "776", agentTypeId: "alpha", sessionId: "native-secret" })
    expect(workspaceA).toHaveBeenLastCalledWith(expect.objectContaining({ adapterId: "github", taskId: "776", count: 1, revision: 1 }))
    expect(JSON.stringify(workspaceA.mock.calls)).not.toContain("native-secret")
    expect(workspaceB).not.toHaveBeenCalled()

    await store.unlink(link.id)
    expect(workspaceA).toHaveBeenLastCalledWith(expect.objectContaining({ adapterId: "github", taskId: "776", count: 0, revision: 2 }))
  })

  it("isolates disconnected listeners from durable mutation publication", () => {
    const events = new TaskSessionLinkEvents()
    const healthy = vi.fn()
    events.subscribe("workspace-a", () => { throw new Error("socket closed") })
    events.subscribe("workspace-a", healthy)

    expect(() => events.publish("workspace-a", { adapterId: "github", taskId: "776", count: 1 })).not.toThrow()
    expect(healthy).toHaveBeenCalledOnce()
  })

  it("keeps a pre-read snapshot cursor behind overlapping changes for replay", () => {
    const events = new TaskSessionLinkEvents()
    const cursor = events.cursor("workspace-a")
    events.publish("workspace-a", { adapterId: "github", taskId: "776", count: 1 })

    expect(events.snapshot([], cursor)).toMatchObject({ streamId: cursor.streamId, revision: 0, tasks: [] })
    expect(events.cursor("workspace-a").revision).toBe(1)
    expect(events.cursor("workspace-b").revision).toBe(0)
  })

  it("does not publish a second event for an idempotent link", async () => {
    const events = new TaskSessionLinkEvents()
    const listener = vi.fn()
    events.subscribe("workspace-a", listener)
    const store = taskSessionLinkStoreWithEvents(memoryStore(), "workspace-a", events)
    const input = { adapterId: "github", taskId: "776", agentTypeId: "alpha", sessionId: "native" }

    await store.link(input)
    await store.link(input)

    expect(listener).toHaveBeenCalledTimes(1)
  })
})
