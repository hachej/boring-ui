"use client"

import { useEffect, useMemo, useState } from "react"

interface SessionStateResponse {
  summary?: { title?: unknown }
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
    void Promise.all(requested.map(async (sessionId) => {
      const response = await fetch(`${apiBaseUrl}/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions/${encodeURIComponent(sessionId)}/state`, {
        method: "GET",
        headers: stableHeaders,
        signal: controller.signal,
      })
      if (!response.ok) return undefined
      const payload = await response.json() as SessionStateResponse
      const title = typeof payload.summary?.title === "string" ? payload.summary.title.trim() : ""
      return title ? [sessionId, title] as const : undefined
    })).then((entries) => {
      setTitles(new Map(entries.filter((entry): entry is readonly [string, string] => entry !== undefined)))
    }).catch(() => {
      if (!controller.signal.aborted) setTitles(new Map())
    })
    return () => controller.abort()
  }, [agentTypeId, apiBaseUrl, headersKey, key])

  return titles
}
