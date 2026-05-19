import type { FileUIPart, UIMessage } from 'ai'
import { isToolUIPart } from 'ai'
import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from '../shared/agentPluginEvents'

import { MentionPicker } from './primitives/mention-picker'
import { SlashCommandPicker } from './primitives/slash-command-picker'
import { useAgentChat } from './hooks/useAgentChat'
import { usePiChatProjection } from './pi/piChatProjection'
import { usePiNativeFollowUpQueue } from './pi/piNativeFollowUpQueue'
import { PI_AGENT_RUNTIME_CAPABILITIES } from '../shared/capabilities'
import { builtinCommands } from './slashCommands/builtins'
import { parseSlashCommand } from './slashCommands/parser'
import { createCommandRegistry, type SlashCommand, type SlashCommandContext } from './slashCommands/registry'
import { PluginUpdateStatus, type PluginUpdateState } from './composer/PluginUpdateStatus'
import {
  type ToolRendererOverrides,
} from './bareToolRenderers'
import { ToolCallGroup, type GroupedToolEntry } from './primitives/tool-call-group'
import { mergeShadcnToolRenderers } from './toolRenderers'
import { ArtifactOpenProvider, type OpenArtifactHandler } from './ArtifactOpenContext'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './primitives/conversation'
import { ChatEmptyState, defaultChatSuggestions, type ChatSuggestion } from './ChatEmptyState'
import { Message, MessageContent, MessageResponse } from './primitives/message'
import { Reasoning, ReasoningTrigger, ReasoningContent } from './primitives/reasoning'
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  usePromptInputAttachments,
} from './primitives/prompt-input'
import {
  Attachments,
  Attachment,
  AttachmentPreview,
  AttachmentInfo,
  AttachmentRemove,
} from './primitives/attachments'
import { PaperclipIcon, CopyIcon, CheckIcon, RefreshCwIcon, Loader2, AlertCircleIcon } from 'lucide-react'
import {
  Button,
  IconButton,
} from '@hachej/boring-ui-kit'
import { cn } from './lib'
import { friendlyError } from './chatErrors'
import { getReasoningPart, isBlankTextPart, isFilePart, isTextPart, type ReasoningPartView } from './chatMessageParts'
import { useComposerHistory } from './useComposerHistory'
import { useComposerPickers } from './useComposerPickers'
import { createEnrichedSubmitPayload } from './chatSubmit'
import { useChatModelSelection } from './hooks/useChatModelSelection'
import { useServerSkills } from './hooks/useServerSkills'
import { useThinkingSettings } from './hooks/useThinkingSettings'
import { useAttachmentNotice } from './hooks/useAttachmentNotice'
import {
  modelPayload,
  type ModelSelection,
  type ThinkingLevel,
} from './chatPanelSettings'
import {
  composerActionClass,
  ModelSelect,
  ThinkingSelect,
  ThoughtVisibilityButton,
} from './chatPanelComposerControls'
import { KbdHints } from './chatPanelKbdHints'

export type { ModelSelection, ThinkingLevel } from './chatPanelSettings'

export type ComposerBlockerAction = {
  id: string
  label: string
}

export type ComposerBlocker = {
  id: string
  reason: string
  label?: string
  sessionId?: string
  actions?: ComposerBlockerAction[]
}

export interface ChatPanelProps {
  sessionId: string
  toolRenderers?: ToolRendererOverrides
  extraCommands?: SlashCommand[]
  /**
   * App-level hot-reload toggle. When `false`, the `/reload` slash
   * command is hidden from the picker and the `/help` listing, and the
   * PluginUpdateStatus banner above the composer never renders.
   * Production apps that don't expose live plugin editing should pass
   * `false`. Defaults to `true`.
   */
  hotReloadEnabled?: boolean
  onSessionReset?: () => void | Promise<void>
  /**
   * Render flush, without the outer canvas tint or the inner mx/my rounded
   * card chrome. Use when embedding ChatPanel inside a parent that already
   * provides its own card surface (e.g. workspace's ChatCenteredShell).
   * Defaults to `true` (standalone chrome on).
   */
  chrome?: boolean
  /**
   * Cards shown when the conversation is empty. Click → sendMessage with the
   * suggestion's `prompt` (or `label` as fallback). Pass `[]` to hide the
   * grid; omit to inherit `defaultChatSuggestions`. Customizable per child
   * app — e.g. a data-app might offer "Build a chart from a CSV" instead.
   */
  suggestions?: ChatSuggestion[]
  /** Custom empty-state text. Omit to use defaults. */
  emptyState?: { eyebrow?: string; title?: string; description?: string }
  /**
   * Render the extended-thinking selector in the composer footer (off / low
   * / medium / high). When enabled, the selected level is persisted in
   * localStorage and sent through to the agent on every turn. Default off
   * — opt-in because not every host wants users tweaking model knobs, and
   * thinking budget consumes more tokens.
   */
  thinkingControl?: boolean
  /**
   * Model selected before any local user choice exists. Usually supplied by
   * the host's /api/v1/agent/models payload, so deployment env can choose
   * the default without rebuilding consumers.
   */
  defaultModel?: ModelSelection
  /**
   * Tap into the SSE data stream. Called for every `onData` part the
   * agent emits — host apps use this to bridge agent-driven file
   * changes into their own UI plumbing (see
   * `useAgentFileChangeBridge` in `@hachej/boring-workspace` for the
   * canonical wire-up).
   */
  onData?: (part: unknown) => void
  /** Headers sent with chat and chat-history requests. */
  requestHeaders?: Record<string, string>
  /**
   * Called with a file path when the user clicks the path label inside
   * a read / write / edit tool card. Hosts (e.g. @hachej/boring-workspace)
   * supply this to open the file in the surrounding workbench. Without
   * it the path renders as plain text. Mounted via context so any
   * future renderer can consume it without a prop drill.
   */
  onOpenArtifact?: OpenArtifactHandler
  /** Generic host-provided blockers that prevent starting a new user turn. */
  composerBlockers?: ComposerBlocker[]
  /** Called when the user presses Stop in the composer. */
  onComposerStop?: () => void
  onComposerBlockerAction?: (blocker: ComposerBlocker, action: string) => void
  className?: string
}

export function ChatPanel(props: ChatPanelProps) {
  const {
    sessionId,
    toolRenderers,
    extraCommands,
    hotReloadEnabled = true,
    onSessionReset,
    className,
    chrome = true,
    suggestions = defaultChatSuggestions,
    emptyState,
    thinkingControl = false,
    defaultModel,
    onData,
    requestHeaders,
    onOpenArtifact,
    composerBlockers = [],
    onComposerStop,
    onComposerBlockerAction,
  } = props
  const capabilities = PI_AGENT_RUNTIME_CAPABILITIES
  const piDataHandlerRef = useRef<(part: unknown) => void>(() => {})
  const followUpDataHandlerRef = useRef<(part: unknown) => void>(() => {})

  const {
    messages, sendMessage, setMessages, status, error, stop, clearError,
  } = useAgentChat({
    sessionId,
    onData: (part) => {
      piDataHandlerRef.current(part)
      followUpDataHandlerRef.current(part)
      onData?.(part)
    },
    requestHeaders,
    persistMessages: capabilities.aiSdkOwnsHistory,
  })

  const { piMessages, handleData: handlePiData } = usePiChatProjection({
    messages,
    status,
    sessionId,
    requestHeaders,
  })
  useEffect(() => {
    piDataHandlerRef.current = handlePiData
  }, [handlePiData])

  const {
    pendingMessages,
    projectedTailMessages,
    projectedStatusById,
    queueFollowUp,
    handleData: handleFollowUpData,
    stopAndClearFollowUps,
  } = usePiNativeFollowUpQueue({
    sessionId,
    status,
    requestHeaders,
    stop,
  })
  useEffect(() => {
    followUpDataHandlerRef.current = handleFollowUpData
  }, [handleFollowUpData])

  const mergedToolRenderers = mergeShadcnToolRenderers(toolRenderers)
  const composerBlocked = composerBlockers.length > 0
  const primaryComposerBlocker = composerBlockers[0]
  const composerBlockerLabel = primaryComposerBlocker?.label ?? 'Complete the pending workspace action to continue.'

  const registry = useMemo(
    () => {
      // When hot reload is disabled at the app level, hide /reload from
      // every consumer (picker, /help, programmatic list) by not
      // registering it in the first place.
      const effectiveBuiltins = hotReloadEnabled
        ? builtinCommands
        : builtinCommands.filter((cmd) => cmd.name !== 'reload')
      return createCommandRegistry([...effectiveBuiltins, ...(extraCommands ?? [])])
    },
    [extraCommands, hotReloadEnabled],
  )
  const skillsStamp = useServerSkills({ registry, requestHeaders })
  const allCommands = useMemo(() => registry.list(), [registry, skillsStamp])

  const { availableModels, model, setModel } = useChatModelSelection({
    defaultModel,
    requestHeaders,
  })
  const { thinkingLevel, setThinkingLevel, showThoughts, setShowThoughts } =
    useThinkingSettings(thinkingControl)
  const { attachmentNotice, setAttachmentNotice } = useAttachmentNotice()

  // Low-level reload call. /reload uses the banner UX via
  // runPluginUpdate when the host has wired it, otherwise falls back
  // to reloadAgentPlugins below for inline-text feedback.
  const callPluginReload = useCallback(async (): Promise<{ reloaded: boolean }> => {
    const res = await fetch('/api/v1/agent/reload', {
      method: 'POST',
      headers: { ...(requestHeaders ?? {}), 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(payload.error || `reload failed (${res.status})`)
    }
    const payload = await res.json().catch(() => ({})) as { reloaded?: boolean }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: payload }))
    }
    return { reloaded: Boolean(payload.reloaded) }
  }, [requestHeaders, sessionId])

  const reloadAgentPlugins = useCallback(async () => {
    try {
      const { reloaded } = await callPluginReload()
      return reloaded ? 'Agent plugins reloaded.' : 'Agent plugins will reload on the next message.'
    } catch (err) {
      return err instanceof Error ? err.message : 'Agent plugin reload failed.'
    }
  }, [callPluginReload])

  // Plugin update status banner (above the composer). Driven by the
  // `/reload` slash command when the host wires `pluginUpdate`.
  // `running` while in-flight, then `success` or `error` with details.
  const [pluginUpdateState, setPluginUpdateState] = useState<PluginUpdateState | null>(null)
  // Clear the banner synchronously on `sessionId` swap. The ref carries
  // the live session value across async boundaries so an in-flight
  // /reload started under a previous session can't race-write its
  // success/error into the new one.
  const activeSessionRef = useRef(sessionId)
  useEffect(() => {
    activeSessionRef.current = sessionId
    setPluginUpdateState(null)
  }, [sessionId])
  const runPluginUpdate = useCallback(async () => {
    const capturedSession = activeSessionRef.current
    setPluginUpdateState({ kind: 'running' })
    try {
      const { reloaded } = await callPluginReload()
      if (activeSessionRef.current !== capturedSession) return 'Plugins updated.'
      setPluginUpdateState({ kind: 'success', reloaded })
      return reloaded ? 'Plugins updated.' : 'Plugins will reload on the next message.'
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Plugin update failed.'
      if (activeSessionRef.current !== capturedSession) return `Plugin update failed: ${message}`
      setPluginUpdateState({ kind: 'error', message })
      return `Plugin update failed: ${message}`
    }
  }, [callPluginReload])
  const dismissPluginUpdate = useCallback(() => setPluginUpdateState(null), [])


  const isStreaming = status === 'submitted' || status === 'streaming'
  const attachmentsDisabled = isStreaming || pendingMessages.length > 0

  const displayMessages = useMemo(() => {
    const waitingTail = projectedTailMessages.filter((message) => projectedStatusById.get(message.id) === 'queued')
    return piMessages.length > 0
      ? [...piMessages, ...waitingTail]
      : [...messages, ...projectedTailMessages]
  }, [messages, piMessages, projectedTailMessages, projectedStatusById])

  // Stop button: cancels stream, clears the queued follow-up, and lets host UI
  // cancel any host-level blocker that is waiting for user attention.
  const handleStop = useCallback(() => {
    onComposerStop?.()
    stopAndClearFollowUps()
  }, [onComposerStop, stopAndClearFollowUps])

  // Escape: interrupts the stream but keeps the queued message — it auto-sends next.
  // Same behaviour as pi's keyboard interrupt: "stop this, do my follow-up instead."
  const handleInterrupt = useCallback(() => {
    stop()
  }, [stop])

  // Wire Escape to interrupt (not full stop) so the queue survives.
  // Guard: skip if focus is inside an input/textarea so Escape can still clear those.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isStreaming) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      handleInterrupt()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isStreaming, handleInterrupt])

  // Compose-history navigation (↑/↓ like a terminal)
  const userHistory = useMemo(() =>
    messages
      .filter((m) => m.role === 'user')
      .map((m) => m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n').trim())
      .filter(Boolean),
    [messages],
  )
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const {
    mentionState,
    slashQuery,
    mentionedFiles,
    clearMentionedFiles,
    dismissMention,
    dismissSlash,
    handleComposerChange,
    selectMention,
    selectSlashCommand,
  } = useComposerPickers({ textareaRef })

  const handleComposerKeyDown = useComposerHistory({
    userHistory,
    textareaRef,
    disabled: mentionState !== null || slashQuery !== null,
  })

  async function handleSubmit({ text, files }: { text: string; files: FileUIPart[] }): Promise<void> {
    // Guard against pointless empty submits (just Enter with nothing typed
    // and no attachment). The server schema requires message.length >= 1,
    // so an empty POST returns 400 — we catch it here and keep the
    // composer in place with focus for the user to type.
    if (composerBlocked) return
    const trimmed = text.trim()
    if (trimmed.length === 0 && (!files || files.length === 0)) {
      return
    }

    const parsed = parseSlashCommand(text)
    if (parsed) {
      const cmd = registry.get(parsed.name)
      if (cmd?.kind === 'skill') {
        const skillMessage = parsed.args
          ? `skill: ${parsed.name}\n\n${parsed.args}`
          : `skill: ${parsed.name}`
        void sendMessage(
          { text, files },
          { body: { sessionId, message: skillMessage, ...modelPayload(model), attachments: [] } },
        )
        return
      }
      if (cmd) {
        const ctx: SlashCommandContext = {
          sessionId,
          clearMessages: () => setMessages([]),
          resetSession: () => {
            setMessages([])
            fetch(
              `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}`,
              requestHeaders
                ? { method: 'DELETE', headers: requestHeaders }
                : { method: 'DELETE' },
            ).catch(() => {})
            void onSessionReset?.()
          },
          listCommands: () => registry.list(),
          reloadAgentPlugins,
          pluginUpdate: { run: runPluginUpdate },
        }
        const result = await Promise.resolve(cmd.handler(parsed.args, ctx))
        if (typeof result === 'string') {
          setMessages((prev) => [
            ...prev,
            {
              id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
              role: 'assistant' as const,
              content: result,
              parts: [{ type: 'text' as const, text: result }],
            },
          ])
        }
        return
      }
    }

    const { serverMessage, attachments: resolvedAttachments } = await createEnrichedSubmitPayload({
      text,
      files: files ?? [],
      mentionedFiles,
    })
    clearMentionedFiles()

    // Queue the message if the agent is currently streaming. The server-side
    // harness will consume this after agent_end and run the follow-up as the
    // next pi turn in the same HTTP stream. This avoids a second AI SDK
    // sendMessage() call while the previous assistant message is still last in
    // client state — that was the source of duplicated assistant text.
    if (isStreaming && files.length > 0) {
      setAttachmentNotice('Attachments can be sent after the current response finishes.')
      throw new Error('attachments_disabled_while_streaming')
    }

    if (isStreaming && capabilities.nativeFollowUp) {
      queueFollowUp({
        text,
        files: files ?? [],
        serverMessage,
        attachments: resolvedAttachments,
      })
      return
    }

    // Fire-and-forget the send so handleSubmit returns as soon as the
    // payload is built. PromptInput clears attachments + text only after
    // the onSubmit Promise resolves — if we awaited `sendMessage`, the
    // composer chips would linger for the entire duration of the server
    // stream. The send still runs (and errors still surface via useChat's
    // `error` state rendered above).
    void sendMessage(
      {
        // Rendered bubble: unchanged user text + file chips via files parts.
        text,
        files,
      },
      {
        body: {
          sessionId,
          // Payload actually sent to the agent (inlined text attachments).
          message: serverMessage,
          ...modelPayload(model),
          // Only forward thinkingLevel when the host opted in. The server
          // schema treats it as optional; omitting it keeps the existing
          // 'off' default behaviour for hosts that don't expose the toggle.
          ...(thinkingControl ? { thinkingLevel } : {}),
          attachments: resolvedAttachments,
        },
      },
    )
  }

  return (
    <ArtifactOpenProvider onOpenArtifact={onOpenArtifact}>
    <div
      data-boring-agent=""
      data-boring-agent-part="chat"
      className={cn(
        "flex h-full min-h-0 overflow-hidden text-foreground antialiased",
        "flex-col",
        chrome
          ? "bg-[color:var(--canvas)] text-[13px]"
          : "bg-transparent text-[13px]",
        className,
      )}
      role="region"
      aria-label="Agent assistant"
    >
      <div className="flex min-h-0 min-w-0 flex-col flex-1">
      <div
        className={cn(
          "flex h-full min-h-0 flex-col overflow-hidden",
          chrome &&
            "mx-3 my-3 rounded-xl bg-[color:var(--surface-chat)] shadow-[0_1px_0_oklch(0_0_0/0.02),0_1px_2px_-1px_oklch(0_0_0/0.04),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.6)]",
        )}
      >
      {/* Indeterminate progress strip — visible whenever the agent is in
          flight (waiting for first byte, streaming text, running a tool).
          Top of the chat surface so it's the first thing the eye registers.
          Self-contained via motion/react so consumers don't need to import
          a separate stylesheet for the keyframes. */}
      <div
        className={cn(
          "relative h-[2px] w-full shrink-0 overflow-hidden bg-[oklch(from_var(--accent)_l_c_h/0.08)]",
          "transition-opacity duration-200",
          isStreaming ? "opacity-100" : "opacity-0",
        )}
        role={isStreaming ? "progressbar" : undefined}
        aria-busy={isStreaming || undefined}
        aria-hidden={!isStreaming}
        aria-label={isStreaming ? "Agent working" : undefined}
      >
        <motion.div
          className="absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent"
          initial={{ x: '-100%' }}
          animate={{ x: isStreaming ? '400%' : '-100%' }}
          transition={{ duration: 1.4, ease: [0.65, 0, 0.35, 1], repeat: isStreaming ? Infinity : 0 }}
        />
      </div>
      <Conversation className="flex-1" aria-label="Agent conversation" aria-live="polite">
        <ConversationContent className={cn(
          "mx-auto flex w-full flex-col gap-6",
          chrome ? "max-w-3xl px-6 py-8" : "max-w-[680px] px-4 py-4",
        )}>
          {displayMessages.length === 0 && (
            <ChatEmptyState
              eyebrow={emptyState?.eyebrow}
              title={emptyState?.title}
              description={emptyState?.description}
              suggestions={suggestions}
              onSelect={(s) => {
                const text = s.prompt ?? s.label
                if (!text.trim()) return
                void sendMessage(
                  { text, files: [] },
                  {
                    body: {
                      sessionId,
                      message: text,
                      ...modelPayload(model),
                      attachments: [],
                    },
                  },
                )
              }}
            />
          )}
          {displayMessages.map((message, messageIndex) => {
            const role = message.role === 'user' || message.role === 'assistant' ? message.role : 'assistant'
            const projectedStatus = projectedStatusById.get(message.id)
            const isWaitingFollowUp = role === 'user' && projectedStatus === 'queued'
            const textParts = message.parts.filter(isTextPart)
            const fileParts = message.parts.filter(isFilePart)
            const seenReasoningTexts = new Set<string>()
            const orderedParts = message.parts.reduce<Array<
              | { kind: 'reasoning'; text: string; state: ReasoningPartView['state']; key: string }
              | { kind: 'part'; part: UIMessage['parts'][number]; key: string }
            >>((items, part, index) => {
              const reasoningPart = getReasoningPart(part)
              const key = `${message.id}-${index}`
              if (!reasoningPart) {
                // Some providers emit whitespace-only text parts between
                // reasoning chunks. Treat those as separators, not real
                // content, otherwise one continuous thought renders as
                // duplicate adjacent "thoughts" widgets.
                if (!isBlankTextPart(part)) {
                  items.push({ kind: 'part', part, key })
                }
                return items
              }
              const normalizedReasoning = reasoningPart.text.trim()
              if (normalizedReasoning && seenReasoningTexts.has(normalizedReasoning)) return items
              if (normalizedReasoning) seenReasoningTexts.add(normalizedReasoning)
              const previous = items[items.length - 1]
              if (previous?.kind === 'reasoning') {
                previous.text = `${previous.text}\n\n${reasoningPart.text}`
                if (reasoningPart.state === 'streaming') previous.state = 'streaming'
              } else {
                items.push({ kind: 'reasoning', ...reasoningPart, key })
              }
              return items
            }, [])
            // Group consecutive tool parts into a single collapsible block.
            // This collapses N separate tool cards into one "Used bash · edit"
            // line while the turn is idle, and auto-expands while tools run.
            type FinalPart =
              | (typeof orderedParts)[number]
              | { kind: 'tool-group'; tools: GroupedToolEntry[]; key: string }
            const finalParts = orderedParts.reduce<FinalPart[]>((acc, item) => {
              if (item.kind === 'part' && isToolUIPart(item.part)) {
                const prev = acc[acc.length - 1]
                if (prev?.kind === 'tool-group') {
                  prev.tools.push({ part: item.part, key: item.key })
                } else {
                  acc.push({ kind: 'tool-group', tools: [{ part: item.part, key: item.key }], key: item.key })
                }
              } else if (item.kind === 'part' && !isTextPart(item.part)) {
                // Non-rendered data parts (heartbeat/status/file-change chunks)
                // often arrive between consecutive tool calls. They should not
                // split one visual "Used command · read" group into multiple
                // dropdowns.
              } else {
                acc.push(item)
              }
              return acc
            }, [])

            // Regenerate is only meaningful for the most recent assistant
            // reply — regenerating an older turn would fork history in
            // ways we don't support. Restricting visibility to the tail
            // keeps the UX honest.
            const isLastMessage = messageIndex === displayMessages.length - 1
            const shouldReserveStreamingActions = isStreaming && role === 'assistant' && isLastMessage

            return (
              <Message
                key={message.id}
                from={role}
                // Reset primitive defaults. `gap-1.5` keeps the per-message
                // action bar close but not touching; the bar itself only
                // renders on hover so idle messages stay tight.
                className="!max-w-full !gap-1.5"
              >
                <MessageContent
                  className={cn(
                    // Layout: flat container, no bubble chrome for the
                    // assistant — per .impeccable.md "the conversation is
                    // the interface": bot replies read as editorial prose
                    // on the page, not as chat-bubble UI. User messages
                    // still get a right-aligned pill so the turn
                    // structure is legible at a glance.
                    "!overflow-visible text-[13px] leading-relaxed text-foreground",
                    role === 'user'
                      ? cn(
                          "!ml-auto !max-w-[80%] !rounded-[var(--radius-lg)]",
                          "!px-4 !py-2.5",
                          isWaitingFollowUp
                            ? "!border !border-dashed !border-border/70 !bg-muted/45 !text-muted-foreground italic shadow-none"
                            : "!bg-secondary !text-secondary-foreground",
                        )
                      : "!w-full !bg-transparent !p-0",
                  )}
                  data-waiting-follow-up={isWaitingFollowUp ? 'true' : undefined}
                >
                  {isWaitingFollowUp && (
                    <div className="mb-1 text-[10px] font-medium not-italic uppercase tracking-[0.16em] text-muted-foreground/70">
                      Waiting…
                    </div>
                  )}
                  {fileParts.length > 0 && (
                    <Attachments
                      variant="list"
                      className={cn(
                        "gap-1.5",
                        // Inside a user bubble, chips should feel like part
                        // of the bubble surface — no competing border/bg
                        // that produces a "box in a box" look. Assistant
                        // messages (no bubble) keep the bordered chip.
                        role === 'user'
                          ? '[&>div]:border-0 [&>div]:bg-transparent [&>div]:px-0 [&>div]:py-1 [&>div:hover]:bg-transparent'
                          : undefined,
                      )}
                    >
                      {fileParts.map((file, idx) => (
                        <Attachment key={`file-${message.id}-${idx}`} data={{ ...file, id: `file-${message.id}-${idx}` }}>
                          <AttachmentPreview className="size-10 shrink-0 rounded-[var(--radius-md)]" />
                          <AttachmentInfo className="min-w-0 flex-1" />
                        </Attachment>
                      ))}
                    </Attachments>
                  )}

                  {/* Render reasoning + text + tool parts in the order the
                      model emitted them. Consecutive tool parts are grouped
                      into a single collapsible block that auto-expands while
                      tools run and collapses to a summary when they settle. */}
                  {finalParts.map((item, index) => {
                    if (item.kind === 'reasoning') {
                      if (!showThoughts) return null
                      return (
                        <Reasoning
                          key={`reasoning-${item.key}`}
                          isStreaming={item.state === 'streaming'}
                          defaultOpen={item.state === 'streaming'}
                        >
                          <ReasoningTrigger
                            className="mb-1 w-fit rounded-[var(--radius-sm)] px-0 py-0 !text-xs !font-normal !text-muted-foreground/75 hover:bg-transparent hover:!text-muted-foreground/75 [&_svg]:!text-muted-foreground/75"
                            getThinkingMessage={(streaming) => (
                              <span>{streaming ? 'thinking' : 'thoughts'}</span>
                            )}
                          />
                          <ReasoningContent>{item.text}</ReasoningContent>
                        </Reasoning>
                      )
                    }
                    if (item.kind === 'tool-group') {
                      return (
                        <ToolCallGroup
                          key={item.key}
                          tools={item.tools}
                          mergedToolRenderers={mergedToolRenderers}
                        />
                      )
                    }
                    const { part } = item
                    if (isTextPart(part)) {
                      return (
                        <MessageResponse
                          key={`text-${message.id}-${index}`}
                          className={cn(
                            "max-w-none",
                            // Editorial prose rhythm — a magazine column on
                            // the page, not a log dump. Fewer type sizes,
                            // more leading; headings earn weight, not size.
                            "prose prose-invert prose-neutral",
                            "prose-p:my-3 prose-p:leading-[1.7] prose-p:text-[13px]",
                            "prose-headings:mt-5 prose-headings:mb-2 prose-headings:font-semibold prose-headings:tracking-[-0.01em]",
                            "prose-ul:my-3 prose-ul:pl-6 prose-ol:my-3 prose-ol:pl-6",
                            "prose-li:my-1.5 prose-li:leading-[1.7] prose-li:pl-1 prose-li:marker:text-muted-foreground/70",
                            "prose-strong:font-semibold prose-strong:text-foreground",
                            "prose-em:text-foreground/90",
                            "prose-a:text-[color:var(--accent)] prose-a:underline-offset-4 hover:prose-a:underline",
                            // Inline code chips — sit on the prose baseline.
                            "prose-code:font-mono prose-code:text-[13px] prose-code:font-medium",
                            "prose-code:rounded-[var(--radius-sm)] prose-code:border prose-code:border-border/60 prose-code:bg-muted/60",
                            "prose-code:px-1.5 prose-code:py-0.5",
                            "prose-code:before:content-none prose-code:after:content-none",
                            // Multi-line code blocks — the CodeBlock primitive owns
                            // its own container styling; strip prose defaults so
                            // we don't double-wrap with another border + bg.
                            "prose-pre:my-0 prose-pre:rounded-none prose-pre:border-0",
                            "prose-pre:bg-transparent prose-pre:p-0",
                          )}
                        >
                          {part.text}
                        </MessageResponse>
                      )
                    }
                    return null
                  })}
                </MessageContent>

                {/* Per-message action bar. Lives OUTSIDE MessageContent.
                 * During streaming it stays mounted but visually/a11y hidden
                 * so the final transition from "working" to "done" doesn't
                 * add a new row and nudge the transcript.
                 * Regenerate is gated to the LAST assistant message — see
                 * the regenerateLastTurn helper below for why we bypass
                 * AI SDK's built-in `regenerate()`. */}
                {role === 'assistant' && (textParts.length > 0 || shouldReserveStreamingActions) && (
                  <MessageActionsBar
                    text={textParts.map((p) => p.text).join('\n\n')}
                    canRegenerate={isLastMessage && !isStreaming}
                    visible={!isStreaming}
                    onRegenerate={() => {
                      void regenerateLastTurn({
                        messages,
                        setMessages,
                        sendMessage,
                        sessionId,
                        model,
                      })
                    }}
                  />
                )}
              </Message>
            )
          })}
          {(() => {
            if (!error) return null
            const friendly = friendlyError(error)
            return (
              <Message from="assistant" className="!max-w-full">
                <MessageContent className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
                  <div role="alert" className="flex items-start gap-3 text-sm text-destructive">
                    <div className="mt-0.5 shrink-0">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{friendly.title}</div>
                      {friendly.detail && (
                        <div className="mt-1 text-xs text-destructive/80">{friendly.detail}</div>
                      )}
                    </div>
                    <IconButton
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => clearError()}
                      className="shrink-0 text-destructive/70 hover:bg-destructive/15 hover:text-destructive"
                      aria-label="Dismiss"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </IconButton>
                  </div>
                </MessageContent>
              </Message>
            )
          })()}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className={cn(chrome ? "px-4 pb-4 pt-2 sm:px-6 sm:pb-5" : "px-3 pb-3 pt-1")}>
        {/* Working… badge — collapses to 0 height when idle so it doesn't waste
            vertical space. Height transition preserves layout stability. */}
        <div
          className={cn(
            "mx-auto w-full overflow-hidden transition-all duration-300",
            chrome ? "max-w-3xl" : "max-w-[680px]",
            isStreaming ? "mb-2 max-h-8" : "max-h-0",
          )}
        >
          <div
            data-testid="chat-working"
            role="status"
            aria-live="polite"
            className={cn(
              "inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/85 px-2.5 py-1 text-[12px] text-muted-foreground/75 shadow-sm backdrop-blur",
            )}
          >
            <motion.span
              aria-hidden="true"
              className="inline-block size-1.5 rounded-full bg-[color:var(--accent)]"
              animate={{ opacity: [0.35, 1, 0.35] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span>Working…</span>
          </div>
        </div>
        {composerBlocked && (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "mx-auto mb-2 w-full max-w-3xl rounded-[var(--radius-md)] border border-primary/30 bg-primary/10",
              "px-3 py-2 text-xs text-foreground",
            )}
          >
            <span>{composerBlockerLabel}</span>
            {primaryComposerBlocker?.actions?.map((action) => (
              <button
                key={action.id}
                type="button"
                className="ml-2 rounded border border-primary/30 px-2 py-0.5 text-[11px] font-medium hover:bg-primary/10"
                onClick={() => onComposerBlockerAction?.(primaryComposerBlocker, action.id)}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        {hotReloadEnabled && (
          <PluginUpdateStatus
            state={pluginUpdateState}
            onDismiss={dismissPluginUpdate}
            onRetry={runPluginUpdate}
          />
        )}
        {attachmentNotice && (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              "mx-auto mb-2 w-full max-w-3xl rounded-[var(--radius-md)] border border-accent/40 bg-[color:var(--accent-soft)]",
              "px-3 py-2 text-xs text-foreground",
            )}
          >
            {attachmentNotice}
          </div>
        )}
        <div className={cn("mx-auto w-full", chrome ? "max-w-3xl" : "max-w-[680px]")}>
          {mentionState && (
            <MentionPicker
              mention={mentionState}
              onSelect={selectMention}
              onDismiss={dismissMention}
            />
          )}
          {slashQuery !== null && (
            <SlashCommandPicker
              query={slashQuery}
              commands={allCommands}
              onSelect={selectSlashCommand}
              onDismiss={dismissSlash}
            />
          )}
        </div>
        <div
          className={cn(
            "relative mx-auto w-full overflow-visible",
            chrome ? "max-w-3xl" : "max-w-[680px]",
            // Workspace-aligned composer surface: a flat card with an
            // inset 1px border at rest, then a focus-within swap that
            // pulls in the accent hue. No heavy drop-shadow — the pane
            // itself already has elevation, so the composer just gets a
            // subtle tonal lift.
            chrome
              ? "rounded-[var(--radius-xl)] bg-[color:var(--card)] shadow-[0_1px_2px_-1px_oklch(0_0_0/0.06),0_6px_18px_-12px_oklch(0_0_0/0.12),inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.7)] focus-within:shadow-[0_1px_3px_-1px_oklch(0_0_0/0.08),0_10px_28px_-14px_oklch(0_0_0/0.16),inset_0_0_0_1px_oklch(from_var(--accent)_l_c_h/0.45)] transition-shadow duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
              : // Embedded composer: visible at-rest border so the input
                // surface is identifiable when nothing has focus, then swap
                // to an accent-tinted border on focus. No card / shadow —
                // the parent surface still owns the elevation.
                "rounded-[var(--radius-xl)] bg-transparent shadow-[inset_0_0_0_1px_oklch(from_var(--border)_l_c_h/0.7)] focus-within:shadow-[inset_0_0_0_1px_oklch(from_var(--accent)_l_c_h/0.45)] transition-shadow duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
            // Neutralize the inner InputGroup's default border/rounded/shadow
            // so the outer surface is the only bounded container. The `!`
            // bumps these past InputGroup's own `border-input border` and
            // `shadow-xs` declarations, which otherwise win the cascade race
            // when both rules have equal class-selector specificity.
            "[&_[data-slot=input-group]]:!border-0 [&_[data-slot=input-group]]:!rounded-none",
            "[&_[data-slot=input-group]]:!shadow-none [&_[data-slot=input-group]]:!bg-transparent",
            "[&_[data-slot=input-group]]:dark:!bg-transparent [&_[data-slot=input-group]]:!ring-0",
            "[&_[data-slot=input-group]]:has-[:focus]:!ring-0",
          )}
        >
          <PromptInput
            data-boring-state={status}
            onSubmit={handleSubmit}
            multiple
            // Guard rails for the attachments pipeline. The server schema
            // caps `attachments` at 20 entries; we match that client-side and
            // add a 5 MB-per-file limit so a giant drag-drop doesn't blow
            // localStorage's ~5 MB origin quota when the cached history grows.
            maxFiles={attachmentsDisabled ? 0 : 20}
            maxFileSize={5 * 1024 * 1024}
            onError={(err) => {
              const e = err as { code: string; message?: string; max?: number }
              if (e.code === 'max_files') {
                setAttachmentNotice(`Up to ${e.max ?? 20} attachments per message.`)
              } else if (e.code === 'max_file_size') {
                const mb = e.max ? Math.round(e.max / 1024 / 1024) : 5
                setAttachmentNotice(`Files must be under ${mb} MB each.`)
              } else if (e.code === 'accept') {
                setAttachmentNotice(`That file type isn't supported here.`)
              } else {
                setAttachmentNotice(e.message || 'Attachment rejected.')
              }
            }}
          >
            <AttachmentsList />
            <PromptInputTextarea
              placeholder={composerBlocked ? composerBlockerLabel : "Ask anything…"}
              disabled={composerBlocked}
              readOnly={composerBlocked}
              onChange={handleComposerChange}
              onKeyDown={handleComposerKeyDown}
              className={cn(
                "min-h-[48px] resize-none border-0 bg-transparent shadow-none",
                "px-4 py-3 text-[13px] leading-[1.55] placeholder:text-muted-foreground/50",
                "focus-visible:ring-0 focus-visible:ring-offset-0",
              )}
            />
            <PromptInputFooter
              className={cn(
                "flex items-center gap-1.5 border-0 bg-transparent",
                "px-2 pb-2 pt-1.5",
              )}
            >
              {/* Left-side actions cluster so attach + model feel like one
               * group rather than two disconnected controls. */}
              <div className="flex items-center gap-1">
                <AttachmentButton disabled={attachmentsDisabled} />
                <ModelSelect
                  value={model}
                  onChange={setModel}
                  options={availableModels}
                  disabled={isStreaming}
                />
              </div>
              {/* Spacer pushes secondary controls + submit to the right. */}
              <div className="ml-auto flex items-center gap-1">
                {thinkingControl && (
                  <>
                    <ThinkingSelect
                      value={thinkingLevel}
                      onChange={setThinkingLevel}
                      disabled={isStreaming}
                    />
                    <ThoughtVisibilityButton
                      visible={showThoughts}
                      onToggle={() => setShowThoughts((value) => !value)}
                    />
                  </>
                )}
                <div className="ml-1 flex items-center gap-1.5">
                  <KbdHints />
                  <PromptInputSubmit
                    status={status}
                  onStop={handleStop}
                  disabled={composerBlocked && !isStreaming}
                  className={cn(
                    // Primary action. Uses the warm accent (not `primary`,
                    // which is a neutral foreground tone) — this is the one
                    // place the brand hue appears in the panel, so it has
                    // to earn the real estate. Becomes a Stop affordance
                    // (square icon + aria-label="Stop") while the turn
                    // streams.
                    "h-8 w-8 shrink-0 rounded-[var(--radius-lg)]",
                    "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]",
                    "transition-all duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    "hover:shadow-[0_0_0_3px_oklch(from_var(--accent)_l_c_h/0.30)] hover:brightness-110 hover:scale-[1.04]",
                    "active:scale-[0.93] active:brightness-95",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/40",
                    "disabled:pointer-events-none disabled:opacity-40",
                    "[&>svg]:size-3.5",
                  )}
                  />
                </div>
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
      </div>
      </div>
    </div>
    </ArtifactOpenProvider>
  )
}

// ---- Composer helpers ----

function AttachmentButton({ disabled }: { disabled?: boolean }) {
  const attachments = usePromptInputAttachments()
  return (
    <IconButton
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      onClick={() => {
        if (!disabled) attachments.openFileDialog()
      }}
      className={cn(composerActionClass, "w-8")}
      aria-label="Attach files"
      title={disabled ? 'Attachments are available after the current response finishes.' : 'Attach files'}
    >
      <PaperclipIcon className="h-4 w-4" />
    </IconButton>
  )
}

function AttachmentsList() {
  const attachments = usePromptInputAttachments()
  if (attachments.files.length === 0) return null
  // data-align=block-start flips PromptInput's InputGroup into flex-col so
  // this row occupies its own horizontal band and the chips anchor to the
  // left edge instead of being center-distributed between textarea + footer.
  return (
    <Attachments
      data-align="block-start"
      variant="inline"
      className="w-full flex-wrap items-center justify-start gap-2 px-5 pt-3 pb-1"
    >
      {attachments.files.map((file) => (
        <Attachment
          key={file.id}
          data={file}
          onRemove={() => attachments.remove(file.id)}
          className={cn(
            // Compact pill — medium border, muted fill, room for a
            // thumbnail + name + remove action.
            "!h-9 !gap-2 !rounded-full !border-input/80 !bg-muted/40 !pl-1 !pr-2",
            "transition-colors hover:!bg-muted/70 hover:!text-foreground",
            file.status === 'error' && "!border-destructive/50 !bg-destructive/10",
          )}
        >
          <div className="relative shrink-0">
            <AttachmentPreview
              // Fixed thumbnail slot; <img> fills via object-cover.
              className="!size-7 overflow-hidden !rounded-full bg-background/60"
            />
            {file.status === 'uploading' && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              </div>
            )}
            {file.status === 'error' && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-destructive/20">
                <AlertCircleIcon className="size-3.5 text-destructive" />
              </div>
            )}
          </div>
          <AttachmentInfo
            className="min-w-0 !max-w-[180px] truncate text-[13px] font-medium"
          />
          <AttachmentRemove
            className={cn(
              // Always-visible remove affordance; default inline variant
              // hides it until hover which is too discoverable-averse here.
              "!size-5 !rounded-full !opacity-100 text-muted-foreground/80 hover:text-foreground",
            )}
          />
        </Attachment>
      ))}
    </Attachments>
  )
}

/**
 * Rewind the most recent assistant turn and re-send the user message
 * that produced it.
 *
 * We deliberately bypass AI SDK's built-in `regenerate()` because it
 * POSTs to `/api/v1/agent/chat` with `trigger: "regenerate-message"`
 * and no `message` field — our server Zod schema requires
 * `message: z.string().min(1)`, so the built-in path fails validation
 * silently and the button appears broken. Intercepting here keeps the
 * server contract narrow (one request shape: new user turn + history
 * comes from pi's server-side session store).
 *
 * Known limitation: because pi persists session history server-side,
 * re-sending adds a duplicate user turn to the store. Acceptable for
 * now — a proper fix is a server endpoint to truncate the last turn
 * before re-sending. Client history is kept clean via setMessages.
 */
function regenerateLastTurn({
  messages,
  setMessages,
  sendMessage,
  sessionId,
  model,
}: {
  messages: UIMessage[]
  setMessages: (m: UIMessage[]) => void
  sendMessage: ReturnType<typeof useAgentChat>['sendMessage']
  sessionId: string
  model: ModelSelection | null
}): Promise<void> | void {
  if (messages.length === 0) return
  const tail = messages[messages.length - 1]
  if (!tail || tail.role !== 'assistant') return

  // Find the immediately preceding user message — walk backwards past
  // any interleaved assistant/tool turns.
  let userIdx = -1
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userIdx = i
      break
    }
  }
  if (userIdx < 0) return
  const userMessage = messages[userIdx]

  const text = userMessage.parts
    .filter(isTextPart)
    .map((p) => p.text)
    .join('\n\n')
  const files = userMessage.parts.filter(isFilePart)

  // Rewind client-visible history to before the user turn. Server-side
  // pi session store still retains it; see caveat in the doc above.
  setMessages(messages.slice(0, userIdx))

  return sendMessage(
    { text, files },
    {
      body: {
        sessionId,
        message: text || '(regenerate)',
        ...modelPayload(model),
        attachments: files?.map((f) => ({
          filename: f.filename,
          mediaType: f.mediaType,
          url: f.url,
        })) ?? [],
      },
    },
  ).then(() => undefined)
}

/**
 * Per-message action bar. Appears on assistant messages once the turn
 * has finished streaming — Copy + Regenerate, standard chat affordances.
 *
 * The row reserves its final height while streaming, but stays visually and
 * accessibility hidden, so the transcript does not jump when the working
 * state settles and the controls fade in.
 */
function MessageActionsBar({
  text,
  canRegenerate,
  onRegenerate,
  visible = true,
}: {
  text: string
  canRegenerate: boolean
  onRegenerate: () => void
  visible?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const markCopied = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const handleCopy = async () => {
    if (!visible) return
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text)
        markCopied()
        return
      } catch {
        /* fall through to legacy fallback */
      }
    }
    // Fallback for non-secure contexts (HTTP dev URLs etc.) where the
    // async Clipboard API is unavailable. document.execCommand('copy') is
    // deprecated but still supported by every shipping browser and works
    // off a temporary textarea + selection.
    if (typeof document === 'undefined') return
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.pointerEvents = 'none'
    document.body.appendChild(ta)
    ta.select()
    try {
      const ok = document.execCommand('copy')
      if (ok) markCopied()
    } catch {
      /* nothing more we can do */
    } finally {
      document.body.removeChild(ta)
    }
  }
  const iconActionBtnClass = cn(
    "inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]",
    "text-muted-foreground/35 transition-colors",
    "hover:bg-foreground/[0.04] hover:text-muted-foreground/80",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent)]/40",
  )
  const hiddenActionProps = visible ? {} : { tabIndex: -1 }
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        // Always mounted but quiet — discrete utility row under the
        // assistant message. Hovering an individual button bumps it
        // back to full contrast.
        "flex min-h-6 items-center gap-0.5 -mt-1 transition-opacity duration-200",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <Button type="button" variant="ghost" size="xs" onClick={handleCopy} className={iconActionBtnClass} aria-label={copied ? 'Copied' : 'Copy message'} title={copied ? 'Copied' : 'Copy'} {...hiddenActionProps}>
        {copied ? <CheckIcon className="h-3.5 w-3.5 text-[color:var(--accent)]" /> : <CopyIcon className="h-3.5 w-3.5" />}
      </Button>
      {canRegenerate && (
        <Button type="button" variant="ghost" size="xs" onClick={visible ? onRegenerate : undefined} className={iconActionBtnClass} aria-label="Regenerate" title="Regenerate" {...hiddenActionProps}>
          <RefreshCwIcon className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
