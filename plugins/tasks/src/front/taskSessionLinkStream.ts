import { useEffect, useRef, useState } from "react"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"
import { WORKSPACE_DETACHED_CHAT_VISIBILITY_EVENT, type WorkspaceDetachedChatVisibilityDetail } from "@hachej/boring-workspace/plugin"
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

export const TASK_SESSION_LINK_REFRESH_EVENT = "boring-tasks:session-links-refresh"

export function requestTaskSessionLinkRefresh(workspaceId: string): void {
  if (workspaceId) window.dispatchEvent(new CustomEvent(TASK_SESSION_LINK_REFRESH_EVENT, { detail: { workspaceId } }))
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
  const [connectionVersion, setConnectionVersion] = useState(0)
  const [detachedChatOpen, setDetachedChatOpen] = useState(() => typeof document !== "undefined"
    && document.querySelector('[data-boring-workspace-part="detached-panel-popover"]') !== null)
  const cursor = useRef<{ streamId: string; revision: number } | null>(null)

  useEffect(() => {
    const onVisibility = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceDetachedChatVisibilityDetail>).detail
      if (typeof detail?.open === "boolean") setDetachedChatOpen(detail.open)
    }
    window.addEventListener(WORKSPACE_DETACHED_CHAT_VISIBILITY_EVENT, onVisibility)
    return () => window.removeEventListener(WORKSPACE_DETACHED_CHAT_VISIBILITY_EVENT, onVisibility)
  }, [])

  useEffect(() => {
    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: unknown }>).detail
      if (detail?.workspaceId === (pluginClient.workspaceId ?? "workspace")) setConnectionVersion((version) => version + 1)
    }
    window.addEventListener(TASK_SESSION_LINK_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(TASK_SESSION_LINK_REFRESH_EVENT, onRefresh)
  }, [pluginClient.workspaceId])

  useEffect(() => {
    if (detachedChatOpen || typeof EventSource === "undefined") return
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
    return () => source.close()
  }, [connectionVersion, detachedChatOpen, pluginClient.apiBaseUrl, pluginClient.workspaceId])

  return linksByTask
}
