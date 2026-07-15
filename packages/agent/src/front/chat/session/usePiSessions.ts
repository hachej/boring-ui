import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionSummary } from '../../../shared/session'
import { createRemotePiSession, type RemotePiSession, type RemotePiSessionOptions } from '../pi/remotePiSession'
import { readActiveSessionId, writeActiveSessionId, type ActiveSessionStorageLike } from './activeSessionStorage'

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

export interface BrowserDraftSessionSummary extends SessionSummary {
  browserDraft: {
    kind: 'new-native'
    requestId: string
    attempted?: boolean
  }
}

export interface PiSessionRenameInit {
  title: string
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
  browserDraftsEnabled?: boolean
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
  rename: (id: string, init: PiSessionRenameInit) => Promise<SessionSummary>
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
  const browserDraftsEnabled = options.browserDraftsEnabled ?? true
  const retryMaxRetries = options.retry?.maxRetries ?? DEFAULT_MAX_RETRIES
  const retryBaseMs = options.retry?.baseMs ?? DEFAULT_RETRY_BASE_MS
  const retryMaxMs = options.retry?.maxMs ?? DEFAULT_RETRY_MAX_MS
  const headersKey = useMemo(() => headersScopeKey(options.requestHeaders, storageScope), [options.requestHeaders, storageScope])
  const normalizedHeaders = useMemo(() => buildRequestHeaders(options.requestHeaders, storageScope), [headersKey, storageScope])
  const workspaceScope = options.workspaceId ?? ''
  const requestScopeKey = useMemo(() => requestScopeIdentity(apiBaseUrl, sessionsApiPath, storageScope, workspaceScope, headersKey), [apiBaseUrl, headersKey, sessionsApiPath, storageScope, workspaceScope])
  const dataSourceKey = useMemo(() => dataSourceIdentity(apiBaseUrl, sessionsApiPath, storageScope, workspaceScope, headersKey), [apiBaseUrl, headersKey, sessionsApiPath, storageScope, workspaceScope])
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [dataStorageScope, setDataStorageScope] = useState(storageScope)
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(() => (
    options.initialActiveSessionId ?? readActiveSessionId({ storageScope, storage: options.storage })
  ))
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
  const loadMoreRequestSeqRef = useRef(0)
  const loadMoreInFlightRef = useRef(false)
  const pendingCreatedRef = useRef<Map<string, SessionSummary>>(new Map())
  const transientBrowserDraftIdsRef = useRef<Set<string>>(new Set())
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

  // Browser-only draft sessions are scoped to one storage/workspace identity. Clear
  // the mutable draft refs during the first render of a new identity so a stale
  // brdraft_ row cannot be merged into the next list or materialized under the
  // new headers while the list fetch is still pending.
  if (pendingCreatedScopeRef.current !== requestScopeKey) {
    pendingCreatedScopeRef.current = requestScopeKey
    pendingCreatedRef.current.clear()
    transientBrowserDraftIdsRef.current.clear()
  }

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    hasMoreRef.current = hasMore
  }, [hasMore])

  const currentScopeLoaded = loadedDataSourceRef.current === dataSourceKey && dataStorageScope === storageScope
  const scopedSessions = currentScopeLoaded ? sessions : []
  const scopedActiveSessionId = currentScopeLoaded ? activeSessionId : undefined
  const activeSessionKnown = Boolean(scopedActiveSessionId && scopedSessions.some((session) => session.id === scopedActiveSessionId))
  const activeSessionDraftKey = useMemo(() => {
    const signal = browserDraftSignal(scopedSessions.find((session) => session.id === scopedActiveSessionId))
    return signal ? `${signal.kind}:${signal.requestId}` : ''
  }, [scopedActiveSessionId, scopedSessions])

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

  // A brdraft_ id becomes an ordinary native session after server materialization;
  // only explicit in-tab draft state (or a live draft summary) is transient.
  const isTransientBrowserDraft = useCallback((id: string | undefined): boolean => {
    if (!id) return false
    if (transientBrowserDraftIdsRef.current.has(id)) return true
    return Boolean(browserDraftSignal(sessionsRef.current.find((session) => session.id === id)))
  }, [])

  const persistActive = useCallback((id: string | undefined) => {
    if (isTransientBrowserDraft(id)) return
    writeActiveSessionId(id, { storageScope, storage: options.storage })
  }, [isTransientBrowserDraft, options.storage, storageScope])

  const ensurePendingScope = useCallback(() => {
    if (pendingCreatedScopeRef.current === requestScopeKey) return
    pendingCreatedScopeRef.current = requestScopeKey
    pendingCreatedRef.current.clear()
    transientBrowserDraftIdsRef.current.clear()
  }, [requestScopeKey])

  const preferredSessionId = useCallback((): string | undefined => {
    const persisted = options.initialActiveSessionId ?? readActiveSessionId({ storageScope, storage: options.storage })
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
    for (const session of data) {
      pendingCreated.delete(session.id)
      transientBrowserDraftIdsRef.current.delete(session.id)
    }
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
    sessionsRef.current = merged
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
      pendingCreatedRef.current.clear()
      transientBrowserDraftIdsRef.current.clear()
      loadedDataSourceRef.current = dataSourceKey
      dataStorageScopeRef.current = storageScope
      sessionsRef.current = []
      activeSessionIdRef.current = undefined
      setDataStorageScope(storageScope)
      setSessions([])
      setActiveSessionId(undefined)
      setActivePiSession(undefined)
      setError(undefined)
      setLoading(false)
      setLoadingMore(false)
      setHasMore(false)
      persistActive(undefined)
      return
    }

    const replacingScope = loadedDataSourceRef.current !== dataSourceKey || dataStorageScopeRef.current !== storageScope
    if (replacingScope) {
      ensurePendingScope()
      canonicalLoadedCountRef.current = 0
      sessionsRef.current = []
      activeSessionIdRef.current = undefined
      setDataStorageScope(storageScope)
      setSessions([])
      setActiveSessionId(undefined)
      setActivePiSession(undefined)
      setHasMore(false)
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
      if (replacingScope) {
        loadedDataSourceRef.current = dataSourceKey
        dataStorageScopeRef.current = storageScope
      }
      if (!background) setError(err instanceof Error ? err : new Error(String(err)))
      setLoading(false)
    }
  }, [applySessions, dataSourceKey, enabled, ensurePendingScope, fetchImpl, persistActive, preferredSessionId, requestHeaders, retryBaseMs, retryMaxMs, retryMaxRetries, sessionsListUrl, storageScope])

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

  useEffect(() => {
    if (!enabled || !connectActiveSession || !scopedActiveSessionId || !activeSessionKnown) {
      setActivePiSession(undefined)
      return
    }

    const activeSummary = sessionsRef.current.find((session) => session.id === scopedActiveSessionId)
    const browserDraft = browserDraftSignal(activeSummary)
    const session = createRemoteSession({
      ...remoteSessionOptionsRef.current,
      ...(browserDraft ? { autoStart: false, browserDraft } : {}),
      sessionId: scopedActiveSessionId,
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
  }, [activeSessionDraftKey, activeSessionKnown, apiBaseUrl, connectActiveSession, createRemoteSession, enabled, fetchImpl, remoteSessionOptionsKey, options.workspaceId, requestHeaders, scopedActiveSessionId, storageScope])

  const create = useCallback(async (init?: PiSessionCreateInit): Promise<SessionSummary> => {
    if (!enabled) throw new Error('Pi sessions are disabled')
    if (!browserDraftsEnabled) {
      const response = await fetchImpl(sessionsUrl(), {
        method: 'POST',
        headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(init ?? {}),
      })
      if (!response.ok) throw new Error(`Failed to create session: ${response.status}`)
      const session = toSessionSummary(await response.json())
      ensurePendingScope()
      pendingCreatedRef.current.set(session.id, session)
      setDataStorageScope(storageScope)
      setSessions((previous) => mergeSessions([session], previous))
      setActiveSessionId(session.id)
      persistActive(session.id)
      setError(undefined)
      return session
    }
    const now = new Date().toISOString()
    const session: BrowserDraftSessionSummary = {
      id: createBrowserDraftSessionId(),
      title: init?.title ?? 'New chat',
      createdAt: now,
      updatedAt: now,
      turnCount: 0,
      materialized: false,
      canRename: false,
      browserDraft: { kind: 'new-native', requestId: createBrowserDraftRequestId() },
    }
    ensurePendingScope()
    pendingCreatedRef.current.set(session.id, session)
    transientBrowserDraftIdsRef.current.add(session.id)
    setDataStorageScope(storageScope)
    setSessions((previous) => mergeSessions([session], previous))
    setActiveSessionId(session.id)
    return session
  }, [browserDraftsEnabled, enabled, ensurePendingScope, fetchImpl, persistActive, requestHeaders, sessionsUrl, storageScope])

  const switchSession = useCallback((id: string) => {
    const known = sessionsRef.current.some((session) => session.id === id)
    const next = known ? id : sessionsRef.current[0]?.id
    setActiveSessionId(next)
    persistActive(next)
  }, [persistActive])

  const renameSession = useCallback(async (id: string, init: PiSessionRenameInit): Promise<SessionSummary> => {
    if (!enabled) throw new Error('Pi sessions are disabled')
    const title = init.title.trim()
    if (!title) throw new Error('Session title is required')
    const target = sessionsRef.current.find((session) => session.id === id)
    if (target?.canRename !== true) throw new Error('Session rename is not available')
    const previous = sessionsRef.current
    const optimisticUpdatedAt = new Date().toISOString()
    setDataStorageScope(storageScope)
    setSessions((current) => current.map((session) => session.id === id ? { ...session, title, updatedAt: optimisticUpdatedAt } : session))

    try {
      const response = await fetchImpl(sessionsUrl(`/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      if (!response.ok) throw new Error(`Failed to rename session: ${response.status}`)
      const session = toSessionSummary(await response.json())
      setSessions((current) => mergeSessions(current.map((item) => item.id === id ? session : item)))
      setError(undefined)
      void refresh({ background: true })
      return session
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setSessions(previous)
      setError(error)
      void refresh({ background: true })
      throw error
    }
  }, [enabled, fetchImpl, refresh, requestHeaders, sessionsUrl, storageScope])

  const deleteSession = useCallback(async (id: string): Promise<void> => {
    if (!enabled) throw new Error('Pi sessions are disabled')
    ensurePendingScope()
    const deletingBrowserDraft = isTransientBrowserDraft(id)
    pendingCreatedRef.current.delete(id)
    transientBrowserDraftIdsRef.current.delete(id)
    setDataStorageScope(storageScope)
    setSessions((previous) => previous.filter((session) => session.id !== id))
    setActiveSessionId((previous) => {
      if (previous !== id) return previous
      const next = sessionsRef.current.find((session) => session.id !== id)?.id
      persistActive(next)
      return next
    })
    if (deletingBrowserDraft) return

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
  }, [enabled, ensurePendingScope, fetchImpl, isTransientBrowserDraft, persistActive, refresh, requestHeaders, sessionsUrl, storageScope])

  const reset = useCallback(() => {
    pendingCreatedRef.current.clear()
    transientBrowserDraftIdsRef.current.clear()
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
  }, [dataSourceKey, persistActive, storageScope])

  const visibleSessions = enabled ? scopedSessions : []
  const visibleActiveSessionId = enabled ? scopedActiveSessionId : undefined
  const activeSession = visibleSessions.find((session) => session.id === visibleActiveSessionId)

  return {
    sessions: visibleSessions,
    activeSession,
    activeSessionId: visibleActiveSessionId,
    activePiSession: visibleActiveSessionId ? activePiSession : undefined,
    dataStorageScope,
    loading: enabled ? loading || !currentScopeLoaded : false,
    loadingMore,
    hasMore: enabled && currentScopeLoaded ? hasMore : false,
    error,
    refresh,
    create,
    switch: switchSession,
    rename: renameSession,
    delete: deleteSession,
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
    canRename: record.canRename === true || record.renameable === true,
    materialized: record.materialized === true,
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

function browserDraftSignal(session: SessionSummary | undefined): BrowserDraftSessionSummary['browserDraft'] | undefined {
  const draft = (session as Partial<BrowserDraftSessionSummary> | undefined)?.browserDraft
  return draft?.kind === 'new-native' && typeof draft.requestId === 'string' ? draft : undefined
}

function createBrowserDraftSessionId(): string {
  return `brdraft_${randomBrowserToken(24)}`
}

function createBrowserDraftRequestId(): string {
  return `brreq_${randomBrowserToken(24)}`
}

function randomBrowserToken(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  const bytes = new Uint8Array(length)
  globalThis.crypto?.getRandomValues?.(bytes)
  if (bytes.every((byte) => byte === 0)) {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
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

function buildRequestHeaders(headers: Record<string, string | undefined> | undefined, _storageScope: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}

function headersScopeKey(headers: Record<string, string | undefined> | undefined, storageScope: string): string {
  return JSON.stringify({ storageScope, headers: Object.entries(headers ?? {}).sort(([a], [b]) => a.localeCompare(b)) })
}

function requestScopeIdentity(apiBaseUrl: string, sessionsApiPath: string, storageScope: string, workspaceScope: string, headersKey: string): string {
  return `${apiBaseUrl}\n${sessionsApiPath}\n${storageScope}\n${workspaceScope}\n${headersKey}`
}

function dataSourceIdentity(apiBaseUrl: string, sessionsApiPath: string, storageScope: string, workspaceScope: string, headersKey: string): string {
  return `${apiBaseUrl}\n${sessionsApiPath}\n${storageScope}\n${workspaceScope}\n${headersKey}`
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
