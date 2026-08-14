import { randomUUID } from "node:crypto"
import type { TaskSessionLinkMutationReceipt, TaskSessionLinkSnapshot, TaskSessionLinkStore } from "./taskSessionLinkStore"

export interface TaskSessionLinkEvent extends TaskSessionLinkSnapshot {
  streamId: string
  revision: number
}

type TaskSessionLinkListener = (event: TaskSessionLinkEvent) => void

export class TaskSessionLinkEvents {
  readonly streamId = randomUUID()
  private readonly revisionsByWorkspace = new Map<string, number>()
  private readonly listenersByWorkspace = new Map<string, Set<TaskSessionLinkListener>>()

  subscribe(workspaceId: string, listener: TaskSessionLinkListener): () => void {
    const listeners = this.listenersByWorkspace.get(workspaceId) ?? new Set<TaskSessionLinkListener>()
    listeners.add(listener)
    this.listenersByWorkspace.set(workspaceId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.listenersByWorkspace.delete(workspaceId)
        this.revisionsByWorkspace.delete(workspaceId)
      }
    }
  }

  publish(workspaceId: string, snapshot: TaskSessionLinkSnapshot): void {
    const listeners = this.listenersByWorkspace.get(workspaceId)
    if (!listeners?.size) {
      this.revisionsByWorkspace.delete(workspaceId)
      return
    }
    const revision = (this.revisionsByWorkspace.get(workspaceId) ?? 0) + 1
    this.revisionsByWorkspace.set(workspaceId, revision)
    const event = { streamId: this.streamId, revision, ...snapshot }
    for (const listener of listeners) {
      try { listener(event) } catch { /* A disconnected client cannot fail a durable mutation. */ }
    }
  }

  cursor(workspaceId: string): { streamId: string; revision: number } {
    return { streamId: this.streamId, revision: this.revisionsByWorkspace.get(workspaceId) ?? 0 }
  }

  snapshot(tasks: TaskSessionLinkSnapshot[], cursor: { streamId: string; revision: number }): { streamId: string; revision: number; tasks: TaskSessionLinkSnapshot[] } {
    return { ...cursor, tasks }
  }
}

export function taskSessionLinkStoreWithEvents(
  store: TaskSessionLinkStore,
  workspaceId: string,
  events: TaskSessionLinkEvents,
): TaskSessionLinkStore {
  const publishReceipt = (receipt: TaskSessionLinkMutationReceipt) => {
    if (receipt.changed) events.publish(workspaceId, receipt.snapshot)
    return receipt
  }
  return {
    list: (adapterId, taskId) => store.list(adapterId, taskId),
    listBySessionIds: (sessionIds) => store.listBySessionIds(sessionIds),
    snapshotLinks: () => store.snapshotLinks(),
    link: async (input) => publishReceipt(await store.link(input)),
    unlink: async (linkId, expectedAgentTypeId) => publishReceipt(await store.unlink(linkId, expectedAgentTypeId)),
  }
}
