"use client"

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { events, remoteMeta } from "../events"
import { useApiBaseUrl } from "./DataProvider"

/**
 * Subscribes to the server-side `/api/v1/fs/events` SSE stream and
 * fans events out onto the workspace event bus with `cause: "remote"`.
 *
 * Wire format (per server contract, see fsEvents.ts):
 *   - `event: change` → `{ eventId, seq, ts, change: WorkspaceChangeEvent }`
 *   - `event: unsupported` → server can't observe changes, fall back
 *   - `event: resync-required` → reconnected with a stale Last-Event-ID,
 *      server's ring buffer can't fill the gap. Drop everything.
 *
 * Reliability:
 *   - EventSource auto-handles reconnect + `Last-Event-ID` header.
 *   - Client dedupes by `eventId` against a tiny LRU.
 *   - On `resync-required`, we invalidate ALL React Query caches the
 *     hook touches (files / tree / stat / search) so consumers refetch
 *     on next read. No need to re-subscribe — EventSource keeps going,
 *     and the server starts feeding live events again immediately.
 *
 * Self-echo handling stays at the data layer: the bus subscriber
 * invalidates queries, and `useEditorLifecycle`'s monotonic mtime
 * check inside `MarkdownEditorPane` means re-fetched-but-identical
 * content is a no-op for the editor. Step 3b adds eventId dedup but
 * intentionally does NOT add per-client UX suppression — that's a
 * future concern (toasts, badges) once we have actual UX surfaces
 * that fire on file changes.
 */
export function useFileEventStream(): void {
  const base = useApiBaseUrl()
  const qc = useQueryClient()

  useEffect(() => {
    if (import.meta.env.VITE_DISABLE_FILE_EVENTS === "1") return
    if (typeof window === "undefined" || typeof EventSource === "undefined") return

    const url = joinUrl(base, "/api/v1/fs/events")
    let es: EventSource | null
    let unsupported = false
    const seenEventIds = new Set<string>()
    const seenOrder: string[] = []
    const SEEN_CAP = 256

    try {
      es = new EventSource(url, { withCredentials: true })
    } catch {
      return
    }

    const recordSeen = (id: string): boolean => {
      if (seenEventIds.has(id)) return false
      seenEventIds.add(id)
      seenOrder.push(id)
      if (seenOrder.length > SEEN_CAP) {
        const evicted = seenOrder.shift()
        if (evicted !== undefined) seenEventIds.delete(evicted)
      }
      return true
    }

    const onChange = (ev: MessageEvent) => {
      let envelope: ChangeEnvelope
      try {
        envelope = JSON.parse(ev.data) as ChangeEnvelope
      } catch {
        return
      }
      if (
        typeof envelope?.eventId !== "string" ||
        typeof envelope.change !== "object" ||
        envelope.change == null
      ) {
        return
      }
      if (!recordSeen(envelope.eventId)) return
      relay(envelope.change)
    }

    const onUnsupported = () => {
      unsupported = true
      es?.close()
    }

    const onResyncRequired = () => {
      // Server's ring buffer can't fill the gap from our last-seen
      // event. Wipe the local dedup memory and invalidate every key
      // the bus subscriber would touch — consumers refetch on next
      // mount/focus, the editor's serverMtime check handles the
      // overlap.
      seenEventIds.clear()
      seenOrder.length = 0
      qc.invalidateQueries({ predicate: (q) => isFileQueryKey(q.queryKey) })
    }

    es.addEventListener("change", onChange as EventListener)
    es.addEventListener("unsupported", onUnsupported as EventListener)
    es.addEventListener("resync-required", onResyncRequired as EventListener)

    return () => {
      if (!es) return
      es.removeEventListener("change", onChange as EventListener)
      es.removeEventListener("unsupported", onUnsupported as EventListener)
      es.removeEventListener("resync-required", onResyncRequired as EventListener)
      if (!unsupported) es.close()
      es = null
    }
  }, [base, qc])
}

interface ChangeEnvelope {
  eventId: string
  seq: number
  ts: number
  change: {
    op: "write" | "unlink" | "rename" | "mkdir"
    path: string
    oldPath?: string
    mtimeMs?: number
  }
}

function relay(c: ChangeEnvelope["change"]): void {
  switch (c.op) {
    case "write":
      events.emit("file:changed", { ...remoteMeta(), path: c.path })
      return
    case "mkdir":
      events.emit("file:created", { ...remoteMeta(), path: c.path, kind: "dir" })
      return
    case "unlink":
      events.emit("file:deleted", { ...remoteMeta(), path: c.path })
      return
    case "rename":
      if (c.oldPath) {
        events.emit("file:moved", { ...remoteMeta(), from: c.oldPath, to: c.path })
      } else {
        events.emit("file:created", { ...remoteMeta(), path: c.path, kind: "file" })
      }
      return
  }
}

function isFileQueryKey(key: readonly unknown[]): boolean {
  for (const seg of key) {
    if (seg === "files" || seg === "tree" || seg === "stat" || seg === "search") {
      return true
    }
  }
  return false
}

function joinUrl(base: string, path: string): string {
  if (!base) return path
  if (base.endsWith("/") && path.startsWith("/")) return base + path.slice(1)
  if (!base.endsWith("/") && !path.startsWith("/")) return `${base}/${path}`
  return base + path
}
