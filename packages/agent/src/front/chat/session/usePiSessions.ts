import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSummary } from '../../../shared/session'
import { createRemotePiSession, type RemotePiSession, type RemotePiSessionOptions } from '../pi/remotePiSession'
import { readActiveSessionId, writeActiveSessionId, type ActiveSessionStorageLike } from './activeSessionStorage'

const DEFAULT_SESSIONS_API_PATH = '/api/v1/agent/pi-chat/sessions'
const DEFAULT_MAX_RETRIES = 8
const DEFAULT_RETRY_BASE_MS = 250
const DEFAULT_RETRY_MAX_MS = 2_000

export interface PiSessionCreateInit {
  title?: string
}

export interface PiSessionRefreshOptions {
  background?: boolean
}

export interface UsePiSessionsOptions {
  apiBaseUrl?: string
  sessionsApiPath?: string
  workspaceId?: string
  storageScope?: string
  requestHeaders?: Record<string, string | undefined>
  enabled?: boolean
  refreshKey?: unknown
  initialActiveSessionId?: string
  fetch?: typeof globalThis.fetch
  storage?: ActiveSessionStorageLike
  createRemoteSession?: (options: RemotePiSessionOptions) => RemotePiSession
  remoteSessionOptions?: Omit<Partial<RemotePiSessionOptions>, 'sessionId' | 'workspaceId' | 'storageScope' | 'apiBaseUrl' | 'headers' | 'fetch'>
  connectActiveSession?: boolean
  retry?: {
    maxRetries?: number
    baseMs?: number
    maxMs?: number
  }
}

export interface UsePiSessionsResult {
  sessions: SessionSummary[]
  activeSession: SessionSummary | undefined
  activeSessionId: string | undefined
  activePiSession: RemotePiSession | undefined
  dataStorageScope: string
  loading: boolean
  error: Error | undefined
  refresh: (options?: PiSessionRefreshOptions) => Promise<void>
  create: (init?: PiSessionCreateInit) => Promise<SessionSummary>
  switch: (id: string) => void
  delete: (id: string) => Promise<void>
  reset: () => void
}

class SessionsPreparingError extends Error {
  constructor() {
    super('Agent runtime is still preparing')
    this.name = 'SessionsPreparingError'
  }
}

export function usePiSessions(options: UsePiSessionsOptions = {}): UsePiSessionsResult {
  const enabled = options.enabled ?? true
  const apiBaseUrl = options.apiBaseUrl?.replace(/\/$/, '') ?? ''
  const sessionsApiPath = options.sessionsApiPath ?? DEFAULT_SESSIONS_API_PATH
  const storageScope = options.storageScope ?? 'default'
  const fetchImpl = useMemo(() => options.fetch ?? globalThis.fetch.bind(globalThis), [options.fetch])
  const createRemoteSession = options.createRemoteSession ?? createRemotePiSession
  const connectActiveSession = options.connectActiveSession ?? true
  const retryMaxRetries = options.retry?.maxRetries ?? DEFAULT_MAX_RETRIES
  const retryBaseMs = options.retry?.baseMs ?? DEFAULT_RETRY_BASE_MS
  const retryMaxMs = options.retry?.maxMs ?? DEFAULT_RETRY_MAX_MS
  const headersKey = useMemo(() => headersScopeKey(options.requestHeaders, storageScope), [options.requestHeaders, storageScope])
  const normalizedHeaders = useMemo(() => buildRequestHeaders(options.requestHeaders, storageScope), [headersKey, storageScope])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [dataStorageScope, setDataStorageScope] = useState(storageScope)
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(() => (
    options.initialActiveSessionId ?? readActiveSessionId({ storageScope, storage: options.storage })
  ))
  const [activePiSession, setActivePiSession] = useState<RemotePiSession | undefined>(undefined)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<Error | undefined>(undefined)
  const mountedRef = useRef(false)
  const refreshVersionRef = useRef(0)
  const retryTimerRef = useRef<RetryDelayHandle | undefined>(undefined)
  const sessionsRef = useRef<SessionSummary[]>([])
  const pendingCreatedRef = useRef<Map<string, SessionSummary>>(new Map())
  const pendingCreatedScopeRef = useRef(scopeIdentity(apiBaseUrl, sessionsApiPath, storageScope, headersKey))

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  const activeSessionKnown = Boolean(activeSessionId && sessions.some((session) => session.id === activeSessionId))

  const requestHeaders = useCallback((): Record<string, string> => normalizedHeaders, [normalizedHeaders])
  const sessionsUrl = useCallback((suffix = '') => `${apiBaseUrl}${sessionsApiPath}${suffix}`, [apiBaseUrl, sessionsApiPath])

  const persistActive = useCallback((id: string | undefined) => {
    writeActiveSessionId(id, { storageScope, storage: options.storage })
  }, [options.storage, storageScope])

  const ensurePendingScope = useCallback(() => {
    const nextScope = scopeIdentity(apiBaseUrl, sessionsApiPath, storageScope, headersKey)
    if (pendingCreatedScopeRef.current === nextScope) return
    pendingCreatedScopeRef.current = nextScope
    pendingCreatedRef.current.clear()
  }, [apiBaseUrl, headersKey, sessionsApiPath, storageScope])

  const applySessions = useCallback((data: SessionSummary[]) => {
    ensurePendingScope()
    const pendingCreated = pendingCreatedRef.current
    for (const session of data) pendingCreated.delete(session.id)
    const merged = mergeSessions(Array.from(pendingCreated.values()), data)

    setDataStorageScope(storageScope)
    setSessions(merged)
    setActiveSessionId((previous) => {
      const persisted = options.initialActiveSessionId ?? readActiveSessionId({ storageScope, storage: options.storage })
      const preferred = previous ?? persisted
      const next = preferred && merged.some((session) => session.id === preferred)
        ? preferred
        : merged[0]?.id
      persistActive(next)
      return next
    })
  }, [ensurePendingScope, options.initialActiveSessionId, options.storage, persistActive, storageScope])

  const refresh = useCallback(async (refreshOptions: PiSessionRefreshOptions = {}) => {
    const version = ++refreshVersionRef.current
    const isCurrent = () => mountedRef.current && version === refreshVersionRef.current
    clearRetryTimer(retryTimerRef)
    const background = refreshOptions.background === true

    if (!enabled) {
      setDataStorageScope(storageScope)
      setSessions([])
      setActiveSessionId(undefined)
      setError(undefined)
      setLoading(false)
      persistActive(undefined)
      return
    }

    if (!background) setLoading(true)
    try {
      let data: SessionSummary[] | undefined
      for (let attempt = 0; ; attempt += 1) {
        try {
          data = await fetchSessionList(fetchImpl, sessionsUrl(), requestHeaders())
          break
        } catch (err) {
          const retryable = err instanceof SessionsPreparingError && attempt < retryMaxRetries
          if (!retryable) throw err
          if (!isCurrent()) return
          await delayWithRef(retryDelayMs(attempt, { baseMs: retryBaseMs, maxMs: retryMaxMs }), retryTimerRef)
          if (!isCurrent()) return
        }
      }
      if (!isCurrent() || !data) return
      applySessions(data)
      setError(undefined)
      setLoading(false)
    } catch (err) {
      if (!isCurrent()) return
      if (!background) setError(err instanceof Error ? err : new Error(String(err)))
      setLoading(false)
    }
  }, [applySessions, enabled, fetchImpl, persistActive, requestHeaders, retryBaseMs, retryMaxMs, retryMaxRetries, sessionsUrl])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    return () => {
      mountedRef.current = false
      refreshVersionRef.current += 1
      clearRetryTimer(retryTimerRef)
    }
  }, [refresh, options.refreshKey])

  useEffect(() => {
    if (!enabled || !connectActiveSession || !activeSessionId || !activeSessionKnown) {
      setActivePiSession(undefined)
      return
    }

    const session = createRemoteSession({
      ...options.remoteSessionOptions,
      sessionId: activeSessionId,
      workspaceId: options.workspaceId,
      storageScope,
      apiBaseUrl,
      headers: requestHeaders,
      fetch: fetchImpl,
    })
    setActivePiSession(session)
    return () => {
      session.dispose()
    }
  }, [activeSessionId, activeSessionKnown, apiBaseUrl, connectActiveSession, createRemoteSession, enabled, fetchImpl, options.remoteSessionOptions, options.workspaceId, requestHeaders, storageScope])

  const create = useCallback(async (init?: PiSessionCreateInit): Promise<SessionSummary> => {
    if (!enabled) throw new Error('Pi sessions are disabled')
    const response = await fetchImpl(sessionsUrl(), {
      method: 'POST',
      headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(init ?? {}),
    })
    if (!response.ok) {
      const err = new Error(`Failed to create session: ${response.status}`)
      setError(err)
      throw err
    }
    const session = toSessionSummary(await response.json())
    ensurePendingScope()
    pendingCreatedRef.current.set(session.id, session)
    setDataStorageScope(storageScope)
    setSessions((previous) => mergeSessions([session], previous))
    setActiveSessionId(session.id)
    persistActive(session.id)
    void refresh()
    return session
  }, [enabled, ensurePendingScope, fetchImpl, persistActive, refresh, requestHeaders, sessionsUrl, storageScope])

  const switchSession = useCallback((id: string) => {
    const known = sessionsRef.current.some((session) => session.id === id)
    const next = known ? id : sessionsRef.current[0]?.id
    setActiveSessionId(next)
    persistActive(next)
  }, [persistActive])

  const deleteSession = useCallback(async (id: string): Promise<void> => {
    if (!enabled) throw new Error('Pi sessions are disabled')
    ensurePendingScope()
    pendingCreatedRef.current.delete(id)
    setDataStorageScope(storageScope)
    setSessions((previous) => previous.filter((session) => session.id !== id))
    setActiveSessionId((previous) => {
      if (previous !== id) return previous
      const next = sessionsRef.current.find((session) => session.id !== id)?.id
      persistActive(next)
      return next
    })

    try {
      const response = await fetchImpl(sessionsUrl(`/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: requestHeaders(),
      })
      if (!response.ok && response.status !== 404) throw new Error(`Failed to delete session: ${response.status}`)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      void refresh()
      throw error
    }
    void refresh()
  }, [enabled, ensurePendingScope, fetchImpl, persistActive, refresh, requestHeaders, sessionsUrl, storageScope])

  const reset = useCallback(() => {
    pendingCreatedRef.current.clear()
    setDataStorageScope(storageScope)
    setActiveSessionId(undefined)
    setActivePiSession(undefined)
    persistActive(undefined)
  }, [persistActive, storageScope])

  const activeSession = sessions.find((session) => session.id === activeSessionId)

  return {
    sessions,
    activeSession,
    activeSessionId: activeSession?.id,
    activePiSession: activeSession ? activePiSession : undefined,
    dataStorageScope,
    loading: enabled ? loading : false,
    error,
    refresh,
    create,
    switch: switchSession,
    delete: deleteSession,
    reset,
  }
}

async function fetchSessionList(fetchImpl: typeof globalThis.fetch, url: string, headers: Record<string, string>): Promise<SessionSummary[]> {
  const response = await fetchImpl(url, Object.keys(headers).length > 0 ? { headers } : undefined)
  if (response.status === 503) throw new SessionsPreparingError()
  if (!response.ok) throw new Error(`Failed to load sessions: ${response.status}`)
  const body = await response.json()
  if (!Array.isArray(body)) throw new Error('Failed to load sessions: invalid response')
  return body.map(toSessionSummary)
}

function toSessionSummary(value: unknown): SessionSummary {
  if (typeof value !== 'object' || value === null) throw new Error('invalid session summary')
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id) throw new Error('invalid session id')
  const now = new Date(0).toISOString()
  return {
    id: record.id,
    title: typeof record.title === 'string' ? record.title : 'Untitled',
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : now,
    turnCount: typeof record.turnCount === 'number' ? record.turnCount : 0,
  }
}

function mergeSessions(overlay: SessionSummary[], canonical: SessionSummary[]): SessionSummary[] {
  const seen = new Set<string>()
  const merged: SessionSummary[] = []
  for (const session of [...overlay, ...canonical]) {
    if (seen.has(session.id)) continue
    seen.add(session.id)
    merged.push(session)
  }
  return merged
}

function buildRequestHeaders(headers: Record<string, string | undefined> | undefined, storageScope: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') result[key] = value
  }
  if (storageScope && !hasHeader(result, 'x-boring-storage-scope')) result['x-boring-storage-scope'] = storageScope
  return result
}

function headersScopeKey(headers: Record<string, string | undefined> | undefined, storageScope: string): string {
  return JSON.stringify({ storageScope, headers: Object.entries(headers ?? {}).sort(([a], [b]) => a.localeCompare(b)) })
}

function scopeIdentity(apiBaseUrl: string, sessionsApiPath: string, storageScope: string, headersKey: string): string {
  return `${apiBaseUrl}\n${sessionsApiPath}\n${storageScope}\n${headersKey}`
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === lower)
}

function retryDelayMs(attempt: number, retry: NonNullable<UsePiSessionsOptions['retry']>): number {
  const base = retry.baseMs ?? DEFAULT_RETRY_BASE_MS
  const max = retry.maxMs ?? DEFAULT_RETRY_MAX_MS
  return Math.min(base * 2 ** Math.max(0, attempt), max)
}

interface RetryDelayHandle {
  timer: ReturnType<typeof setTimeout>
  resolve: () => void
}

function delayWithRef(ms: number, ref: { current: RetryDelayHandle | undefined }): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      if (ref.current === handle) ref.current = undefined
      resolve()
    }
    const handle: RetryDelayHandle = {
      timer: setTimeout(finish, ms),
      resolve: finish,
    }
    ref.current = handle
  })
}

function clearRetryTimer(ref: { current: RetryDelayHandle | undefined }): void {
  const handle = ref.current
  if (handle !== undefined) {
    clearTimeout(handle.timer)
    handle.resolve()
  }
}
