import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { WORKSPACE_COMPOSER_STOP_REASONS, emitWorkspaceComposerStop } from "../../front/chrome/chat/composerStop"
import {
  workspaceSessionKey,
  workspaceSessionKeyFor,
  workspaceSessionRef,
} from "../../front/sessionIdentity"
import {
  createLocalStorageSessions,
  useLocalStorageSessions,
} from "./localStorageSessions"
import { useAddressedConsoleController } from "./addressedConsoleSessions"
import { useWorkspaceAgentChatPanes } from "./useWorkspaceAgentChatPanes"
import type {
  UseWorkspaceAddressedAgentSelection,
  UseWorkspaceAgentSessions,
  WorkspaceAgentSession,
  WorkspaceAgentSessionsApi,
} from "./WorkspaceAgentFront"

interface RemoteSessionSnapshot<TSession extends WorkspaceAgentSession> {
  workspaceId: string
  agentTypeId: string | undefined
  sessions: TSession[]
  activeSessionId: string | null | undefined
  activeSessionAgentTypeId: string | null | undefined
  loading: boolean
  loadingMore?: boolean
  hasMore?: boolean
  error?: Error | null
}

interface WorkspaceAgentSessionCoordinatorOptions<
  TSession extends WorkspaceAgentSession,
> {
  workspaceId: string
  explicitAgentTypeId?: string
  addressedAgentSelection: boolean
  useAgentSelection: UseWorkspaceAddressedAgentSelection
  useSessions: UseWorkspaceAgentSessions<TSession>
  chatPanelProvided: boolean
  useSessionsProvided: boolean
  resolvedRequestHeaders: Record<string, string>
  resolvedSessionStorageKey: string
  apiBaseUrl?: string
  provisionWorkspace?: boolean
  isPluginTabsLayout: boolean
  sessions?: WorkspaceAgentSession[]
  activeSessionId?: string | null
  activeSessionAgentTypeId?: string | null
  onSwitchSession?: (id: string, agentTypeId?: string) => void
  onCreateSession?: () => unknown | Promise<unknown>
  onDeleteSession?: (id: string, agentTypeId?: string) => void
  onActiveSessionIdChange?: (sessionId: string | null) => void
  defaultSessionTitle: string
  autoSubmitInitialDraft: boolean
  persistenceEnabled: boolean
  onPaneFocus: () => void
}

const remoteSessionActionsUnavailable = () => undefined

function readStoredSessionId(storageKey: string): string | null {
  try {
    return globalThis.localStorage?.getItem(storageKey) ?? null
  } catch {
    return null
  }
}

export function useWorkspaceAgentSessionCoordinator<
  TSession extends WorkspaceAgentSession,
>({
  workspaceId,
  explicitAgentTypeId,
  addressedAgentSelection,
  useAgentSelection,
  useSessions,
  chatPanelProvided,
  useSessionsProvided,
  resolvedRequestHeaders,
  resolvedSessionStorageKey,
  apiBaseUrl,
  provisionWorkspace,
  isPluginTabsLayout,
  sessions,
  activeSessionId,
  activeSessionAgentTypeId,
  onSwitchSession,
  onCreateSession,
  onDeleteSession,
  onActiveSessionIdChange,
  defaultSessionTitle,
  autoSubmitInitialDraft,
  persistenceEnabled,
  onPaneFocus,
}: WorkspaceAgentSessionCoordinatorOptions<TSession>) {
  const addressedAgentSelectionEnabled = addressedAgentSelection && !explicitAgentTypeId
  const multiAgentConsoleEnabled = addressedAgentSelectionEnabled && isPluginTabsLayout
  const addressedAgentSelectionState = useAgentSelection({
    apiBaseUrl,
    requestHeaders: resolvedRequestHeaders,
    storageScope: workspaceId,
    enabled: addressedAgentSelectionEnabled,
  })
  const agentTypeId = explicitAgentTypeId ?? addressedAgentSelectionState.selectedAgentTypeId
  const addressedAgentSelectionPending = addressedAgentSelectionEnabled && !agentTypeId
  const agentSessionScopeKey = `${workspaceId}\n${agentTypeId ?? ""}`
  const agentSessionScopeRef = useRef(agentSessionScopeKey)
  agentSessionScopeRef.current = agentSessionScopeKey
  const handleAgentTypeIdChange = useCallback((nextAgentTypeId: string) => {
    addressedAgentSelectionState.selectAgentTypeId(nextAgentTypeId)
  }, [addressedAgentSelectionState.selectAgentTypeId])
  const controlledAgentSelection = useMemo(() => addressedAgentSelectionEnabled ? {
    agents: addressedAgentSelectionState.agents,
    selectedAgentTypeId: addressedAgentSelectionState.selectedAgentTypeId,
    loading: addressedAgentSelectionState.loading,
    error: addressedAgentSelectionState.error,
    onSelect: handleAgentTypeIdChange,
  } : undefined, [
    addressedAgentSelectionEnabled,
    addressedAgentSelectionState.agents,
    addressedAgentSelectionState.error,
    addressedAgentSelectionState.loading,
    addressedAgentSelectionState.selectedAgentTypeId,
    handleAgentTypeIdChange,
  ])

  const localSessionStore = useMemo(
    () => createLocalStorageSessions({ storageKey: resolvedSessionStorageKey }),
    [resolvedSessionStorageKey],
  )
  const localSessions = useLocalStorageSessions(localSessionStore)
  const [emptySessionsGrace, setEmptySessionsGrace] = useState<{ scopeKey: string; expired: boolean }>(() => ({
    scopeKey: agentSessionScopeKey,
    expired: false,
  }))
  const [initialRemoteSessionCreating, setInitialRemoteSessionCreating] = useState<{ scopeKey: string; creating: boolean }>(() => ({
    scopeKey: agentSessionScopeKey,
    creating: false,
  }))
  const [initialRemoteSessionCreateFailed, setInitialRemoteSessionCreateFailed] = useState<{ scopeKey: string; failed: boolean }>(() => ({
    scopeKey: agentSessionScopeKey,
    failed: false,
  }))

  const shouldUseRemoteSessions = !chatPanelProvided || useSessionsProvided || addressedAgentSelectionEnabled
  const remoteSessionHookEnabled = shouldUseRemoteSessions && provisionWorkspace !== false
  const primaryRemoteSessionApi = useSessions({
    requestHeaders: resolvedRequestHeaders,
    storageKey: resolvedSessionStorageKey,
    agentTypeId: multiAgentConsoleEnabled ? undefined : agentTypeId,
    workspaceId,
    apiBaseUrl,
    enabled: remoteSessionHookEnabled && !addressedAgentSelectionPending && !multiAgentConsoleEnabled,
  })
  const addressedSessionControllersRef = useRef(new Map<string, WorkspaceAgentSessionsApi<TSession>>())
  const [remoteSessionSnapshots, setRemoteSessionSnapshots] = useState<Map<string, RemoteSessionSnapshot<TSession>>>(() => new Map())
  const publishAddressedSessionController = useCallback((
    ownerAgentTypeId: string,
    controller: WorkspaceAgentSessionsApi<TSession>,
  ) => {
    addressedSessionControllersRef.current.set(ownerAgentTypeId, controller)
    const scopeKey = `${workspaceId}\n${ownerAgentTypeId}`
    const activeOwner = controller.activeSessionAgentTypeId
      ?? controller.activeSession?.agentTypeId
      ?? ownerAgentTypeId
    const sourceAgentTypeId = controller.sourceAgentTypeId ?? ownerAgentTypeId
    setRemoteSessionSnapshots((previous) => {
      const current = previous.get(scopeKey)
      const sameSessions = current?.sessions.length === controller.sessions.length
        && current.sessions.every((session, index) => {
          const next = controller.sessions[index]
          return session.id === next?.id
            && session.agentTypeId === next.agentTypeId
            && session.title === next.title
            && session.turnCount === next.turnCount
            && session.readOnly === next.readOnly
            && session.readOnlyReason === next.readOnlyReason
        })
      if (
        current?.workspaceId === workspaceId
        && current.agentTypeId === sourceAgentTypeId
        && current.activeSessionId === controller.activeSessionId
        && current.activeSessionAgentTypeId === activeOwner
        && current.loading === controller.loading
        && current.loadingMore === controller.loadingMore
        && current.hasMore === controller.hasMore
        && current.error === controller.error
        && sameSessions
      ) return previous
      const next = new Map(previous)
      next.set(scopeKey, {
        workspaceId,
        agentTypeId: sourceAgentTypeId,
        sessions: controller.sessions,
        activeSessionId: controller.activeSessionId,
        activeSessionAgentTypeId: activeOwner,
        loading: controller.loading,
        loadingMore: controller.loadingMore,
        hasMore: controller.hasMore,
        error: controller.error,
      })
      return next
    })
  }, [workspaceId])
  const removeAddressedSessionController = useCallback((ownerAgentTypeId: string) => {
    addressedSessionControllersRef.current.delete(ownerAgentTypeId)
    const scopeKey = `${workspaceId}\n${ownerAgentTypeId}`
    setRemoteSessionSnapshots((previous) => {
      if (!previous.has(scopeKey)) return previous
      const next = new Map(previous)
      next.delete(scopeKey)
      return next
    })
  }, [workspaceId])
  const remoteSessionSnapshot = remoteSessionSnapshots.get(agentSessionScopeKey)
  const remoteSessionApi = useMemo<WorkspaceAgentSessionsApi<TSession>>(() => {
    if (!multiAgentConsoleEnabled || !agentTypeId) return primaryRemoteSessionApi
    const snapshot = remoteSessionSnapshots.get(agentSessionScopeKey)
    const controller = () => addressedSessionControllersRef.current.get(agentTypeId)
    const selectedSessions = snapshot?.sessions ?? []
    const active = selectedSessions.find((session) => session.id === snapshot?.activeSessionId) ?? null
    return {
      sessions: selectedSessions,
      sourceAgentTypeId: snapshot?.agentTypeId ?? agentTypeId,
      loading: snapshot?.loading ?? true,
      loadingMore: snapshot?.loadingMore,
      hasMore: snapshot?.hasMore,
      error: snapshot?.error,
      activeSessionId: snapshot?.activeSessionId,
      activeSessionAgentTypeId: snapshot?.activeSessionAgentTypeId,
      activeSession: active,
      workspaceId,
      switch: (id) => controller()?.switch(id),
      create: (input) => controller()?.create(input),
      adoptNative: (localId, session) => controller()?.adoptNative?.(localId, session),
      rename: (id, title) => controller()?.rename?.(id, title),
      delete: (id) => controller()?.delete(id),
      markReadOnly: (id, reason) => controller()?.markReadOnly?.(id, reason),
      loadMore: () => controller()?.loadMore?.(),
      refresh: (options) => controller()?.refresh?.(options),
    }
  }, [agentSessionScopeKey, agentTypeId, multiAgentConsoleEnabled, primaryRemoteSessionApi, remoteSessionSnapshots, workspaceId])
  const {
    activate: activateAddressedSession,
    createSession: createAddressedSession,
    adoptNativeSession: adoptAddressedSession,
    renameSession: renameAddressedSession,
    deleteSession: deleteAddressedSession,
    markSessionReadOnly: markAddressedSessionReadOnly,
    refreshSession: refreshAddressedSession,
  } = useAddressedConsoleController({
    enabled: multiAgentConsoleEnabled,
    selectedAgentTypeId: agentTypeId,
    selectAgentTypeId: handleAgentTypeIdChange,
    controllers: addressedSessionControllersRef,
  })

  const remoteSessionsArePreviousWorkspace = remoteSessionHookEnabled
    && remoteSessionApi.workspaceId != null
    && remoteSessionApi.workspaceId !== workspaceId
  const remoteSessionsArePreviousAgent = remoteSessionHookEnabled && (
    agentTypeId
      ? remoteSessionApi.sourceAgentTypeId != null
        ? remoteSessionApi.sourceAgentTypeId !== agentTypeId
        : addressedAgentSelectionEnabled
      : remoteSessionApi.sourceAgentTypeId != null
  )
  const remoteSessionsAvailable = remoteSessionHookEnabled
    && !addressedAgentSelectionPending
    && !remoteSessionApi.loading
    && !remoteSessionApi.error
    && !remoteSessionsArePreviousWorkspace
    && !remoteSessionsArePreviousAgent
  const remoteSessionsPending = addressedAgentSelectionPending || (remoteSessionHookEnabled && !remoteSessionsAvailable)
  useEffect(() => {
    if (!remoteSessionsAvailable) return
    setRemoteSessionSnapshots((previous) => {
      const current = previous.get(agentSessionScopeKey)
      const sameScope = current?.workspaceId === workspaceId && current?.agentTypeId === agentTypeId
      const remoteActiveOwner = remoteSessionApi.activeSessionAgentTypeId
        ?? remoteSessionApi.activeSession?.agentTypeId
        ?? null
      const sameActive = current?.activeSessionId === remoteSessionApi.activeSessionId
        && current?.activeSessionAgentTypeId === remoteActiveOwner
      const sameSessions = current?.sessions.length === remoteSessionApi.sessions.length
        && current.sessions.every((session, index) => (
          session.id === remoteSessionApi.sessions[index]?.id
          && session.agentTypeId === remoteSessionApi.sessions[index]?.agentTypeId
          && session.title === remoteSessionApi.sessions[index]?.title
          && session.turnCount === remoteSessionApi.sessions[index]?.turnCount
          && session.readOnly === remoteSessionApi.sessions[index]?.readOnly
          && session.readOnlyReason === remoteSessionApi.sessions[index]?.readOnlyReason
        ))
      if (sameScope && sameActive && sameSessions) return previous
      const next = new Map(previous)
      next.set(agentSessionScopeKey, {
        workspaceId,
        agentTypeId,
        sessions: remoteSessionApi.sessions,
        activeSessionId: remoteSessionApi.activeSessionId,
        activeSessionAgentTypeId: remoteActiveOwner,
        loading: remoteSessionApi.loading,
        loadingMore: remoteSessionApi.loadingMore,
        hasMore: remoteSessionApi.hasMore,
        error: remoteSessionApi.error,
      })
      return next
    })
  }, [agentSessionScopeKey, agentTypeId, remoteSessionApi.activeSession, remoteSessionApi.activeSessionAgentTypeId, remoteSessionApi.activeSessionId, remoteSessionApi.sessions, remoteSessionsAvailable, workspaceId])

  const remoteSessionsHaveStaleData = remoteSessionsPending
    && remoteSessionSnapshot?.workspaceId === workspaceId
    && remoteSessionSnapshot.agentTypeId === agentTypeId
    && remoteSessionSnapshot.sessions.length > 0
  const pendingStoredActiveSessionId = remoteSessionsPending && !agentTypeId
    ? readStoredSessionId(resolvedSessionStorageKey)
    : null
  const pendingRemoteActiveSessionId = remoteSessionsPending
    && !remoteSessionsArePreviousWorkspace
    && !remoteSessionsArePreviousAgent
    ? remoteSessionApi.activeSessionId ?? null
    : null
  const rawActiveRemoteSessions = remoteSessionsAvailable
    ? remoteSessionApi.sessions
    : remoteSessionsHaveStaleData
      ? remoteSessionSnapshot?.sessions ?? []
      : []
  const activeRemoteSessions = useMemo(() => {
    if (!agentTypeId) return rawActiveRemoteSessions
    return rawActiveRemoteSessions.map((session) => (
      session.agentTypeId == null ? { ...session, agentTypeId } : session
    ))
  }, [agentTypeId, rawActiveRemoteSessions])
  const activeRemoteSessionId = remoteSessionsAvailable
    ? remoteSessionApi.activeSessionId
    : remoteSessionsHaveStaleData
      ? remoteSessionSnapshot?.activeSessionId
      : null
  const activeRemoteSessionAgentTypeId = remoteSessionsAvailable
    ? remoteSessionApi.sourceAgentTypeId
      ?? remoteSessionApi.activeSessionAgentTypeId
      ?? remoteSessionApi.activeSession?.agentTypeId
      ?? null
    : remoteSessionsHaveStaleData
      ? remoteSessionSnapshot?.activeSessionAgentTypeId
      : null
  const sessionApi = shouldUseRemoteSessions && (remoteSessionsAvailable || remoteSessionsHaveStaleData) ? remoteSessionApi : undefined
  const hasExplicitSessionProps =
    sessions !== undefined
    || activeSessionId !== undefined
    || activeSessionAgentTypeId !== undefined
    || onSwitchSession !== undefined
    || onCreateSession !== undefined
    || onDeleteSession !== undefined
  const emptySessionsGraceExpired = emptySessionsGrace.scopeKey === agentSessionScopeKey && emptySessionsGrace.expired
  const suppressEmptyAutoCreateRef = useRef(false)
  const remoteEmptySessionsSettling = Boolean(
    remoteSessionsAvailable
    && sessionApi
    && !multiAgentConsoleEnabled
    && !hasExplicitSessionProps
    && activeRemoteSessions.length === 0
    && !emptySessionsGraceExpired,
  )
  const remoteInitialSessionCreating = initialRemoteSessionCreating.scopeKey === agentSessionScopeKey
    && initialRemoteSessionCreating.creating
  const remoteInitialSessionFailed = initialRemoteSessionCreateFailed.scopeKey === agentSessionScopeKey
    && initialRemoteSessionCreateFailed.failed
  const remoteInitialSessionNeeded = Boolean(
    remoteSessionsAvailable
      && sessionApi
      && !multiAgentConsoleEnabled
      && !hasExplicitSessionProps
      && activeRemoteSessions.length === 0
      && emptySessionsGraceExpired
      && !suppressEmptyAutoCreateRef.current
      && !remoteInitialSessionFailed,
  )
  const remoteSessionsInitialLoading = Boolean(
    addressedAgentSelectionPending
    || remoteSessionsArePreviousAgent
    || (remoteSessionsPending
      && remoteSessionApi.loading
      && !remoteSessionApi.error
      && shouldUseRemoteSessions
      && !hasExplicitSessionProps
      && !remoteSessionsHaveStaleData
      && !pendingStoredActiveSessionId
      && !pendingRemoteActiveSessionId),
  )
  const remoteSessionsTransitioning = remoteSessionsInitialLoading
    || remoteEmptySessionsSettling
    || remoteInitialSessionCreating
    || remoteInitialSessionNeeded
  const selectedAddressedAgentIsEmpty = Boolean(
    multiAgentConsoleEnabled
    && agentTypeId
    && remoteSessionsAvailable
    && activeRemoteSessions.length === 0,
  )

  useEffect(() => {
    if (!remoteEmptySessionsSettling) {
      if (emptySessionsGrace.scopeKey !== agentSessionScopeKey) {
        setEmptySessionsGrace({ scopeKey: agentSessionScopeKey, expired: false })
      }
      return
    }
    const scopeKey = agentSessionScopeKey
    setEmptySessionsGrace({ scopeKey, expired: false })
    const timeout = globalThis.setTimeout(() => {
      if (agentSessionScopeRef.current === scopeKey) {
        setEmptySessionsGrace({ scopeKey, expired: true })
      }
    }, 2000)
    return () => globalThis.clearTimeout(timeout)
  }, [agentSessionScopeKey, emptySessionsGrace.scopeKey, remoteEmptySessionsSettling])

  const sessionItems = sessionApi ? activeRemoteSessions.map((session) => ({
    ...session,
    title: session.title ?? "New session",
  })) : undefined
  const pendingStoredSessionPlaceholder = pendingStoredActiveSessionId
    ? [{
        id: pendingStoredActiveSessionId,
        title: "Loading sessions…",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        turnCount: 0,
      }]
    : []
  const resolvedSessions = sessionApi
    ? sessionItems ?? []
    : remoteSessionsPending
      ? pendingStoredSessionPlaceholder
      : hasExplicitSessionProps
        ? sessions ?? []
        : localSessions.sessions
  const appLeftSessions = useMemo(() => {
    if (!multiAgentConsoleEnabled) return resolvedSessions
    const collected = new Map<string, WorkspaceAgentSession>()
    for (const agent of addressedAgentSelectionState.agents) {
      const snapshot = remoteSessionSnapshots.get(`${workspaceId}\n${agent.agentTypeId}`)
      if (snapshot?.agentTypeId !== agent.agentTypeId) continue
      for (const session of snapshot?.sessions ?? []) {
        const owned = session.agentTypeId == null ? { ...session, agentTypeId: agent.agentTypeId } : session
        collected.set(workspaceSessionKeyFor(owned), owned)
      }
    }
    for (const session of resolvedSessions) collected.set(workspaceSessionKeyFor(session), session)
    return [...collected.values()]
  }, [addressedAgentSelectionState.agents, multiAgentConsoleEnabled, remoteSessionSnapshots, resolvedSessions, workspaceId])
  const appLeftAgents = useMemo(() => addressedAgentSelectionState.agents.map((agent) => {
    const snapshot = remoteSessionSnapshots.get(`${workspaceId}\n${agent.agentTypeId}`)
    const sessionsStatus = !snapshot || snapshot.loading || snapshot.agentTypeId !== agent.agentTypeId
      ? "loading" as const
      : snapshot.error
        ? "error" as const
        : "loaded" as const
    return { ...agent, sessionsStatus }
  }), [addressedAgentSelectionState.agents, remoteSessionSnapshots, workspaceId])
  const resolvedActiveId = sessionApi
    ? activeRemoteSessionId ?? null
    : remoteSessionsPending
      ? pendingStoredActiveSessionId ?? pendingRemoteActiveSessionId
      : hasExplicitSessionProps
        ? activeSessionId ?? null
        : localSessions.activeId
  const resolvedActiveAgentTypeId = sessionApi
    ? activeRemoteSessionAgentTypeId
    : remoteSessionsPending
      ? null
      : hasExplicitSessionProps
        ? activeSessionAgentTypeId ?? null
        : null

  const needsFreshRemoteSessionForAutoSubmit = autoSubmitInitialDraft
    && shouldUseRemoteSessions
    && !hasExplicitSessionProps
  const [autoSubmitSessionId, setAutoSubmitSessionId] = useState<string | null | undefined>(() => (
    needsFreshRemoteSessionForAutoSubmit ? null : undefined
  ))
  const autoSubmitSessionScopeRef = useRef(agentSessionScopeKey)
  const autoSubmitSessionCreateRef = useRef<string | null>(null)
  useEffect(() => {
    if (autoSubmitSessionScopeRef.current !== agentSessionScopeKey) {
      autoSubmitSessionScopeRef.current = agentSessionScopeKey
      autoSubmitSessionCreateRef.current = null
      setAutoSubmitSessionId(needsFreshRemoteSessionForAutoSubmit ? null : undefined)
      return
    }
    if (needsFreshRemoteSessionForAutoSubmit && autoSubmitSessionId === undefined) {
      autoSubmitSessionCreateRef.current = null
      setAutoSubmitSessionId(null)
    }
  }, [agentSessionScopeKey, autoSubmitSessionId, needsFreshRemoteSessionForAutoSubmit])
  useEffect(() => {
    if (!sessionApi || autoSubmitSessionId !== null) return
    if (autoSubmitSessionCreateRef.current === agentSessionScopeKey) return
    const scopeKey = agentSessionScopeKey
    autoSubmitSessionCreateRef.current = scopeKey
    void Promise.resolve(sessionApi.create({ title: defaultSessionTitle }))
      .then((session) => {
        if (agentSessionScopeRef.current !== scopeKey) return
        if (typeof (session as { id?: unknown } | null | undefined)?.id !== "string") {
          throw new Error("auto_submit_session_create_failed")
        }
        setAutoSubmitSessionId((session as { id: string }).id)
      })
      .catch(() => {
        if (agentSessionScopeRef.current !== scopeKey) return
        autoSubmitSessionCreateRef.current = null
        setAutoSubmitSessionId(undefined)
      })
  }, [agentSessionScopeKey, autoSubmitSessionId, defaultSessionTitle, sessionApi])
  const settleAutoSubmitInitialDraft = useCallback(() => {
    autoSubmitSessionCreateRef.current = null
    setAutoSubmitSessionId(undefined)
  }, [])
  const effectiveActiveSessionId = autoSubmitSessionId !== undefined
    ? autoSubmitSessionId ?? null
    : resolvedActiveId
  const effectiveActiveSessionAgentTypeId = autoSubmitSessionId !== undefined
    ? agentTypeId ?? null
    : resolvedActiveAgentTypeId
  const rawSwitch: (id: string, agentTypeId?: string) => unknown = remoteSessionsPending
    ? remoteSessionActionsUnavailable
    : sessionApi?.switch ?? onSwitchSession ?? localSessionStore.switchTo
  const resolvedSwitch = useCallback((nextSessionId: string, nextAgentTypeId?: string) => {
    if (effectiveActiveSessionId && nextSessionId !== effectiveActiveSessionId) {
      emitWorkspaceComposerStop({
        sessionId: effectiveActiveSessionId,
        reason: WORKSPACE_COMPOSER_STOP_REASONS.sessionSwitch,
      })
    }
    return nextAgentTypeId
      ? rawSwitch(nextSessionId, nextAgentTypeId)
      : rawSwitch(nextSessionId)
  }, [effectiveActiveSessionId, rawSwitch])
  const resolvedCreate = useCallback((targetAgentTypeId?: string) => {
    if (multiAgentConsoleEnabled && targetAgentTypeId) {
      return createAddressedSession(targetAgentTypeId)
    }
    if (remoteSessionsPending) return remoteSessionActionsUnavailable()
    if (sessionApi) return sessionApi.create()
    if (onCreateSession) return onCreateSession()
    return localSessionStore.create()
  }, [createAddressedSession, localSessionStore, multiAgentConsoleEnabled, onCreateSession, remoteSessionsPending, sessionApi])
  const resolvedRename = useCallback((id: string, title: string, sessionAgentTypeId?: string) => {
    if (multiAgentConsoleEnabled && sessionAgentTypeId) {
      return renameAddressedSession(workspaceSessionRef(id, sessionAgentTypeId), title)
    }
    return sessionApi?.rename?.(id, title)
  }, [multiAgentConsoleEnabled, renameAddressedSession, sessionApi])
  const markSessionReadOnly = useCallback((id: string, sessionAgentTypeId?: string, reason?: string) => {
    if (multiAgentConsoleEnabled && sessionAgentTypeId) {
      markAddressedSessionReadOnly(workspaceSessionRef(id, sessionAgentTypeId), reason)
      return
    }
    sessionApi?.markReadOnly?.(id, reason)
  }, [markAddressedSessionReadOnly, multiAgentConsoleEnabled, sessionApi])
  const rawDelete: (id: string, agentTypeId?: string) => unknown = remoteSessionsPending
    ? remoteSessionActionsUnavailable
    : sessionApi?.delete ?? onDeleteSession ?? localSessionStore.remove
  const autoCreateSessionRef = useRef<string | null>(null)
  const pendingLastSessionDeleteRef = useRef<Set<string>>(new Set())
  const resolvedDelete = useCallback((id: string, sessionAgentTypeId?: string) => {
    if (multiAgentConsoleEnabled && sessionAgentTypeId) {
      return deleteAddressedSession(workspaceSessionRef(id, sessionAgentTypeId))
    }
    if (sessionApi && remoteSessionsPending && activeRemoteSessions.length <= 1) {
      suppressEmptyAutoCreateRef.current = true
      return sessionAgentTypeId ? rawDelete(id, sessionAgentTypeId) : rawDelete(id)
    }
    if (sessionApi && !remoteSessionsPending && activeRemoteSessions.length <= 1) {
      if (sessionApi.hasMore) {
        suppressEmptyAutoCreateRef.current = true
        return sessionAgentTypeId ? rawDelete(id, sessionAgentTypeId) : rawDelete(id)
      }
      const sessionKey = workspaceSessionKey(id, sessionAgentTypeId)
      if (pendingLastSessionDeleteRef.current.has(sessionKey)) return Promise.resolve()
      pendingLastSessionDeleteRef.current.add(sessionKey)
      const scopeKey = agentSessionScopeKey
      autoCreateSessionRef.current = scopeKey
      setInitialRemoteSessionCreateFailed({ scopeKey, failed: false })
      const replacement = sessionApi.create({ title: defaultSessionTitle })
      return Promise.resolve(
        replacement && typeof (replacement as PromiseLike<unknown>).then === "function"
          ? Promise.resolve(replacement).then(() => {
              if (agentSessionScopeRef.current !== scopeKey) return undefined
              return sessionAgentTypeId ? rawDelete(id, sessionAgentTypeId) : rawDelete(id)
            })
          : agentSessionScopeRef.current === scopeKey
            ? sessionAgentTypeId ? rawDelete(id, sessionAgentTypeId) : rawDelete(id)
            : undefined,
      )
        .catch((error) => {
          if (agentSessionScopeRef.current !== scopeKey) return undefined
          autoCreateSessionRef.current = null
          setInitialRemoteSessionCreateFailed({ scopeKey, failed: true })
          throw error
        })
        .finally(() => {
          pendingLastSessionDeleteRef.current.delete(sessionKey)
        })
    }
    return sessionAgentTypeId ? rawDelete(id, sessionAgentTypeId) : rawDelete(id)
  }, [activeRemoteSessions.length, agentSessionScopeKey, defaultSessionTitle, deleteAddressedSession, multiAgentConsoleEnabled, rawDelete, remoteSessionsPending, sessionApi])

  useEffect(() => {
    autoCreateSessionRef.current = null
    pendingLastSessionDeleteRef.current.clear()
    suppressEmptyAutoCreateRef.current = false
    setInitialRemoteSessionCreating({ scopeKey: agentSessionScopeKey, creating: false })
    setInitialRemoteSessionCreateFailed({ scopeKey: agentSessionScopeKey, failed: false })
  }, [agentSessionScopeKey])

  useEffect(() => {
    if (!sessionApi || sessionApi.loading) return
    if (multiAgentConsoleEnabled) return
    if (remoteEmptySessionsSettling) return
    if (autoSubmitSessionId !== undefined) return
    if (activeRemoteSessions.length > 0) {
      if (autoCreateSessionRef.current === agentSessionScopeKey) autoCreateSessionRef.current = null
      suppressEmptyAutoCreateRef.current = false
      setInitialRemoteSessionCreating((current) => (
        current.scopeKey === agentSessionScopeKey && current.creating
          ? { scopeKey: agentSessionScopeKey, creating: false }
          : current
      ))
      setInitialRemoteSessionCreateFailed((current) => (
        current.scopeKey === agentSessionScopeKey && current.failed
          ? { scopeKey: agentSessionScopeKey, failed: false }
          : current
      ))
      return
    }
    if (suppressEmptyAutoCreateRef.current) return
    if (autoCreateSessionRef.current === agentSessionScopeKey) return
    const scopeKey = agentSessionScopeKey
    autoCreateSessionRef.current = scopeKey
    setInitialRemoteSessionCreating({ scopeKey, creating: true })
    setInitialRemoteSessionCreateFailed({ scopeKey, failed: false })
    void Promise.resolve(sessionApi.create({ title: defaultSessionTitle }))
      .catch(() => {
        if (agentSessionScopeRef.current !== scopeKey) return
        autoCreateSessionRef.current = null
        setInitialRemoteSessionCreating({ scopeKey, creating: false })
        setInitialRemoteSessionCreateFailed({ scopeKey, failed: true })
      })
  }, [activeRemoteSessions.length, agentSessionScopeKey, autoSubmitSessionId, defaultSessionTitle, multiAgentConsoleEnabled, remoteEmptySessionsSettling, sessionApi])

  useEffect(() => {
    if (remoteSessionsPending) return
    onActiveSessionIdChange?.(effectiveActiveSessionId ?? null)
  }, [effectiveActiveSessionId, onActiveSessionIdChange, remoteSessionsPending])

  const resolvedSessionTitle = resolvedSessions.find((session) => (
    workspaceSessionKeyFor(session) === workspaceSessionKey(
      effectiveActiveSessionId ?? "",
      effectiveActiveSessionAgentTypeId ?? agentTypeId,
    )
  ))?.title ?? undefined

  const panes = useWorkspaceAgentChatPanes({
    workspaceId,
    persistenceEnabled,
    provisionWorkspace,
    defaultSessionTitle,
    autoSubmitInitialDraft,
    onPaneFocus,
    settleAutoSubmitInitialDraft,
    selection: {
      addressedSelectionEnabled: addressedAgentSelectionEnabled,
      multiAgentConsoleEnabled,
      agentTypeId,
      agents: addressedAgentSelectionState.agents,
      agentsLoading: addressedAgentSelectionState.loading,
      agentsError: addressedAgentSelectionState.error,
      selectedAgentIsEmpty: selectedAddressedAgentIsEmpty,
    },
    sessions: {
      shouldUseRemoteSessions,
      useSessionsProvided,
      remoteSnapshotWorkspaceId: remoteSessionSnapshot?.workspaceId,
      remoteSessionsAvailable,
      remoteSessionsPending,
      remoteSessionsTransitioning,
      activeRemoteSessions,
      resolvedSessions,
      appLeftSessions,
      effectiveActiveSessionId,
      effectiveActiveSessionAgentTypeId,
      autoSubmitSessionPending: autoSubmitSessionId !== undefined,
      sessionApi,
    },
    actions: {
      activateAddressedSession,
      rawSwitch,
      resolvedSwitch,
      resolvedCreate,
      resolvedDelete,
    },
  })
  return {
    selection: {
      addressedAgentSelectionEnabled,
      multiAgentConsoleEnabled,
      addressedAgentSelectionState,
      agentTypeId,
      handleAgentTypeIdChange,
      controlledAgentSelection,
    },
    addressedHost: {
      remoteSessionHookEnabled,
      publishAddressedSessionController,
      removeAddressedSessionController,
    },
    sessions: {
      shouldUseRemoteSessions,
      remoteSessionApi,
      refreshAddressedSession,
      remoteSessionsPending,
      sessionApi,
      hasExplicitSessionProps,
      remoteSessionsTransitioning,
      selectedAddressedAgentIsEmpty,
      appLeftSessions,
      appLeftAgents,
      effectiveActiveSessionId,
      effectiveActiveSessionAgentTypeId,
      resolvedSessions,
      resolvedSessionTitle,
      rawSwitch,
      resolvedCreate,
      resolvedRename,
      markSessionReadOnly,
      adoptAddressedSession,
    },
    panes,
  }
}
