import { randomUUID } from "node:crypto"
import type { BoringTaskSessionLink } from "../shared"
import type { TaskSessionLinkCount, TaskSessionLinkStore } from "./taskSessionLinkStore"

export interface TaskSessionLinkCountEvent extends TaskSessionLinkCount {
  streamId: string
  revision: number
}

type TaskSessionLinkCountListener = (event: TaskSessionLinkCountEvent) => void

export class TaskSessionLinkEvents {
  readonly streamId = randomUUID()
  private readonly revisionsByWorkspace = new Map<string, number>()
  private readonly listenersByWorkspace = new Map<string, Set<TaskSessionLinkCountListener>>()

  subscribe(workspaceId: string, listener: TaskSessionLinkCountListener): () => void {
    const listeners = this.listenersByWorkspace.get(workspaceId) ?? new Set<TaskSessionLinkCountListener>()
    listeners.add(listener)
    this.listenersByWorkspace.set(workspaceId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listenersByWorkspace.delete(workspaceId)
    }
  }

  publish(workspaceId: string, count: TaskSessionLinkCount): void {
    const revision = (this.revisionsByWorkspace.get(workspaceId) ?? 0) + 1
    this.revisionsByWorkspace.set(workspaceId, revision)
    const event = { streamId: this.streamId, revision, ...count }
    for (const listener of this.listenersByWorkspace.get(workspaceId) ?? []) {
      try { listener(event) } catch { /* A disconnected client cannot fail a durable mutation. */ }
    }
  }

  cursor(workspaceId: string): { streamId: string; revision: number } {
    return { streamId: this.streamId, revision: this.revisionsByWorkspace.get(workspaceId) ?? 0 }
  }

  snapshot(counts: TaskSessionLinkCount[], cursor: { streamId: string; revision: number }): { streamId: string; revision: number; tasks: TaskSessionLinkCount[] } {
    return { ...cursor, tasks: counts }
  }
}

export function taskSessionLinkStoreWithEvents(
  store: TaskSessionLinkStore,
  workspaceId: string,
  events: TaskSessionLinkEvents,
): TaskSessionLinkStore {
  const publish = (link: BoringTaskSessionLink, count: number) => {
    events.publish(workspaceId, { adapterId: link.adapterId, taskId: link.taskId, count })
  }
  return {
    list: (adapterId, taskId) => store.list(adapterId, taskId),
    listBySessionIds: (sessionIds) => store.listBySessionIds(sessionIds),
    ...(store.snapshotCounts ? { snapshotCounts: () => store.snapshotCounts!() } : {}),
    async link(input) {
      if (store.linkWithCount) {
        const result = await store.linkWithCount(input)
        if (result.created) publish(result.link, result.count)
        return result.link
      }
      const existing = await store.list(input.adapterId, input.taskId)
      const link = await store.link(input)
      if (!existing.some((candidate) => candidate.id === link.id)) publish(link, (await store.list(link.adapterId, link.taskId)).length)
      return link
    },
    async unlink(linkId) {
      if (store.unlinkWithCount) {
        const result = await store.unlinkWithCount(linkId)
        publish(result.link, result.count)
        return result.link
      }
      const link = await store.unlink(linkId)
      publish(link, (await store.list(link.adapterId, link.taskId)).length)
      return link
    },
  }
}
