import { WORKSPACE_TASK_PROVENANCE_CHANGED_EVENT } from "@hachej/boring-workspace"
import { useEffect, useMemo, useRef, useState } from "react"

export interface RelatedTaskRef {
  adapterId: string
  taskId: string
  number: string
  title: string
  statusId: string
  url?: string
}

interface SessionTaskResolution {
  matches: Array<{ sessionId: string; tasks: RelatedTaskRef[] }>
  omittedSessionIds: string[]
}

function validTask(value: unknown): value is RelatedTaskRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const task = value as Record<string, unknown>
  return ["adapterId", "taskId", "number", "title", "statusId"].every((key) => typeof task[key] === "string" && (task[key] as string).length > 0)
    && (task.url === undefined || typeof task.url === "string")
}

function normalizeResolution(value: unknown): SessionTaskResolution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { matches: [], omittedSessionIds: [] }
  const raw = value as Record<string, unknown>
  const matches = Array.isArray(raw.matches) ? raw.matches.flatMap((match) => {
    if (!match || typeof match !== "object" || Array.isArray(match)) return []
    const record = match as Record<string, unknown>
    if (typeof record.sessionId !== "string" || !Array.isArray(record.tasks)) return []
    const tasks = record.tasks.filter(validTask).slice(0, 25)
    return tasks.length > 0 ? [{ sessionId: record.sessionId, tasks }] : []
  }) : []
  const omittedSessionIds = Array.isArray(raw.omittedSessionIds)
    ? raw.omittedSessionIds.filter((id): id is string => typeof id === "string")
    : []
  return { matches: matches.slice(0, 50), omittedSessionIds }
}

export async function resolveRelatedTasks(options: {
  apiBaseUrl: string
  headers?: Record<string, string>
  sessionIds: readonly string[]
  signal?: AbortSignal
}): Promise<SessionTaskResolution> {
  const sessionIds = Array.from(new Set(options.sessionIds.map((id) => id.trim()).filter(Boolean))).slice(0, 50)
  if (sessionIds.length === 0) return { matches: [], omittedSessionIds: [] }
  const response = await fetch(`${options.apiBaseUrl.replace(/\/$/, "")}/api/boring-tasks/sessions/tasks`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body: JSON.stringify({ sessionIds }),
    signal: options.signal,
  })
  if (response.status === 404) return { matches: [], omittedSessionIds: sessionIds }
  if (!response.ok) throw new Error(`related task resolution failed (${response.status})`)
  return normalizeResolution(await response.json())
}

export function useRelatedTasks(options: {
  apiBaseUrl: string
  headers?: Record<string, string>
  sessionIds: readonly string[]
}): ReadonlyMap<string, readonly RelatedTaskRef[]> {
  const [bySession, setBySession] = useState<ReadonlyMap<string, readonly RelatedTaskRef[]>>(() => new Map())
  const [revision, setRevision] = useState(0)
  const cacheRef = useRef(new Map<string, ReadonlyMap<string, readonly RelatedTaskRef[]>>())
  const contextRef = useRef({ apiBaseUrl: options.apiBaseUrl, headers: options.headers })
  if (contextRef.current.apiBaseUrl !== options.apiBaseUrl || contextRef.current.headers !== options.headers) {
    cacheRef.current.clear()
    contextRef.current = { apiBaseUrl: options.apiBaseUrl, headers: options.headers }
  }
  const sessionKey = useMemo(() => Array.from(new Set(options.sessionIds)).sort().join("\u0000"), [options.sessionIds])
  const cacheKey = `${revision}:${sessionKey}`

  useEffect(() => {
    const invalidate = () => {
      cacheRef.current.clear()
      setRevision((current) => current + 1)
    }
    window.addEventListener(WORKSPACE_TASK_PROVENANCE_CHANGED_EVENT, invalidate)
    return () => window.removeEventListener(WORKSPACE_TASK_PROVENANCE_CHANGED_EVENT, invalidate)
  }, [])

  useEffect(() => {
    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setBySession(cached)
      return
    }
    const controller = new AbortController()
    void resolveRelatedTasks({
      apiBaseUrl: options.apiBaseUrl,
      headers: options.headers,
      sessionIds: sessionKey ? sessionKey.split("\u0000") : [],
      signal: controller.signal,
    }).then((resolution) => {
      if (controller.signal.aborted) return
      const next = new Map(resolution.matches.map((match) => [match.sessionId, match.tasks] as const))
      cacheRef.current.set(cacheKey, next)
      setBySession(next)
    }).catch((error) => {
      if (!controller.signal.aborted && (error as { name?: unknown })?.name !== "AbortError") setBySession(new Map())
    })
    return () => controller.abort()
  }, [cacheKey, options.apiBaseUrl, options.headers, sessionKey])

  return bySession
}
