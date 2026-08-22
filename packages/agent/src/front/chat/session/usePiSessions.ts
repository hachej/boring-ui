import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SessionSummary } from '../../../shared/session'
import { createRequestId, withStorageScope } from '../../agentHttp'
import { createRemotePiSession, type RemotePiSession, type RemotePiSessionOptions } from '../pi/remotePiSession'
import {
  readActiveSessionId,
  readBootResumeSessionId,
  writeActiveSessionId,
  writeBootResumeSessionId,
  type ActiveSessionStorageLike,
  type BootResumeSessionSource,
} from './sessionSelectionStorage'

const SESSION_PAGE_SIZE = 50
// 60 attempts with the 2s backoff cap ≈ two minutes of resilience — enough
// to ride out a hub restart plus its cold-start window, after which the
// session list recovers without a remount.
const DEFAULT_MAX_RETRIES = 60
const DEFAULT_RETRY_BASE_MS = 250
const DEFAULT_RETRY_MAX_MS = 2_000
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export interface PiSessionCreateInit {
  title?: string
  /** Boot-only intent to resume this exact tab-owned empty session. */
  resumeSessionId?: string
}

export interface PiSessionRefreshOptions {
  background?: boolean
  /** Reject when the authoritative refresh fails instead of only updating hook state. */
  throwOnError?: boolean
}

export interface UsePiSessionsOptions {
  agentTypeId: string
  apiBaseUrl?: string
  sessionsApiPath?: string
  workspaceId?: string
  /** Stable caller identity echoed only after this source's rows are authoritative. */
  sourceIdentity?: string
  /** Server-authorized workspace/storage scope used for HTTP requests. */
  storageScope?: string
  /** Browser-only active-session persistence scope; defaults to storageScope. */
  activeSessionStorageScope?: string
  requestHeaders?: Record<string, string | undefined>
  enabled?: boolean
  refreshKey?: unknown
  initialActiveSessionId?: string
  fetch?: typeof globalThis.fetch
  storage?: ActiveSessionStorageLike
  /** Tab-owned unsent-session resume storage. Defaults to sessionStorage. */
  bootResumeStorage?: ActiveSessionStorageLike
  createRemoteSession?: (options: RemotePiSessionOptions) => RemotePiSession
  remoteSessionOptions?: Omit<Partial<RemotePiSessionOptions>, 'sessionId' | 'agentTypeId' | 'workspaceId' | 'storageScope' | 'apiBaseUrl' | 'headers' | 'fetch'>
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
  /** Hidden boot candidate; never connected/rendered before create confirms it. */
  resumeSessionId: string | undefined
  activePiSession: RemotePiSession | undefined
  dataStorageScope: string
  /** Attests that returned session data belongs to the caller's expected source. */
  sourceIdentity: string | undefined
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: Error | undefined
  refresh: (options?: PiSessionRefreshOptions) => Promise<void>
  create: (init?: PiSessionCreateInit) => Promise<SessionSummary>
  rename: (id: string, title: string) => Promise<SessionSummary>
  switch: (id: string) => void
  delete: (id: string) => Promise<void>
  loadMore: () => Promise<void>
  reset: () => void
}

class SessionsPreparingError extends Error {
  constructor() {
    super('Agent runtime is still preparing')
    this.name = 'SessionsPreparingError'
  }
}

class StaleSessionsSourceError extends Error {
  constructor() {
    super('Pi sessions source is stale')
    this.name = 'StaleSessionsSourceError'
  }
}

// Network-level failure (server restarting, connection refused). fetch()
// rejects with TypeError in every browser for these; they are transient by
// nature and must be retried like a 503, not surfaced as a terminal error
// that pins "Loading sessions" until the component remounts.
function isNetworkFetchError(error: unknown): boolean {
  return error instanceof TypeError
}

export function usePiSessions(options: UsePiSessionsOptions): UsePiSessionsResult {
  const enabled = options.enabled ?? true
  const apiBaseUrl = options.apiBaseUrl?.replace(/\/$/, '') ?? ''
  const sessionsApiPath = options.sessionsApiPath ?? `/api/v1/agents/${encodeURIComponent(options.agentTypeId)}/sessions`
  const storageScope = options.storageScope ?? 'default'
  const activeSessionStorageScope = options.activeSessionStorageScope ?? storageScope
  const fetchImpl = useMemo(() => options.fetch ?? globalThis.fetch.bind(globalThis), [options.fetch])
  const createRemoteSession = options.createRemoteSession ?? createRemotePiSession
  const connectActiveSession = options.connectActiveSession ?? true
  const retryMaxRetries = options.retry?.maxRetries ?? DEFAULT_MAX_RETRIES
  const retryBaseMs = options.retry?.baseMs ?? DEFAULT_RETRY_BASE_MS
  const retryMaxMs = options.retry?.maxMs ?? DEFAULT_RETRY_MAX_MS
  const headersKey = useMemo(() => headersScopeKey(options.requestHeaders, storageScope), [options.requestHeaders, storageScope])
  const normalizedHeaders = useMemo(() => withStorageScope(options.requestHeaders, storageScope) ?? {}, [headersKey, storageScope])
  const requestScopeKey = useMemo(
    () => requestScopeIdentity(apiBaseUrl, sessionsApiPath, options.agentTypeId, storageScope, headersKey, options.workspaceId, options.sourceIdentity),
    [apiBaseUrl, headersKey, options.agentTypeId, options.sourceIdentity, options.workspaceId, sessionsApiPath, storageScope],
  )
  const dataSourceKey = useMemo(
    () => dataSourceIdentity(apiBaseUrl, sessionsApiPath, options.agentTypeId, storageScope, options.workspaceId, options.sourceIdentity),
    [apiBaseUrl, options.agentTypeId, options.sourceIdentity, options.workspaceId, sessionsApiPath, storageScope],
  )
  const bootResumeSource = useMemo<BootResumeSessionSource>(() => ({
    apiBaseUrl,
    sessionsApiPath,
    agentTypeId: options.agentTypeId,
    workspaceId: options.workspaceId,
    storageScope,
  }), [apiBaseUrl, options.agentTypeId, options.workspaceId, sessionsApiPath, storageScope])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [dataStorageScope, setDataStorageScope] = useState(storageScope)
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined)
  const [resumeSessionState, setResumeSessionState] = useState<{ dataSourceKey: string; id: string | undefined }>(() => ({
    dataSourceKey,
    id: readBootResumeSessionId({ bootResumeSource, storage: options.bootResumeStorage }),
  }))
  const resumeSessionId = resumeSessionState.dataSourceKey === dataSourceKey ? resumeSessionState.id : undefined
  const [activePiSession, setActivePiSession] = useState<RemotePiSession | undefined>(undefined)
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
  const nextCursorRef = useRef<string | undefined>(undefined)
  const loadMoreRequestSeqRef = useRef(0)
  const loadMoreInFlightRef = useRef(false)
  const pendingCreatedRef = useRef<Map<string, SessionSummary>>(new Map())
  const pendingDeletedRef = useRef<Set<string>>(new Set())
  const pendingCreatedScopeRef = useRef(requestScopeKey)
  const dataStorageScopeRef = useRef(storageScope)
  const loadedDataSourceRef = useRef(dataSourceKey)
  const committedRequestScopeRef = useRef(requestScopeKey)
  useIsomorphicLayoutEffect(() => {
    committedRequestScopeRef.current = requestScopeKey
  }, [requestScopeKey])
  const sourceIsCurrent = useCallback(
    (scope: string) => mountedRef.current && committedRequestScopeRef.current === scope,
    [],
  )
  const remoteSessionOptionsRef = useRef(options.remoteSessionOptions)
  remoteSessionOptionsRef.current = options.remoteSessionOptions
  const remoteSessionOptionsKey = useMemo(
    () => remoteSessionOptionsIdentity(options.remoteSessionOptions),
    [options.remoteSessionOptions],
  )

  useIsomorphicLayoutEffect(() => {
    setResumeSessionState((current) => current.dataSourceKey === dataSourceKey
      ? current
      : {
          dataSourceKey,
          id: readBootResumeSessionId({ bootResumeSource, storage: options.bootResumeStorage }),
        })
  }, [bootResumeSource, dataSourceKey, options.bootResumeStorage])

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
  const sessionsListUrl = useCallback((cursor?: string) => {
    const query = new URLSearchParams({ limit: String(SESSION_PAGE_SIZE) })
    if (cursor) query.set('cursor', cursor)
    return sessionsUrl(`?${query.toString()}`)
  }, [sessionsUrl])

  const persistActive = useCallback((id: string | undefined) => {
    writeActiveSessionId(id, { storageScope: activeSessionStorageScope, storage: options.storage })
  }, [activeSessionStorageScope, options.storage])

  const persistBootResume = useCallback((id: string | undefined) => {
    writeBootResumeSessionId(id, { bootResumeSource, storage: options.bootResumeStorage })
    setResumeSessionState({ dataSourceKey, id })
  }, [bootResumeSource, dataSourceKey, options.bootResumeStorage])

  const rememberConfirmedEmptySession = useCallback((id: string) => {
    writeBootResumeSessionId(id, { bootResumeSource, storage: options.bootResumeStorage })
    setResumeSessionState({ dataSourceKey, id: undefined })
  }, [bootResumeSource, dataSourceKey, options.bootResumeStorage])

  const ensurePendingScope = useCallback(() => {
    if (pendingCreatedScopeRef.current === requestScopeKey) return
    pendingCreatedScopeRef.current = requestScopeKey
    pendingCreatedRef.current.clear()
    pendingDeletedRef.current.clear()
  }, [requestScopeKey])

  const preferredSessionId = useCallback((): string | undefined => {
    const persisted = options.initialActiveSessionId ?? readActiveSessionId({
      storageScope: activeSessionStorageScope,
      storage: options.storage,
    })
    if (loadedDataSourceRef.current === dataSourceKey) return activeSessionIdRef.current ?? persisted
    if (dataStorageScopeRef.current !== storageScope) return persisted
    return undefined
  }, [activeSessionStorageScope, dataSourceKey, options.initialActiveSessionId, options.storage, storageScope])

  const applySessions = useCallback((data: SessionSummary[], applyOptions: { background?: boolean; nextCursor?: string } = {}) => {
    ensurePendingScope()
    const replacingScope = loadedDataSourceRef.current !== dataSourceKey
    const requestedActiveId = preferredSessionId()
    const replacingScopePreferred = replacingScope ? requestedActiveId : undefined
    const pendingCreated = pendingCreatedRef.current
    const pendingDeleted = pendingDeletedRef.current
    const deletedIds = new Set(pendingDeleted)
    for (const session of data) pendingCreated.delete(session.id)
    const filteredData = data.filter((session) => !deletedIds.has(session.id))
    if (applyOptions.nextCursor === undefined) {
      const returnedIds = new Set(data.map((session) => session.id))
      for (const deletedId of pendingDeleted) {
        if (!returnedIds.has(deletedId)) pendingDeleted.delete(deletedId)
      }
    }
    const canonicalCount = canonicalPageCount(filteredData)
    const pageMayHaveMore = applyOptions.nextCursor !== undefined
    const wasExhaustedBeyondFirstPage = applyOptions.background
      && !hasMoreRef.current
      && canonicalLoadedCountRef.current >= canonicalCount
    const requestedActiveReturned = Boolean(requestedActiveId && filteredData.some((session) => session.id === requestedActiveId))
    const current = applyOptions.background && pageMayHaveMore
      ? sessionsRef.current.filter((session) => !requestedActiveId || requestedActiveReturned || session.id !== requestedActiveId)
      : []
    const merged = mergeSessions(Array.from(pendingCreated.values()), filteredData, current.filter((session) => !deletedIds.has(session.id)))
    const rememberedEmptyId = readBootResumeSessionId({
      bootResumeSource,
      storage: options.bootResumeStorage,
    })
    if (rememberedEmptyId && filteredData.some((session) => session.id === rememberedEmptyId)) {
      persistBootResume(undefined)
    }
    const nextHasMore = pageMayHaveMore && !wasExhaustedBeyondFirstPage
    canonicalLoadedCountRef.current = applyOptions.background
      ? Math.max(canonicalLoadedCountRef.current, canonicalCount)
      : canonicalCount

    loadedDataSourceRef.current = dataSourceKey
    dataStorageScopeRef.current = storageScope
    setDataStorageScope(storageScope)
    setSessions(merged)
    nextCursorRef.current = applyOptions.nextCursor
    setHasMore(nextHasMore)
    setActiveSessionId((previous) => {
      const preferred = replacingScope ? replacingScopePreferred : previous ?? preferredSessionId()
      const next = preferred && merged.some((session) => session.id === preferred)
        ? preferred
        : merged[0]?.id
      persistActive(next)
      return next
    })
  }, [bootResumeSource, dataSourceKey, ensurePendingScope, options.bootResumeStorage, persistActive, persistBootResume, preferredSessionId, storageScope])

  const refresh = useCallback(async (refreshOptions: PiSessionRefreshOptions = {}) => {
    const scope = requestScopeKey
    if (mountedRef.current && !sourceIsCurrent(scope)) throw new StaleSessionsSourceError()
    const version = ++refreshVersionRef.current
    const isCurrent = () => sourceIsCurrent(scope) && version === refreshVersionRef.current
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
      let page: SessionPage | undefined
      for (let attempt = 0; ; attempt += 1) {
        try {
          page = await fetchSessionList(fetchImpl, sessionsListUrl(), requestHeaders())
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
      if (!isCurrent() || !page) return
      applySessions(page.sessions, { background, nextCursor: page.nextCursor })
      setError(undefined)
      setLoading(false)
    } catch (err) {
      if (!isCurrent()) return
      const error = err instanceof Error ? err : new Error(String(err))
      if (!background) setError(error)
      setLoading(false)
      if (refreshOptions.throwOnError) throw error
    }
  }, [applySessions, enabled, fetchImpl, persistActive, preferredSessionId, requestHeaders, requestScopeKey, retryBaseMs, retryMaxMs, retryMaxRetries, sessionsListUrl, sourceIsCurrent])

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
    setLoadingMore(true)
    try {
      const page = await fetchSessionList(fetchImpl, sessionsListUrl(nextCursorRef.current), requestHeaders())
      const data = page.sessions.filter((session) => !pendingDeletedRef.current.has(session.id))
      if (requestSeq !== loadMoreRequestSeqRef.current || version !== refreshVersionRef.current || !sourceIsCurrent(scope)) return
      const merged = mergeSessions(sessionsRef.current.filter((session) => !pendingDeletedRef.current.has(session.id)), data)
      const nextHasMore = page.nextCursor !== undefined
      canonicalLoadedCountRef.current += data.length
      nextCursorRef.current = page.nextCursor
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
      if (requestSeq === loadMoreRequestSeqRef.current && version === refreshVersionRef.current && sourceIsCurrent(scope)) {
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      if (requestSeq === loadMoreRequestSeqRef.current) loadMoreInFlightRef.current = false
      if (requestSeq === loadMoreRequestSeqRef.current && version === refreshVersionRef.current && sourceIsCurrent(scope)) {
        setLoadingMore(false)
      }
    }
  }, [enabled, fetchImpl, hasMore, loading, loadingMore, persistActive, requestHeaders, requestScopeKey, sessionsListUrl, sourceIsCurrent])

  useEffect(() => {
    if (!enabled || !connectActiveSession || !activeSessionId || !activeSessionKnown) {
      setActivePiSession(undefined)
      return
    }

    const session = createRemoteSession({
      ...remoteSessionOptionsRef.current,
      sessionId: activeSessionId,
      agentTypeId: options.agentTypeId,
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
  }, [activeSessionId, activeSessionKnown, apiBaseUrl, connectActiveSession, createRemoteSession, enabled, fetchImpl, remoteSessionOptionsKey, options.agentTypeId, options.workspaceId, requestHeaders, storageScope])

  const create = useCallback(async (init?: PiSessionCreateInit): Promise<SessionSummary> => {
    const scope = requestScopeKey
    if (!sourceIsCurrent(scope)) throw new StaleSessionsSourceError()
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
    const body = await response.json()
    const session = addressedCreatedSession(body, options.agentTypeId, init?.title)
    if (!sourceIsCurrent(scope)) return session
    ensurePendingScope()
    rememberConfirmedEmptySession(session.id)
    pendingCreatedRef.current.set(session.id, session)
    setDataStorageScope(storageScope)
    setSessions((previous) => mergeSessions([session], previous))
    setActiveSessionId(session.id)
    persistActive(session.id)
    void refresh()
    return session
  }, [enabled, ensurePendingScope, fetchImpl, persistActive, refresh, rememberConfirmedEmptySession, requestHeaders, requestScopeKey, sessionsUrl, sourceIsCurrent, storageScope])

  const switchSession = useCallback((id: string) => {
    if (!sourceIsCurrent(requestScopeKey)) return
    const known = sessionsRef.current.some((session) => session.id === id)
    const next = known ? id : sessionsRef.current[0]?.id
    setActiveSessionId(next)
    persistActive(next)
  }, [persistActive, requestScopeKey, sourceIsCurrent])

  const rename = useCallback(async (id: string, title: string): Promise<SessionSummary> => {
    const scope = requestScopeKey
    if (!sourceIsCurrent(scope)) throw new StaleSessionsSourceError()
    if (!enabled) throw new Error('Pi sessions are disabled')
    const response = await fetchImpl(sessionsUrl(`/${encodeURIComponent(id)}/rename`), {
      method: 'POST',
      headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: createRequestId('rename'), title }),
    })
    if (!response.ok) throw new Error(`Failed to rename session: ${response.status}`)
    const renamed = toAddressedSessionSummary(await response.json())
    if (!sourceIsCurrent(scope)) throw new StaleSessionsSourceError()
    ensurePendingScope()
    if (pendingCreatedRef.current.has(id)) pendingCreatedRef.current.set(id, renamed)
    setSessions((current) => current.map((session) => session.id === id ? renamed : session))
    return renamed
  }, [enabled, ensurePendingScope, fetchImpl, requestHeaders, requestScopeKey, sessionsUrl, sourceIsCurrent])

  const deleteSession = useCallback(async (id: string): Promise<void> => {
    const scope = requestScopeKey
    if (!sourceIsCurrent(scope)) throw new StaleSessionsSourceError()
    if (!enabled) throw new Error('Pi sessions are disabled')
    ensurePendingScope()
    if (readBootResumeSessionId({ bootResumeSource, storage: options.bootResumeStorage }) === id) {
      persistBootResume(undefined)
    }
    const deletedSession = sessionsRef.current.find((session) => session.id === id)
    const deletedSessionWasActive = activeSessionIdRef.current === id
    pendingCreatedRef.current.delete(id)
    pendingDeletedRef.current.add(id)
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
      if (sourceIsCurrent(scope)) {
        pendingDeletedRef.current.delete(id)
        if (deletedSession) {
          setSessions((previous) => mergeSessions([deletedSession], previous))
          if (deletedSessionWasActive) {
            setActiveSessionId(id)
            persistActive(id)
          }
        }
        setError(error)
        void refresh()
      }
      throw error
    }
    if (sourceIsCurrent(scope)) void refresh()
  }, [bootResumeSource, enabled, ensurePendingScope, fetchImpl, options.bootResumeStorage, persistActive, persistBootResume, refresh, requestHeaders, requestScopeKey, sessionsUrl, sourceIsCurrent, storageScope])

  const reset = useCallback(() => {
    if (!sourceIsCurrent(requestScopeKey)) return
    pendingCreatedRef.current.clear()
    pendingDeletedRef.current.clear()
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
  }, [dataSourceKey, persistActive, requestScopeKey, sourceIsCurrent, storageScope])

  const visibleActiveSessionId = enabled ? activeSessionId : undefined
  const activeSession = enabled ? sessions.find((session) => session.id === visibleActiveSessionId) : undefined

  return {
    sessions,
    activeSession,
    activeSessionId: visibleActiveSessionId,
    resumeSessionId,
    activePiSession: visibleActiveSessionId ? activePiSession : undefined,
    dataStorageScope,
    sourceIdentity: enabled && loadedDataSourceRef.current === dataSourceKey ? options.sourceIdentity : undefined,
    loading: enabled ? loading : false,
    loadingMore,
    hasMore: enabled ? hasMore : false,
    error,
    refresh,
    create,
    rename,
    switch: switchSession,
    delete: deleteSession,
    loadMore,
    reset,
  }
}

interface SessionPage {
  sessions: SessionSummary[]
  nextCursor?: string
}

async function fetchSessionList(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  headers: Record<string, string>,
): Promise<SessionPage> {
  const response = await fetchImpl(url, Object.keys(headers).length > 0 ? { headers } : undefined)
  if (response.status === 503) throw new SessionsPreparingError()
  if (!response.ok) throw new Error(`Failed to load sessions: ${response.status}`)
  const body = await response.json()
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { sessions?: unknown }).sessions)) {
    throw new Error('Failed to load sessions: invalid response')
  }
  const page = body as { sessions: unknown[]; nextCursor?: unknown }
  return {
    sessions: page.sessions.map(toAddressedSessionSummary),
    ...(typeof page.nextCursor === 'string' ? { nextCursor: page.nextCursor } : {}),
  }
}

function toAddressedSessionSummary(value: unknown): SessionSummary {
  if (typeof value !== 'object' || value === null) throw new Error('invalid addressed session summary')
  const record = value as Record<string, unknown>
  const ref = record.ref
  if (typeof ref !== 'object' || ref === null || typeof (ref as { sessionId?: unknown }).sessionId !== 'string') {
    throw new Error('invalid addressed session ref')
  }
  const createdAt = typeof record.createdAt === 'number' ? new Date(record.createdAt).toISOString() : new Date(0).toISOString()
  const updatedAt = typeof record.updatedAt === 'number' ? new Date(record.updatedAt).toISOString() : createdAt
  const agentTypeId = (ref as { agentTypeId?: unknown }).agentTypeId
  const status = record.status
  const addressedStatus = status === 'idle' || status === 'running' || status === 'aborting' || status === 'error'
    ? status
    : undefined
  return {
    id: (ref as { sessionId: string }).sessionId,
    title: typeof record.title === 'string' ? record.title : 'Untitled',
    createdAt,
    updatedAt,
    turnCount: typeof record.turnCount === 'number' ? record.turnCount : 0,
    ...(typeof agentTypeId === 'string' ? { agentTypeId } : {}),
    ...(typeof record.nativeSessionId === 'string' ? { nativeSessionId: record.nativeSessionId } : {}),
    ...(typeof record.hasAssistantReply === 'boolean' ? { hasAssistantReply: record.hasAssistantReply } : {}),
    ...(addressedStatus ? { status: addressedStatus } : {}),
  }
}

function addressedCreatedSession(value: unknown, expectedAgentTypeId: string, title?: string): SessionSummary {
  if (
    typeof value !== 'object'
    || value === null
    || typeof (value as { sessionId?: unknown }).sessionId !== 'string'
    || (value as { agentTypeId?: unknown }).agentTypeId !== expectedAgentTypeId
  ) {
    throw new Error('invalid addressed session ref')
  }
  const now = new Date().toISOString()
  return {
    id: (value as { sessionId: string }).sessionId,
    agentTypeId: expectedAgentTypeId,
    title: title ?? 'Untitled',
    createdAt: now,
    updatedAt: now,
    turnCount: 0,
  }
}

function canonicalPageCount(data: SessionSummary[]): number {
  return Math.min(data.length, SESSION_PAGE_SIZE)
}

const remoteSessionOptionObjectIds = new WeakMap<object, number>()
let remoteSessionOptionObjectSeq = 0
function remoteSessionOptionObjectIdentity(value: unknown): string | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
  const object = value as object
  let id = remoteSessionOptionObjectIds.get(object)
  if (!id) {
    id = ++remoteSessionOptionObjectSeq
    remoteSessionOptionObjectIds.set(object, id)
  }
  return String(id)
}

function remoteSessionOptionsIdentity(options: UsePiSessionsOptions['remoteSessionOptions']): string {
  if (!options) return '{}'
  return JSON.stringify({
    autoStart: options.autoStart,
    requestTimeoutMs: options.requestTimeoutMs,
    onEvent: remoteSessionOptionObjectIdentity(options.onEvent),
    storeOptions: remoteSessionOptionObjectIdentity(options.storeOptions),
    setTimeoutFn: remoteSessionOptionObjectIdentity(options.setTimeoutFn),
    clearTimeoutFn: remoteSessionOptionObjectIdentity(options.clearTimeoutFn),
    reconnect: options.reconnect ? {
      baseMs: options.reconnect.baseMs,
      maxMs: options.reconnect.maxMs,
      jitterRatio: options.reconnect.jitterRatio,
      random: remoteSessionOptionObjectIdentity(options.reconnect.random),
    } : undefined,
    debug: options.debug ? {
      largeStateWarningBytes: options.debug.largeStateWarningBytes,
      largeStateWarningMessages: options.debug.largeStateWarningMessages,
      onWarning: remoteSessionOptionObjectIdentity(options.debug.onWarning),
    } : undefined,
  })
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

function headersScopeKey(headers: Record<string, string | undefined> | undefined, storageScope: string): string {
  return JSON.stringify({ storageScope, headers: Object.entries(headers ?? {}).sort(([a], [b]) => a.localeCompare(b)) })
}

function requestScopeIdentity(
  apiBaseUrl: string,
  sessionsApiPath: string,
  agentTypeId: string,
  storageScope: string,
  headersKey: string,
  workspaceId?: string,
  sourceIdentity?: string,
): string {
  return `${apiBaseUrl}\n${sessionsApiPath}\n${agentTypeId}\n${storageScope}\n${headersKey}\n${workspaceId ?? ''}\n${sourceIdentity ?? ''}`
}

function dataSourceIdentity(
  apiBaseUrl: string,
  sessionsApiPath: string,
  agentTypeId: string,
  storageScope: string,
  workspaceId?: string,
  sourceIdentity?: string,
): string {
  return `${apiBaseUrl}\n${sessionsApiPath}\n${agentTypeId}\n${storageScope}\n${workspaceId ?? ''}\n${sourceIdentity ?? ''}`
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
