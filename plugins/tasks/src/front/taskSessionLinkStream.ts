import { useEffect, useRef, useState } from "react"
import type { WorkspacePluginClient } from "@hachej/boring-workspace"

export const TASK_SESSION_LINKS_CHANGED_EVENT = "boring-tasks:session-links-changed"

export interface TaskSessionLinkCount {
  adapterId: string
  taskId: string
  count: number
}

interface TaskSessionLinkSnapshot {
  streamId: string
  revision: number
  tasks: TaskSessionLinkCount[]
}

interface TaskSessionLinkChange extends TaskSessionLinkCount {
  streamId: string
  revision: number
}

export function taskSessionLinkKey(adapterId: string, taskId: string): string {
  return JSON.stringify([adapterId, taskId])
}

function count(value: unknown): TaskSessionLinkCount | undefined {
  if (!value || typeof value !== "object") return undefined
  const item = value as Partial<TaskSessionLinkCount>
  if (typeof item.adapterId !== "string" || typeof item.taskId !== "string") return undefined
  if (!Number.isInteger(item.count) || (item.count ?? -1) < 0) return undefined
  return { adapterId: item.adapterId, taskId: item.taskId, count: item.count! }
}

function envelope(value: unknown): { streamId: string; revision: number } | undefined {
  if (!value || typeof value !== "object") return undefined
  const item = value as { streamId?: unknown; revision?: unknown }
  if (typeof item.streamId !== "string" || !Number.isInteger(item.revision) || (item.revision as number) < 0) return undefined
  return { streamId: item.streamId, revision: item.revision as number }
}

export function useTaskSessionLinkCounts(pluginClient: WorkspacePluginClient): ReadonlyMap<string, number> | null {
  const [counts, setCounts] = useState<ReadonlyMap<string, number> | null>(null)
  const cursor = useRef<{ streamId: string; revision: number } | null>(null)

  useEffect(() => {
    if (typeof EventSource === "undefined") return
    const endpoint = pluginClient.apiBaseUrl.replace(/\/$/, "")
    const query = pluginClient.workspaceId ? `?workspaceId=${encodeURIComponent(pluginClient.workspaceId)}` : ""
    const source = new EventSource(`${endpoint}/api/boring-tasks/session-links/events${query}`)
    source.addEventListener("snapshot", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as Partial<TaskSessionLinkSnapshot>
        const nextCursor = envelope(parsed)
        if (!nextCursor || !Array.isArray(parsed.tasks)) return
        const next = new Map<string, number>()
        for (const raw of parsed.tasks) {
          const item = count(raw)
          if (item) next.set(taskSessionLinkKey(item.adapterId, item.taskId), item.count)
        }
        cursor.current = nextCursor
        setCounts(next)
      } catch { /* Ignore malformed stream frames. */ }
    })
    source.addEventListener("change", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as Partial<TaskSessionLinkChange>
        const nextCursor = envelope(parsed)
        const item = count(parsed)
        const current = cursor.current
        if (!nextCursor || !item || !current || current.streamId !== nextCursor.streamId || nextCursor.revision <= current.revision) return
        cursor.current = nextCursor
        setCounts((previous) => {
          const next = new Map(previous ?? [])
          if (item.count === 0) next.delete(taskSessionLinkKey(item.adapterId, item.taskId))
          else next.set(taskSessionLinkKey(item.adapterId, item.taskId), item.count)
          return next
        })
      } catch { /* Ignore malformed stream frames. */ }
    })
    return () => source.close()
  }, [pluginClient.apiBaseUrl, pluginClient.workspaceId])

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail as { adapterId?: unknown; taskId?: unknown } | undefined
      if (typeof detail?.adapterId !== "string" || typeof detail.taskId !== "string") return
      const requestCursor = cursor.current
      if (!requestCursor) return
      void pluginClient.postJson<{ links?: unknown[] }>("/api/boring-tasks/sessions/list", {
        adapterId: detail.adapterId,
        taskId: detail.taskId,
      }).then((response) => {
        const currentCursor = cursor.current
        if (currentCursor?.streamId !== requestCursor?.streamId || currentCursor?.revision !== requestCursor?.revision) return
        const nextCount = Array.isArray(response.links) ? response.links.length : 0
        setCounts((previous) => {
          const next = new Map(previous ?? [])
          const key = taskSessionLinkKey(detail.adapterId as string, detail.taskId as string)
          if (nextCount === 0) next.delete(key)
          else next.set(key, nextCount)
          return next
        })
      }).catch(() => {})
    }
    window.addEventListener(TASK_SESSION_LINKS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(TASK_SESSION_LINKS_CHANGED_EVENT, onChanged)
  }, [pluginClient])

  return counts
}
