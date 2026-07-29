import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { describe, expect, it, vi } from "vitest"
import type { AutomationRunChangedEvent } from "../../shared/types"
import { InMemoryAutomationRunEventBus, parseAutomationRunChangedEvent, PostgresAutomationRunEventBus } from "../runEventBus"

const TEST_DB_URL = process.env.DATABASE_URL ?? "postgres://ubuntu:test@localhost/boring_ui_test"

function event(overrides: Partial<AutomationRunChangedEvent> = {}): AutomationRunChangedEvent {
  return {
    v: 1,
    eventId: randomUUID(),
    workspaceId: "workspace-a",
    userId: "user-a",
    automationId: "automation-a",
    runId: "run-a",
    status: "succeeded",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  }
}

describe("automation run event bus", () => {
  it("isolates in-memory subscribers by workspace and user", async () => {
    const bus = new InMemoryAutomationRunEventBus()
    const matching = vi.fn()
    const otherWorkspace = vi.fn()
    const otherUser = vi.fn()
    await bus.subscribe({ workspaceId: "workspace-a", userId: "user-a" }, matching)
    await bus.subscribe({ workspaceId: "workspace-b", userId: "user-a" }, otherWorkspace)
    await bus.subscribe({ workspaceId: "workspace-a", userId: "user-b" }, otherUser)

    await bus.publish(event())

    expect(matching).toHaveBeenCalledOnce()
    expect(otherWorkspace).not.toHaveBeenCalled()
    expect(otherUser).not.toHaveBeenCalled()
  })

  it("delivers invalidations across Postgres-backed bus instances", async () => {
    const publisherSql = postgres(TEST_DB_URL, { max: 1 })
    const subscriberSql = postgres(TEST_DB_URL, { max: 1 })
    const publisher = new PostgresAutomationRunEventBus(publisherSql)
    const subscriber = new PostgresAutomationRunEventBus(subscriberSql)
    try {
      let resolveReceived!: (event: AutomationRunChangedEvent) => void
      const received = new Promise<AutomationRunChangedEvent>((resolve) => { resolveReceived = resolve })
      const otherActor = vi.fn()
      await subscriber.subscribe({ workspaceId: "workspace-a", userId: "user-a" }, resolveReceived)
      await subscriber.subscribe({ workspaceId: "workspace-a", userId: "user-b" }, otherActor)
      const expected = event()
      await publisher.publish(expected)
      await expect(received).resolves.toEqual(expected)
      expect(otherActor).not.toHaveBeenCalled()
    } finally {
      await Promise.all([publisher.close(), subscriber.close()])
      await Promise.all([publisherSql.end(), subscriberSql.end()])
    }
  })

  it("rejects malformed notification payloads", () => {
    expect(parseAutomationRunChangedEvent("not-json")).toBeNull()
    expect(parseAutomationRunChangedEvent(JSON.stringify({ ...event(), status: "unknown" }))).toBeNull()
  })
})
