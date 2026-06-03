"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@hachej/boring-ui-kit'
import { ArtifactOpenProvider } from '../ArtifactOpenContext'
import type { PiChatEvent, PiChatStatus } from '../../shared/chat'
import type { AvailableModel, ModelSelection, ThinkingLevel } from '../chatPanelSettings'
import { DEFAULT_THINKING } from '../chatPanelSettings'
import { cn } from '../lib'
import type { SlashCommand } from '../slashCommands'
import { builtinCommands, createCommandRegistry } from '../slashCommands'
import type { ToolRendererOverrides } from '../bareToolRenderers'
import { ComposerBar, MessageTimeline, RuntimeNotices, type ComposerSendPayload, type RuntimeNotice } from './components'
import { selectMessagesForRender, selectQueuePreview, selectRuntimeNotices } from './pi/selectors'
import type { PiChatState } from './pi/piChatReducer'
import { createRemotePiSession, type RemotePiSession, type RemotePiSessionDebugState, type RemotePiSessionOptions } from './pi/remotePiSession'
import {
  InitialDraftAutoSubmitGuard,
  createPiComposerPolicyController,
  modelOptionsForSelection,
  readPiComposerSettings,
  type ActiveSessionStorageLike,
} from './session'
import { SessionList, usePiSessions, type UsePiSessionsOptions } from './session'

const EMPTY_COMMANDS: SlashCommand[] = []
const EMPTY_BLOCKERS: Array<{ id: string; sessionId?: string; label?: string; reason?: string }> = []

export interface PiChatPanelProps {
  /** Optional externally selected Pi session id. When provided, session navigation is owned by the host. */
  sessionId?: string
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
  initialDraft?: string
  autoSubmitInitialDraft?: boolean
  model?: ModelSelection | null
  availableModels?: AvailableModel[]
  thinkingLevel?: ThinkingLevel
  thinkingControl?: boolean
  mentionedFiles?: string[] | (() => string[])
  commands?: SlashCommand[]
  toolRenderers?: ToolRendererOverrides
  createRemoteSession?: (options: RemotePiSessionOptions) => RemotePiSession
  remoteSessionOptions?: UsePiSessionsOptions['remoteSessionOptions']
  onBeforeSubmit?: (draft: string, context: { files: ComposerSendPayload['files']; source?: 'composer' | 'suggestion' | 'auto-submit' }) => boolean | Promise<boolean>
  onReloadAgentPlugins?: () => Promise<string>
  onCommandResult?: (message: string) => void
  onComposerWarning?: (message: string) => void
  onMentionedFilesConsumed?: () => void
  onData?: (part: unknown) => void
  onOpenArtifact?: (path: string) => void
  composerBlockers?: Array<{ id: string; sessionId?: string; label?: string; reason?: string }>
  onComposerStop?: () => void
}

export function PiChatPanel({
  sessionId,
  apiBaseUrl,
  workspaceId,
  storageScope = 'default',
  requestHeaders,
  storage,
  fetch,
  className,
  chrome = true,
  debug = false,
  showSessions = true,
  initialDraft,
  autoSubmitInitialDraft = false,
  model,
  availableModels,
  thinkingLevel,
  thinkingControl = true,
  mentionedFiles,
  commands = EMPTY_COMMANDS,
  toolRenderers,
  createRemoteSession,
  remoteSessionOptions,
  onBeforeSubmit,
  onReloadAgentPlugins,
  onCommandResult,
  onComposerWarning,
  onMentionedFilesConsumed,
  onData,
  onOpenArtifact,
  composerBlockers = EMPTY_BLOCKERS,
  onComposerStop,
}: PiChatPanelProps) {
  const externalSessionId = sessionId?.trim() || undefined
  const onDataRef = useRef(onData)
  onDataRef.current = onData
  const remoteSessionOptionsWithEvents = useMemo<UsePiSessionsOptions['remoteSessionOptions']>(() => ({
    ...remoteSessionOptions,
    onEvent: (event: PiChatEvent) => {
      remoteSessionOptions?.onEvent?.(event)
      onDataRef.current?.(event)
    },
  }), [remoteSessionOptions])
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
  const externalPiSession = useExternalRemotePiSession({
    sessionId: externalSessionId,
    workspaceId,
    storageScope,
    apiBaseUrl,
    requestHeaders,
    fetch,
    createRemoteSession,
    remoteSessionOptions: remoteSessionOptionsWithEvents,
  })
  const activePiSession = externalSessionId ? externalPiSession : sessions.activePiSession
  const chatState = useRemotePiSessionState(activePiSession)
  const settings = useMemo(() => readPiComposerSettings({ storageScope, storage }), [storage, storageScope])
  const selectedModel = model ?? settings.model
  const selectedThinking = thinkingLevel ?? settings.thinkingLevel ?? DEFAULT_THINKING
  const modelOptions = useMemo(() => modelOptionsForSelection(availableModels ?? [], selectedModel), [availableModels, selectedModel])
  const [draft, setDraft] = useState(() => initialDraft ?? '')
  const draftRef = useRef(draft)
  draftRef.current = draft
  const initialDraftGuard = useRef(new InitialDraftAutoSubmitGuard())
  const [localNotices, setLocalNotices] = useState<RuntimeNotice[]>([])
  const [dismissedNoticeIds, setDismissedNoticeIds] = useState<Set<string>>(() => new Set())
  const [composerFocusSignal, setComposerFocusSignal] = useState(0)

  const registry = useMemo(() => {
    const next = createCommandRegistry(builtinCommands)
    for (const command of commands) next.register(command)
    return next
  }, [commands])

  const activeChatSessionId = chatState?.sessionId
  const activeSessionId = externalSessionId ?? sessions.activeSessionId
  const activeSession = externalSessionId ? undefined : sessions.activeSession
  const sessionList = externalSessionId ? [] : sessions.sessions
  const sessionsLoading = externalSessionId ? false : sessions.loading
  const sessionsError = externalSessionId ? undefined : sessions.error
  const activeBlockers = useMemo(
    () => composerBlockers.filter((blocker) => !blocker.sessionId || blocker.sessionId === activeSessionId),
    [activeSessionId, composerBlockers],
  )
  const messages = chatState ? selectMessagesForRender(chatState) : []
  const queuePreview = chatState ? selectQueuePreview(chatState) : []
  const debugState = activePiSession?.getDebugState()
  const runtimeNotices = useMemo(() => {
    const fromState = chatState ? selectRuntimeNotices(chatState) : []
    const sessionNotice = sessionsError
      ? [{ id: 'session-navigation-error', level: 'error' as const, text: sessionsError.message, dismissible: true }]
      : []
    const blockerNotices = activeBlockers.map((blocker) => ({
      id: `composer-blocker:${blocker.id}`,
      level: 'warning' as const,
      text: blocker.label ?? blocker.reason ?? 'Workspace is not ready for a new message.',
      dismissible: false,
    }))
    const largeStateNotice = debug && debugState?.largeStateWarning
      ? [{
          id: 'large-state-warning',
          level: 'warning' as const,
          text: `Large Pi chat state: ${debugState.largeStateWarning.messageCount} messages, approximately ${debugState.largeStateWarning.approxBytes} bytes.`,
          dismissible: true,
        }]
      : []
    return [...fromState, ...sessionNotice, ...blockerNotices, ...largeStateNotice, ...localNotices].filter((notice) => !dismissedNoticeIds.has(notice.id))
  }, [activeBlockers, chatState, debug, debugState?.largeStateWarning, dismissedNoticeIds, localNotices, sessionsError])

  const addLocalNotice = useCallback((notice: RuntimeNotice) => {
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

  const deleteSession = useCallback((sessionId: string) => {
    if (externalSessionId) return
    void sessions.delete(sessionId).catch((error) => {
      addLocalNotice({ id: `session-delete-error:${sessionId}`, level: 'error', text: errorMessage(error, 'Could not delete the Pi session.'), dismissible: true })
    })
  }, [addLocalNotice, externalSessionId, sessions.delete])

  const resetSession = useCallback(() => {
    const currentSessionId = activeSessionId
    if (!currentSessionId || externalSessionId) return
    void (async () => {
      await sessions.delete(currentSessionId)
      await sessions.create()
    })().catch((error) => {
      addLocalNotice({ id: 'session-reset-error', level: 'error', text: errorMessage(error, 'Could not reset the Pi session.'), dismissible: true })
    })
  }, [activeSessionId, addLocalNotice, externalSessionId, sessions.create, sessions.delete])

  const reloadAgentPlugins = useCallback(async () => {
    if (!onReloadAgentPlugins) return 'Agent plugin reload is not configured.'
    return await onReloadAgentPlugins()
  }, [onReloadAgentPlugins])

  const policy = useMemo(() => {
    if (!activePiSession || !activeChatSessionId) return undefined
    return createPiComposerPolicyController({
      session: activePiSession,
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
      },
      model: selectedModel,
      thinkingLevel: selectedThinking,
      thinkingControl,
      composerBlocked: activeBlockers.length > 0,
      blockerMessage: activeBlockers[0]?.label ?? activeBlockers[0]?.reason,
      mentionedFiles,
      getDraft: () => draftRef.current,
      onDraftChange: setDraft,
      onBeforeSubmit,
      onCommandResult: (message) => {
        onCommandResult?.(message)
        addLocalNotice({ id: `command:${Date.now()}`, level: 'info', text: message, dismissible: true })
      },
      onWarning: (message) => {
        onComposerWarning?.(message)
        addLocalNotice({ id: `composer-warning:${Date.now()}`, level: 'warning', text: message, dismissible: true })
      },
      onMentionedFilesConsumed,
    })
  }, [activeBlockers, activeChatSessionId, activePiSession, addLocalNotice, mentionedFiles, onBeforeSubmit, onCommandResult, onComposerWarning, onMentionedFilesConsumed, registry, reloadAgentPlugins, resetSession, selectedModel, selectedThinking, thinkingControl])

  const sendComposerMessage = useCallback(async ({ text, files }: ComposerSendPayload) => {
    if (!policy) {
      addLocalNotice({ id: 'composer-no-session', level: 'warning', text: 'Create or select a Pi session before sending.', dismissible: true })
      return false
    }
    const result = await policy.submit({ text, files })
    if (!result.preserveDraft) setDraft('')
    setComposerFocusSignal((value) => value + 1)
    return result.preserveDraft ? false : undefined
  }, [addLocalNotice, policy])

  const editQueued = useCallback(() => {
    if (!policy) return
    void policy.editQueued().then((result) => {
      setComposerFocusSignal((value) => value + 1)
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
    setComposerFocusSignal((value) => value + 1)
  }, [activeSessionId])

  useEffect(() => {
    const currentSessionId = activeSessionId ?? '__none__'
    if (initialDraftGuard.current.shouldRestore(currentSessionId, initialDraft) && initialDraft !== undefined) {
      setDraft(initialDraft)
    }
  }, [activeSessionId, initialDraft])

  useEffect(() => {
    if (!autoSubmitInitialDraft || !policy || !activeSessionId) return
    if (!initialDraftGuard.current.claimAutoSubmit(activeSessionId, initialDraft)) return
    void policy.submit({ text: initialDraft ?? '', files: [], source: 'auto-submit' }).then((result) => {
      if (!result.preserveDraft) setDraft('')
    })
  }, [activeSessionId, autoSubmitInitialDraft, initialDraft, policy])

  const status: PiChatStatus = chatState?.status ?? (sessionsLoading ? 'hydrating' : 'idle')
  const disabled = !policy || sessionsLoading || activeBlockers.length > 0
  const panel = (
    <div
      data-boring-agent=""
      data-boring-agent-part="pi-chat-panel"
      data-pi-chat-session-id={activeSessionId}
      data-pi-chat-connection={debugState?.connection ?? 'disconnected'}
      data-pi-chat-last-seq={debugState?.lastSeq ?? 0}
      className={cn('flex h-full min-h-0 overflow-hidden text-foreground', chrome && 'bg-[color:var(--canvas)]', className)}
    >
      {showSessions ? (
        <aside data-boring-agent-part="pi-chat-session-sidebar" className="min-h-0 w-64 shrink-0 border-r border-border/60">
          <SessionList
            sessions={sessionList}
            activeId={activeSessionId}
            loading={sessionsLoading}
            onCreate={createSession}
            onSwitch={sessions.switch}
            onDelete={deleteSession}
          />
        </aside>
      ) : null}
      <section data-boring-agent-part="pi-chat-main" className="flex min-w-0 flex-1 flex-col">
        <div data-boring-agent-part="pi-chat-toolbar" className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
          <div className="min-w-0 truncate">
            {activeSession ? activeSession.title : sessionsLoading ? 'Loading Pi sessions…' : activeSessionId ? `Session ${activeSessionId}` : 'No Pi session selected'}
            {modelOptions.length > 0 && selectedModel ? <span className="ml-2">· {selectedModel.id}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <span data-boring-agent-part="pi-chat-connection-state" role="status" aria-live="polite">{chatState?.connection.state ?? 'disconnected'}</span>
            <Button type="button" variant="ghost" size="sm" onClick={createSession}>New</Button>
          </div>
        </div>
        <RuntimeNotices notices={runtimeNotices} onDismiss={clearLocalNotice} onAction={clearLocalNotice} />
        {debug && debugState ? <PiChatDebugPanel debugState={debugState} /> : null}
        <MessageTimeline messages={messages} queuePreview={queuePreview} toolRenderers={toolRenderers} />
        <ComposerBar
          status={status}
          value={draft}
          onValueChange={setDraft}
          disabled={disabled}
          queuePreview={queuePreview}
          focusSignal={composerFocusSignal}
          onSend={sendComposerMessage}
          onStop={stop}
          onEditQueued={queuePreview.length > 0 ? editQueued : undefined}
          rightControls={policy ? (
            <Button type="button" variant="ghost" size="sm" onClick={interrupt} data-boring-agent-part="pi-chat-interrupt">
              Interrupt
            </Button>
          ) : null}
        />
      </section>
    </div>
  )

  return onOpenArtifact ? <ArtifactOpenProvider onOpenArtifact={onOpenArtifact}>{panel}</ArtifactOpenProvider> : panel
}

function PiChatDebugPanel({ debugState }: { debugState: RemotePiSessionDebugState }) {
  return (
    <pre
      data-boring-agent-part="pi-chat-debug"
      aria-label="Pi chat debug metadata"
      className="max-h-40 overflow-auto border-b border-border/60 bg-muted/35 px-3 py-2 text-[11px] text-muted-foreground"
    >
      {JSON.stringify(debugState, null, 2)}
    </pre>
  )
}

function useExternalRemotePiSession({
  sessionId,
  workspaceId,
  storageScope,
  apiBaseUrl,
  requestHeaders,
  fetch,
  createRemoteSession,
  remoteSessionOptions,
}: {
  sessionId?: string
  workspaceId?: string
  storageScope: string
  apiBaseUrl?: string
  requestHeaders?: Record<string, string | undefined>
  fetch?: typeof globalThis.fetch
  createRemoteSession?: (options: RemotePiSessionOptions) => RemotePiSession
  remoteSessionOptions?: UsePiSessionsOptions['remoteSessionOptions']
}): RemotePiSession | undefined {
  const [session, setSession] = useState<RemotePiSession | undefined>()
  useEffect(() => {
    if (!sessionId) {
      setSession(undefined)
      return
    }
    const next = (createRemoteSession ?? createRemotePiSession)({
      ...remoteSessionOptions,
      sessionId,
      workspaceId,
      storageScope,
      apiBaseUrl,
      headers: requestHeaders,
      fetch,
    })
    setSession(next)
    return () => next.dispose()
  }, [apiBaseUrl, createRemoteSession, fetch, remoteSessionOptions, requestHeaders, sessionId, storageScope, workspaceId])
  return session
}

function useRemotePiSessionState(session: RemotePiSession | undefined): PiChatState | undefined {
  return useSyncExternalStore(
    useCallback((listener) => session?.subscribe(listener) ?? (() => {}), [session]),
    useCallback(() => session?.getState(), [session]),
    useCallback(() => session?.getState(), [session]),
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
