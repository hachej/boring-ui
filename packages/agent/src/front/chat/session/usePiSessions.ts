import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SessionSummarySchema, type SessionSummary } from '../../../shared/session'
import { createRemotePiSession, type RemotePiSession, type RemotePiSessionOptions } from '../pi/remotePiSession'
import { remoteSessionOptionsIdentity } from '../pi/remoteSessionOptionsIdentity'
import { readActiveSessionId, writeActiveSessionId, type ActiveSessionStorageLike } from './activeSessionStorage'
import { EphemeralSessionCoordinator, type EphemeralSessionCoordinatorApi } from './ephemeralSessionCoordinator'

const DEFAULT_SESSIONS_API_PATH = '/api/v1/agent/pi-chat/sessions'
const SESSION_PAGE_SIZE = 50
// 60 attempts with the 2s backoff cap ≈ two minutes of resilience — enough
// to ride out a hub restart plus its cold-start window, after which the
// session list recovers without a remount.
const DEFAULT_MAX_RETRIES = 60
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
  /** Keep newly opened browser chats local until their first prompt. */
  localCreateUntilPrompt?: boolean
  /** Optional host-owned coordinator for externally keyed panes. */
  ephemeralSessionCoordinator?: EphemeralSessionCoordinatorApi
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
  loadingMore: boolean
  hasMore: boolean
  error: Error | undefined
  refresh: (options?: PiSessionRefreshOptions) => Promise<void>
  create: (init?: PiSessionCreateInit) => Promise<SessionSummary>
  switch: (id: string) => void
  delete: (id: string) => Promise<void>
  rename: (id: string, title: string) => Promise<SessionSummary>
  materializeLocal: (localId: string, session: SessionSummary) => Promise<void>
  ephemeralSessionCoordinator: EphemeralSessionCoordinatorApi
  isEphemeralSession: (id: string) => boolean
  loadMore: () => Promise<void>
  reset: () => void
}

class SessionsPreparingError extends Error {
  constructor() {
    super('Agent runtime is still preparing')
    this.name = 'SessionsPreparingError'
  }
}

// Network-level failure (server restarting, connection refused). fetch()
// rejects with TypeError in every browser for these; they are transient by
// nature and must be retried like a 503, not surfaced as a terminal error
// that pins "Loading sessions" until the component remounts.
function isNetworkFetchError(error: unknown): boolean {
  return error instanceof TypeError
}

export function usePiSessions(options: UsePiSessionsOptions = {}): UsePiSessionsResult {
  const enabled = options.enabled ?? true
  const apiBaseUrl = options.apiBaseUrl?.replace(/\/$/, '') ?? ''
  const sessionsApiPath = options.sessionsApiPath ?? DEFAULT_SESSIONS_API_PATH
  const storageScope = options.storageScope ?? 'default'
  const fetchImpl = useMemo(() => options.fetch ?? globalThis.fetch.bind(globalThis), [options.fetch])
  const createRemoteSession = options.createRemoteSession ?? createRemotePiSession
  const connectActiveSession = options.connectActiveSession ?? true
  const localCreateUntilPrompt = options.localCreateUntilPrompt === true
  const retryMaxRetries = options.retry?.maxRetries ?? DEFAULT_MAX_RETRIES
  const retryBaseMs = options.retry?.baseMs ?? DEFAULT_RETRY_BASE_MS
  const retryMaxMs = options.retry?.maxMs ?? DEFAULT_RETRY_MAX_MS
  const headersKey = useMemo(() => headersScopeKey(options.requestHeaders, storageScope), [options.requestHeaders, storageScope])
  const normalizedHeaders = useMemo(() => buildRequestHeaders(options.requestHeaders, storageScope), [headersKey, storageScope])
  const requestScopeKey = useMemo(() => requestScopeIdentity(apiBaseUrl, sessionsApiPath, storageScope, headersKey), [apiBaseUrl, headersKey, sessionsApiPath, storageScope])
  const dataSourceKey = useMemo(() => dataSourceIdentity(apiBaseUrl, sessionsApiPath, storageScope), [apiBaseUrl, sessionsApiPath, storageScope])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [dataStorageScope, setDataStorageScope] = useState(storageScope)
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(() => {
    const stored = options.initialActiveSessionId ?? readActiveSessionId({ storageScope, storage: options.storage })
    return stored
  })
  const [activePiSession, setActivePiSession] = useState<RemotePiSession | undefined>(undefined)
  const coordinatorIsOwned = options.ephemeralSessionCoordinator === undefined
  const ephemeralSessionCoordinator = useMemo<EphemeralSessionCoordinatorApi>(
    () => options.ephemeralSessionCoordinator ?? new EphemeralSessionCoordinator(),
    [options.ephemeralSessionCoordinator, requestScopeKey],
  )
  const [loading, setLoading] = useState(enabled)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<Error | undefined>(undefined)
  const mountedRef = useRef(false)
  const refreshVersionRef = useRef(0)
  const retryTimerRef = useRef<RetryDelayHandle | undefined>(undefined)
  const sessionsRef = useRef<SessionSummary[]>([])
  const activeSessionIdRef = useRef<string | undefined>(activeSessionId)
  const hasMoreRef = useRef(hasMore)
  const canonicalLoadedCountRef = useRef(0)
  const loadMoreRequestSeqRef = useRef(0)
  const loadMoreInFlightRef = useRef(false)
  const pendingCreatedRef = useRef<Map<string, SessionSummary>>(new Map())
  const localSessionIdsRef = useRef<Set<string>>(new Set())
  const pendingCreatedScopeRef = useRef(requestScopeKey)
  const dataStorageScopeRef = useRef(storageScope)
  const loadedDataSourceRef = useRef(dataSourceKey)
  const requestScopeRef = useRef(requestScopeKey)
  requestScopeRef.current = requestScopeKey
  const remoteSessionOptionsRef = useRef(options.remoteSessionOptions)
  remoteSessionOptionsRef.current = options.remoteSessionOptions
  const remoteSessionOptionsKey = useMemo(
    () => remoteSessionOptionsIdentity(options.remoteSessionOptions),
    [options.remoteSessionOptions],
  )
  useEffect(() => {
    if (!coordinatorIsOwned) return
    // This owner is request-scoped, not pane-scoped. A scope replacement gets
    // a new coordinator from the memo above and disposes the old transaction.
    if (ephemeralSessionCoordinator instanceof EphemeralSessionCoordinator) {
      ephemeralSessionCoordinator.activate()
    }
    return () => {
      ephemeralSessionCoordinator.dispose()
    }
  }, [coordinatorIsOwned, ephemeralSessionCoordinator])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    hasMoreRef.current = hasMore
  }, [hasMore])

  const activeSessionKnown = Boolean(activeSessionId && sessions.some((session) => session.id === activeSessionId))

  const requestHeaders = useCallback((): Record<string, string> => normalizedHeaders, [normalizedHeaders])
  const sessionsUrl = useCallback((suffix = '') => `${apiBaseUrl}${sessionsApiPath}${suffix}`, [apiBaseUrl, sessionsApiPath])
  const sessionsListUrl = useCallback((offset = 0, includeId?: string) => {
    const query = new URLSearchParams()
    if (offset > 0) {
      query.set('limit', String(SESSION_PAGE_SIZE))
      query.set('offset', String(offset))
    }
    if (offset <= 0 && includeId) query.set('activeSessionId', includeId)
    if (query.size === 0) return sessionsUrl()
    return sessionsUrl(`?${query.toString()}`)
  }, [sessionsUrl])

  const persistActive = useCallback((id: string | undefined) => {
    // Browser-local IDs are process memory only. Never let a reload resurrect one.
    writeActiveSessionId(id && !ephemeralSessionCoordinator.isEphemeralSession(id) ? id : undefined, { storageScope, storage: options.storage })
  }, [ephemeralSessionCoordinator, options.storage, storageScope])

  const ensurePendingScope = useCallback(() => {
    if (pendingCreatedScopeRef.current === requestScopeKey) return
    pendingCreatedScopeRef.current = requestScopeKey
    pendingCreatedRef.current.clear()
  }, [requestScopeKey])

  const preferredSessionId = useCallback((): string | undefined => {
    const stored = options.initialActiveSessionId ?? readActiveSessionId({ storageScope, storage: options.storage })
    const persisted = stored
    if (loadedDataSourceRef.current === dataSourceKey) return activeSessionIdRef.current ?? persisted
    if (dataStorageScopeRef.current !== storageScope) return persisted
    return undefined
  }, [dataSourceKey, options.initialActiveSessionId, options.storage, storageScope])

  const applySessions = useCallback((data: SessionSummary[], applyOptions: { background?: boolean } = {}) => {
    ensurePendingScope()
    const replacingScope = loadedDataSourceRef.current !== dataSourceKey
    const requestedActiveId = preferredSessionId()
    const replacingScopePreferred = replacingScope ? requestedActiveId : undefined
    const pendingCreated = pendingCreatedRef.current
    for (const session of data) pendingCreated.delete(session.id)
    const canonicalCount = canonicalPageCount(data)
    const pageMayHaveMore = data.length >= SESSION_PAGE_SIZE
    const wasExhaustedBeyondFirstPage = applyOptions.background
      && !hasMoreRef.current
      && canonicalLoadedCountRef.current >= canonicalCount
    const requestedActiveReturned = Boolean(requestedActiveId && data.some((session) => session.id === requestedActiveId))
    const current = applyOptions.background && pageMayHaveMore
      ? sessionsRef.current.filter((session) => !requestedActiveId || requestedActiveReturned || session.id !== requestedActiveId)
      : []
    const merged = mergeSessions(Array.from(pendingCreated.values()), data, current)
    const nextHasMore = pageMayHaveMore && !wasExhaustedBeyondFirstPage
    canonicalLoadedCountRef.current = applyOptions.background
      ? Math.max(canonicalLoadedCountRef.current, canonicalCount)
      : canonicalCount

    loadedDataSourceRef.current = dataSourceKey
    dataStorageScopeRef.current = storageScope
    setDataStorageScope(storageScope)
    setSessions(merged)
    setHasMore(nextHasMore)
    setActiveSessionId((previous) => {
      const preferred = replacingScope ? replacingScopePreferred : previous ?? preferredSessionId()
      const next = preferred && merged.some((session) => session.id === preferred)
        ? preferred
        : merged[0]?.id
      persistActive(next)
      return next
    })
  }, [dataSourceKey, ensurePendingScope, persistActive, preferredSessionId, storageScope])

  const refresh = useCallback(async (refreshOptions: PiSessionRefreshOptions = {}) => {
    const version = ++refreshVersionRef.current
    const isCurrent = () => mountedRef.current && version === refreshVersionRef.current
    clearRetryTimer(retryTimerRef)
    const background = refreshOptions.background === true

    if (!enabled) {
      loadMoreRequestSeqRef.current += 1
      loadMoreInFlightRef.current = false
      canonicalLoadedCountRef.current = 0
      loadedDataSourceRef.current = dataSourceKey
      dataStorageScopeRef.current = storageScope
      setDataStorageScope(storageScope)
      setSessions([])
      setActiveSessionId(undefined)
      setError(undefined)
      setLoading(false)
      setLoadingMore(false)
      setHasMore(false)
      persistActive(undefined)
      return
    }

    loadMoreRequestSeqRef.current += 1
    loadMoreInFlightRef.current = false
    setLoadingMore(false)
    if (!background) setLoading(true)
    try {
      let data: SessionSummary[] | undefined
      for (let attempt = 0; ; attempt += 1) {
        try {
          data = await fetchSessionList(fetchImpl, sessionsListUrl(0, preferredSessionId()), requestHeaders())
          break
        } catch (err) {
          const transient = err instanceof SessionsPreparingError || isNetworkFetchError(err)
          const retryable = transient && attempt < retryMaxRetries
          if (!retryable) throw err
          if (!isCurrent()) return
          await delayWithRef(retryDelayMs(attempt, { baseMs: retryBaseMs, maxMs: retryMaxMs }), retryTimerRef)
          if (!isCurrent()) return
        }
      }
      if (!isCurrent() || !data) return
      applySessions(data, { background })
      setError(undefined)
      setLoading(false)
    } catch (err) {
      if (!isCurrent()) return
      if (!background) setError(err instanceof Error ? err : new Error(String(err)))
      setLoading(false)
    }
  }, [applySessions, enabled, fetchImpl, persistActive, preferredSessionId, requestHeaders, retryBaseMs, retryMaxMs, retryMaxRetries, sessionsListUrl])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    return () => {
      mountedRef.current = false
      refreshVersionRef.current += 1
      clearRetryTimer(retryTimerRef)
    }
  }, [refresh, options.refreshKey])

  const loadMore = useCallback(async (): Promise<void> => {
    if (!enabled || loading || loadingMore || loadMoreInFlightRef.current || !hasMore) return
    const requestSeq = ++loadMoreRequestSeqRef.current
    loadMoreInFlightRef.current = true
    const version = refreshVersionRef.current
    const scope = requestScopeKey
    const offset = canonicalLoadedCountRef.current
    setLoadingMore(true)
    try {
      const data = await fetchSessionList(fetchImpl, sessionsListUrl(offset), requestHeaders())
      if (!mountedRef.current || requestSeq !== loadMoreRequestSeqRef.current || version !== refreshVersionRef.current || scope !== requestScopeRef.current) return
      const merged = mergeSessions(sessionsRef.current, data)
      const nextHasMore = data.length >= SESSION_PAGE_SIZE
      canonicalLoadedCountRef.current += data.length
      setSessions(merged)
      setHasMore(nextHasMore)
      setError(undefined)
      setActiveSessionId((previous) => {
        if (previous && merged.some((session) => session.id === previous)) return previous
        const next = merged[0]?.id
        persistActive(next)
        return next
      })
    } catch (err) {
      if (mountedRef.current && requestSeq === loadMoreRequestSeqRef.current && version === refreshVersionRef.current && scope === requestScopeRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      if (requestSeq === loadMoreRequestSeqRef.current) loadMoreInFlightRef.current = false
      if (mountedRef.current && requestSeq === loadMoreRequestSeqRef.current && version === refreshVersionRef.current && scope === requestScopeRef.current) {
        setLoadingMore(false)
      }
    }
  }, [enabled, fetchImpl, hasMore, loading, loadingMore, persistActive, requestHeaders, requestScopeKey, sessionsListUrl])

  const materializeLocal = useCallback(async (localId: string, session: SessionSummary): Promise<void> => {
    localSessionIdsRef.current.delete(localId)
    ensurePendingScope()
    pendingCreatedRef.current.delete(localId)
    pendingCreatedRef.current.set(session.id, session)
    setSessions((previous) => mergeSessions([session], previous.filter((item) => item.id !== localId)))
    setActiveSessionId((previous) => {
      if (previous !== localId) return previous
      persistActive(session.id)
      return session.id
    })
    // A native first-send must be visible through the session source before
    // a host renders its replacement pane. Refresh is only reconciliation.
    await refresh({ background: true })
  }, [ensurePendingScope, persistActive, refresh])

  useEffect(() => ephemeralSessionCoordinator.subscribe(({ localId, session }) => {
    void materializeLocal(localId, session)
  }), [ephemeralSessionCoordinator, materializeLocal])

  useEffect(() => {
    if (!enabled || !connectActiveSession || !activeSessionId || !activeSessionKnown) {
      setActivePiSession(undefined)
      return
    }

    const ephemeralPhase = ephemeralSessionCoordinator.phase(activeSessionId)
    const adoptedNativeId = ephemeralPhase?.type === 'adopted' || ephemeralPhase?.type === 'failed'
      ? ephemeralPhase.receipt.nativeSessionId
      : undefined
    const isLocalSession = localSessionIdsRef.current.has(activeSessionId)
      && (ephemeralPhase?.type === 'local' || ephemeralPhase?.type === 'starting' || ephemeralPhase?.type === 'retryable')
    const session = createRemoteSession({
      ...remoteSessionOptionsRef.current,
      sessionId: adoptedNativeId ?? activeSessionId,
      workspaceId: options.workspaceId,
      storageScope,
      apiBaseUrl,
      headers: requestHeaders,
      fetch: fetchImpl,
      ...(isLocalSession ? {
        autoStart: false,
        ephemeralSession: { coordinator: ephemeralSessionCoordinator, localId: activeSessionId },
      } : {}),
    })
    setActivePiSession(session)
    return () => {
      session.dispose()
    }
  }, [activeSessionId, activeSessionKnown, apiBaseUrl, connectActiveSession, createRemoteSession, enabled, ephemeralSessionCoordinator, fetchImpl, remoteSessionOptionsKey, options.workspaceId, requestHeaders, storageScope])

  const create = useCallback(async (init?: PiSessionCreateInit): Promise<SessionSummary> => {
    if (!enabled) throw new Error('Pi sessions are disabled')
    if (localCreateUntilPrompt) {
      const now = new Date().toISOString()
      const session: SessionSummary = {
        id: `local-${nativeLocalId()}`,
        title: init?.title ?? 'New chat',
        createdAt: now,
        updatedAt: now,
        turnCount: 0,
      }
      localSessionIdsRef.current.add(session.id)
      ephemeralSessionCoordinator.register(session.id)
      ensurePendingScope()
      pendingCreatedRef.current.set(session.id, session)
      setDataStorageScope(storageScope)
      setSessions((previous) => mergeSessions([session], previous))
      setActiveSessionId(session.id)
      // A pre-send browser session is deliberately not durable browser state.
      return session
    }
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
  }, [enabled, ensurePendingScope, ephemeralSessionCoordinator, fetchImpl, localCreateUntilPrompt, persistActive, refresh, requestHeaders, sessionsUrl, storageScope])

  const switchSession = useCallback((id: string) => {
    const known = sessionsRef.current.some((session) => session.id === id)
    const next = known ? id : sessionsRef.current[0]?.id
    setActiveSessionId(next)
    persistActive(next)
  }, [persistActive])

  const deleteSession = useCallback(async (id: string): Promise<void> => {
    if (!enabled) throw new Error('Pi sessions are disabled')
    const wasLocal = localSessionIdsRef.current.delete(id)
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

    if (wasLocal) {
      try {
        await ephemeralSessionCoordinator.discard(id)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setError(error)
        void refresh()
        throw error
      }
      return
    }

    try {
      const response = await fetchImpl(sessionsUrl(`/${encodeURIComponent(id)}`), {
        method: 'DELETE',
        headers: requestHeaders(),
      })
      if (!response.ok && response.status !== 404) throw new Error(`Failed to delete session: ${response.status}`)
      ephemeralSessionCoordinator.discardNativeSession(id)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      void refresh()
      throw error
    }
    void refresh()
  }, [enabled, ensurePendingScope, ephemeralSessionCoordinator, fetchImpl, persistActive, refresh, requestHeaders, sessionsUrl, storageScope])

  const rename = useCallback(async (id: string, title: string): Promise<SessionSummary> => {
    if (!enabled) throw new Error('Pi sessions are disabled')
    const response = await fetchImpl(sessionsUrl(`/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!response.ok) {
      const err = new Error(`Failed to rename session: ${response.status}`)
      setError(err)
      throw err
    }
    const session = toSessionSummary(await response.json())
    // Rename is metadata-only: preserve the canonical server/list position
    // until a later refresh supplies a genuinely newer updatedAt.
    setSessions((previous) => replaceSession(previous, session))
    void refresh({ background: true })
    return session
  }, [enabled, fetchImpl, refresh, requestHeaders, sessionsUrl])

  const reset = useCallback(() => {
    pendingCreatedRef.current.clear()
    for (const id of localSessionIdsRef.current) void ephemeralSessionCoordinator.discard(id).catch(() => {})
    localSessionIdsRef.current.clear()
    loadMoreRequestSeqRef.current += 1
    loadMoreInFlightRef.current = false
    canonicalLoadedCountRef.current = canonicalPageCount(sessionsRef.current)
    loadedDataSourceRef.current = dataSourceKey
    dataStorageScopeRef.current = storageScope
    setDataStorageScope(storageScope)
    setActiveSessionId(undefined)
    setActivePiSession(undefined)
    setLoadingMore(false)
    persistActive(undefined)
  }, [dataSourceKey, ephemeralSessionCoordinator, persistActive, storageScope])

  const visibleActiveSessionId = enabled ? activeSessionId : undefined
  const activeSession = enabled ? sessions.find((session) => session.id === visibleActiveSessionId) : undefined

  return {
    sessions,
    activeSession,
    activeSessionId: visibleActiveSessionId,
    activePiSession: visibleActiveSessionId ? activePiSession : undefined,
    dataStorageScope,
    loading: enabled ? loading : false,
    loadingMore,
    hasMore: enabled ? hasMore : false,
    error,
    refresh,
    create,
    switch: switchSession,
    delete: deleteSession,
    rename,
    materializeLocal,
    ephemeralSessionCoordinator,
    isEphemeralSession: (id) => ephemeralSessionCoordinator.isEphemeralSession(id),
    loadMore,
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
  return SessionSummarySchema.parse(value)
}

function nativeLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function canonicalPageCount(data: SessionSummary[]): number {
  return Math.min(data.length, SESSION_PAGE_SIZE)
}

function mergeSessions(...lists: SessionSummary[][]): SessionSummary[] {
  const seen = new Set<string>()
  const merged: SessionSummary[] = []
  for (const list of lists) {
    for (const session of list) {
      if (seen.has(session.id)) continue
      seen.add(session.id)
      merged.push(session)
    }
  }
  return merged
}

function replaceSession(sessions: SessionSummary[], replacement: SessionSummary): SessionSummary[] {
  const index = sessions.findIndex((session) => session.id === replacement.id)
  if (index < 0) return mergeSessions([replacement], sessions)
  const next = [...sessions]
  next[index] = replacement
  return next
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

function requestScopeIdentity(apiBaseUrl: string, sessionsApiPath: string, storageScope: string, headersKey: string): string {
  return `${apiBaseUrl}\n${sessionsApiPath}\n${storageScope}\n${headersKey}`
}

function dataSourceIdentity(apiBaseUrl: string, sessionsApiPath: string, storageScope: string): string {
  return `${apiBaseUrl}\n${sessionsApiPath}\n${storageScope}`
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
