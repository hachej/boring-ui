import { randomUUID } from "node:crypto"
import type { BoringTaskSessionLink } from "../shared"
import type { TaskSessionLinkSnapshot, TaskSessionLinkStore } from "./taskSessionLinkStore"

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
      if (listeners.size === 0) this.listenersByWorkspace.delete(workspaceId)
    }
  }

  publish(workspaceId: string, snapshot: TaskSessionLinkSnapshot): void {
    const revision = (this.revisionsByWorkspace.get(workspaceId) ?? 0) + 1
    this.revisionsByWorkspace.set(workspaceId, revision)
    const event = { streamId: this.streamId, revision, ...snapshot }
    for (const listener of this.listenersByWorkspace.get(workspaceId) ?? []) {
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
  const publish = (link: BoringTaskSessionLink, links: BoringTaskSessionLink[]) => {
    events.publish(workspaceId, { adapterId: link.adapterId, taskId: link.taskId, links })
  }
  return {
    list: (adapterId, taskId) => store.list(adapterId, taskId),
    listBySessionIds: (sessionIds) => store.listBySessionIds(sessionIds),
    ...(store.snapshotLinks ? { snapshotLinks: () => store.snapshotLinks!() } : {}),
    async link(input) {
      if (store.linkWithSnapshot) {
        const result = await store.linkWithSnapshot(input)
        if (result.created) publish(result.link, result.links)
        return result.link
      }
      const existing = await store.list(input.adapterId, input.taskId)
      const link = await store.link(input)
      if (!existing.some((candidate) => candidate.id === link.id)) publish(link, await store.list(link.adapterId, link.taskId))
      return link
    },
    async unlink(linkId) {
      if (store.unlinkWithSnapshot) {
        const result = await store.unlinkWithSnapshot(linkId)
        publish(result.link, result.links)
        return result.link
      }
      const link = await store.unlink(linkId)
      publish(link, await store.list(link.adapterId, link.taskId))
      return link
    },
  }
}
