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
  const streamIdentity = `${pluginClient.apiBaseUrl}\u0000${pluginClient.workspaceId ?? ""}`
  const [streamState, setStreamState] = useState<{ identity: string; links: ReadonlyMap<string, readonly BoringTaskSessionLink[]> } | null>(null)
  const [generation, setGeneration] = useState(0)
  const cursor = useRef<{ identity: string; streamId: string; revision: number } | null>(null)

  useEffect(() => {
    if (typeof EventSource === "undefined") return
    const endpoint = pluginClient.apiBaseUrl.replace(/\/$/, "")
    // Streaming contract: hosts authenticate this same-origin native EventSource with
    // cookies. workspaceId is only a routing selector and is re-authorized server-side.
    const query = pluginClient.workspaceId ? `?workspaceId=${encodeURIComponent(pluginClient.workspaceId)}` : ""
    const source = new EventSource(`${endpoint}/api/boring-tasks/session-links/events${query}`, { withCredentials: true })
    let reconnecting = false
    const reconnect = () => {
      if (reconnecting) return
      reconnecting = true
      source.close()
      cursor.current = null
      setStreamState(null)
      setGeneration((current) => current + 1)
    }
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
        cursor.current = { identity: streamIdentity, ...nextCursor }
        setStreamState({ identity: streamIdentity, links: next })
      } catch { /* Ignore malformed stream frames. */ }
    })
    const applyTaskLinks = (item: TaskSessionLinks) => {
      setStreamState((previous) => {
        const next = new Map(previous?.identity === streamIdentity ? previous.links : [])
        const key = taskSessionLinkKey(item.adapterId, item.taskId)
        if (item.links.length === 0) next.delete(key)
        else next.set(key, item.links)
        return { identity: streamIdentity, links: next }
      })
    }
    source.addEventListener("change", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as Partial<TaskSessionLinkChange>
        const nextCursor = envelope(parsed)
        const item = taskLinks(parsed)
        const current = cursor.current
        if (!nextCursor || !item || !current || current.identity !== streamIdentity || current.streamId !== nextCursor.streamId || nextCursor.revision <= current.revision) return
        if (nextCursor.revision !== current.revision + 1) {
          reconnect()
          return
        }
        cursor.current = { identity: streamIdentity, ...nextCursor }
        applyTaskLinks(item)
      } catch { /* Ignore malformed stream frames. */ }
    })
    return () => source.close()
  }, [generation, pluginClient.apiBaseUrl, pluginClient.workspaceId, streamIdentity])

  return streamState?.identity === streamIdentity ? streamState.links : null
}
