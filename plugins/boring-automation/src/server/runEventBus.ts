import type postgres from "postgres"
import type { AutomationRunChangedEvent } from "../shared/types"
import type { VerifiedAutomationActor } from "./manualRunExecutor"

const AUTOMATION_RUN_EVENT_CHANNEL = "boring_automation_run_changed"

type RunEventListener = (event: AutomationRunChangedEvent) => void

export interface AutomationRunEventPublisher {
  publish(event: AutomationRunChangedEvent): Promise<void>
}

export interface AutomationRunEventBus extends AutomationRunEventPublisher {
  subscribe(actor: VerifiedAutomationActor, listener: RunEventListener): Promise<() => void>
  close(): Promise<void>
}

export class InMemoryAutomationRunEventBus implements AutomationRunEventBus {
  private readonly subscribers = new Set<{ actor: VerifiedAutomationActor; listener: RunEventListener }>()

  async publish(event: AutomationRunChangedEvent): Promise<void> {
    for (const subscriber of this.subscribers) {
      if (matchesActor(event, subscriber.actor)) subscriber.listener(event)
    }
  }

  async subscribe(actor: VerifiedAutomationActor, listener: RunEventListener): Promise<() => void> {
    const subscriber = { actor: { ...actor }, listener }
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  async close(): Promise<void> {
    this.subscribers.clear()
  }
}

export class PostgresAutomationRunEventBus implements AutomationRunEventBus {
  private readonly subscribers = new Set<{ actor: VerifiedAutomationActor; listener: RunEventListener }>()
  private listener: Promise<postgres.ListenMeta> | undefined

  constructor(private readonly sql: postgres.Sql) {}

  async publish(event: AutomationRunChangedEvent): Promise<void> {
    await this.sql.notify(AUTOMATION_RUN_EVENT_CHANNEL, JSON.stringify(event))
  }

  async subscribe(actor: VerifiedAutomationActor, listener: RunEventListener): Promise<() => void> {
    const subscriber = { actor: { ...actor }, listener }
    this.subscribers.add(subscriber)
    try {
      await this.ensureListening()
    } catch (error) {
      this.subscribers.delete(subscriber)
      throw error
    }
    return () => this.subscribers.delete(subscriber)
  }

  async close(): Promise<void> {
    this.subscribers.clear()
    const listener = this.listener
    this.listener = undefined
    if (listener) await (await listener).unlisten()
  }

  private ensureListening(): Promise<postgres.ListenMeta> {
    this.listener ??= this.sql.listen(AUTOMATION_RUN_EVENT_CHANNEL, (payload) => {
      const event = parseAutomationRunChangedEvent(payload)
      if (!event) return
      for (const subscriber of this.subscribers) {
        if (matchesActor(event, subscriber.actor)) subscriber.listener(event)
      }
    })
    return this.listener
  }
}

function matchesActor(event: AutomationRunChangedEvent, actor: VerifiedAutomationActor): boolean {
  return event.workspaceId === actor.workspaceId && event.userId === actor.userId
}

export function parseAutomationRunChangedEvent(payload: string): AutomationRunChangedEvent | null {
  try {
    const value = JSON.parse(payload) as Partial<AutomationRunChangedEvent>
    if (
      value.v !== 1
      || typeof value.eventId !== "string"
      || typeof value.workspaceId !== "string"
      || typeof value.userId !== "string"
      || typeof value.automationId !== "string"
      || typeof value.runId !== "string"
      || typeof value.updatedAt !== "string"
      || !isRunStatus(value.status)
    ) return null
    return value as AutomationRunChangedEvent
  } catch {
    return null
  }
}

function isRunStatus(value: unknown): value is AutomationRunChangedEvent["status"] {
  return value === "queued"
    || value === "dispatching"
    || value === "running"
    || value === "succeeded"
    || value === "failed"
    || value === "cancelled"
    || value === "outcome-unknown"
}
