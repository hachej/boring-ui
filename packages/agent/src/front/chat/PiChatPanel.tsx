"use client"

import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileUIPart } from 'ai'
import { ArtifactOpenProvider } from '../ArtifactOpenContext'
import {
  WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT,
  WORKSPACE_COMMAND_NOTIFY_EVENT,
  type CommandNotifyPayload,
} from '../../shared/agentPluginEvents'
import type { PiChatEvent, PiChatStatus } from '../../shared/chat'
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
import type { RemotePiSession, RemotePiSessionOptions } from './pi/remotePiSession'
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
import { PiConversationSurface } from './components/PiConversationSurface'
import { PiChatComposerSurface } from './components/PiChatComposerSurface'
import { useExternalRemotePiSession, useRemotePiSessionState } from './piChatPanelHooks'
import {
  errorMessage,
  headersContentKey,
  isPiBusyStatus,
  normalizedHeadersFromContentKey,
  parseBrowserPluginReloadDetail,
  pluginReloadFailureMessage,
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
const EMPTY_BLOCKERS: Array<{ id: string; sessionId?: string; label?: string; reason?: string }> = []

export type { ComposerBlocker, ComposerBlockerAction, PanelNotice }

export type { ChatPanelRuntimeDependenciesWarmupStatus, ChatPanelWorkspaceWarmupStatus }

export type ChatSubmitSource = 'composer' | 'suggestion' | 'auto-submit'

export interface ChatSubmitContext {
  files: FileUIPart[]
  sessionId: string
  source: ChatSubmitSource
}

interface ComposerSendPayload {
  text: string
  files: FileUIPart[]
  source?: ChatSubmitSource
}

export interface ChatPanelEmptyState {
  eyebrow?: string
  title?: string
  description?: string
}

export interface PiChatPanelProps {
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
  thinkingLevel?: ThinkingLevel
  thinkingControl?: boolean
  serverResourcesEnabled?: boolean
  mentionedFiles?: string[] | (() => string[])
  commands?: SlashCommand[]
  toolRenderers?: ToolRendererOverrides
  createRemoteSession?: (options: RemotePiSessionOptions) => RemotePiSession
  remoteSessionOptions?: UsePiSessionsOptions['remoteSessionOptions']
  hydrateMessages?: boolean
  workspaceWarmupStatus?: ChatPanelWorkspaceWarmupStatus
  onSessionReset?: () => void | Promise<void>
  onBeforeSubmit?: (draft: string, context: ChatSubmitContext) => false | void | boolean | Promise<false | void | boolean>
  onReloadAgentPlugins?: () => Promise<string>
  onCommandResult?: (message: string) => void
  onComposerWarning?: (message: string) => void
  onMentionedFilesConsumed?: () => void
  onData?: (part: unknown) => void
  onOpenArtifact?: (path: string) => void
  composerBlockers?: ComposerBlocker[]
  onComposerStop?: () => void
  onComposerBlockerAction?: (blocker: ComposerBlocker, action: string) => void
}

export function PiChatPanel({
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
  thinkingLevel,
  thinkingControl = true,
  serverResourcesEnabled = true,
  mentionedFiles,
  commands = EMPTY_COMMANDS,
  toolRenderers,
  createRemoteSession,
  remoteSessionOptions,
  hydrateMessages = true,
  workspaceWarmupStatus,
  onSessionReset,
  onBeforeSubmit,
  onReloadAgentPlugins,
  onCommandResult,
  onComposerWarning,
  onMentionedFilesConsumed,
  onData,
  onOpenArtifact,
  composerBlockers = EMPTY_BLOCKERS,
  onComposerStop,
  onComposerBlockerAction,
}: PiChatPanelProps) {
  const externalSessionId = sessionId?.trim() || undefined
  const showSessionSidebar = showSessions ?? externalSessionId === undefined
  const onDataRef = useRef(onData)
  onDataRef.current = onData
  const sessionListRefreshRef = useRef<(() => void) | undefined>(undefined)
  const requestHeadersKey = useMemo(() => headersContentKey(requestHeaders), [requestHeaders])
  const normalizedRequestHeaders = useMemo(() => normalizedHeadersFromContentKey(requestHeadersKey), [requestHeadersKey])
  const remoteSessionOptionsWithEvents = useMemo<UsePiSessionsOptions['remoteSessionOptions']>(() => ({
    ...remoteSessionOptions,
    ...(hydrateMessages ? {} : { autoStart: false }),
    onEvent: (event: PiChatEvent) => {
      remoteSessionOptions?.onEvent?.(event)
      onDataRef.current?.(event)
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
    enabled: externalSessionId === undefined,
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
  const externalPiSession = useExternalRemotePiSession({
    sessionId: externalSessionId,
    workspaceId,
    storageScope,
    apiBaseUrl,
    requestHeaders: normalizedRequestHeaders,
    fetch,
    createRemoteSession,
    remoteSessionOptions: remoteSessionOptionsWithEvents,
  })
  const activePiSession = externalSessionId ? externalPiSession : sessions.activePiSession
  const chatState = useRemotePiSessionState(activePiSession)
  const activeSessionId = externalSessionId ?? sessions.activeSessionId
  const sessionList = externalSessionId ? [] : sessions.sessions
  const sessionsLoading = externalSessionId ? false : sessions.loading
  const sessionsError = externalSessionId ? undefined : sessions.error
  const selectedChatState = activeSessionId && chatState?.sessionId !== activeSessionId ? undefined : chatState
  const selectedPiSession = selectedChatState ? activePiSession : undefined
  const chatStatePending = Boolean(activeSessionId && chatState && chatState.sessionId !== activeSessionId)
  const selectedSessionPending = Boolean(activeSessionId && !selectedChatState)
  const modelDiscovery = useChatModelSelection({
    apiBaseUrl,
    defaultModel,
    fetch,
    requestHeaders: normalizedRequestHeaders,
    storage,
    storageScope,
    enabled: serverResourcesEnabled && availableModels === undefined,
  })
  const selectedModel = model === undefined ? modelDiscovery.model : model
  const modelOptions = useMemo(
    () => modelOptionsForSelection(availableModels ?? modelDiscovery.availableModels, selectedModel),
    [availableModels, modelDiscovery.availableModels, selectedModel],
  )
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
    const effectiveBuiltins = hotReloadEnabled
      ? builtinCommands
      : builtinCommands.filter((command) => command.name !== 'reload')
    const next = createCommandRegistry(effectiveBuiltins)
    for (const command of extraCommands ?? []) next.register(command)
    for (const command of commands) next.register(command)
    return next
  }, [apiBaseUrl, commands, extraCommands, hotReloadEnabled, normalizedRequestHeaders, serverResourcesEnabled, serverSkillsRefreshKey, storageScope])
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
    () => composerBlockers.filter((blocker) => !blocker.sessionId || blocker.sessionId === activeSessionId),
    [activeSessionId, composerBlockers],
  )
  const canonicalMessages = selectedChatState ? selectMessagesForRender(selectedChatState) : []
  const queuePreview = selectedChatState ? selectQueuePreview(selectedChatState) : []
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
          text: `Large Pi chat state: ${debugState.largeStateWarning.messageCount} messages, approximately ${debugState.largeStateWarning.approxBytes} bytes.`,
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
    setDismissedNoticeIds((previous) => new Set(previous).add(id))
    setLocalNotices((previous) => previous.filter((notice) => notice.id !== id))
  }, [])

  const createSession = useCallback(() => {
    if (externalSessionId) return
    void sessions.create().catch((error) => {
      addLocalNotice({ id: 'session-create-error', level: 'error', text: errorMessage(error, 'Could not create a Pi session.'), dismissible: true })
    })
  }, [addLocalNotice, externalSessionId, sessions.create])

  useEffect(() => {
    if (externalSessionId || sessionsLoading || sessionsError || activeSessionId || sessionList.length > 0) return
    if (resetInProgressRef.current) return
    if (autoCreateInFlightRef.current) return
    autoCreateInFlightRef.current = true
    void sessions.create().catch((error) => {
      autoCreateInFlightRef.current = false
      addLocalNotice({ id: 'session-auto-create-error', level: 'error', text: errorMessage(error, 'Could not create a Pi session.'), dismissible: true })
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
      addLocalNotice({ id: `session-delete-error:${sessionId}`, level: 'error', text: errorMessage(error, 'Could not delete the Pi session.'), dismissible: true })
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
      addLocalNotice({ id: 'session-reset-error', level: 'error', text: errorMessage(error, 'Could not reset the Pi session.'), dismissible: true })
    }).finally(() => {
      resetInProgressRef.current = false
    })
  }, [activeSessionId, addLocalNotice, externalSessionId, onSessionReset, sessions.create, sessions.delete])

  const reloadAgentPlugins = useCallback(async () => {
    if (!onReloadAgentPlugins) throw new Error('Agent plugin reload is not configured.')
    return await onReloadAgentPlugins()
  }, [onReloadAgentPlugins])

  const runPluginUpdate = useCallback(async () => {
    setPluginUpdateState({ kind: 'running' })
    try {
      const message = await reloadAgentPlugins()
      const failureMessage = pluginReloadFailureMessage(message)
      if (failureMessage) {
        setPluginUpdateState({ kind: 'error', message: failureMessage })
        return `Plugin update failed: ${failureMessage}`
      }
      setPluginUpdateState({ kind: 'success', reloaded: !/will reload on the next message/i.test(message) })
      setServerSkillsRefreshKey((key) => key + 1)
      return message
    } catch (error) {
      const message = errorMessage(error, 'Agent plugin reload failed.')
      setPluginUpdateState({ kind: 'error', message })
      return `Plugin update failed: ${message}`
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
    if (!selectedPiSession || !activeChatSessionId) return undefined
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
          text: '/clear is not available in the Pi-native chat panel.',
          dismissible: true,
        }),
        resetSession,
        listCommands: () => registry.list(),
        reloadAgentPlugins,
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
        onComposerWarning?.(message)
        addLocalNotice({ id: `composer-warning:${Date.now()}`, level: 'warning', text: message, dismissible: true })
      },
      onMentionedFilesConsumed: () => {
        clearMentionedFiles()
        onMentionedFilesConsumed?.()
      },
    })
  }, [activeChatSessionId, addLocalNotice, clearMentionedFiles, composerBlocked, composerBlockerLabel, effectiveMentionedFiles, markLocalSubmitted, onBeforeSubmit, onCommandResult, onComposerWarning, onMentionedFilesConsumed, openModelPicker, openThinkingPicker, registry, reloadAgentPlugins, resetSession, runPluginUpdate, selectComposerModel, selectComposerThinking, selectedModel, selectedPiSession, selectedThinking, setComposerDraft, submitThinkingControl])

  const sendComposerMessage = useCallback(async ({ text, files, source = 'composer' }: ComposerSendPayload) => {
    if (!policy) {
      addLocalNotice({ id: 'composer-no-session', level: 'warning', text: 'Create or select a Pi session before sending.', dismissible: true })
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
        restoreSubmittedDraft()
        return false
      }
      if (result.type === 'prompt' && activeChatSessionId) {
        if (shouldHoldLocalSubmitted(selectedPiSession, result.cursor)) markLocalSubmitted(activeChatSessionId)
        else clearLocalSubmitted(activeChatSessionId)
      }
      return undefined
    } catch (error) {
      clearLocalSubmitted(activeChatSessionId)
      restoreSubmittedDraft()
      throw error
    }
  }, [activeChatSessionId, addLocalNotice, clearLocalSubmitted, markLocalSubmitted, policy, selectedPiSession, setComposerDraft])

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
    void policy?.stop().catch((error) => {
      addLocalNotice({ id: 'stop-error', level: 'error', text: errorMessage(error, 'Could not stop the Pi session.'), dismissible: true })
    })
  }, [addLocalNotice, onComposerStop, policy])

  const interrupt = useCallback(() => {
    void policy?.interrupt().catch((error) => {
      addLocalNotice({ id: 'interrupt-error', level: 'error', text: errorMessage(error, 'Could not interrupt the Pi session.'), dismissible: true })
    })
  }, [addLocalNotice, policy])

  useEffect(() => {
    setPluginUpdateState(null)
    setCommandNotifyState(null)
    setLocalNotices([])
    setDismissedNoticeIds(new Set())
  }, [activeSessionId])

  useEffect(() => {
    const currentSessionId = activeSessionId ?? '__none__'
    if (initialDraftGuard.current.shouldRestore(currentSessionId, initialDraft) && initialDraft !== undefined) {
      setComposerDraft(initialDraft, initialDraft.length > 0)
      onDraftRestored?.()
    }
  }, [activeSessionId, initialDraft, onDraftRestored, setComposerDraft])

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
      if (result.type === 'prompt') {
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
      addLocalNotice({ id: 'auto-submit-error', level: 'error', text: errorMessage(error, 'Could not auto-submit the initial draft.'), dismissible: true })
    })
  }, [activeSessionId, addLocalNotice, autoSubmitInitialDraft, clearLocalSubmitted, composerBlocked, initialDraft, markLocalSubmitted, onAutoSubmitInitialDraftAccepted, policy, selectedPiSession, setComposerDraft, settlePendingAutoSubmit])

  useEffect(() => {
    if (workspaceWarmupStatus?.status === 'ready') {
      clearLocalNotice('workspace-warmup')
    }
  }, [clearLocalNotice, workspaceWarmupStatus?.status])

  const disabled = !policy || sessionsLoading || composerBlocked
  const isStreaming = isPiBusyStatus(status)
  const submitStatus = toPromptSubmitStatus(status)
  const submitDisabled = !policy || sessionsLoading || (composerBlocked && !isStreaming)
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
    if (!isStreaming) return
    const sessionId = activeChatSessionId
    return () => {
      // Pane unmounted (or session switched) mid-stream: clear the signal
      // rather than leaving a stale "working" badge behind.
      window.dispatchEvent(new CustomEvent('boring:chat-session-status', {
        detail: { sessionId, working: false },
      }))
    }
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
              runtimeNotices={runtimeNotices}
              onDismissNotice={clearLocalNotice}
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
            <div aria-label="Pi chat debug metadata" className="contents" role="region">
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
