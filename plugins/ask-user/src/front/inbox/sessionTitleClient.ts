"use client"

import { useEffect, useMemo, useState } from "react"

interface SessionActivityResponse {
  sessions?: Array<{ sessionId?: unknown; title?: unknown }>
}

export function useInboxSessionTitles({
  apiBaseUrl,
  headers,
  sessionIds,
}: {
  apiBaseUrl: string
  headers?: Record<string, string>
  sessionIds: readonly string[]
}): ReadonlyMap<string, string> {
  const key = useMemo(() => Array.from(new Set(sessionIds)).sort().slice(0, 50).join("\n"), [sessionIds])
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(() => new Map())

  useEffect(() => {
    const requested = key ? key.split("\n") : []
    if (requested.length === 0) {
      setTitles(new Map())
      return
    }
    const controller = new AbortController()
    void fetch(`${apiBaseUrl}/api/v1/agent/pi-chat/sessions/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(headers ?? {}) },
      body: JSON.stringify({ sessionIds: requested }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("session titles unavailable")
      const payload = await response.json() as SessionActivityResponse
      const next = new Map<string, string>()
      for (const session of payload.sessions ?? []) {
        if (typeof session.sessionId !== "string" || typeof session.title !== "string") continue
        const title = session.title.trim()
        if (title) next.set(session.sessionId, title)
      }
      setTitles(next)
    }).catch(() => {
      if (!controller.signal.aborted) setTitles(new Map())
    })
    return () => controller.abort()
  }, [apiBaseUrl, headers, key])

  return titles
}
