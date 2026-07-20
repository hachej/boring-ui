import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NativePromptReceipt } from '../../../shared/chat/nativePiFirstSend'
import type { SessionSummary } from '../../../shared/session'
import { clearNativeFirst, tombstoneNativeFirst } from '../pi/nativeFirstSendTransactions'
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
  if (dataSourceKeyRef.current !== dataSourceKey) {
    dataSourceKeyRef.current = dataSourceKey
    dataSourceGenerationRef.current += 1
  }
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
  const pendingRenamesRef = useRef<Map<string, SessionSummary>>(new Map())
  const localSessionsRef = useRef<Map<string, LocalSession>>(new Map())
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
      && (!activeSessionEphemeral || isCurrentLocalSession(localSessionsRef.current.get(activeSession.id), dataSourceKeyRef.current, dataSourceGenerationRef.current)),
  )

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
      clearNativeFirst(local.nativeFirstDataSourceKey, id)
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

  const applyPendingRenameTitles = useCallback((serverRows: SessionSummary[], rows: SessionSummary[]): SessionSummary[] => {
    const pending = new Map(pendingRenamesRef.current)
    for (const session of serverRows) {
      if (pending.get(session.id)?.title === session.title) pendingRenamesRef.current.delete(session.id)
    }
    return rows.map((session) => {
      const rename = pending.get(session.id)
      return rename ? { ...session, title: rename.title } : session
    })
  }, [])

  const applySessions = useCallback((data: SessionSummary[], applyOptions: { background?: boolean } = {}) => {
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
    const pageMayHaveMore = serverData.length >= SESSION_PAGE_SIZE
    const wasExhaustedBeyondFirstPage = applyOptions.background
      && !hasMoreRef.current
      && canonicalLoadedCountRef.current >= canonicalCount
    const requestedActiveReturned = Boolean(requestedActiveId && serverData.some((session) => session.id === requestedActiveId))
    const current = applyOptions.background && pageMayHaveMore
      ? sessionsRef.current.filter((session) => !requestedActiveId || requestedActiveReturned || session.id !== requestedActiveId)
      : []
    const merged = applyPendingRenameTitles(serverData, mergeSessions(Array.from(localSessionsRef.current.values(), ({ session }) => session), Array.from(pendingCreated.values()), serverData, current))
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
  }, [applyPendingRenameTitles, clearStaleLocalSessions, dataSourceKey, ensurePendingScope, persistActive, preferredSessionId, storageScope])

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
      const merged = applyPendingRenameTitles(data, mergeSessions(sessionsRef.current, data))
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
  }, [applyPendingRenameTitles, enabled, fetchImpl, hasMore, loading, loadingMore, persistActive, requestHeaders, requestScopeKey, sessionsListUrl])

  const adoptNative = useCallback((localId: string, session: SessionSummary, refreshAfter = true) => {
    const local = localSessionsRef.current.get(localId)
    if (!isCurrentLocalSession(local, dataSourceKeyRef.current, dataSourceGenerationRef.current)) return
    const nativeSession = { ...session, ephemeral: false }
    localSessionsRef.current.delete(localId)
    pendingCreatedRef.current.delete(localId)
    pendingCreatedRef.current.set(nativeSession.id, nativeSession)
    setSessions((previous) => mergeSessions([nativeSession], previous.filter((item) => item.id !== localId)))
    setActiveSessionId((previous) => {
      if (previous !== localId) return previous
      persistActive(nativeSession.id)
      return nativeSession.id
    })
    if (refreshAfter) void refresh({ background: true })
  }, [persistActive, refresh])

  useEffect(() => {
    if (!enabled || !connectActiveSession || !activeSessionId || !activeSessionKnown) {
      setActivePiSession(undefined)
      return
    }

    const session = createRemoteSession({
      ...remoteSessionOptionsRef.current,
      sessionId: activeSessionId,
      ...(activeSessionEphemeral ? { autoStart: false, nativeFirstPrompt: { onAdopt: (native: SessionSummary) => adoptNative(activeSessionId, native) } } : {}),
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
  }, [activeSessionEphemeral, activeSessionId, activeSessionKnown, adoptNative, apiBaseUrl, connectActiveSession, createRemoteSession, enabled, fetchImpl, remoteSessionOptionsKey, options.workspaceId, requestHeaders, storageScope])

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
      setSessions((previous) => mergeSessions([session], previous.filter((item) => !staleIds.has(item.id))))
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
    const session = toSessionSummary(await response.json())
    ensurePendingScope()
    pendingCreatedRef.current.set(session.id, session)
    setDataStorageScope(storageScope)
    setSessions((previous) => mergeSessions([session], previous))
    setActiveSessionId(session.id)
    persistActive(session.id)
    void refresh()
    return session
  }, [clearStaleLocalSessions, dataSourceKey, enabled, ensurePendingScope, fetchImpl, localCreateUntilPrompt, nativeFirstDataSourceKey, persistActive, refresh, requestHeaders, sessionsUrl, storageScope])

  const rename = useCallback(async (id: string, title: string): Promise<SessionSummary> => {
    const response = await fetchImpl(sessionsUrl(`/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!response.ok) throw new Error(`Failed to rename session: ${response.status}`)
    const session = toSessionSummary(await response.json())
    ensurePendingScope()
    pendingRenamesRef.current.set(id, session)
    setSessions((previous) => previous.map((item) => item.id === id ? { ...item, ...session } : item))
    return session
  }, [ensurePendingScope, fetchImpl, requestHeaders, sessionsUrl])

  const switchSession = useCallback((id: string) => {
    const known = sessionsRef.current.some((session) => session.id === id)
    const next = known ? id : sessionsRef.current[0]?.id
    setActiveSessionId(next)
    persistActive(next)
  }, [persistActive])

  const deleteSession = useCallback(async (id: string): Promise<void> => {
    if (!enabled) throw new Error('Pi sessions are disabled')
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
          const response = await fetchImpl(sessionsUrl(`/${encodeURIComponent(receipt.nativeSessionId)}`), {
            method: 'DELETE',
            headers: requestHeaders(),
          })
          if (!response.ok && response.status !== 404) throw new Error(`Failed to delete session: ${response.status}`)
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          clearNativeFirst(local.nativeFirstDataSourceKey, id)
          // The native transcript is now the only safe retry target.
          adoptNative(id, receipt.session, false)
          setError(error)
          throw error
        }
      }
      clearNativeFirst(local.nativeFirstDataSourceKey, id)
      localSessionsRef.current.delete(id)
      pendingCreatedRef.current.delete(id)
      setDataStorageScope(storageScope)
      setSessions((previous) => previous.filter((session) => session.id !== id))
      setActiveSessionId((previous) => {
        if (previous !== id) return previous
        const next = sessionsRef.current.find((session) => session.id !== id)?.id
        persistActive(next)
        return next
      })
      if (receipt) void refresh()
      return
    }

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
  }, [adoptNative, clearStaleLocalSessions, enabled, ensurePendingScope, fetchImpl, persistActive, refresh, requestHeaders, sessionsUrl, storageScope])

  const reset = useCallback(() => {
    pendingCreatedRef.current.clear()
    pendingRenamesRef.current.clear()
    for (const [id, local] of localSessionsRef.current) clearNativeFirst(local.nativeFirstDataSourceKey, id)
    localSessionsRef.current.clear()
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
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `local-${crypto.randomUUID()}`
    : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

function nativeFirstDataSourceIdentity(apiBaseUrl: string, storageScope: string, workspaceId?: string): string {
  return `${apiBaseUrl}\n${workspaceId ?? ''}\n${storageScope}`
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
