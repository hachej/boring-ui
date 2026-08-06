import { useEffect, useRef, useState } from "react"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import type { BoringTaskSessionLink } from "../shared"

export interface TaskSessionLinks {
  adapterId: string
  taskId: string
  links: BoringTaskSessionLink[]
}

interface TaskSessionLinkSnapshot {
  streamId: string
  revision: number
  tasks: TaskSessionLinks[]
}

interface TaskSessionLinkChange extends TaskSessionLinks {
  streamId: string
  revision: number
}

export const TASK_SESSION_LINK_RECEIPT_EVENT = "boring-tasks:session-link-receipt"

export function emitTaskSessionLinkReceipt(value: unknown): void {
  if (!value || typeof value !== "object") return
  const workspaceId = (value as { workspaceId?: unknown }).workspaceId
  const item = taskLinks(value)
  if (typeof workspaceId === "string" && workspaceId.length > 0 && item) {
    window.dispatchEvent(new CustomEvent(TASK_SESSION_LINK_RECEIPT_EVENT, { detail: { workspaceId, ...item } }))
  }
}

export function taskSessionLinkKey(adapterId: string, taskId: string): string {
  return JSON.stringify([adapterId, taskId])
}

function link(value: unknown): BoringTaskSessionLink | undefined {
  if (!value || typeof value !== "object") return undefined
  const item = value as Partial<BoringTaskSessionLink>
  if ([item.id, item.adapterId, item.taskId, item.agentTypeId, item.sessionId, item.createdAt].some((part) => typeof part !== "string" || part.length === 0)) return undefined
  return item as BoringTaskSessionLink
}

function taskLinks(value: unknown): TaskSessionLinks | undefined {
  if (!value || typeof value !== "object") return undefined
  const item = value as Partial<TaskSessionLinks>
  if (typeof item.adapterId !== "string" || typeof item.taskId !== "string" || !Array.isArray(item.links)) return undefined
  const links = item.links.map(link)
  if (links.some((item) => !item)) return undefined
  return { adapterId: item.adapterId, taskId: item.taskId, links: links as BoringTaskSessionLink[] }
}

function envelope(value: unknown): { streamId: string; revision: number } | undefined {
  if (!value || typeof value !== "object") return undefined
  const item = value as { streamId?: unknown; revision?: unknown }
  if (typeof item.streamId !== "string" || !Number.isInteger(item.revision) || (item.revision as number) < 0) return undefined
  return { streamId: item.streamId, revision: item.revision as number }
}

export function useTaskSessionLinks(pluginClient: WorkspacePluginClient): ReadonlyMap<string, readonly BoringTaskSessionLink[]> | null {
  const [linksByTask, setLinksByTask] = useState<ReadonlyMap<string, readonly BoringTaskSessionLink[]> | null>(null)
  const cursor = useRef<{ streamId: string; revision: number } | null>(null)

  useEffect(() => {
    if (typeof EventSource === "undefined") return
    const endpoint = pluginClient.apiBaseUrl.replace(/\/$/, "")
    const query = pluginClient.workspaceId ? `?workspaceId=${encodeURIComponent(pluginClient.workspaceId)}` : ""
    const source = new EventSource(`${endpoint}/api/boring-tasks/session-links/events${query}`, { withCredentials: true })
    source.addEventListener("snapshot", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as Partial<TaskSessionLinkSnapshot>
        const nextCursor = envelope(parsed)
        if (!nextCursor || !Array.isArray(parsed.tasks)) return
        const next = new Map<string, readonly BoringTaskSessionLink[]>()
        for (const raw of parsed.tasks) {
          const item = taskLinks(raw)
          if (item?.links.length) next.set(taskSessionLinkKey(item.adapterId, item.taskId), item.links)
        }
        cursor.current = nextCursor
        setLinksByTask(next)
      } catch { /* Ignore malformed stream frames. */ }
    })
    const applyTaskLinks = (item: TaskSessionLinks) => {
      setLinksByTask((previous) => {
        const next = new Map(previous ?? [])
        const key = taskSessionLinkKey(item.adapterId, item.taskId)
        if (item.links.length === 0) next.delete(key)
        else next.set(key, item.links)
        return next
      })
    }
    source.addEventListener("change", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as Partial<TaskSessionLinkChange>
        const nextCursor = envelope(parsed)
        const item = taskLinks(parsed)
        const current = cursor.current
        if (!nextCursor || !item || !current || current.streamId !== nextCursor.streamId || nextCursor.revision <= current.revision) return
        cursor.current = nextCursor
        applyTaskLinks(item)
      } catch { /* Ignore malformed stream frames. */ }
    })
    const onReceipt = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      const receiptWorkspaceId = detail && typeof detail === "object"
        ? (detail as { workspaceId?: unknown }).workspaceId
        : undefined
      const item = taskLinks(detail)
      if (receiptWorkspaceId === (pluginClient.workspaceId ?? "workspace") && item) applyTaskLinks(item)
    }
    window.addEventListener(TASK_SESSION_LINK_RECEIPT_EVENT, onReceipt)
    return () => {
      window.removeEventListener(TASK_SESSION_LINK_RECEIPT_EVENT, onReceipt)
      source.close()
    }
  }, [pluginClient.apiBaseUrl, pluginClient.workspaceId])

  return linksByTask
}
