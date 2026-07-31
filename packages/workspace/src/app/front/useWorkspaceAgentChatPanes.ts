import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  persistedWorkspaceSessionRef,
  workspaceSessionKey,
  workspaceSessionKeyFor,
  workspaceSessionRef,
  workspaceSessionRefFromKey,
  workspaceSessionRefFromPersisted,
  type WorkspaceSessionRef,
} from "../../front/sessionIdentity"
import type { ChatPanePendingPlacement, ChatPaneSplitDirection } from "../../front/layout"
import { surfaceSessionActionError } from "../../front/sessionActionErrors"
import {
  createdSessionId,
  insertPaneAfter,
  replaceActivePane,
  type ChatPaneState,
} from "./chatPaneState"
import type {
  WorkspaceAddressedAgentOption,
  WorkspaceAgentSession,
  WorkspaceAgentSessionsApi,
} from "./WorkspaceAgentFront"

interface PendingCreatePane {
  afterId: string
  knownIds: Set<string>
  placementDirection?: ChatPaneSplitDirection
  createdId?: string
}

export interface CreateChatPaneOptions {
  targetAgentTypeId?: string
  placementDirection?: ChatPaneSplitDirection
}

interface WorkspaceAgentChatPaneSelection {
  addressedSelectionEnabled: boolean
  multiAgentConsoleEnabled: boolean
  agentTypeId?: string
  agents: readonly WorkspaceAddressedAgentOption[]
  agentsLoading: boolean
  agentsError?: Error
  selectedAgentIsEmpty: boolean
}

interface WorkspaceAgentChatPaneSessions<
  TSession extends WorkspaceAgentSession,
> {
  shouldUseRemoteSessions: boolean
  useSessionsProvided: boolean
  remoteSnapshotWorkspaceId?: string
  remoteSessionsAvailable: boolean
  remoteSessionsPending: boolean
  remoteSessionsTransitioning: boolean
  activeRemoteSessions: TSession[]
  resolvedSessions: WorkspaceAgentSession[]
  appLeftSessions: WorkspaceAgentSession[]
  effectiveActiveSessionId: string | null
  effectiveActiveSessionAgentTypeId: string | null | undefined
  autoSubmitSessionPending: boolean
  sessionApi?: WorkspaceAgentSessionsApi<TSession>
}

interface WorkspaceAgentChatPaneActions {
  activateAddressedSession: (session: WorkspaceSessionRef) => boolean
  rawSwitch: (id: string, agentTypeId?: string) => unknown
  resolvedSwitch: (id: string, agentTypeId?: string) => unknown
  resolvedCreate: (agentTypeId?: string) => unknown
  resolvedDelete: (id: string, agentTypeId?: string) => unknown
}

interface UseWorkspaceAgentChatPanesOptions<
  TSession extends WorkspaceAgentSession,
> {
  workspaceId: string
  persistenceEnabled: boolean
  provisionWorkspace?: boolean
  defaultSessionTitle: string
  autoSubmitInitialDraft: boolean
  onPaneFocus: () => void
  settleAutoSubmitInitialDraft: () => void
  selection: WorkspaceAgentChatPaneSelection
  sessions: WorkspaceAgentChatPaneSessions<TSession>
  actions: WorkspaceAgentChatPaneActions
}

const EMPTY_IDS: string[] = []

function focusActiveAgentComposer(): void {
  if (typeof document === "undefined") return
  const activePane = document.querySelector<HTMLElement>('[data-boring-workspace-part="chat-pane"][data-boring-state="active"]')
  const root: Document | HTMLElement = activePane ?? document
  const textarea = root.querySelector<HTMLTextAreaElement>('[data-boring-agent] textarea[name="message"], textarea[name="message"]')
  textarea?.focus()
}

function scheduleActiveAgentComposerFocus(): void {
  if (typeof window === "undefined") return
  window.requestAnimationFrame(() => {
    focusActiveAgentComposer()
    window.setTimeout(focusActiveAgentComposer, 320)
  })
}

function persistedRefsFromKeys(keys: readonly string[]) {
  return keys.map((key) => persistedWorkspaceSessionRef(workspaceSessionRefFromKey(key)))
}

function retainOtherCatalogAgentPanes(
  ids: readonly string[],
  selectedAgentTypeId: string | undefined,
  catalogAgentTypeIds: ReadonlySet<string>,
): string[] {
  return ids.filter((id) => {
    const owner = workspaceSessionRefFromKey(id).agentTypeId
    return Boolean(owner && owner !== selectedAgentTypeId && catalogAgentTypeIds.has(owner))
  })
}

function readStoredChatPaneState(storageKey: string, workspaceId: string): ChatPaneState | null {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: unknown; refs?: unknown; activeRef?: unknown; ids?: unknown; activeId?: unknown }
    const refs = parsed.version === 2 && Array.isArray(parsed.refs)
      ? parsed.refs.map(workspaceSessionRefFromPersisted).filter((ref): ref is WorkspaceSessionRef => Boolean(ref))
      : Array.isArray(parsed.ids)
        ? parsed.ids
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .map((sessionId) => workspaceSessionRef(sessionId))
        : []
    const ids = refs.map((ref) => workspaceSessionKey(ref.sessionId, ref.agentTypeId))
    if (ids.length === 0) return null
    const activeRef = parsed.version === 2
      ? workspaceSessionRefFromPersisted(parsed.activeRef)
      : typeof parsed.activeId === "string" ? { sessionId: parsed.activeId } : null
    const activeKey = activeRef ? workspaceSessionKey(activeRef.sessionId, activeRef.agentTypeId) : null
    return { workspaceId, ids, activeId: activeKey && ids.includes(activeKey) ? activeKey : ids[0] }
  } catch {
    return null
  }
}

function writeStoredChatPaneState(storageKey: string, state: ChatPaneState): void {
  try {
    if (state.ids.length === 0) {
      globalThis.localStorage?.removeItem(storageKey)
      return
    }
    globalThis.localStorage?.setItem(storageKey, JSON.stringify({
      version: 2,
      refs: persistedRefsFromKeys(state.ids),
      activeRef: state.activeId ? persistedWorkspaceSessionRef(workspaceSessionRefFromKey(state.activeId)) : null,
    }))
  } catch {
    // Best-effort persistence only.
  }
}

function readStoredPinnedSessions(storageKey: string, workspaceId: string): { workspaceId: string; ids: string[] } | null {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: unknown; refs?: unknown; ids?: unknown }
    const refs = parsed.version === 2 && Array.isArray(parsed.refs)
      ? parsed.refs.map(workspaceSessionRefFromPersisted).filter((ref): ref is WorkspaceSessionRef => Boolean(ref))
      : Array.isArray(parsed.ids)
        ? parsed.ids
          .filter((id): id is string => typeof id === "string" && id.length > 0)
          .map((sessionId) => workspaceSessionRef(sessionId))
        : []
    return { workspaceId, ids: refs.map((ref) => workspaceSessionKey(ref.sessionId, ref.agentTypeId)) }
  } catch {
    return null
  }
}

function writeStoredPinnedSessions(storageKey: string, ids: string[]): void {
  try {
    if (ids.length === 0) {
      globalThis.localStorage?.removeItem(storageKey)
      return
    }
    globalThis.localStorage?.setItem(storageKey, JSON.stringify({
      version: 2,
      refs: persistedRefsFromKeys(ids),
    }))
  } catch {
    // Best-effort persistence only.
  }
}

export function useWorkspaceAgentChatPanes<
  TSession extends WorkspaceAgentSession,
>({
  workspaceId,
  persistenceEnabled,
  provisionWorkspace,
  defaultSessionTitle,
  autoSubmitInitialDraft,
  onPaneFocus,
  settleAutoSubmitInitialDraft,
  selection,
  sessions,
  actions,
}: UseWorkspaceAgentChatPanesOptions<TSession>) {
  const {
    addressedSelectionEnabled,
    multiAgentConsoleEnabled,
    agentTypeId,
    agents,
    agentsLoading,
    agentsError,
    selectedAgentIsEmpty,
  } = selection
  const {
    shouldUseRemoteSessions,
    useSessionsProvided,
    remoteSnapshotWorkspaceId,
    remoteSessionsAvailable,
    remoteSessionsPending,
    remoteSessionsTransitioning,
    activeRemoteSessions,
    resolvedSessions,
    appLeftSessions,
    effectiveActiveSessionId,
    effectiveActiveSessionAgentTypeId,
    autoSubmitSessionPending,
    sessionApi,
  } = sessions
  const {
    activateAddressedSession,
    rawSwitch,
    resolvedSwitch,
    resolvedCreate,
    resolvedDelete,
  } = actions

  const chatPaneStorageKey = `boring-workspace:chat-panes:${workspaceId}`
  const [chatPaneState, setChatPaneState] = useState<ChatPaneState>(() =>
    (persistenceEnabled ? readStoredChatPaneState(chatPaneStorageKey, workspaceId) : null)
      ?? { workspaceId, ids: [], activeId: null },
  )
  const chatPaneStateRef = useRef(chatPaneState)
  chatPaneStateRef.current = chatPaneState
  const [pendingChatPanePlacement, setPendingChatPanePlacement] = useState<ChatPanePendingPlacement | null>(null)
  const [chatPaneSplitPending, setChatPaneSplitPending] = useState(false)
  const consumePendingChatPanePlacement = useCallback((paneId: string) => {
    setPendingChatPanePlacement((current) => current?.paneId === paneId ? null : current)
  }, [])
  const [flashChatPane, setFlashChatPane] = useState<{ workspaceId: string; id: string } | null>(null)
  useEffect(() => {
    if (!flashChatPane) return
    const timer = setTimeout(() => setFlashChatPane(null), 700)
    return () => clearTimeout(timer)
  }, [flashChatPane])
  useEffect(() => {
    if (!persistenceEnabled || chatPaneState.workspaceId !== workspaceId) return
    writeStoredChatPaneState(chatPaneStorageKey, chatPaneState)
  }, [chatPaneState, chatPaneStorageKey, persistenceEnabled, workspaceId])
  useEffect(() => {
    setChatPaneState((previous) => {
      if (previous.workspaceId === workspaceId) return previous
      return (persistenceEnabled ? readStoredChatPaneState(chatPaneStorageKey, workspaceId) : null)
        ?? { workspaceId, ids: [], activeId: null }
    })
  }, [chatPaneStorageKey, persistenceEnabled, workspaceId])

  const pinnedStorageKey = `boring-workspace:pinned-sessions:${workspaceId}`
  const [pinnedState, setPinnedState] = useState<{ workspaceId: string; ids: string[] }>(() =>
    (persistenceEnabled ? readStoredPinnedSessions(pinnedStorageKey, workspaceId) : null)
      ?? { workspaceId, ids: [] },
  )
  const pinnedIds = pinnedState.workspaceId === workspaceId ? pinnedState.ids : EMPTY_IDS
  useEffect(() => {
    setPinnedState((previous) => {
      if (previous.workspaceId === workspaceId) return previous
      return (persistenceEnabled ? readStoredPinnedSessions(pinnedStorageKey, workspaceId) : null)
        ?? { workspaceId, ids: [] }
    })
  }, [persistenceEnabled, pinnedStorageKey, workspaceId])
  const toggleSessionPinned = useCallback((sessionId: string, sessionAgentTypeId?: string) => {
    const sessionKey = workspaceSessionKey(sessionId, sessionAgentTypeId)
    setPinnedState((previous) => {
      const current = previous.workspaceId === workspaceId ? previous.ids : []
      const ids = current.includes(sessionKey)
        ? current.filter((id) => id !== sessionKey)
        : [sessionKey, ...current]
      if (persistenceEnabled) writeStoredPinnedSessions(pinnedStorageKey, ids)
      return { workspaceId, ids }
    })
  }, [persistenceEnabled, pinnedStorageKey, workspaceId])

  const chatSessionId = shouldUseRemoteSessions
    && !useSessionsProvided
    && remoteSnapshotWorkspaceId != null
    && remoteSnapshotWorkspaceId !== workspaceId
    ? "default"
    : effectiveActiveSessionId ?? (autoSubmitSessionPending ? "default" : resolvedSessions[0]?.id ?? "default")
  const requestedChatSessionAgentTypeId = effectiveActiveSessionAgentTypeId ?? agentTypeId
  const chatSessionOwner = resolvedSessions.find((session) => (
    session.id === chatSessionId
    && (requestedChatSessionAgentTypeId === undefined || session.agentTypeId === requestedChatSessionAgentTypeId)
  ))
  const chatSessionAgentTypeId = chatSessionOwner?.agentTypeId ?? requestedChatSessionAgentTypeId
  const chatSessionKey = workspaceSessionKey(chatSessionId, chatSessionAgentTypeId)
  const addressedAgentCatalogKey = multiAgentConsoleEnabled
    ? agents.map((agent) => agent.agentTypeId).join("\0")
    : ""
  const addressedAgentTypeIds = useMemo(
    () => new Set(addressedAgentCatalogKey ? addressedAgentCatalogKey.split("\0") : []),
    [addressedAgentCatalogKey],
  )
  const addressedAgentCatalogAuthoritative = multiAgentConsoleEnabled && !agentsLoading && !agentsError
  const addressedAgentCatalogPolicyRef = useRef({
    authoritative: addressedAgentCatalogAuthoritative,
    agentTypeIds: addressedAgentTypeIds,
  })
  addressedAgentCatalogPolicyRef.current = {
    authoritative: addressedAgentCatalogAuthoritative,
    agentTypeIds: addressedAgentTypeIds,
  }
  const canMountCreatedAgentPane = useCallback((createdAgentTypeId: string | undefined) => {
    if (!multiAgentConsoleEnabled || !createdAgentTypeId) return true
    const policy = addressedAgentCatalogPolicyRef.current
    return !policy.authoritative || policy.agentTypeIds.has(createdAgentTypeId)
  }, [multiAgentConsoleEnabled])
  useEffect(() => {
    if (!addressedAgentCatalogAuthoritative) return
    setChatPaneState((previous) => {
      if (previous.workspaceId !== workspaceId) return previous
      const nextIds = previous.ids.filter((id) => {
        const owner = workspaceSessionRefFromKey(id).agentTypeId
        return !owner || addressedAgentTypeIds.has(owner)
      })
      if (nextIds.length === previous.ids.length) return previous
      return {
        workspaceId,
        ids: nextIds,
        activeId: previous.activeId && nextIds.includes(previous.activeId)
          ? previous.activeId
          : nextIds[0] ?? null,
      }
    })
  }, [addressedAgentCatalogAuthoritative, addressedAgentTypeIds, workspaceId])

  const pendingCreatePaneRef = useRef<PendingCreatePane | null>(null)
  const optimisticCreatedPaneKeysRef = useRef<Set<string>>(new Set())
  const sessionListAuthoritative = !sessionApi?.hasMore && !remoteSessionsPending
  useEffect(() => {
    if (remoteSessionsTransitioning) return
    const pendingCreatePane = pendingCreatePaneRef.current
    const sessionKeys = new Set(resolvedSessions.map(workspaceSessionKeyFor))
    for (const key of optimisticCreatedPaneKeysRef.current) {
      if (sessionKeys.has(key)) optimisticCreatedPaneKeysRef.current.delete(key)
    }
    const newlyObservedSession = pendingCreatePane
      ? resolvedSessions.find((session) => !pendingCreatePane.knownIds.has(workspaceSessionKeyFor(session)))
      : undefined
    const pendingCreatedId = pendingCreatePane
      ? pendingCreatePane.createdId
        ?? (sessionKeys.has(chatSessionKey) && !pendingCreatePane.knownIds.has(chatSessionKey)
          ? chatSessionKey
          : newlyObservedSession ? workspaceSessionKeyFor(newlyObservedSession) : null)
      : null
    if (pendingCreatedId && sessionKeys.has(pendingCreatedId)) {
      if (pendingCreatePane?.placementDirection) {
        setPendingChatPanePlacement({
          paneId: pendingCreatedId,
          referencePaneId: pendingCreatePane.afterId,
          direction: pendingCreatePane.placementDirection,
        })
      }
      setChatPaneSplitPending(false)
      pendingCreatePaneRef.current = null
    }
    const preservingEphemeralDefault = chatSessionId === "default" && autoSubmitSessionPending
    const canPruneMissingSessions = sessionListAuthoritative
      && (sessionKeys.size > 0 || multiAgentConsoleEnabled)
      && !preservingEphemeralDefault
    const desiredSessionId = pendingCreatedId
      ?? (canPruneMissingSessions && !sessionKeys.has(chatSessionKey)
        ? resolvedSessions[0] ? workspaceSessionKeyFor(resolvedSessions[0]) : chatSessionKey
        : chatSessionKey)
    setChatPaneState((previous) => {
      const current = previous.workspaceId === workspaceId
        ? previous
        : { workspaceId, ids: [], activeId: null }
      if (remoteSessionsPending && current.ids.length > 0 && !pendingCreatedId) return current
      if (selectedAgentIsEmpty && !pendingCreatedId) {
        const nextIds = retainOtherCatalogAgentPanes(current.ids, agentTypeId, addressedAgentTypeIds)
        const nextActiveId = current.activeId && nextIds.includes(current.activeId)
          ? current.activeId
          : nextIds[0] ?? null
        if (
          previous.workspaceId === workspaceId
          && previous.activeId === nextActiveId
          && previous.ids.length === nextIds.length
          && previous.ids.every((id, index) => id === nextIds[index])
        ) return previous
        return { workspaceId, ids: nextIds, activeId: nextActiveId }
      }
      const currentActiveRef = current.activeId ? workspaceSessionRefFromKey(current.activeId) : undefined
      const activeOwnerIsExplicit = Boolean(effectiveActiveSessionAgentTypeId ?? agentTypeId)
      const currentMatchesControlledSession = activeOwnerIsExplicit
        ? current.activeId === chatSessionKey
        : currentActiveRef?.sessionId === chatSessionId
      const resolvedDesiredSessionId = !pendingCreatedId
        && current.activeId
        && (!canPruneMissingSessions || sessionKeys.has(current.activeId))
        && currentMatchesControlledSession
        ? current.activeId
        : desiredSessionId
      const rawIds = current.ids.length > 0 ? current.ids : [resolvedDesiredSessionId]
      const prunedIds = canPruneMissingSessions
        ? rawIds.filter((id) => {
            if (
              sessionKeys.has(id)
              || optimisticCreatedPaneKeysRef.current.has(id)
              || id === pendingCreatedId
            ) return true
            if (!multiAgentConsoleEnabled || !agentTypeId) return false
            const owner = workspaceSessionRefFromKey(id).agentTypeId
            return Boolean(owner && owner !== agentTypeId && addressedAgentTypeIds.has(owner))
          })
        : rawIds
      const ids = prunedIds.length > 0 ? prunedIds : [resolvedDesiredSessionId]
      const activeId = current.activeId && ids.includes(current.activeId)
        ? current.activeId
        : ids[0] ?? resolvedDesiredSessionId
      const nextIds = pendingCreatedId
        ? insertPaneAfter(ids, pendingCreatePane?.afterId, pendingCreatedId)
        : resolvedDesiredSessionId === activeId || ids.includes(resolvedDesiredSessionId)
          ? ids
          : multiAgentConsoleEnabled
            && workspaceSessionRefFromKey(activeId).agentTypeId !== workspaceSessionRefFromKey(resolvedDesiredSessionId).agentTypeId
            ? insertPaneAfter(ids, activeId, resolvedDesiredSessionId)
            : replaceActivePane(ids, activeId, resolvedDesiredSessionId)
      const nextActiveId = nextIds.includes(resolvedDesiredSessionId)
        ? resolvedDesiredSessionId
        : nextIds[0] ?? resolvedDesiredSessionId
      if (
        previous.workspaceId === workspaceId
        && previous.activeId === nextActiveId
        && previous.ids.length === nextIds.length
        && previous.ids.every((id, index) => id === nextIds[index])
      ) return previous
      return { workspaceId, ids: nextIds, activeId: nextActiveId }
    })
  }, [addressedAgentTypeIds, agentTypeId, autoSubmitSessionPending, chatSessionId, chatSessionKey, effectiveActiveSessionAgentTypeId, multiAgentConsoleEnabled, remoteSessionsPending, remoteSessionsTransitioning, resolvedSessions, selectedAgentIsEmpty, sessionListAuthoritative, workspaceId])

  const sessionTitleById = useMemo(() => {
    const titles = new Map<string, string | null | undefined>()
    for (const session of appLeftSessions) titles.set(workspaceSessionKeyFor(session), session.title)
    return titles
  }, [appLeftSessions])
  const [initialHydrationPromptStarted, setInitialHydrationPromptStarted] = useState<{ workspaceId: string; ids: Set<string> }>(() => ({
    workspaceId,
    ids: new Set(),
  }))
  const emptySessionIds = useMemo(() => {
    const ids = new Set<string>()
    if (!remoteSessionsAvailable) return ids
    const startedIds = initialHydrationPromptStarted.workspaceId === workspaceId
      ? initialHydrationPromptStarted.ids
      : new Set<string>()
    for (const session of activeRemoteSessions) {
      const key = workspaceSessionKeyFor(session)
      if (session.turnCount === 0 && !startedIds.has(key)) ids.add(key)
    }
    return ids
  }, [activeRemoteSessions, initialHydrationPromptStarted, remoteSessionsAvailable, workspaceId])
  useEffect(() => {
    setInitialHydrationPromptStarted((current) => (
      current.workspaceId === workspaceId ? current : { workspaceId, ids: new Set() }
    ))
  }, [workspaceId])
  const markInitialHydrationPromptStarted = useCallback((
    submittedSessionId: string,
    submittedAgentTypeId?: string,
  ) => {
    setInitialHydrationPromptStarted((current) => {
      const currentIds = current.workspaceId === workspaceId ? current.ids : new Set<string>()
      const submittedKey = workspaceSessionKey(submittedSessionId, submittedAgentTypeId)
      if (currentIds.has(submittedKey)) {
        return current.workspaceId === workspaceId ? current : { workspaceId, ids: currentIds }
      }
      const ids = new Set(currentIds)
      ids.add(submittedKey)
      return { workspaceId, ids }
    })
  }, [workspaceId])

  const activeChatPaneState = chatPaneState.workspaceId === workspaceId
    ? chatPaneState
    : { workspaceId, ids: [], activeId: null }
  const retainedChatPaneIds = selectedAgentIsEmpty
    ? retainOtherCatalogAgentPanes(activeChatPaneState.ids, agentTypeId, addressedAgentTypeIds)
    : activeChatPaneState.ids
  const awaitingInitialAddressedSessions = multiAgentConsoleEnabled
    && remoteSessionsPending
    && !effectiveActiveSessionId
    && retainedChatPaneIds.length === 0
  const fallbackChatPaneIds = selectedAgentIsEmpty || awaitingInitialAddressedSessions
    ? []
    : [chatSessionKey]
  const storedChatPaneIds = retainedChatPaneIds.length > 0
    ? retainedChatPaneIds
    : fallbackChatPaneIds
  const selectedAgentChatPaneIds = addressedSelectionEnabled && !multiAgentConsoleEnabled && agentTypeId
    ? storedChatPaneIds.filter((id) => workspaceSessionRefFromKey(id).agentTypeId === agentTypeId)
    : storedChatPaneIds
  const chatPaneIds = selectedAgentChatPaneIds.length > 0
    ? selectedAgentChatPaneIds
    : fallbackChatPaneIds
  const selectedAgentActivePaneId = multiAgentConsoleEnabled && agentTypeId
    ? chatPaneIds.find((id) => {
        const ref = workspaceSessionRefFromKey(id)
        return ref.agentTypeId === agentTypeId && ref.sessionId === effectiveActiveSessionId
      }) ?? chatPaneIds.find((id) => workspaceSessionRefFromKey(id).agentTypeId === agentTypeId)
    : undefined
  const activeChatPaneId = selectedAgentActivePaneId
    ?? (activeChatPaneState.activeId && chatPaneIds.includes(activeChatPaneState.activeId)
      ? activeChatPaneState.activeId
      : chatPaneIds[0] ?? chatSessionKey)
  const displayedActiveChatPaneId = selectedAgentIsEmpty || awaitingInitialAddressedSessions
    ? null
    : activeChatPaneId
  const sessionAgentLabelById = useMemo(() => {
    const labels = new Map<string, string>()
    if (!multiAgentConsoleEnabled || agents.length <= 1) return labels
    const labelByAgentTypeId = new Map(agents.map((agent) => [agent.agentTypeId, agent.label]))
    for (const id of chatPaneIds) {
      const owner = workspaceSessionRefFromKey(id).agentTypeId
      const label = owner ? labelByAgentTypeId.get(owner) : undefined
      if (label) labels.set(id, label)
    }
    return labels
  }, [agents, chatPaneIds, multiAgentConsoleEnabled])

  const switchToChatPane = useCallback((nextSessionId: string, nextAgentTypeId?: string) => {
    onPaneFocus()
    const nextSessionKey = workspaceSessionKey(nextSessionId, nextAgentTypeId)
    const current = chatPaneState.workspaceId === workspaceId
      ? chatPaneState
      : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
    const alreadyVisible = current.ids.includes(nextSessionKey)
    setChatPaneState((previous) => {
      const paneState = previous.workspaceId === workspaceId
        ? previous
        : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
      const ids = paneState.ids.includes(nextSessionKey)
        ? paneState.ids
        : replaceActivePane(paneState.ids, paneState.activeId, nextSessionKey)
      return { workspaceId, ids, activeId: nextSessionKey }
    })
    if (multiAgentConsoleEnabled && nextAgentTypeId) {
      const nextRef = workspaceSessionRef(nextSessionId, nextAgentTypeId)
      if (nextAgentTypeId !== agentTypeId || alreadyVisible) {
        activateAddressedSession(nextRef)
        return
      }
    }
    return alreadyVisible
      ? nextAgentTypeId ? rawSwitch(nextSessionId, nextAgentTypeId) : rawSwitch(nextSessionId)
      : nextAgentTypeId ? resolvedSwitch(nextSessionId, nextAgentTypeId) : resolvedSwitch(nextSessionId)
  }, [activateAddressedSession, agentTypeId, chatPaneState, chatSessionKey, multiAgentConsoleEnabled, onPaneFocus, rawSwitch, resolvedSwitch, workspaceId])

  const activateChatPane = useCallback((nextSessionKey: string) => {
    onPaneFocus()
    setChatPaneState((previous) => {
      const current = previous.workspaceId === workspaceId
        ? previous
        : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
      return {
        workspaceId,
        ids: current.ids.includes(nextSessionKey)
          ? current.ids
          : insertPaneAfter(current.ids, current.activeId, nextSessionKey),
        activeId: nextSessionKey,
      }
    })
    const ref = workspaceSessionRefFromKey(nextSessionKey)
    if (multiAgentConsoleEnabled && ref.agentTypeId) {
      activateAddressedSession(ref)
      return
    }
    return ref.agentTypeId ? rawSwitch(ref.sessionId, ref.agentTypeId) : rawSwitch(ref.sessionId)
  }, [activateAddressedSession, chatSessionKey, multiAgentConsoleEnabled, onPaneFocus, rawSwitch, workspaceId])

  const openChatPane = useCallback((nextSessionId: string, nextAgentTypeId?: string) => {
    onPaneFocus()
    const nextSessionKey = workspaceSessionKey(nextSessionId, nextAgentTypeId)
    const current = chatPaneState.workspaceId === workspaceId
      ? chatPaneState
      : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
    if (current.ids.includes(nextSessionKey)) {
      setFlashChatPane({ workspaceId, id: nextSessionKey })
    }
    setChatPaneState((previous) => {
      const paneState = previous.workspaceId === workspaceId
        ? previous
        : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
      return {
        workspaceId,
        ids: insertPaneAfter(paneState.ids, paneState.activeId, nextSessionKey),
        activeId: nextSessionKey,
      }
    })
    if (multiAgentConsoleEnabled && nextAgentTypeId) {
      activateAddressedSession(workspaceSessionRef(nextSessionId, nextAgentTypeId))
      return
    }
    return nextAgentTypeId ? rawSwitch(nextSessionId, nextAgentTypeId) : rawSwitch(nextSessionId)
  }, [activateAddressedSession, chatPaneState, chatSessionKey, multiAgentConsoleEnabled, onPaneFocus, rawSwitch, workspaceId])

  const closeChatPane = useCallback((sessionKey: string) => {
    const current = chatPaneState.workspaceId === workspaceId
      ? chatPaneState
      : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
    if (current.ids.length <= 1) return
    const closingIndex = current.ids.indexOf(sessionKey)
    if (closingIndex < 0) return
    const nextIds = current.ids.filter((id) => id !== sessionKey)
    const nextActiveId = current.activeId === sessionKey
      ? nextIds[Math.max(0, closingIndex - 1)] ?? nextIds[0] ?? null
      : current.activeId
    setChatPaneState({ workspaceId, ids: nextIds, activeId: nextActiveId })
    if (nextActiveId && current.activeId === sessionKey) {
      const next = workspaceSessionRefFromKey(nextActiveId)
      if (multiAgentConsoleEnabled && next.agentTypeId) activateAddressedSession(next)
      else if (next.agentTypeId) rawSwitch(next.sessionId, next.agentTypeId)
      else rawSwitch(next.sessionId)
    }
  }, [activateAddressedSession, chatPaneState, chatSessionKey, multiAgentConsoleEnabled, rawSwitch, workspaceId])

  const createChatSession = useCallback((targetAgentTypeId?: string) => {
    if (pendingCreatePaneRef.current) return
    const pendingCreatePane = {
      afterId: activeChatPaneId,
      knownIds: new Set(resolvedSessions.map(workspaceSessionKeyFor)),
    }
    pendingCreatePaneRef.current = pendingCreatePane
    let created: unknown
    try {
      created = resolvedCreate(targetAgentTypeId)
    } catch (error) {
      if (pendingCreatePaneRef.current === pendingCreatePane) pendingCreatePaneRef.current = null
      surfaceSessionActionError("create chat", error)
      return
    }
    void Promise.resolve(created).then((session) => {
      const id = createdSessionId(session)
      if (!id) return
      const createdAgentTypeId = typeof (session as { agentTypeId?: unknown } | null)?.agentTypeId === "string"
        ? (session as { agentTypeId: string }).agentTypeId
        : targetAgentTypeId ?? agentTypeId
      const createdKey = workspaceSessionKey(id, createdAgentTypeId)
      if (!canMountCreatedAgentPane(createdAgentTypeId)) {
        if (pendingCreatePaneRef.current === pendingCreatePane) pendingCreatePaneRef.current = null
        return
      }
      optimisticCreatedPaneKeysRef.current.add(createdKey)
      if (pendingCreatePaneRef.current === pendingCreatePane) pendingCreatePaneRef.current = null
      setChatPaneState((previous) => {
        const current = previous.workspaceId === workspaceId
          ? previous
          : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
        const retainedIds = selectedAgentIsEmpty
          ? retainOtherCatalogAgentPanes(current.ids, agentTypeId, addressedAgentTypeIds)
          : current.ids
        const ids = retainedIds.length > 0 ? retainedIds : selectedAgentIsEmpty ? [] : [chatSessionKey]
        const activeId = current.activeId && ids.includes(current.activeId)
          ? current.activeId
          : ids[0] ?? chatSessionKey
        const nextIds = replaceActivePane(ids, activeId, createdKey)
        return { workspaceId, ids: nextIds, activeId: createdKey }
      })
      if (multiAgentConsoleEnabled && createdAgentTypeId) {
        activateAddressedSession(workspaceSessionRef(id, createdAgentTypeId))
      } else if (!sessionApi) {
        if (createdAgentTypeId) rawSwitch(id, createdAgentTypeId)
        else rawSwitch(id)
      }
      scheduleActiveAgentComposerFocus()
    }).catch((error) => {
      if (pendingCreatePaneRef.current === pendingCreatePane) pendingCreatePaneRef.current = null
      surfaceSessionActionError("create chat", error)
    })
    return created
  }, [activateAddressedSession, activeChatPaneId, addressedAgentTypeIds, agentTypeId, canMountCreatedAgentPane, chatSessionKey, multiAgentConsoleEnabled, rawSwitch, resolvedCreate, resolvedSessions, selectedAgentIsEmpty, sessionApi, workspaceId])

  const createChatPaneAfter = useCallback((
    afterId: string,
    options: CreateChatPaneOptions = {},
  ) => {
    if (pendingCreatePaneRef.current) return
    const { targetAgentTypeId, placementDirection } = options
    setChatPaneSplitPending(true)
    const pendingCreatePane = {
      afterId,
      placementDirection,
      knownIds: new Set(resolvedSessions.map(workspaceSessionKeyFor)),
    }
    pendingCreatePaneRef.current = pendingCreatePane
    let created: unknown
    try {
      created = resolvedCreate(targetAgentTypeId)
    } catch (error) {
      if (pendingCreatePaneRef.current === pendingCreatePane) pendingCreatePaneRef.current = null
      setChatPaneSplitPending(false)
      surfaceSessionActionError("create chat", error)
      return
    }
    void Promise.resolve(created).then((session) => {
      const id = createdSessionId(session)
      if (!id) return
      const createdAgentTypeId = typeof (session as { agentTypeId?: unknown } | null)?.agentTypeId === "string"
        ? (session as { agentTypeId: string }).agentTypeId
        : targetAgentTypeId ?? agentTypeId
      const createdKey = workspaceSessionKey(id, createdAgentTypeId)
      if (!canMountCreatedAgentPane(createdAgentTypeId)) {
        if (pendingCreatePaneRef.current === pendingCreatePane) {
          pendingCreatePaneRef.current = null
          setChatPaneSplitPending(false)
        }
        return
      }
      optimisticCreatedPaneKeysRef.current.add(createdKey)
      if (pendingCreatePaneRef.current === pendingCreatePane) {
        pendingCreatePaneRef.current = null
        if (placementDirection) {
          setPendingChatPanePlacement({
            paneId: createdKey,
            referencePaneId: afterId,
            direction: placementDirection,
          })
        }
        setChatPaneSplitPending(false)
      }
      setChatPaneState((previous) => {
        const current = previous.workspaceId === workspaceId
          ? previous
          : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
        return {
          workspaceId,
          ids: insertPaneAfter(current.ids, afterId, createdKey),
          activeId: createdKey,
        }
      })
      if (multiAgentConsoleEnabled && createdAgentTypeId) {
        activateAddressedSession(workspaceSessionRef(id, createdAgentTypeId))
      } else if (!sessionApi) {
        if (createdAgentTypeId) rawSwitch(id, createdAgentTypeId)
        else rawSwitch(id)
      }
      scheduleActiveAgentComposerFocus()
    }).catch((error) => {
      if (pendingCreatePaneRef.current === pendingCreatePane) pendingCreatePaneRef.current = null
      setChatPaneSplitPending(false)
      surfaceSessionActionError("create chat", error)
    })
    return created
  }, [activateAddressedSession, agentTypeId, canMountCreatedAgentPane, chatSessionKey, multiAgentConsoleEnabled, rawSwitch, resolvedCreate, resolvedSessions, sessionApi, workspaceId])

  const deleteSessionAndPane = useCallback((sessionId: string, sessionAgentTypeId?: string) => {
    let deletion: unknown
    try {
      deletion = resolvedDelete(sessionId, sessionAgentTypeId)
    } catch (error) {
      surfaceSessionActionError("delete chat", error)
      return
    }
    const sessionKey = workspaceSessionKey(sessionId, sessionAgentTypeId)
    return Promise.resolve(deletion).then(() => {
      const latest = chatPaneStateRef.current
      const current = latest.workspaceId === workspaceId
        ? latest
        : { workspaceId, ids: [chatSessionKey], activeId: chatSessionKey }
      const deletingIndex = current.ids.indexOf(sessionKey)
      if (deletingIndex >= 0) {
        const nextIds = current.ids.filter((id) => id !== sessionKey)
        const nextActiveId = current.activeId === sessionKey
          ? nextIds[Math.max(0, deletingIndex - 1)] ?? nextIds[0] ?? null
          : current.activeId
        setChatPaneState({ workspaceId, ids: nextIds, activeId: nextActiveId })
        if (nextActiveId && current.activeId === sessionKey) {
          const next = workspaceSessionRefFromKey(nextActiveId)
          if (multiAgentConsoleEnabled && next.agentTypeId) activateAddressedSession(next)
          else if (next.agentTypeId) resolvedSwitch(next.sessionId, next.agentTypeId)
          else resolvedSwitch(next.sessionId)
        }
      }
    }).catch((error) => {
      surfaceSessionActionError("delete chat", error)
    })
  }, [activateAddressedSession, chatSessionKey, multiAgentConsoleEnabled, resolvedDelete, resolvedSwitch, workspaceId])

  const createChatSessionPreferNewPane = useCallback((targetAgentTypeId?: string) => {
    if (chatPaneIds.length >= 2) return createChatPaneAfter(activeChatPaneId, { targetAgentTypeId })
    return createChatSession(targetAgentTypeId)
  }, [activeChatPaneId, chatPaneIds.length, createChatPaneAfter, createChatSession])

  const [autoSubmitHydrationDisabled, setAutoSubmitHydrationDisabled] = useState(autoSubmitInitialDraft)
  const autoSubmitHydrationWorkspaceRef = useRef(workspaceId)
  useEffect(() => {
    if (autoSubmitHydrationWorkspaceRef.current !== workspaceId) {
      autoSubmitHydrationWorkspaceRef.current = workspaceId
      setAutoSubmitHydrationDisabled(autoSubmitInitialDraft)
      return
    }
    if (autoSubmitInitialDraft) setAutoSubmitHydrationDisabled(true)
  }, [autoSubmitInitialDraft, workspaceId])
  const delayAutoSubmitDraft = autoSubmitInitialDraft
    && shouldUseRemoteSessions
    && !effectiveActiveSessionId
  const hydrateMessages = !autoSubmitHydrationDisabled && provisionWorkspace !== false && (
    shouldUseRemoteSessions ? Boolean(effectiveActiveSessionId) : true
  )
  const settleAutoSubmitHydration = useCallback(() => {
    setAutoSubmitHydrationDisabled(false)
    settleAutoSubmitInitialDraft()
  }, [settleAutoSubmitInitialDraft])

  return {
    chatSessionId,
    chatSessionKey,
    chatPaneIds,
    activeChatPaneId,
    displayedActiveChatPaneId,
    flashChatPane,
    pinnedIds,
    sessionTitleById,
    sessionAgentLabelById,
    emptySessionIds,
    delayAutoSubmitDraft,
    hydrateMessages,
    markInitialHydrationPromptStarted,
    settleAutoSubmitHydration,
    toggleSessionPinned,
    switchToChatPane,
    activateChatPane,
    openChatPane,
    closeChatPane,
    createChatSession,
    createChatPaneAfter,
    chatPaneSplitPending,
    pendingChatPanePlacement,
    consumePendingChatPanePlacement,
    createChatSessionPreferNewPane,
    deleteSessionAndPane,
  }
}
