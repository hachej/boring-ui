"use client"

import { useEffect, useMemo, useState } from "react"

interface SessionSummariesResponse {
  summaries?: Array<{ ref?: { sessionId?: unknown }; title?: unknown }>
}

export function useInboxSessionTitles({
  agentTypeId,
  apiBaseUrl,
  headers,
  sessionIds,
}: {
  agentTypeId: string
  apiBaseUrl: string
  headers?: Record<string, string>
  sessionIds: readonly string[]
}): ReadonlyMap<string, string> {
  const key = useMemo(() => Array.from(new Set(sessionIds)).sort().slice(0, 50).join("\n"), [sessionIds])
  const headersKey = useMemo(() => JSON.stringify(Object.entries(headers ?? {}).sort(([left], [right]) => left.localeCompare(right))), [headers])
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(() => new Map())

  useEffect(() => {
    const requested = key ? key.split("\n") : []
    if (requested.length === 0) {
      setTitles(new Map())
      return
    }
    const controller = new AbortController()
    const stableHeaders = Object.fromEntries(JSON.parse(headersKey) as Array<[string, string]>)
    void fetch(`${apiBaseUrl}/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions/summaries`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", ...stableHeaders },
      body: JSON.stringify({ sessionIds: requested }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return new Map<string, string>()
      const payload = await response.json() as SessionSummariesResponse
      const entries = (payload.summaries ?? []).flatMap((summary) => {
        const sessionId = typeof summary.ref?.sessionId === "string" ? summary.ref.sessionId : ""
        const title = typeof summary.title === "string" ? summary.title.trim() : ""
        return sessionId && title ? [[sessionId, title] as const] : []
      })
      return new Map(entries)
    }).then(setTitles).catch(() => {
      if (!controller.signal.aborted) setTitles(new Map())
    })
    return () => controller.abort()
  }, [agentTypeId, apiBaseUrl, headersKey, key])

  return titles
}
