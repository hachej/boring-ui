import { useEffect, useRef } from 'react'
import type { SessionActivityStatus } from './usePiSessions'

interface AddressedActivityFrame {
  ref?: { agentTypeId?: unknown; sessionId?: unknown }
  status?: unknown
}

function parseActivity(value: unknown): { sessionId: string; agentTypeId: string; status: SessionActivityStatus } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { ref, status } = value as AddressedActivityFrame
  if (!ref || typeof ref !== 'object') return undefined
  const { agentTypeId, sessionId } = ref
  if (typeof agentTypeId !== 'string' || typeof sessionId !== 'string') return undefined
  if (status !== 'idle' && status !== 'running' && status !== 'aborting' && status !== 'error') return undefined
  return { sessionId, agentTypeId, status }
}

/**
 * Live session-activity ownership for a *rendered* session list.
 *
 * The server tracks activity in an in-memory index and streams it on the
 * session-activity SSE channel. Whoever renders the list must own this
 * subscription — statuses that only update a hidden list leave visible rows
 * stale. Local state only: no request, no per-row transcript read (gh-1338).
 */
export function useSessionListActivity(options: {
  apiBaseUrl?: string
  enabled: boolean
  onActivity: (sessionId: string, status: SessionActivityStatus, agentTypeId: string) => void
}): void {
  const { apiBaseUrl, enabled, onActivity } = options
  // Ref so stream events apply through the latest callback without
  // resubscribing (and reconnecting) whenever list state changes.
  const onActivityRef = useRef(onActivity)
  onActivityRef.current = onActivity

  useEffect(() => {
    if (!enabled) return
    const EventSourceCtor = typeof EventSource === 'undefined' ? null : EventSource
    if (!EventSourceCtor) return
    const endpoint = apiBaseUrl?.replace(/\/$/, '') ?? ''
    const source = new EventSourceCtor(`${endpoint}/api/v1/agents/session-activity/events`)
    const handle = (event: MessageEvent) => {
      try {
        const parsed: unknown = JSON.parse(event.data as string)
        const frames = Array.isArray((parsed as { sessions?: unknown })?.sessions)
          ? (parsed as { sessions: unknown[] }).sessions
          : [parsed]
        for (const frame of frames) {
          const activity = parseActivity(frame)
          if (activity) onActivityRef.current(activity.sessionId, activity.status, activity.agentTypeId)
        }
      } catch { /* Ignore malformed server frames. */ }
    }
    source.addEventListener('snapshot', handle as EventListener)
    source.addEventListener('activity', handle as EventListener)
    return () => source.close()
  }, [apiBaseUrl, enabled])
}
