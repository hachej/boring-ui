import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NativePromptReceipt } from '../../../shared/chat/nativePiFirstSend'
import type { SessionSummary } from '../../../shared/session'
import { clearNativeFirst, nativeFirstDataSourceIdentity, releaseNativeFirst, tombstoneNativeFirst } from '../pi/nativeFirstSendTransactions'
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
const MAX_PENDING_RENAME_MISMATCHES = 2

export interface PiSessionCreateInit {
  title?: string
}

export interface PiSessionRefreshOptions {
  background?: boolean
  /** Reject when the authoritative refresh fails instead of only updating hook state. */
  throwOnError?: boolean
}

export interface UsePiSessionsOptions {
  apiBaseUrl?: string
  sessionsApiPath?: string
  /** Selects the additive addressed AgentGateway transport. Omit for legacy wire. */
  agentTypeId?: string
  workspaceId?: string
  storageScope?: string
  requestHeaders?: Record<string, string | undefined>
  enabled?: boolean
  refreshKey?: unknown
  initialActiveSessionId?: string
  fetch?: typeof globalThis.fetch
  storage?: ActiveSessionStorageLike
  createRemoteSession?: (options: RemotePiSessionOptions) => RemotePiSession
  remoteSessionOptions?: Omit<Partial<RemotePiSessionOptions>, 'sessionId' | 'agentTypeId' | 'workspaceId' | 'storageScope' | 'apiBaseUrl' | 'headers' | 'fetch'>
  connectActiveSession?: boolean
  /** Keep newly opened chats in browser memory until their first prompt. */
  localCreateUntilPrompt?: boolean
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
  /** Replaces a browser-local id with its atomically adopted native Pi id. */
  adoptNative: (localId: string, session: SessionSummary) => void
  rename: (id: string, title: string) => Promise<SessionSummary>
  switch: (id: string) => void
  delete: (id: string) => Promise<void>
  loadMore: () => Promise<void>
  reset: () => void
}

interface LocalSession {
  session: SessionSummary
  dataSourceKey: string
  nativeFirstDataSourceKey: string
  generation: number
}

interface PendingRename {
  title: string
  generation: number
  mismatches: number
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
  const addressed = typeof options.agentTypeId === 'string' && options.agentTypeId.length > 0
  const sessionsApiPath = options.sessionsApiPath ?? (addressed
    ? `/api/v1/agents/${encodeURIComponent(options.agentTypeId!)}/sessions`
    : DEFAULT_SESSIONS_API_PATH)
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
  const requestScopeKey = useMemo(() => requestScopeIdentity(apiBaseUrl, sessionsApiPath, storageScope, headersKey, options.workspaceId), [apiBaseUrl, headersKey, options.workspaceId, sessionsApiPath, storageScope])
  const dataSourceKey = useMemo(() => dataSourceIdentity(apiBaseUrl, sessionsApiPath, storageScope, options.workspaceId), [apiBaseUrl, options.workspaceId, sessionsApiPath, storageScope])
  const nativeFirstDataSourceKey = useMemo(() => nativeFirstDataSourceIdentity(apiBaseUrl, storageScope, options.workspaceId), [apiBaseUrl, options.workspaceId, storageScope])
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
  const dataSourceKeyRef = useRef(dataSourceKey)
  const dataSourceGenerationRef = useRef(0)
  const renderDataSourceGeneration = dataSourceGenerationRef.current
    + (dataSourceKeyRef.current === dataSourceKey ? 0 : 1)
  const mountedRef = useRef(false)
  const refreshVersionRef = useRef(0)
  const refreshGenerationRef = useRef(0)
  const retryTimerRef = useRef<RetryDelayHandle | undefined>(undefined)
  const sessionsRef = useRef<SessionSummary[]>([])
  const activeSessionIdRef = useRef<string | undefined>(activeSessionId)
  const hasMoreRef = useRef(hasMore)
  const canonicalLoadedCountRef = useRef(0)
  const nextCursorRef = useRef<string | undefined>(undefined)
  const loadMoreRequestSeqRef = useRef(0)
  const loadMoreInFlightRef = useRef(false)
  const pendingCreatedRef = useRef<Map<string, SessionSummary>>(new Map())
  const pendingRenamesRef = useRef<Map<string, PendingRename>>(new Map())
  const localSessionsRef = useRef<Map<string, LocalSession>>(new Map())
  const pendingCreatedScopeRef = useRef(requestScopeKey)
  const dataStorageScopeRef = useRef(storageScope)
  const loadedDataSourceRef = useRef(dataSourceKey)
  const requestScopeRef = useRef(requestScopeKey)
  const remoteSessionOptionsRef = useRef(options.remoteSessionOptions)
  remoteSessionOptionsRef.current = options.remoteSessionOptions
  const remoteSessionOptionsKey = useMemo(
    () => remoteSessionOptionsIdentity(options.remoteSessionOptions),
    [options.remoteSessionOptions],
  )

  useEffect(() => {
    if (dataSourceKeyRef.current !== dataSourceKey) {
      dataSourceKeyRef.current = dataSourceKey
      dataSourceGenerationRef.current += 1
    }
    requestScopeRef.current = requestScopeKey
  }, [dataSourceKey, requestScopeKey])

  useEffect(() => () => {
    for (const [id, local] of localSessionsRef.current) releaseNativeFirst(local.nativeFirstDataSourceKey, id)
  }, [])

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    hasMoreRef.current = hasMore
  }, [hasMore])

  const activeSession = enabled ? sessions.find((session) => session.id === activeSessionId) : undefined
  const activeSessionEphemeral = activeSession?.ephemeral === true
  const activeSessionKnown = Boolean(
    activeSession
      && (!activeSessionEphemeral || isCurrentLocalSession(localSessionsRef.current.get(activeSession.id), dataSourceKey, renderDataSourceGeneration)),
  )

  const requestHeaders = useCallback((): Record<string, string> => normalizedHeaders, [normalizedHeaders])
  const sessionsUrl = useCallback((suffix = '') => `${apiBaseUrl}${sessionsApiPath}${suffix}`, [apiBaseUrl, sessionsApiPath])
  const sessionsListUrl = useCallback((offset = 0, includeId?: string, cursor?: string) => {
    const query = new URLSearchParams()
    if (addressed) {
      query.set('limit', String(SESSION_PAGE_SIZE))
      if (cursor) query.set('cursor', cursor)
    } else {
      if (offset > 0) {
        query.set('limit', String(SESSION_PAGE_SIZE))
        query.set('offset', String(offset))
      }
      if (offset <= 0 && includeId) query.set('activeSessionId', includeId)
    }
    if (query.size === 0) return sessionsUrl()
    return sessionsUrl(`?${query.toString()}`)
  }, [addressed, sessionsUrl])

  const persistActive = useCallback((id: string | undefined) => {
    writeActiveSessionId(id && !localSessionsRef.current.has(id) ? id : undefined, { storageScope, storage: options.storage })
  }, [options.storage, storageScope])

  const ensurePendingScope = useCallback(() => {
    if (pendingCreatedScopeRef.current === requestScopeKey) return
    pendingCreatedScopeRef.current = requestScopeKey
    pendingCreatedRef.current.clear()
    pendingRenamesRef.current.clear()
  }, [requestScopeKey])

  const clearStaleLocalSessions = useCallback((): Set<string> => {
    const staleIds = new Set<string>()
    for (const [id, local] of localSessionsRef.current) {
      if (isCurrentLocalSession(local, dataSourceKeyRef.current, dataSourceGenerationRef.current)) continue
      localSessionsRef.current.delete(id)
      releaseNativeFirst(local.nativeFirstDataSourceKey, id)
      staleIds.add(id)
    }
    return staleIds
  }, [dataSourceKey])

  useEffect(() => {
    const staleIds = clearStaleLocalSessions()
    if (staleIds.size === 0) return
    setSessions((previous) => previous.filter((session) => !staleIds.has(session.id)))
  }, [clearStaleLocalSessions])

  const preferredSessionId = useCallback((): string | undefined => {
    const persisted = options.initialActiveSessionId ?? readActiveSessionId({ storageScope, storage: options.storage })
    if (loadedDataSourceRef.current === dataSourceKey) {
      const active = activeSessionIdRef.current
      return active && !localSessionsRef.current.has(active) ? active : persisted
    }
    if (dataStorageScopeRef.current !== storageScope) return persisted
    return undefined
  }, [dataSourceKey, options.initialActiveSessionId, options.storage, storageScope])

  const applyPendingRenameTitles = useCallback((serverRows: SessionSummary[], rows: SessionSummary[], requestGeneration: number): SessionSummary[] => {
    const pending = pendingRenamesRef.current
    for (const session of serverRows) {
      const rename = pending.get(session.id)
      if (!rename || requestGeneration <= rename.generation) continue
      if (session.title === rename.title || ++rename.mismatches >= MAX_PENDING_RENAME_MISMATCHES) {
        pending.delete(session.id)
      }
    }
    return rows.map((session) => {
      const rename = pending.get(session.id)
      return rename ? { ...session, title: rename.title } : session
    })
  }, [])

  const applySessions = useCallback((data: SessionSummary[], applyOptions: { background?: boolean; nextCursor?: string; requestGeneration: number }) => {
    clearStaleLocalSessions()
    ensurePendingScope()
    const replacingScope = loadedDataSourceRef.current !== dataSourceKey
    const requestedActiveId = preferredSessionId()
    const replacingScopePreferred = replacingScope ? requestedActiveId : undefined
    const pendingCreated = pendingCreatedRef.current
    const serverData = data.map((session) => {
      const pending = pendingCreated.get(session.id)
      pendingCreated.delete(session.id)
      return pending?.ephemeral === false ? { ...session, ephemeral: false } : session
    })
    const canonicalCount = canonicalPageCount(serverData)
    const pageMayHaveMore = addressed ? applyOptions.nextCursor !== undefined : serverData.length >= SESSION_PAGE_SIZE
    const wasExhaustedBeyondFirstPage = applyOptions.background
      && !hasMoreRef.current
      && canonicalLoadedCountRef.current >= canonicalCount
    const requestedActiveReturned = Boolean(requestedActiveId && serverData.some((session) => session.id === requestedActiveId))
    const current = applyOptions.background && pageMayHaveMore
      ? sessionsRef.current.filter((session) => !requestedActiveId || requestedActiveReturned || session.id !== requestedActiveId)
      : []
    const merged = applyPendingRenameTitles(serverData, mergeSessionLists(addressed, Array.from(localSessionsRef.current.values(), ({ session }) => session).reverse(), Array.from(pendingCreated.values()), serverData, current), applyOptions.requestGeneration)
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
        : serverData[0]?.id ?? merged[0]?.id
      persistActive(next)
      return next
    })
  }, [addressed, applyPendingRenameTitles, clearStaleLocalSessions, dataSourceKey, ensurePendingScope, persistActive, preferredSessionId, storageScope])

  const refresh = useCallback(async (refreshOptions: PiSessionRefreshOptions = {}) => {
    const version = ++refreshVersionRef.current
    const requestGeneration = ++refreshGenerationRef.current
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
    else setLoading(false)
    try {
      let page: SessionPage | undefined
      for (let attempt = 0; ; attempt += 1) {
        try {
          page = await fetchSessionList(fetchImpl, sessionsListUrl(0, preferredSessionId()), requestHeaders(), addressed)
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
      applySessions(page.sessions, { background, nextCursor: page.nextCursor, requestGeneration })
      setError(undefined)
      setLoading(false)
    } catch (err) {
      if (!isCurrent()) return
      const error = err instanceof Error ? err : new Error(String(err))
      if (!background) setError(error)
      setLoading(false)
      if (refreshOptions.throwOnError) throw error
    }
  }, [addressed, applySessions, enabled, fetchImpl, persistActive, preferredSessionId, requestHeaders, retryBaseMs, retryMaxMs, retryMaxRetries, sessionsListUrl])

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
    const requestGeneration = ++refreshGenerationRef.current
    const scope = requestScopeKey
    const offset = canonicalLoadedCountRef.current
    setLoadingMore(true)
    try {
      const page = await fetchSessionList(fetchImpl, sessionsListUrl(offset, undefined, nextCursorRef.current), requestHeaders(), addressed)
      const data = page.sessions
      if (!mountedRef.current || requestSeq !== loadMoreRequestSeqRef.current || version !== refreshVersionRef.current || scope !== requestScopeRef.current) return
      const merged = applyPendingRenameTitles(data, mergeSessionLists(addressed, sessionsRef.current, data), requestGeneration)
      const nextHasMore = addressed ? page.nextCursor !== undefined : data.length >= SESSION_PAGE_SIZE
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
      if (mountedRef.current && requestSeq === loadMoreRequestSeqRef.current && version === refreshVersionRef.current && scope === requestScopeRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      if (requestSeq === loadMoreRequestSeqRef.current) loadMoreInFlightRef.current = false
      if (mountedRef.current && requestSeq === loadMoreRequestSeqRef.current && version === refreshVersionRef.current && scope === requestScopeRef.current) {
        setLoadingMore(false)
      }
    }
  }, [addressed, applyPendingRenameTitles, enabled, fetchImpl, hasMore, loading, loadingMore, persistActive, requestHeaders, requestScopeKey, sessionsListUrl])

  const adoptNative = useCallback((localId: string, session: SessionSummary, refreshAfter = true, originalDataSourceKey = dataSourceKeyRef.current) => {
    const local = localSessionsRef.current.get(localId)
    const localIsCurrent = isCurrentLocalSession(local, dataSourceKeyRef.current, dataSourceGenerationRef.current)
    if (!localIsCurrent && dataSourceKeyRef.current !== originalDataSourceKey) return
    const nativeSession = { ...session, ephemeral: false }
    localSessionsRef.current.delete(localId)
    pendingCreatedRef.current.delete(localId)
    ensurePendingScope()
    pendingCreatedRef.current.set(nativeSession.id, nativeSession)
    setSessions((previous) => mergeSessionLists(addressed, [nativeSession], previous.filter((item) => item.id !== localId)))
    setActiveSessionId((previous) => {
      if (previous !== localId) return previous
      persistActive(nativeSession.id)
      return nativeSession.id
    })
    if (refreshAfter) void refresh({ background: true })
  }, [addressed, ensurePendingScope, persistActive, refresh])

  useEffect(() => {
    if (!enabled || !connectActiveSession || !activeSessionId || !activeSessionKnown) {
      setActivePiSession(undefined)
      return
    }

    const session = createRemoteSession({
      ...remoteSessionOptionsRef.current,
      sessionId: activeSessionId,
      ...(activeSessionEphemeral ? {
        autoStart: false,
        nativeFirstPrompt: {
          onMaterialize: (native: SessionSummary) => adoptNative(activeSessionId, native, true, dataSourceKey),
          onAdopt: (native: SessionSummary) => adoptNative(activeSessionId, native, true, dataSourceKey),
        },
      } : {}),
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
  }, [activeSessionEphemeral, activeSessionId, activeSessionKnown, adoptNative, apiBaseUrl, connectActiveSession, createRemoteSession, dataSourceKey, enabled, fetchImpl, remoteSessionOptionsKey, options.agentTypeId, options.workspaceId, requestHeaders, storageScope])

  const create = useCallback(async (init?: PiSessionCreateInit): Promise<SessionSummary> => {
    if (!enabled) throw new Error('Pi sessions are disabled')
    if (localCreateUntilPrompt) {
      const staleIds = clearStaleLocalSessions()
      const now = new Date().toISOString()
      const session = { id: localSessionId(), title: init?.title ?? 'New session', createdAt: now, updatedAt: now, turnCount: 0, ephemeral: true }
      localSessionsRef.current.set(session.id, {
        session,
        dataSourceKey,
        nativeFirstDataSourceKey,
        generation: dataSourceGenerationRef.current,
      })
      setDataStorageScope(storageScope)
      setSessions((previous) => mergeSessionLists(addressed, [session], previous.filter((item) => !staleIds.has(item.id))))
      setActiveSessionId(session.id)
      persistActive(undefined)
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
    const body = await response.json()
    const session = addressed
      ? addressedCreatedSession(body, init?.title)
      : toSessionSummary(body)
    ensurePendingScope()
    pendingCreatedRef.current.set(session.id, session)
    setDataStorageScope(storageScope)
    setSessions((previous) => mergeSessionLists(addressed, [session], previous))
    setActiveSessionId(session.id)
    persistActive(session.id)
    void refresh()
    return session
  }, [addressed, clearStaleLocalSessions, dataSourceKey, enabled, ensurePendingScope, fetchImpl, localCreateUntilPrompt, nativeFirstDataSourceKey, persistActive, refresh, requestHeaders, sessionsUrl, storageScope])

  const rename = useCallback(async (id: string, title: string): Promise<SessionSummary> => {
    const requestScope = requestScopeKey
    const dataSourceGeneration = dataSourceGenerationRef.current
    const response = await fetchImpl(sessionsUrl(`/${encodeURIComponent(id)}${addressed ? '/rename' : ''}`), {
      method: addressed ? 'POST' : 'PATCH',
      headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(addressed ? { requestId: sessionMutationRequestId('rename'), title } : { title }),
    })
    if (!response.ok) throw new Error(`Failed to rename session: ${response.status}`)
    const body = await response.json()
    const session = addressed ? toAddressedSessionSummary(body) : toSessionSummary(body)
    if (requestScope !== requestScopeRef.current || dataSourceGeneration !== dataSourceGenerationRef.current) return session
    ensurePendingScope()
    pendingRenamesRef.current.set(id, { title: session.title, generation: refreshGenerationRef.current, mismatches: 0 })
    setSessions((previous) => previous.map((item) => item.id === id ? { ...item, ...session } : item))
    void refresh({ background: true }).catch(() => {
      // Background reconciliation is best-effort after the rename succeeds.
    })
    return session
  }, [addressed, ensurePendingScope, fetchImpl, refresh, requestHeaders, requestScopeKey, sessionsUrl])

  const switchSession = useCallback((id: string) => {
    const known = sessionsRef.current.some((session) => session.id === id)
    const next = known ? id : sessionsRef.current[0]?.id
    setActiveSessionId(next)
    persistActive(next)
  }, [persistActive])

  const removeSessionLocally = useCallback((id: string) => {
    pendingCreatedRef.current.delete(id)
    setDataStorageScope(storageScope)
    setSessions((previous) => previous.filter((session) => session.id !== id))
    setActiveSessionId((previous) => {
      if (previous !== id) return previous
      const next = sessionsRef.current.find((session) => session.id !== id)?.id
      persistActive(next)
      return next
    })
  }, [persistActive, storageScope])

  const deleteSession = useCallback(async (id: string): Promise<void> => {
    if (!enabled) throw new Error('Pi sessions are disabled')
    const sourceDataSourceKey = dataSourceKeyRef.current
    const sourceDataSourceGeneration = dataSourceGenerationRef.current
    const sourceRequestScope = requestScopeRef.current
    const sourceFetch = fetchImpl
    const sourceSessionsUrl = sessionsUrl
    const sourceRequestHeaders = requestHeaders()
    const sourceIsCurrent = () => (
      sourceDataSourceKey === dataSourceKeyRef.current
      && sourceDataSourceGeneration === dataSourceGenerationRef.current
      && sourceRequestScope === requestScopeRef.current
    )
    ensurePendingScope()
    if (clearStaleLocalSessions().has(id)) return
    const local = localSessionsRef.current.get(id)
    if (local) {
      let receipt: NativePromptReceipt | undefined
      try {
        receipt = await tombstoneNativeFirst<NativePromptReceipt>(local.nativeFirstDataSourceKey, id)
      } catch {
        // A reconciled unknown outcome has no safe native delete target.
      }
      if (receipt) {
        try {
          const response = await sourceFetch(sourceSessionsUrl(`/${encodeURIComponent(receipt.nativeSessionId)}`), {
            method: 'DELETE',
            headers: sourceRequestHeaders,
          })
          if (!response.ok && response.status !== 404) throw new Error(`Failed to delete session: ${response.status}`)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          clearNativeFirst(local.nativeFirstDataSourceKey, id)
          if (sourceIsCurrent()) {
            // The native transcript is now the only safe retry target.
            adoptNative(id, receipt.session, false)
            setError(error)
          } else {
            localSessionsRef.current.delete(id)
            pendingCreatedRef.current.delete(id)
          }
          throw error
        }
      }
      clearNativeFirst(local.nativeFirstDataSourceKey, id)
      localSessionsRef.current.delete(id)
      if (!sourceIsCurrent()) {
        pendingCreatedRef.current.delete(id)
        return
      }
      removeSessionLocally(id)
      void refresh()
      return
    }

    removeSessionLocally(id)
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
  }, [adoptNative, clearStaleLocalSessions, enabled, ensurePendingScope, fetchImpl, refresh, removeSessionLocally, requestHeaders, sessionsUrl])

  const reset = useCallback(() => {
    pendingCreatedRef.current.clear()
    pendingRenamesRef.current.clear()
    const localIds = new Set(localSessionsRef.current.keys())
    for (const [id, local] of localSessionsRef.current) releaseNativeFirst(local.nativeFirstDataSourceKey, id)
    localSessionsRef.current.clear()
    const retainedSessions = sessionsRef.current.filter((session) => !localIds.has(session.id))
    sessionsRef.current = retainedSessions
    setSessions((previous) => previous.filter((session) => !localIds.has(session.id)))
    loadMoreRequestSeqRef.current += 1
    loadMoreInFlightRef.current = false
    canonicalLoadedCountRef.current = canonicalPageCount(retainedSessions)
    nextCursorRef.current = undefined
    loadedDataSourceRef.current = dataSourceKey
    dataStorageScopeRef.current = storageScope
    setDataStorageScope(storageScope)
    setActiveSessionId(undefined)
    setActivePiSession(undefined)
    setLoadingMore(false)
    persistActive(undefined)
  }, [dataSourceKey, persistActive, storageScope])

  const visibleActiveSessionId = enabled ? activeSessionId : undefined

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
    adoptNative,
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
  addressed: boolean,
): Promise<SessionPage> {
  const response = await fetchImpl(url, Object.keys(headers).length > 0 ? { headers } : undefined)
  if (response.status === 503) throw new SessionsPreparingError()
  if (!response.ok) throw new Error(`Failed to load sessions: ${response.status}`)
  const body = await response.json()
  if (!addressed) {
    if (!Array.isArray(body)) throw new Error('Failed to load sessions: invalid response')
    return { sessions: body.map(toSessionSummary) }
  }
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { sessions?: unknown }).sessions)) {
    throw new Error('Failed to load sessions: invalid response')
  }
  const page = body as { sessions: unknown[]; nextCursor?: unknown }
  return {
    sessions: page.sessions.map(toAddressedSessionSummary),
    ...(typeof page.nextCursor === 'string' ? { nextCursor: page.nextCursor } : {}),
  }
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
    ...(typeof record.nativeSessionId === 'string' ? { nativeSessionId: record.nativeSessionId } : {}),
    ...(typeof record.hasAssistantReply === 'boolean' ? { hasAssistantReply: record.hasAssistantReply } : {}),
  }
}

function isCurrentLocalSession(
  local: LocalSession | undefined,
  dataSourceKey: string,
  generation: number,
): boolean {
  return local?.dataSourceKey === dataSourceKey && local.generation === generation
}

function localSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    const value = character === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
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
  return {
    id: (ref as { sessionId: string }).sessionId,
    title: typeof record.title === 'string' ? record.title : 'Untitled',
    createdAt,
    updatedAt,
    turnCount: typeof record.turnCount === 'number' ? record.turnCount : 0,
    ...(typeof agentTypeId === 'string' ? { agentTypeId } : {}),
    ...(typeof record.nativeSessionId === 'string' ? { nativeSessionId: record.nativeSessionId } : {}),
    ...(typeof record.hasAssistantReply === 'boolean' ? { hasAssistantReply: record.hasAssistantReply } : {}),
  }
}

function addressedCreatedSession(value: unknown, title?: string): SessionSummary {
  if (typeof value !== 'object' || value === null || typeof (value as { sessionId?: unknown }).sessionId !== 'string') {
    throw new Error('invalid addressed session ref')
  }
  const now = new Date().toISOString()
  return {
    id: (value as { sessionId: string }).sessionId,
    title: title ?? 'Untitled',
    createdAt: now,
    updatedAt: now,
    turnCount: 0,
  }
}

function sessionMutationRequestId(operation: string): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${operation}-${crypto.randomUUID()}`
    : `${operation}-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

function compareSessionSummaries(left: SessionSummary, right: SessionSummary): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function mergeSessions(...lists: SessionSummary[][]): SessionSummary[] {
  return mergeSessionsInOrder(...lists).sort(compareSessionSummaries)
}

function mergeSessionLists(addressed: boolean, ...lists: SessionSummary[][]): SessionSummary[] {
  return addressed ? mergeSessionsInOrder(...lists) : mergeSessions(...lists)
}

function mergeSessionsInOrder(...lists: SessionSummary[][]): SessionSummary[] {
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

function requestScopeIdentity(apiBaseUrl: string, sessionsApiPath: string, storageScope: string, headersKey: string, workspaceId?: string): string {
  return `${apiBaseUrl}\n${sessionsApiPath}\n${storageScope}\n${headersKey}\n${workspaceId ?? ''}`
}

function dataSourceIdentity(apiBaseUrl: string, sessionsApiPath: string, storageScope: string, workspaceId?: string): string {
  return `${apiBaseUrl}\n${sessionsApiPath}\n${storageScope}\n${workspaceId ?? ''}`
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
