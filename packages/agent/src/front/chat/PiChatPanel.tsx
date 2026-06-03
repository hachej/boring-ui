"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@hachej/boring-ui-kit'
import type { PiChatStatus } from '../../shared/chat'
import type { AvailableModel, ModelSelection, ThinkingLevel } from '../chatPanelSettings'
import { DEFAULT_THINKING } from '../chatPanelSettings'
import { cn } from '../lib'
import type { SlashCommand } from '../slashCommands'
import { builtinCommands, createCommandRegistry } from '../slashCommands'
import type { ToolRendererOverrides } from '../bareToolRenderers'
import { ComposerBar, MessageTimeline, RuntimeNotices, type ComposerSendPayload, type RuntimeNotice } from './components'
import { selectMessagesForRender, selectQueuePreview, selectRuntimeNotices } from './pi/selectors'
import type { PiChatState } from './pi/piChatReducer'
import type { RemotePiSession, RemotePiSessionOptions } from './pi/remotePiSession'
import {
  InitialDraftAutoSubmitGuard,
  createPiComposerPolicyController,
  modelOptionsForSelection,
  readPiComposerSettings,
  type ActiveSessionStorageLike,
} from './session'
import { SessionList, usePiSessions, type UsePiSessionsOptions } from './session'

const EMPTY_COMMANDS: SlashCommand[] = []

export interface PiChatPanelProps {
  apiBaseUrl?: string
  workspaceId?: string
  storageScope?: string
  requestHeaders?: Record<string, string | undefined>
  storage?: ActiveSessionStorageLike
  fetch?: typeof globalThis.fetch
  className?: string
  chrome?: boolean
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
}

export function PiChatPanel({
  apiBaseUrl,
  workspaceId,
  storageScope = 'default',
  requestHeaders,
  storage,
  fetch,
  className,
  chrome = true,
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
}: PiChatPanelProps) {
  const sessions = usePiSessions({
    apiBaseUrl,
    workspaceId,
    storageScope,
    requestHeaders,
    storage,
    fetch,
    createRemoteSession,
    remoteSessionOptions,
  })
  const activePiSession = sessions.activePiSession
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

  const registry = useMemo(() => {
    const next = createCommandRegistry(builtinCommands)
    for (const command of commands) next.register(command)
    return next
  }, [commands])

  const activeChatSessionId = chatState?.sessionId
  const messages = chatState ? selectMessagesForRender(chatState) : []
  const queuePreview = chatState ? selectQueuePreview(chatState) : []
  const runtimeNotices = useMemo(() => {
    const fromState = chatState ? selectRuntimeNotices(chatState) : []
    const sessionNotice = sessions.error
      ? [{ id: 'session-navigation-error', level: 'error' as const, text: sessions.error.message, dismissible: true }]
      : []
    return [...fromState, ...sessionNotice, ...localNotices].filter((notice) => !dismissedNoticeIds.has(notice.id))
  }, [chatState, dismissedNoticeIds, localNotices, sessions.error])

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
    void sessions.create().catch((error) => {
      addLocalNotice({ id: 'session-create-error', level: 'error', text: errorMessage(error, 'Could not create a Pi session.'), dismissible: true })
    })
  }, [addLocalNotice, sessions.create])

  const deleteSession = useCallback((sessionId: string) => {
    void sessions.delete(sessionId).catch((error) => {
      addLocalNotice({ id: `session-delete-error:${sessionId}`, level: 'error', text: errorMessage(error, 'Could not delete the Pi session.'), dismissible: true })
    })
  }, [addLocalNotice, sessions.delete])

  const resetSession = useCallback(() => {
    const sessionId = sessions.activeSessionId
    if (!sessionId) return
    void (async () => {
      await sessions.delete(sessionId)
      await sessions.create()
    })().catch((error) => {
      addLocalNotice({ id: 'session-reset-error', level: 'error', text: errorMessage(error, 'Could not reset the Pi session.'), dismissible: true })
    })
  }, [addLocalNotice, sessions.activeSessionId, sessions.create, sessions.delete])

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
  }, [activeChatSessionId, activePiSession, addLocalNotice, mentionedFiles, onBeforeSubmit, onCommandResult, onComposerWarning, onMentionedFilesConsumed, registry, reloadAgentPlugins, resetSession, selectedModel, selectedThinking, thinkingControl])

  const sendComposerMessage = useCallback(async ({ text, files }: ComposerSendPayload) => {
    if (!policy) {
      addLocalNotice({ id: 'composer-no-session', level: 'warning', text: 'Create or select a Pi session before sending.', dismissible: true })
      return false
    }
    const result = await policy.submit({ text, files })
    if (!result.preserveDraft) setDraft('')
    return result.preserveDraft ? false : undefined
  }, [addLocalNotice, policy])

  const editQueued = useCallback(() => {
    if (!policy) return
    void policy.editQueued().then((result) => {
      if (result.type === 'clear-failed') {
        addLocalNotice({ id: 'edit-queued-clear-failed', level: 'warning', text: result.message, dismissible: true })
      }
    })
  }, [addLocalNotice, policy])

  const stop = useCallback(() => {
    void policy?.stop().catch((error) => {
      addLocalNotice({ id: 'stop-error', level: 'error', text: errorMessage(error, 'Could not stop the Pi session.'), dismissible: true })
    })
  }, [addLocalNotice, policy])

  const interrupt = useCallback(() => {
    void policy?.interrupt().catch((error) => {
      addLocalNotice({ id: 'interrupt-error', level: 'error', text: errorMessage(error, 'Could not interrupt the Pi session.'), dismissible: true })
    })
  }, [addLocalNotice, policy])

  useEffect(() => {
    const sessionId = sessions.activeSessionId ?? '__none__'
    if (initialDraftGuard.current.shouldRestore(sessionId, initialDraft) && initialDraft !== undefined) {
      setDraft(initialDraft)
    }
  }, [initialDraft, sessions.activeSessionId])

  useEffect(() => {
    if (!autoSubmitInitialDraft || !policy || !sessions.activeSessionId) return
    if (!initialDraftGuard.current.claimAutoSubmit(sessions.activeSessionId, initialDraft)) return
    void policy.submit({ text: initialDraft ?? '', files: [], source: 'auto-submit' }).then((result) => {
      if (!result.preserveDraft) setDraft('')
    })
  }, [autoSubmitInitialDraft, initialDraft, policy, sessions.activeSessionId])

  const status: PiChatStatus = chatState?.status ?? (sessions.loading ? 'hydrating' : 'idle')
  const disabled = !policy || sessions.loading
  return (
    <div
      data-boring-agent=""
      data-boring-agent-part="pi-chat-panel"
      data-pi-chat-session-id={sessions.activeSessionId}
      className={cn('flex h-full min-h-0 overflow-hidden text-foreground', chrome && 'bg-[color:var(--canvas)]', className)}
    >
      {showSessions ? (
        <aside data-boring-agent-part="pi-chat-session-sidebar" className="min-h-0 w-64 shrink-0 border-r border-border/60">
          <SessionList
            sessions={sessions.sessions}
            activeId={sessions.activeSessionId}
            loading={sessions.loading}
            onCreate={createSession}
            onSwitch={sessions.switch}
            onDelete={deleteSession}
          />
        </aside>
      ) : null}
      <section data-boring-agent-part="pi-chat-main" className="flex min-w-0 flex-1 flex-col">
        <div data-boring-agent-part="pi-chat-toolbar" className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
          <div className="min-w-0 truncate">
            {sessions.activeSession ? sessions.activeSession.title : sessions.loading ? 'Loading Pi sessions…' : 'No Pi session selected'}
            {modelOptions.length > 0 && selectedModel ? <span className="ml-2">· {selectedModel.id}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            <span data-boring-agent-part="pi-chat-connection-state">{chatState?.connection.state ?? 'disconnected'}</span>
            <Button type="button" variant="ghost" size="sm" onClick={createSession}>New</Button>
          </div>
        </div>
        <RuntimeNotices notices={runtimeNotices} onDismiss={clearLocalNotice} onAction={clearLocalNotice} />
        <MessageTimeline messages={messages} queuePreview={queuePreview} toolRenderers={toolRenderers} />
        <ComposerBar
          status={status}
          value={draft}
          onValueChange={setDraft}
          disabled={disabled}
          queuePreview={queuePreview}
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
