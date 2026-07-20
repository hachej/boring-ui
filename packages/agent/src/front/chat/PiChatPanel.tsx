"use client"

import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PromptInputFilePart } from '../primitives/prompt-input'
import { ArtifactOpenProvider } from '../ArtifactOpenContext'
import {
  WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT,
  WORKSPACE_COMMAND_NOTIFY_EVENT,
  type CommandNotifyPayload,
} from '../../shared/agentPluginEvents'
import type { PiChatEvent, PiChatStatus, PromptPayload } from '../../shared/chat'
import type { AvailableModel, ModelSelection, ThinkingLevel } from '../chatPanelSettings'
import { DEFAULT_THINKING } from '../chatPanelSettings'
import { cn } from '../lib'
import { defaultChatSuggestions, type ChatSuggestion } from '../ChatEmptyState'
import type { SlashCommand } from '../slashCommands'
import { builtinCommands, createCommandRegistry } from '../slashCommands'
import type { ToolRendererOverrides } from '../bareToolRenderers'
import { mergeShadcnToolRenderers } from '../toolRenderers'
import type { PluginUpdateState } from '../composer/PluginUpdateStatus'
import type { CommandRunState } from '../composer/CommandRunStatus'
import { useComposerHistory } from '../useComposerHistory'
import { useComposerPickers } from '../useComposerPickers'
import { useChatModelSelection } from '../hooks/useChatModelSelection'
import { useServerCommands } from '../hooks/useServerCommands'
import { useAttachmentNotice } from '../hooks/useAttachmentNotice'
import {
  composerNoticeForRuntimeDependencies,
  composerNoticeForWarmup,
  type ChatPanelRuntimeDependenciesWarmupStatus,
  type ChatPanelWorkspaceWarmupStatus,
} from './chatPanelWorkspaceWarmup'
import { selectMessagesForRender, selectQueuePreview, selectRuntimeNotices } from './pi/selectors'
import { piChatErrorCode, type RemotePiSession, type RemotePiSessionOptions } from './pi/remotePiSession'
import type { EphemeralSessionAdoption, EphemeralSessionCoordinatorApi } from './session/ephemeralSessionCoordinator'
import type { PiChatRuntimeNotice } from './pi/piChatReducer'
import {
  InitialDraftAutoSubmitGuard,
  createPiComposerPolicyController,
  modelOptionsForSelection,
  readPiComposerSettings,
  selectComposerHistoryFromCanonicalUsers,
  writePiComposerShowThoughts,
  writePiComposerThinking,
  type ActiveSessionStorageLike,
} from './session'
import { SessionList, usePiSessions, type UsePiSessionsOptions } from './session'
import {
  type ComposerBlocker,
  type ComposerBlockerAction,
  type PanelNotice,
} from './components/ChatNotices'
import { PiConversationSurface, type MessageFooterProjectionItem } from './components/PiConversationSurface'
import { PiChatComposerSurface } from './components/PiChatComposerSurface'
import { useExternalRemotePiSession, useRemotePiSessionState } from './piChatPanelHooks'
import {
  errorMessage,
  headersContentKey,
  isPiBusyStatus,
  normalizedHeadersFromContentKey,
  parseBrowserPluginReloadDetail,
  resolveModelSlashSelection,
  resolveThinkingSlashSelection,
  shouldHoldLocalSubmitted,
  shouldRefreshSessionListAfterEvent,
  statusForState,
  thinkingLabel,
  toDebugUiMessage,
  toPromptSubmitStatus,
} from './piChatPanelUtils'

const DebugDrawer = lazy(() => import('../DebugDrawer').then((m) => ({ default: m.DebugDrawer })))

const EMPTY_COMMANDS: SlashCommand[] = []
const EMPTY_COMMAND_NAMES: string[] = []
const EMPTY_BLOCKERS: never[] = []
/** Stable id for the notice that surfaces a rejected run (so re-rejections replace
 * it rather than stacking, and the next admit can retract it). */
const RUN_REJECTED_NOTICE_ID = 'run-rejected'

function promptInputFilesForAttachments(attachments: NonNullable<PromptPayload['attachments']>): PromptInputFilePart[] {
  return attachments.map((attachment) => ({
    type: 'file',
    url: attachment.url,
    mediaType: attachment.mediaType ?? 'application/octet-stream',
    filename: attachment.filename,
    path: attachment.path,
  }))
}

export type { ComposerBlocker, ComposerBlockerAction, PanelNotice }

export type { ChatPanelRuntimeDependenciesWarmupStatus, ChatPanelWorkspaceWarmupStatus }

export type ChatSubmitSource = 'composer' | 'suggestion' | 'auto-submit'

export interface ChatSubmitContext {
  files: PromptInputFilePart[]
  sessionId: string
  source: ChatSubmitSource
}

interface ComposerSendPayload {
  text: string
  files: PromptInputFilePart[]
  source?: ChatSubmitSource
}

export interface ChatPanelEmptyState {
  eyebrow?: string
  title?: string
  description?: ReactNode
  /** Optional content rendered below the suggestion grid (e.g. a footer link). */
  footer?: ReactNode
}

export interface AgentPluginReloadResult {
  message: string
  reloaded: boolean
}

function normalizeAgentPluginReloadResult(result: AgentPluginReloadResult | string): AgentPluginReloadResult {
  if (typeof result !== 'string') return result

  // Compatibility for hosts using the original string-returning callback contract.
  const firstLine = result.trim().split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? ''
  if (/^(?:agent plugins|extensions) reloaded\.?$/i.test(firstLine)) return { message: result, reloaded: true }
  if (/^(?:agent plugins|extensions) will reload on the next message\.?$/i.test(firstLine)) return { message: result, reloaded: false }
  throw new Error(result)
}

export interface PiChatPanelProps<
  TComposerBlocker extends ComposerBlocker = ComposerBlocker,
> {
  /** Optional externally selected Pi session id. When provided, session navigation is owned by the host. */
  sessionId?: string
  /** Alias kept for consumers that still pass the pre-cutover prop name. */
  extraCommands?: SlashCommand[]
  apiBaseUrl?: string
  workspaceId?: string
  storageScope?: string
  requestHeaders?: Record<string, string | undefined>
  storage?: ActiveSessionStorageLike
  fetch?: typeof globalThis.fetch
  className?: string
  chrome?: boolean
  debug?: boolean
  showSessions?: boolean
  hotReloadEnabled?: boolean
  suggestions?: ChatSuggestion[]
  emptyState?: ChatPanelEmptyState
  emptyPlacement?: 'default' | 'hero'
  composerPlaceholder?: string
  initialDraft?: string
  autoSubmitInitialDraft?: boolean
  onDraftRestored?: () => void
  onAutoSubmitInitialDraftAccepted?: () => void
  onAutoSubmitInitialDraftSettled?: () => void
  model?: ModelSelection | null
  defaultModel?: ModelSelection
  availableModels?: AvailableModel[]
  hideDefaultModelOption?: boolean
  hideComposerSettings?: boolean
  suppressPreSubmitCancelledWarning?: boolean
  thinkingLevel?: ThinkingLevel
  thinkingControl?: boolean
  serverResourcesEnabled?: boolean
  /** Explicit direct/local capability for browser-local chats to materialize on first send. */
  nativeSessionStartEnabled?: boolean
  mentionedFiles?: string[] | (() => string[])
  commands?: SlashCommand[]
  /** Built-in slash command names to omit from the composer command registry. */
  excludeBuiltinCommands?: string[]
  toolRenderers?: ToolRendererOverrides
  messageFooterProjection?: (items: readonly MessageFooterProjectionItem[]) => ReadonlyMap<string, ReactNode>
  createRemoteSession?: (options: RemotePiSessionOptions) => RemotePiSession
  remoteSessionOptions?: UsePiSessionsOptions['remoteSessionOptions']
  /** Request-scope first-send owner shared by externally keyed panes. */
  ephemeralSessionCoordinator?: EphemeralSessionCoordinatorApi
  /** Externally keyed hosts replace their pane ID from this single adoption event. */
  onEphemeralSessionAdopted?: (adoption: EphemeralSessionAdoption) => void
  hydrateMessages?: boolean
  allowPromptDuringInitialHydration?: boolean
  workspaceWarmupStatus?: ChatPanelWorkspaceWarmupStatus
  onSessionReset?: () => void | Promise<void>
  onBeforeSubmit?: (draft: string, context: ChatSubmitContext) => false | void | boolean | Promise<false | void | boolean>
  onReloadAgentPlugins?: () => Promise<AgentPluginReloadResult | string>
  onCommandResult?: (message: string) => void
  onComposerWarning?: (message: string) => void
  onMentionedFilesConsumed?: () => void
  onPromptSubmitStarted?: (context: { sessionId: string; clientNonce: string }) => void
  onData?: (part: unknown) => void
  onOpenArtifact?: (path: string, options?: { filesystem?: string }) => void
  composerBlockers?: TComposerBlocker[]
  onComposerStop?: () => void
  onComposerBlockerAction?: (blocker: TComposerBlocker, action: string) => void
  /** Fired once each time a run settles (busy → idle). Hosts use it to refresh
   * out-of-band state after a turn (e.g. a usage/quota indicator). The agent stays
   * agnostic about what the host does with it. */
  onTurnComplete?: () => void
  /** Host-supplied action node for a runtime notice, keyed off notice.errorCode.
   * Lets a host attach a recovery action for a specific error code without the agent
   * knowing what the code means or what the action does. */
  renderNoticeAction?: (notice: PiChatRuntimeNotice) => ReactNode
}

export function PiChatPanel<
  TComposerBlocker extends ComposerBlocker = ComposerBlocker,
>({
  sessionId,
  extraCommands,
  apiBaseUrl,
  workspaceId,
  storageScope = 'default',
  requestHeaders,
  storage,
  fetch,
  className,
  chrome = true,
  debug = false,
  showSessions,
  hotReloadEnabled = true,
  suggestions = defaultChatSuggestions,
  emptyState,
  emptyPlacement = 'default',
  composerPlaceholder,
  initialDraft,
  autoSubmitInitialDraft = false,
  onDraftRestored,
  onAutoSubmitInitialDraftAccepted,
  onAutoSubmitInitialDraftSettled,
  model,
  defaultModel,
  availableModels,
  hideDefaultModelOption = false,
  hideComposerSettings = false,
  suppressPreSubmitCancelledWarning = false,
  thinkingLevel,
  thinkingControl = true,
  serverResourcesEnabled = true,
  nativeSessionStartEnabled = false,
  mentionedFiles,
  commands = EMPTY_COMMANDS,
  excludeBuiltinCommands = EMPTY_COMMAND_NAMES,
  toolRenderers,
  messageFooterProjection,
  createRemoteSession,
  remoteSessionOptions,
  ephemeralSessionCoordinator: suppliedEphemeralSessionCoordinator,
  onEphemeralSessionAdopted,
  hydrateMessages = true,
  allowPromptDuringInitialHydration = false,
  workspaceWarmupStatus,
  onSessionReset,
  onBeforeSubmit,
  onReloadAgentPlugins,
  onCommandResult,
  onComposerWarning,
  onMentionedFilesConsumed,
  onPromptSubmitStarted,
  onData,
  onOpenArtifact,
  composerBlockers = EMPTY_BLOCKERS,
  onComposerStop,
  onComposerBlockerAction,
  onTurnComplete,
  renderNoticeAction,
}: PiChatPanelProps<TComposerBlocker>) {
  const externalSessionId = sessionId?.trim() || undefined
  const showSessionSidebar = showSessions ?? externalSessionId === undefined
  const onDataRef = useRef(onData)
  onDataRef.current = onData
  // Ref so the (memoized) session-options closure can fire onTurnComplete without
  // re-creating the session each time the callback identity changes.
  const onTurnCompleteRef = useRef(onTurnComplete)
  onTurnCompleteRef.current = onTurnComplete
  const sessionListRefreshRef = useRef<(() => void) | undefined>(undefined)
  const requestHeadersKey = useMemo(() => headersContentKey(requestHeaders), [requestHeaders])
  const normalizedRequestHeaders = useMemo(() => normalizedHeadersFromContentKey(requestHeadersKey), [requestHeadersKey])
  const remoteSessionOptionsWithEvents = useMemo<UsePiSessionsOptions['remoteSessionOptions']>(() => ({
    ...remoteSessionOptions,
    ...(hydrateMessages ? {} : { autoStart: false }),
    onEvent: (event: PiChatEvent) => {
      remoteSessionOptions?.onEvent?.(event)
      onDataRef.current?.(event)
      // Fire onTurnComplete on the per-turn TERMINAL settle event. Driven by the event
      // stream (not rendered status edges) so back-to-back queued turns each report once
      // even when the store coalesces a streaming→idle→streaming flicker, and so a
      // rejected send (which never produces agent-end) is never reported. Skip
      // willRetry ends — those are non-terminal (pi will auto-retry) and would over-fire.
      if (event.type === 'agent-end' && !event.willRetry) onTurnCompleteRef.current?.()
      if (shouldRefreshSessionListAfterEvent(event)) sessionListRefreshRef.current?.()
    },
  }), [hydrateMessages, remoteSessionOptions])
  const sessions = usePiSessions({
    apiBaseUrl,
    workspaceId,
    storageScope,
    requestHeaders,
    storage,
    fetch,
    createRemoteSession,
    remoteSessionOptions: remoteSessionOptionsWithEvents,
    ephemeralSessionCoordinator: suppliedEphemeralSessionCoordinator,
    enabled: externalSessionId === undefined,
    localCreateUntilPrompt: nativeSessionStartEnabled,
  })
  useEffect(() => {
    if (externalSessionId) {
      sessionListRefreshRef.current = undefined
      return
    }
    const refreshSessionList = () => {
      void sessions.refresh({ background: true })
    }
    sessionListRefreshRef.current = refreshSessionList
    return () => {
      if (sessionListRefreshRef.current === refreshSessionList) sessionListRefreshRef.current = undefined
    }
  }, [externalSessionId, sessions.refresh])
  const effectiveEphemeralSessionCoordinator = suppliedEphemeralSessionCoordinator ?? sessions.ephemeralSessionCoordinator
  const [ephemeralCoordinatorVersion, setEphemeralCoordinatorVersion] = useState(0)
  useEffect(() => effectiveEphemeralSessionCoordinator.subscribeState(() => {
    setEphemeralCoordinatorVersion((version) => version + 1)
  }), [effectiveEphemeralSessionCoordinator])
  useEffect(() => {
    if (!externalSessionId || !onEphemeralSessionAdopted) return
    return effectiveEphemeralSessionCoordinator.subscribe((adoption) => {
      if (adoption.localId === externalSessionId) onEphemeralSessionAdopted(adoption)
    })
  }, [effectiveEphemeralSessionCoordinator, externalSessionId, onEphemeralSessionAdopted])
  const externalPiSession = useExternalRemotePiSession({
    sessionId: externalSessionId,
    workspaceId,
    storageScope,
    apiBaseUrl,
    requestHeaders: normalizedRequestHeaders,
    fetch,
    createRemoteSession,
    remoteSessionOptions: remoteSessionOptionsWithEvents,
    ephemeralSessionCoordinator: effectiveEphemeralSessionCoordinator,
    ephemeralSessionVersion: ephemeralCoordinatorVersion,
    nativeSessionStartEnabled,
  })
  const activePiSession = externalSessionId ? externalPiSession : sessions.activePiSession
  const chatState = useRemotePiSessionState(activePiSession)
  const activeSessionId = externalSessionId ?? sessions.activeSessionId
  const sessionList = externalSessionId ? [] : sessions.sessions
  const sessionsLoading = externalSessionId ? false : sessions.loading
  const sessionsError = externalSessionId ? undefined : sessions.error
  // An external pane can receive coordinator adoption before its host replaces
  // the supplied local ID. Only that explicit adopted phase may use the native
  // remote view while IDs differ; ordinary external state still must match.
  const externalEphemeralPhase = externalSessionId ? effectiveEphemeralSessionCoordinator.phase(externalSessionId) : undefined
  const externalPaneAdopted = externalEphemeralPhase?.type === 'adopted' || externalEphemeralPhase?.type === 'failed'
  const selectedChatState = externalPaneAdopted
    ? chatState
    : activeSessionId && chatState?.sessionId === activeSessionId ? chatState : undefined
  const selectedPiSession = selectedChatState ? activePiSession : undefined
  const chatStatePending = Boolean(!externalPaneAdopted && activeSessionId && chatState && chatState.sessionId !== activeSessionId)
  const selectedSessionPending = Boolean(activeSessionId && !selectedChatState)
  const modelDiscoveryEnabled = serverResourcesEnabled && availableModels === undefined
  const modelDiscovery = useChatModelSelection({
    apiBaseUrl,
    defaultModel,
    fetch,
    requestHeaders: normalizedRequestHeaders,
    storage,
    storageScope,
    enabled: modelDiscoveryEnabled,
  })
  const selectedModel = model === undefined ? modelDiscovery.model : model
  const modelOptions = useMemo(
    () => modelOptionsForSelection(availableModels ?? modelDiscovery.availableModels, selectedModel),
    [availableModels, modelDiscovery.availableModels, selectedModel],
  )
  const selectedModelAuthorizedByDiscovery = !modelDiscoveryEnabled || Boolean(selectedModel && modelDiscovery.availableModels.some(
    (modelOption) => modelOption.available && modelOption.provider === selectedModel.provider && modelOption.id === selectedModel.id,
  ))
  const serverModelSelectionPending = modelDiscoveryEnabled && !modelDiscovery.loaded
  const serverModelSelectionUnavailable = modelDiscoveryEnabled && modelDiscovery.loaded && !selectedModelAuthorizedByDiscovery
  const serverModelSelectionReady = !serverModelSelectionPending && !serverModelSelectionUnavailable
  const [storedThinkingLevel, setStoredThinkingLevel] = useState<ThinkingLevel>(() =>
    thinkingControl ? readPiComposerSettings({ storageScope, storage }).thinkingLevel : DEFAULT_THINKING,
  )
  const [showThoughts, setShowThoughts] = useState<boolean>(() =>
    readPiComposerSettings({ storageScope, storage }).showThoughts,
  )
  const [composerSettingsOwner, setComposerSettingsOwner] = useState(() => ({ storageScope, storage }))
  useEffect(() => {
    const settings = readPiComposerSettings({ storageScope, storage })
    setStoredThinkingLevel(thinkingControl ? settings.thinkingLevel : DEFAULT_THINKING)
    setShowThoughts(settings.showThoughts)
    setComposerSettingsOwner({ storageScope, storage })
  }, [storage, storageScope, thinkingControl])
  const composerSettingsLoaded = composerSettingsOwner.storageScope === storageScope && composerSettingsOwner.storage === storage
  useEffect(() => {
    if (!thinkingControl) return
    if (!composerSettingsLoaded) return
    writePiComposerThinking(storedThinkingLevel, { storageScope, storage })
  }, [composerSettingsLoaded, storage, storageScope, storedThinkingLevel, thinkingControl])
  useEffect(() => {
    if (!composerSettingsLoaded) return
    writePiComposerShowThoughts(showThoughts, { storageScope, storage })
  }, [composerSettingsLoaded, showThoughts, storage, storageScope])
  const selectedThinking = thinkingLevel ?? storedThinkingLevel
  const submitThinkingControl = thinkingControl || thinkingLevel !== undefined
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [thinkingPickerOpen, setThinkingPickerOpen] = useState(false)
  const [draft, setDraft] = useState(() => initialDraft ?? '')
  const failedEphemeralDraft = useMemo(
    () => effectiveEphemeralSessionCoordinator.failedDraft(activeSessionId),
    [activeSessionId, effectiveEphemeralSessionCoordinator, ephemeralCoordinatorVersion],
  )
  const draftRef = useRef(draft)
  draftRef.current = draft
  const initialDraftGuard = useRef(new InitialDraftAutoSubmitGuard())
  const pendingAutoSubmitSettleRef = useRef<string | undefined>(undefined)
  const acceptedAutoSubmitSettleRef = useRef<string | undefined>(undefined)
  const resetInProgressRef = useRef(false)
  const autoCreateInFlightRef = useRef(false)
  const settlePendingAutoSubmit = useCallback((sessionId?: string) => {
    const pendingSessionId = pendingAutoSubmitSettleRef.current
    if (!pendingSessionId || (sessionId && pendingSessionId !== sessionId)) return false
    pendingAutoSubmitSettleRef.current = undefined
    if (acceptedAutoSubmitSettleRef.current === pendingSessionId) acceptedAutoSubmitSettleRef.current = undefined
    onAutoSubmitInitialDraftSettled?.()
    return true
  }, [onAutoSubmitInitialDraftSettled])
  const prevStatusRef = useRef<PiChatStatus>('idle')
  const statusRef = useRef<PiChatStatus>('idle')
  const scrollToBottomRef = useRef<() => void>(() => {})
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [localNotices, setLocalNotices] = useState<PanelNotice[]>([])
  const [dismissedNoticeIds, setDismissedNoticeIds] = useState<Set<string>>(() => new Set())
  const [pluginUpdateState, setPluginUpdateState] = useState<PluginUpdateState | null>(null)
  const [commandNotifyState, setCommandNotifyState] = useState<CommandRunState | null>(null)
  const commandRunIdRef = useRef(0)
  const [serverSkillsRefreshKey, setServerSkillsRefreshKey] = useState(0)
  const [localSubmittedSessionId, setLocalSubmittedSessionId] = useState<string | undefined>()
  const localSubmittedSessionRef = useRef<string | undefined>(undefined)
  const { attachmentNotice, setAttachmentNotice } = useAttachmentNotice()

  const markLocalSubmitted = useCallback((sessionId: string) => {
    localSubmittedSessionRef.current = sessionId
    setLocalSubmittedSessionId(sessionId)
  }, [])
  const clearLocalSubmitted = useCallback((sessionId?: string) => {
    if (sessionId && localSubmittedSessionRef.current !== sessionId) return
    localSubmittedSessionRef.current = undefined
    setLocalSubmittedSessionId(undefined)
  }, [])

  const registry = useMemo(() => {
    const excludedBuiltins = new Set(excludeBuiltinCommands)
    const effectiveBuiltins = builtinCommands.filter((command) => {
      if (!hotReloadEnabled && command.name === 'reload') return false
      return !excludedBuiltins.has(command.name)
    })
    const next = createCommandRegistry(effectiveBuiltins)
    for (const command of extraCommands ?? []) next.register(command)
    for (const command of commands) next.register(command)
    return next
  }, [apiBaseUrl, commands, excludeBuiltinCommands, extraCommands, hotReloadEnabled, normalizedRequestHeaders, serverResourcesEnabled, serverSkillsRefreshKey, storageScope])
  const commandsStamp = useServerCommands({
    registry,
    requestHeaders: normalizedRequestHeaders,
    sessionId: activeSessionId ?? 'default',
    apiBaseUrl,
    fetch,
    storageScope,
    refreshKey: serverSkillsRefreshKey,
    enabled: serverResourcesEnabled,
  })
  const allCommands = useMemo(() => registry.list(), [registry, commandsStamp])

  const activeChatSessionId = selectedChatState?.sessionId
  const warmupNotice = composerNoticeForWarmup(workspaceWarmupStatus)
  const runtimeDependenciesNotice = composerNoticeForRuntimeDependencies(workspaceWarmupStatus)
  const workspaceWarmupBlocked = Boolean(warmupNotice)
  const activeBlockers = useMemo(
    // A missing active session id means a single/sessionless chat host. In that
    // mode, keep scoped blockers visible instead of hiding the only attention UI.
    // Multi-session hosts should pass a session id so unrelated blockers filter out.
    () => composerBlockers.filter((blocker) => !blocker.sessionId || !activeSessionId || blocker.sessionId === activeSessionId),
    [activeSessionId, composerBlockers],
  )
  const canonicalMessages = useMemo(
    () => selectedChatState ? selectMessagesForRender(selectedChatState) : [],
    [selectedChatState],
  )
  const queuePreview = useMemo(
    () => selectedChatState ? selectQueuePreview(selectedChatState) : [],
    [selectedChatState],
  )
  const messages = canonicalMessages
  const userHistory = useMemo(() => selectComposerHistoryFromCanonicalUsers(canonicalMessages), [canonicalMessages])
  const emptyStateHydrating = statusForState(selectedChatState, sessionsLoading || chatStatePending || selectedSessionPending) === 'hydrating'
  const emptyHero = emptyPlacement === 'hero' && messages.length === 0 && queuePreview.length === 0 && !emptyStateHydrating
  const debugState = selectedPiSession?.getDebugState()
  const composerBlocked = workspaceWarmupBlocked || activeBlockers.length > 0
  const primaryComposerBlocker = activeBlockers[0]
  const composerBlockerLabel = workspaceWarmupBlocked
    ? (warmupNotice?.title ?? 'Preparing workspace...')
    : primaryComposerBlocker?.label ?? primaryComposerBlocker?.reason ?? 'Complete the pending workspace action to continue.'
  const composerStatusNotice = warmupNotice ?? runtimeDependenciesNotice
  const runtimeNotices = useMemo(() => {
    const fromState = selectedChatState ? selectRuntimeNotices(selectedChatState) : []
    const sessionNotice = sessionsError
      ? [{ id: 'session-navigation-error', level: 'error' as const, text: sessionsError.message, dismissible: true }]
      : []
    // Composer blockers already render as an actionable bar right above the
    // input (ComposerBlockerNotice, with Open/Cancel buttons), so surfacing
    // them again as a timeline warning notice just duplicates the same line.
    // Keep the single actionable bar; don't echo it here.
    const largeStateNotice = debug && debugState?.largeStateWarning
      ? [{
          id: 'large-state-warning',
          level: 'warning' as const,
          text: `Large chat state: ${debugState.largeStateWarning.messageCount} messages, approximately ${debugState.largeStateWarning.approxBytes} bytes.`,
          dismissible: true,
        }]
      : []
    return [...fromState, ...sessionNotice, ...largeStateNotice, ...localNotices].filter((notice) => !dismissedNoticeIds.has(notice.id))
  }, [debug, debugState?.largeStateWarning, dismissedNoticeIds, localNotices, selectedChatState, sessionsError])

  const addLocalNotice = useCallback((notice: PanelNotice) => {
    setLocalNotices((previous) => {
      const next = previous.filter((candidate) => candidate.id !== notice.id)
      return [...next, notice]
    })
  }, [])

  const clearLocalNotice = useCallback((id: string) => {
    // Dismissing the error only hides its notice. The coordinator retains the
    // failed recovery until the next admitted prompt so attachments survive.
    setDismissedNoticeIds((previous) => new Set(previous).add(id))
    setLocalNotices((previous) => previous.filter((notice) => notice.id !== id))
  }, [])

  // Remove a notice so it can be shown again later (unlike clearLocalNotice, which
  // permanently dismisses the id). Used to retract the run-rejected CTA on the next
  // submit so a fresh rejection re-renders rather than being suppressed.
  const dropLocalNotice = useCallback((id: string) => {
    setDismissedNoticeIds((previous) => {
      if (!previous.has(id)) return previous
      const next = new Set(previous)
      next.delete(id)
      return next
    })
    setLocalNotices((previous) => previous.filter((notice) => notice.id !== id))
  }, [])

  const createSession = useCallback(() => {
    if (externalSessionId) return
    void sessions.create().catch((error) => {
      addLocalNotice({ id: 'session-create-error', level: 'error', text: errorMessage(error, 'Could not create a chat session.'), dismissible: true })
    })
  }, [addLocalNotice, externalSessionId, sessions.create])

  useEffect(() => {
    if (externalSessionId || sessionsLoading || sessionsError || activeSessionId || sessionList.length > 0) return
    if (resetInProgressRef.current) return
    if (autoCreateInFlightRef.current) return
    autoCreateInFlightRef.current = true
    void sessions.create().catch((error) => {
      autoCreateInFlightRef.current = false
      addLocalNotice({ id: 'session-auto-create-error', level: 'error', text: errorMessage(error, 'Could not create a chat session.'), dismissible: true })
    })
  }, [activeSessionId, addLocalNotice, externalSessionId, sessionList.length, sessions.create, sessionsError, sessionsLoading])

  useEffect(() => {
    if (externalSessionId || sessionsError || activeSessionId || sessionList.length > 0) {
      autoCreateInFlightRef.current = false
    }
  }, [activeSessionId, externalSessionId, sessionList.length, sessionsError])

  const deleteSession = useCallback((sessionId: string) => {
    if (externalSessionId) return
    void sessions.delete(sessionId).catch((error) => {
      addLocalNotice({ id: `session-delete-error:${sessionId}`, level: 'error', text: errorMessage(error, 'Could not delete the chat session.'), dismissible: true })
    })
  }, [addLocalNotice, externalSessionId, sessions.delete])

  const resetSession = useCallback(() => {
    const currentSessionId = activeSessionId
    if (externalSessionId) {
      void onSessionReset?.()
      return
    }
    if (!currentSessionId) return
    void (async () => {
      resetInProgressRef.current = true
      await sessions.delete(currentSessionId)
      await sessions.create()
      await onSessionReset?.()
    })().catch((error) => {
      addLocalNotice({ id: 'session-reset-error', level: 'error', text: errorMessage(error, 'Could not reset the chat session.'), dismissible: true })
    }).finally(() => {
      resetInProgressRef.current = false
    })
  }, [activeSessionId, addLocalNotice, externalSessionId, onSessionReset, sessions.create, sessions.delete])

  const reloadAgentPlugins = useCallback(async () => {
    if (!onReloadAgentPlugins) throw new Error('Agent plugin reload is not configured.')
    return normalizeAgentPluginReloadResult(await onReloadAgentPlugins())
  }, [onReloadAgentPlugins])

  const runPluginUpdate = useCallback(async () => {
    setPluginUpdateState({ kind: 'running' })
    try {
      const result = await reloadAgentPlugins()
      setPluginUpdateState({ kind: 'success', reloaded: result.reloaded })
      setServerSkillsRefreshKey((key) => key + 1)
      return result.message
    } catch (error) {
      const message = errorMessage(error, 'Extension reload failed.')
      setPluginUpdateState({ kind: 'error', message })
      return `Extension update failed: ${message}`
    }
  }, [reloadAgentPlugins])

  const dismissPluginUpdate = useCallback(() => setPluginUpdateState(null), [])

  const dismissCommandNotify = useCallback(() => setCommandNotifyState(null), [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onCommandNotify = (event: Event) => {
      const payload = (event as CustomEvent<CommandNotifyPayload>).detail
      if (!payload || typeof payload.message !== 'string') return
      const tone = payload.tone
      const command = payload.command ?? ''
      if (tone === 'error') {
        setCommandNotifyState({ kind: 'error', command, message: payload.message })
      } else {
        // 'success', 'info', and 'warn' all use the success banner tone
        const runId = ++commandRunIdRef.current
        setCommandNotifyState({ kind: 'success', command, detail: payload.message, runId })
      }
    }
    window.addEventListener(WORKSPACE_COMMAND_NOTIFY_EVENT, onCommandNotify as EventListener)
    return () => window.removeEventListener(WORKSPACE_COMMAND_NOTIFY_EVENT, onCommandNotify as EventListener)
  }, [])

  useEffect(() => {
    if (!hotReloadEnabled || typeof window === 'undefined') return
    const onBrowserPluginReload = (event: Event) => {
      const parsed = parseBrowserPluginReloadDetail((event as CustomEvent).detail)
      if (!parsed) return
      if (parsed.kind === 'success') setServerSkillsRefreshKey((key) => key + 1)
      setPluginUpdateState((previous) => {
        if (!previous) return previous
        if (parsed.kind === 'error') return { kind: 'error', message: parsed.message }
        if (previous.kind === 'error') return previous
        const current = previous.kind === 'success' ? previous : { kind: 'success' as const, reloaded: true }
        const frontEvents = current.frontEvents ?? []
        if (frontEvents.some((item) => item.pluginId === parsed.diagnostic.pluginId && item.message === parsed.diagnostic.message)) {
          return current
        }
        return { ...current, frontEvents: [...frontEvents, parsed.diagnostic] }
      })
    }
    window.addEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, onBrowserPluginReload as EventListener)
    return () => window.removeEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, onBrowserPluginReload as EventListener)
  }, [hotReloadEnabled])

  const {
    mentionState,
    slashQuery,
    mentionedFiles: pickedMentionedFiles,
    clearMentionedFiles,
    dismissMention,
    dismissSlash,
    handleComposerChange,
    selectMention,
    selectSlashCommand: insertSlashCommand,
  } = useComposerPickers({ textareaRef })

  const effectiveMentionedFiles = mentionedFiles ?? pickedMentionedFiles

  const handleComposerKeyDown = useComposerHistory({
    userHistory,
    textareaRef,
    disabled: mentionState !== null || slashQuery !== null || modelPickerOpen || thinkingPickerOpen,
  })

  const setComposerDraft = useCallback((next: string, focus = true) => {
    draftRef.current = next
    setDraft(next)
    if (textareaRef.current) {
      textareaRef.current.value = next
      if (focus) textareaRef.current.focus()
    }
  }, [])

  const warnComposer = useCallback((message: string) => {
    onComposerWarning?.(message)
    addLocalNotice({ id: `composer-warning:${Date.now()}`, level: 'warning', text: message, dismissible: true })
  }, [addLocalNotice, onComposerWarning])

  const openModelPicker = useCallback(() => {
    if (isPiBusyStatus(statusRef.current)) {
      warnComposer('Model picker is unavailable while the agent is running.')
      return false
    }
    if (model !== undefined) {
      warnComposer('Model selection is controlled by the host.')
      return false
    }
    setThinkingPickerOpen(false)
    setModelPickerOpen(true)
    return true
  }, [model, warnComposer])

  const openThinkingPicker = useCallback(() => {
    if (isPiBusyStatus(statusRef.current)) {
      warnComposer('Thinking picker is unavailable while the agent is running.')
      return false
    }
    if (!thinkingControl || thinkingLevel !== undefined) {
      warnComposer('Thinking level is controlled by the host.')
      return false
    }
    setModelPickerOpen(false)
    setThinkingPickerOpen(true)
    return true
  }, [thinkingControl, thinkingLevel, warnComposer])

  const selectComposerModel = useCallback((query: string) => {
    if (model !== undefined) return 'Model selection is controlled by the host.'
    const match = resolveModelSlashSelection(query, modelOptions)
    if (!match) return `No model matched "${query}".`
    modelDiscovery.setModel(match)
    return `Model set to ${match.label ?? match.id}.`
  }, [model, modelDiscovery, modelOptions])

  const selectComposerThinking = useCallback((query: string) => {
    if (!thinkingControl || thinkingLevel !== undefined) return 'Thinking level is controlled by the host.'
    const match = resolveThinkingSlashSelection(query)
    if (!match) return `No thinking level matched "${query}".`
    setStoredThinkingLevel(match)
    return `Thinking set to ${thinkingLabel(match)}.`
  }, [thinkingControl, thinkingLevel])

  const selectSlashCommand = useCallback((name: string) => {
    if (name === 'model') {
      dismissSlash()
      if (openModelPicker()) setComposerDraft('')
      return
    }
    if (name === 'thinking' || name === 'think') {
      dismissSlash()
      if (openThinkingPicker()) setComposerDraft('')
      return
    }
    insertSlashCommand(name)
  }, [dismissSlash, insertSlashCommand, openModelPicker, openThinkingPicker, setComposerDraft])

  const policy = useMemo(() => {
    if (!selectedPiSession || !activeChatSessionId || !serverModelSelectionReady) return undefined
    const policySession = {
      getState: () => {
        const state = selectedPiSession.getState()
        if (localSubmittedSessionRef.current === activeChatSessionId && state.status === 'idle') {
          return { ...state, status: 'submitted' as PiChatStatus }
        }
        return state
      },
      prompt: selectedPiSession.prompt.bind(selectedPiSession),
      followUp: selectedPiSession.followUp.bind(selectedPiSession),
      clearQueue: selectedPiSession.clearQueue.bind(selectedPiSession),
      interrupt: selectedPiSession.interrupt.bind(selectedPiSession),
      stop: selectedPiSession.stop.bind(selectedPiSession),
    }
    return createPiComposerPolicyController({
      session: policySession,
      registry,
      slashContext: {
        sessionId: activeChatSessionId,
        clearMessages: () => addLocalNotice({
          id: 'clear-not-supported',
          level: 'info',
          text: '/clear is not available in this chat panel.',
          dismissible: true,
        }),
        resetSession,
        listCommands: () => registry.list(),
        reloadAgentPlugins: async () => (await reloadAgentPlugins()).message,
        pluginUpdate: { run: runPluginUpdate },
        openModelPicker,
        selectComposerModel,
        openThinkingPicker,
        selectComposerThinking,
      },
      model: selectedModel,
      thinkingLevel: selectedThinking,
      thinkingControl: submitThinkingControl,
      composerBlocked,
      blockerMessage: composerBlockerLabel,
      mentionedFiles: effectiveMentionedFiles,
      getDraft: () => draftRef.current,
      onDraftChange: setComposerDraft,
      allowPromptDuringInitialHydration,
      onPromptSubmitStarted: () => {
        markLocalSubmitted(activeChatSessionId)
      },
      onBeforeSubmit: onBeforeSubmit
        ? async (draft, context) => {
            const result = await onBeforeSubmit(draft, { ...context, sessionId: activeChatSessionId, source: context.source ?? 'composer' })
            return result !== false
          }
        : undefined,
      onCommandResult: (message) => {
        onCommandResult?.(message)
        addLocalNotice({ id: `command:${Date.now()}`, level: 'info', text: message, dismissible: true })
      },
      onWarning: (message) => {
        if (suppressPreSubmitCancelledWarning && message === 'Submit was cancelled before sending.') return
        onComposerWarning?.(message)
        addLocalNotice({ id: `composer-warning:${Date.now()}`, level: 'warning', text: message, dismissible: true })
      },
      onMentionedFilesConsumed: () => {
        clearMentionedFiles()
        onMentionedFilesConsumed?.()
      },
    })
  }, [activeChatSessionId, addLocalNotice, allowPromptDuringInitialHydration, clearMentionedFiles, composerBlocked, composerBlockerLabel, effectiveMentionedFiles, markLocalSubmitted, onBeforeSubmit, onCommandResult, onComposerWarning, onMentionedFilesConsumed, onPromptSubmitStarted, openModelPicker, openThinkingPicker, registry, reloadAgentPlugins, resetSession, runPluginUpdate, selectComposerModel, selectComposerThinking, selectedModel, selectedPiSession, selectedThinking, serverModelSelectionReady, setComposerDraft, submitThinkingControl, suppressPreSubmitCancelledWarning])

  // Turn a rejected send (prompt/follow-up/auto-submit) into the single run-rejected
  // notice, carrying the stable server error code so a host can attach a recovery
  // action for a specific code.
  const surfaceRunRejected = useCallback((error: unknown) => {
    const errorCode = piChatErrorCode(error)
    // Un-dismiss first: if the user dismissed a prior rejection, the id sits in
    // dismissedNoticeIds and would filter out this fresh one — leaving them with no
    // recovery action while the same error condition persists.
    dropLocalNotice(RUN_REJECTED_NOTICE_ID)
    addLocalNotice({
      id: RUN_REJECTED_NOTICE_ID,
      level: 'error',
      text: errorMessage(error, 'Could not send your message.'),
      dismissible: true,
      ...(errorCode ? { errorCode } : {}),
    })
  }, [addLocalNotice, dropLocalNotice])

  const sendComposerMessage = useCallback(async ({ text, files, source = 'composer' }: ComposerSendPayload) => {
    if (!policy) {
      addLocalNotice({ id: 'composer-no-session', level: 'warning', text: 'Create or select a chat session before sending.', dismissible: true })
      return false
    }
    const submittedDraft = text
    const restoreSubmittedDraft = () => {
      if (draftRef.current === '') setComposerDraft(submittedDraft)
    }
    setComposerDraft('', false)
    scrollToBottomRef.current()
    try {
      const result = await policy.submit({ text, files, source })
      if (result.preserveDraft) {
        // Locally blocked (composer blocker, onBeforeSubmit veto): NOT an admit, so
        // leave any prior run-rejected CTA in place — nothing superseded it.
        restoreSubmittedDraft()
        return false
      }
      // Only an ADMITTED server run (prompt/follow-up) supersedes a prior rejection —
      // retract its CTA then. A local slash command (type: 'command', preserveDraft:false)
      // admits no run, so it must leave the recovery CTA in place. (A fresh rejection in
      // the catch below re-renders it because surfaceRunRejected un-dismisses.)
      if (result.type === 'prompt' || result.type === 'followup') {
        dropLocalNotice(RUN_REJECTED_NOTICE_ID)
        if (result.type === 'prompt') effectiveEphemeralSessionCoordinator.clearFailedDraft(activeChatSessionId)
      }
      if (result.type === 'prompt' && activeChatSessionId) {
        onPromptSubmitStarted?.({ sessionId: activeChatSessionId, clientNonce: result.clientNonce })
        if (shouldHoldLocalSubmitted(selectedPiSession, result.cursor)) markLocalSubmitted(activeChatSessionId)
        else clearLocalSubmitted(activeChatSessionId)
      }
      return undefined
    } catch (error) {
      clearLocalSubmitted(activeChatSessionId)
      restoreSubmittedDraft()
      // Single normalization point for rejected sends: surface as one stable
      // notice carrying the server error code so a host can attach a recovery
      // action for a specific code. Swallow the rejection afterwards so the
      // fire-and-forget composer callsite has nothing to leak.
      surfaceRunRejected(error)
      return false
    }
  }, [activeChatSessionId, clearLocalSubmitted, dropLocalNotice, effectiveEphemeralSessionCoordinator, markLocalSubmitted, onPromptSubmitStarted, policy, selectedPiSession, setComposerDraft, surfaceRunRejected])

  const editQueued = useCallback(() => {
    if (!policy) return
    void policy.editQueued().then((result) => {
      if (result.type === 'clear-failed') {
        addLocalNotice({ id: 'edit-queued-clear-failed', level: 'warning', text: result.message, dismissible: true })
      }
    })
  }, [addLocalNotice, policy])

  const stop = useCallback(() => {
    onComposerStop?.()
    clearLocalSubmitted(activeChatSessionId)
    void policy?.stop().catch((error) => {
      addLocalNotice({ id: 'stop-error', level: 'error', text: errorMessage(error, 'Could not stop the chat session.'), dismissible: true })
    })
  }, [activeChatSessionId, addLocalNotice, clearLocalSubmitted, onComposerStop, policy])

  const interrupt = useCallback(() => {
    void policy?.interrupt().catch((error) => {
      addLocalNotice({ id: 'interrupt-error', level: 'error', text: errorMessage(error, 'Could not interrupt the chat session.'), dismissible: true })
    })
  }, [addLocalNotice, policy])

  useEffect(() => {
    setPluginUpdateState(null)
    setCommandNotifyState(null)
    setLocalNotices([])
    setDismissedNoticeIds(new Set())
  }, [activeSessionId])

  useEffect(() => {
    if (!failedEphemeralDraft || failedEphemeralDraft.sessionId !== activeSessionId) return
    // Recovery remains in the request-scoped coordinator. This idempotent
    // projection deliberately works under StrictMode and after pane remounts.
    initialDraftGuard.current.shouldRestore(activeSessionId!, initialDraft)
    if (autoSubmitInitialDraft) initialDraftGuard.current.claimAutoSubmit(activeSessionId!, initialDraft)
    setComposerDraft(failedEphemeralDraft.draft, false)
    setLocalNotices((previous) => [
      ...previous.filter((notice) => notice.id !== RUN_REJECTED_NOTICE_ID),
      {
        id: RUN_REJECTED_NOTICE_ID,
        level: 'error',
        text: failedEphemeralDraft.error.message,
        dismissible: true,
        errorCode: failedEphemeralDraft.error.code,
      },
    ])
    setDismissedNoticeIds((previous) => {
      if (!previous.has(RUN_REJECTED_NOTICE_ID)) return previous
      const next = new Set(previous)
      next.delete(RUN_REJECTED_NOTICE_ID)
      return next
    })
  }, [activeSessionId, autoSubmitInitialDraft, failedEphemeralDraft, initialDraft, setComposerDraft])

  useEffect(() => {
    const currentSessionId = activeSessionId ?? '__none__'
    if (failedEphemeralDraft?.sessionId === activeSessionId) return
    if (initialDraftGuard.current.shouldRestore(currentSessionId, initialDraft) && initialDraft !== undefined) {
      setComposerDraft(initialDraft, initialDraft.length > 0)
      onDraftRestored?.()
    }
  }, [activeSessionId, failedEphemeralDraft?.sessionId, initialDraft, onDraftRestored, setComposerDraft])

  const remoteStatus: PiChatStatus = selectedChatState?.status ?? (sessionsLoading || chatStatePending || selectedSessionPending ? 'hydrating' : 'idle')
  const status: PiChatStatus =
    localSubmittedSessionId === activeSessionId && remoteStatus === 'idle'
      ? 'submitted'
      : remoteStatus
  useEffect(() => {
    if (!localSubmittedSessionId) return
    if (localSubmittedSessionId !== activeSessionId) {
      clearLocalSubmitted()
      return
    }
    if (remoteStatus !== 'idle') clearLocalSubmitted(localSubmittedSessionId)
  }, [activeSessionId, clearLocalSubmitted, localSubmittedSessionId, remoteStatus])
  useEffect(() => {
    const previous = prevStatusRef.current
    statusRef.current = status
    prevStatusRef.current = status
    if (!pendingAutoSubmitSettleRef.current) return
    if (acceptedAutoSubmitSettleRef.current !== pendingAutoSubmitSettleRef.current) return
    if (isPiBusyStatus(status)) return
    if (!isPiBusyStatus(previous) && previous !== 'submitted') return
    settlePendingAutoSubmit()
  }, [settlePendingAutoSubmit, status])

  useEffect(() => {
    if (!autoSubmitInitialDraft || !policy || !activeSessionId || composerBlocked) return
    if (failedEphemeralDraft?.sessionId === activeSessionId) return
    if (!initialDraftGuard.current.claimAutoSubmit(activeSessionId, initialDraft)) return
    pendingAutoSubmitSettleRef.current = activeSessionId
    acceptedAutoSubmitSettleRef.current = undefined
    const submittedDraft = initialDraft ?? ''
    const restoreSubmittedDraft = () => {
      if (draftRef.current === '') setComposerDraft(submittedDraft, submittedDraft.length > 0)
    }
    setComposerDraft('', false)
    void policy.submit({ text: submittedDraft, files: [], source: 'auto-submit' }).then((result) => {
      if (result.preserveDraft) {
        restoreSubmittedDraft()
        settlePendingAutoSubmit(activeSessionId)
        if (result.type === 'blocked' && result.reason === 'composer-blocked') {
          initialDraftGuard.current.releaseAutoSubmit(activeSessionId)
        }
        return
      }
      // Supersede a prior run-rejected CTA only on an admitted run (same rule as the
      // composer path — a local command admits nothing).
      if (result.type === 'prompt' || result.type === 'followup') {
        dropLocalNotice(RUN_REJECTED_NOTICE_ID)
      }
      if (result.type === 'prompt') {
        onPromptSubmitStarted?.({ sessionId: activeSessionId, clientNonce: result.clientNonce })
        if (shouldHoldLocalSubmitted(selectedPiSession, result.cursor)) markLocalSubmitted(activeSessionId)
        else clearLocalSubmitted(activeSessionId)
      }
      acceptedAutoSubmitSettleRef.current = activeSessionId
      onAutoSubmitInitialDraftAccepted?.()
      if (!isPiBusyStatus(statusRef.current) && pendingAutoSubmitSettleRef.current === activeSessionId) {
        settlePendingAutoSubmit(activeSessionId)
      }
    }).catch((error) => {
      clearLocalSubmitted(activeSessionId)
      restoreSubmittedDraft()
      settlePendingAutoSubmit(activeSessionId)
      // Same normalization as the composer path so an auto-submitted run the server
      // rejects (for any reason) surfaces the actionable run-rejected notice instead
      // of an inert generic error.
      surfaceRunRejected(error)
    })
  }, [activeSessionId, autoSubmitInitialDraft, clearLocalSubmitted, composerBlocked, dropLocalNotice, failedEphemeralDraft?.sessionId, initialDraft, markLocalSubmitted, onAutoSubmitInitialDraftAccepted, onPromptSubmitStarted, policy, selectedPiSession, setComposerDraft, settlePendingAutoSubmit, surfaceRunRejected])

  useEffect(() => {
    if (workspaceWarmupStatus?.status === 'ready') {
      clearLocalNotice('workspace-warmup')
    }
  }, [clearLocalNotice, workspaceWarmupStatus?.status])

  const initialHydrationPromptAllowed = Boolean(
    allowPromptDuringInitialHydration
      && selectedChatState
      && selectedChatState.status === 'hydrating'
      && !selectedChatState.hydrated
      && selectedChatState.history.messageCount === 0
      && selectedChatState.committedMessages.length === 0
      && selectedChatState.queue.followUps.length === 0
      && Object.keys(selectedChatState.optimisticOutbox).length === 0
      && !selectedChatState.streamingMessage,
  )
  const noDiscoveredModelAvailable = modelDiscoveryEnabled
    && modelDiscovery.loaded
    && modelDiscovery.availableModels.every((modelOption) => !modelOption.available)
  const modelSelectionBlocked = serverModelSelectionPending || serverModelSelectionUnavailable || noDiscoveredModelAvailable
  const disabled = !policy || sessionsLoading || composerBlocked
  const isStreaming = isPiBusyStatus(status)
  const submitStatus = initialHydrationPromptAllowed ? 'ready' : toPromptSubmitStatus(status)
  const submitDisabled = !policy || sessionsLoading || modelSelectionBlocked || (composerBlocked && !isStreaming)
  const mergedToolRenderers = useMemo(() => mergeShadcnToolRenderers(toolRenderers), [toolRenderers])
  const debugMessages = useMemo(() => messages.map(toDebugUiMessage), [messages])

  const onTextareaChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setModelPickerOpen(false)
    setThinkingPickerOpen(false)
    setDraft(event.currentTarget.value)
    handleComposerChange(event)
  }, [handleComposerChange])

  useEffect(() => {
    if (!isStreaming) return
    setModelPickerOpen(false)
    setThinkingPickerOpen(false)
  }, [isStreaming])

  // Broadcast per-session busy state so shell chrome (e.g. the session
  // browser) can show a "working" indicator without coupling to this panel.
  useEffect(() => {
    if (typeof window === 'undefined' || !activeChatSessionId) return
    window.dispatchEvent(new CustomEvent('boring:chat-session-status', {
      detail: { sessionId: activeChatSessionId, working: isStreaming },
    }))
    // Do not clear on unmount/session switch. A background session can keep
    // running after its panel is no longer selected; clearing here makes the
    // session-list "working" badge disappear while the run is still active.
    // The selected/running panel emits `working: false` when it observes the
    // terminal status, and a later remount of an idle session also reconciles it.
  }, [activeChatSessionId, isStreaming])

  const onTextareaKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && isStreaming) {
      if (event.defaultPrevented || mentionState !== null || slashQuery !== null) {
        handleComposerKeyDown(event)
        return
      }
      event.preventDefault()
      interrupt()
      return
    }
    handleComposerKeyDown(event)
  }, [handleComposerKeyDown, interrupt, isStreaming, mentionState, slashQuery])

  return (
    <ArtifactOpenProvider onOpenArtifact={onOpenArtifact}>
      <div
        data-boring-agent=""
        data-boring-agent-part="chat"
        data-pi-chat-session-id={activeSessionId}
        data-pi-chat-connection={debugState?.connection ?? 'disconnected'}
        data-pi-chat-last-seq={debugState?.lastSeq ?? 0}
        className={cn(
          'flex h-full min-h-0 overflow-hidden text-foreground antialiased',
          debug ? 'flex-row' : showSessionSidebar ? 'flex-row' : 'flex-col',
          chrome ? 'bg-[color:var(--canvas)] text-[13px]' : 'bg-transparent text-[13px]',
          className,
        )}
        role="region"
        aria-label="Agent assistant"
      >
        {showSessionSidebar ? (
          <aside data-boring-agent-part="pi-chat-session-sidebar" className="min-h-0 w-64 shrink-0 border-r border-border/60">
            <SessionList
              sessions={sessionList}
              activeId={activeSessionId}
              loading={sessionsLoading}
              onCreate={createSession}
              onSwitch={sessions.switch}
              onDelete={deleteSession}
              onLoadMore={sessions.loadMore}
              hasMore={sessions.hasMore}
              loadingMore={sessions.loadingMore}
            />
          </aside>
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            className={cn(
              'flex h-full min-h-0 flex-col overflow-hidden',
              emptyHero && 'justify-center',
              chrome &&
                'mx-3 my-3 rounded-xl bg-[color:var(--surface-chat)] shadow-[0_1px_0_oklch(0_0_0/0.02),0_1px_2px_-1px_oklch(0_0_0/0.04),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.6)]',
            )}
          >
            <PiConversationSurface
              chrome={chrome}
              emptyHero={emptyHero}
              messages={messages}
              emptyStateHydrating={emptyStateHydrating}
              emptyState={emptyState}
              suggestions={suggestions}
              isStreaming={isStreaming}
              showThoughts={showThoughts}
              toolRenderers={mergedToolRenderers}
              messageFooterProjection={messageFooterProjection}
              runtimeNotices={runtimeNotices}
              onDismissNotice={clearLocalNotice}
              renderNoticeAction={renderNoticeAction}
              onScrollToBottomReady={(scrollToBottom) => {
                scrollToBottomRef.current = scrollToBottom
              }}
              onSuggestionSubmit={({ text, files, source }) => sendComposerMessage({ text, files, source })}
              onRestoreDraft={setComposerDraft}
              windowResetKey={activeSessionId}
            />

            <PiChatComposerSurface
              chrome={chrome}
              isStreaming={isStreaming}
              status={status}
              disabled={disabled}
              submitStatus={submitStatus}
              submitDisabled={submitDisabled}
              composerBlocked={composerBlocked}
              composerBlockerLabel={composerBlockerLabel}
              composerPlaceholder={composerPlaceholder}
              composerStatusNotice={composerStatusNotice}
              workspaceWarmupBlocked={workspaceWarmupBlocked}
              primaryComposerBlocker={primaryComposerBlocker}
              onComposerBlockerAction={onComposerBlockerAction}
              queuePreview={queuePreview}
              onEditQueued={editQueued}
              hotReloadEnabled={hotReloadEnabled}
              pluginUpdateState={pluginUpdateState}
              onDismissPluginUpdate={dismissPluginUpdate}
              onRunPluginUpdate={runPluginUpdate}
              commandNotifyState={commandNotifyState}
              onDismissCommandNotify={dismissCommandNotify}
              attachmentNotice={attachmentNotice}
              onAttachmentNotice={setAttachmentNotice}
              mentionState={mentionState}
              slashQuery={slashQuery}
              apiBaseUrl={apiBaseUrl}
              fetch={fetch}
              requestHeaders={normalizedRequestHeaders}
              storageScope={storageScope}
              onSelectMention={selectMention}
              onDismissMention={dismissMention}
              commands={allCommands}
              onSelectSlashCommand={selectSlashCommand}
              onDismissSlash={dismissSlash}
              modelPickerOpen={modelPickerOpen}
              selectedModel={selectedModel}
              modelOptions={modelOptions}
              modelControlled={model !== undefined}
              hideDefaultModelOption={hideDefaultModelOption}
              hideComposerSettings={hideComposerSettings}
              onModelChange={modelDiscovery.setModel}
              onSetModelPickerOpen={setModelPickerOpen}
              onOpenModelPicker={openModelPicker}
              thinkingPickerOpen={thinkingPickerOpen}
              selectedThinking={selectedThinking}
              thinkingControl={thinkingControl}
              thinkingControlled={thinkingLevel !== undefined}
              onThinkingChange={setStoredThinkingLevel}
              onSetThinkingPickerOpen={setThinkingPickerOpen}
              onOpenThinkingPicker={openThinkingPicker}
              draft={draft}
              initialFiles={failedEphemeralDraft ? promptInputFilesForAttachments(failedEphemeralDraft.attachments) : undefined}
              initialFilesKey={failedEphemeralDraft?.id}
              textareaRef={textareaRef}
              onTextareaChange={onTextareaChange}
              onTextareaKeyDown={onTextareaKeyDown}
              onSubmitMessage={({ text, files }) => sendComposerMessage({ text, files })}
              onStop={stop}
            />
          </div>
        </div>
        {debug ? (
          <Suspense fallback={null}>
            <div aria-label="Chat debug metadata" className="contents" role="region">
              <DebugDrawer
                apiBaseUrl={apiBaseUrl}
                fetch={fetch}
                sessionId={activeSessionId ?? activeChatSessionId ?? 'unknown'}
                messages={debugMessages}
                requestHeaders={normalizedRequestHeaders}
                storageScope={storageScope}
                width={440}
                onWidthChange={() => {}}
              />
            </div>
          </Suspense>
        ) : null}
      </div>
    </ArtifactOpenProvider>
  )

}
