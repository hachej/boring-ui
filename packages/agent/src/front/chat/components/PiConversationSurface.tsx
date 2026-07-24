"use client"

import type { ReactNode } from 'react'
import type { PromptInputFilePart } from '../../primitives/prompt-input'
import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import type { BoringChatMessage } from '../../../shared/chat'
import type { ToolRendererOverrides } from '../../bareToolRenderers'
import { ChatEmptyState, type ChatSuggestion } from '../../ChatEmptyState'
import { cn } from '../../lib'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '../../primitives/conversation'
import { RuntimeNoticeMessages, type PanelNotice } from './ChatNotices'
import { PiTimelineMessage } from './PiTimelineMessage'

// Heavy sessions (tool-heavy runs reach thousands of messages) must not mount
// the whole transcript at once. Render a window anchored to the latest message
// and reveal older messages as the user scrolls up.
const TRANSCRIPT_WINDOW = 60
const TRANSCRIPT_WINDOW_STEP = 40
const LOAD_OLDER_THRESHOLD_PX = 320

export interface MessageFooterProjectionItem {
  key: string
  message: BoringChatMessage
}

export interface PiConversationSurfaceProps {
  chrome: boolean
  emptyHero: boolean
  messages: BoringChatMessage[]
  emptyStateHydrating: boolean
  emptyState?: {
    eyebrow?: string
    title?: string
    description?: ReactNode
    footer?: ReactNode
  }
  suggestions: ChatSuggestion[]
  isStreaming: boolean
  showThoughts: boolean
  toolRenderers: ToolRendererOverrides
  messageFooterProjection?: (items: readonly MessageFooterProjectionItem[]) => ReadonlyMap<string, ReactNode>
  runtimeNotices: PanelNotice[]
  onDismissNotice: (id: string) => void
  /** Host-supplied recovery action node for a runtime notice, keyed off its error
   * code. Forwarded to RuntimeNoticeMessages. */
  renderNoticeAction?: (notice: PanelNotice) => ReactNode
  onScrollToBottomReady: (scrollToBottom: () => void) => void
  onSuggestionSubmit: (payload: { text: string; files: PromptInputFilePart[]; source: 'suggestion' }) => Promise<false | void>
  onRestoreDraft: (text: string) => void
  /** Changes when the active session changes; resets the history window to the latest page. */
  windowResetKey?: string
}

export function PiConversationSurface({
  chrome,
  emptyHero,
  messages,
  emptyStateHydrating,
  emptyState,
  suggestions,
  isStreaming,
  showThoughts,
  toolRenderers,
  messageFooterProjection,
  runtimeNotices,
  onDismissNotice,
  renderNoticeAction,
  onScrollToBottomReady,
  onSuggestionSubmit,
  onRestoreDraft,
  windowResetKey,
}: PiConversationSurfaceProps) {
  const messageItems = useMemo(() => buildMessageRenderItems(messages), [messages])
  const messageFooters = useMemo(
    () => messageFooterProjection?.(messageItems) ?? new Map<string, ReactNode>(),
    [messageFooterProjection, messageItems],
  )
  const total = messageItems.length

  const [visibleCount, setVisibleCount] = useState(TRANSCRIPT_WINDOW)
  // Start each session at the latest window rather than inheriting a large
  // window expanded in a previously-viewed session.
  useEffect(() => {
    setVisibleCount(TRANSCRIPT_WINDOW)
  }, [windowResetKey])

  const hasOlder = total > visibleCount
  const visibleItems = hasOlder ? messageItems.slice(total - visibleCount) : messageItems
  const olderCount = hasOlder ? total - visibleCount : 0
  const loadOlder = useCallback(() => {
    setVisibleCount((count) => count + TRANSCRIPT_WINDOW_STEP)
  }, [])

  return (
    <Conversation
      className={emptyHero ? 'max-h-[45vh] flex-none' : 'flex-1'}
      aria-label="Agent conversation"
      aria-live="polite"
      onScrollToBottomReady={onScrollToBottomReady}
    >
      <ConversationContent className={cn(
        'mx-auto flex w-full flex-col gap-6',
        chrome ? 'max-w-3xl px-6 py-8' : 'max-w-[680px] px-4 py-4',
        emptyHero && 'py-4 text-center',
      )}>
        {messages.length === 0 && emptyStateHydrating ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card/70 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading chat history…
          </div>
        ) : null}
        {messages.length === 0 && !emptyStateHydrating ? (
          <ChatEmptyState
            eyebrow={emptyState?.eyebrow}
            title={emptyState?.title}
            description={emptyState?.description}
            footer={emptyState?.footer}
            suggestions={suggestions}
            className={emptyHero ? 'items-center text-center [&>p]:mx-auto' : undefined}
            onSelect={(suggestion) => {
              const text = suggestion.prompt ?? suggestion.label
              if (!text.trim()) return
              void onSuggestionSubmit({ text, files: [], source: 'suggestion' }).then((result) => {
                if (result === false) onRestoreDraft(text)
              })
            }}
          />
        ) : null}
        {hasOlder ? (
          <TranscriptHistoryLoader olderCount={olderCount} onLoadOlder={loadOlder} />
        ) : null}
        {visibleItems.map(({ message, key }, index) => (
          <PiTimelineMessage
            key={key}
            message={message}
            isLast={index === visibleItems.length - 1}
            isStreaming={isStreaming}
            showThoughts={showThoughts}
            toolRenderers={toolRenderers}
            footer={messageFooters.get(key)}
          />
        ))}
        <RuntimeNoticeMessages notices={runtimeNotices} onDismiss={onDismissNotice} renderAction={renderNoticeAction} />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}

/**
 * Renders the "load older" affordance and auto-reveals the previous page when
 * the user scrolls near the top, preserving their scroll position so prepended
 * messages don't jump the viewport. Must render inside <Conversation> so it can
 * read the stick-to-bottom scroll container.
 */
function TranscriptHistoryLoader({ olderCount, onLoadOlder }: { olderCount: number; onLoadOlder: () => void }) {
  const { scrollRef } = useStickToBottomContext()
  const pendingAnchor = useRef<number | null>(null)
  const armed = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      if (!armed.current) return
      if (el.scrollTop <= LOAD_OLDER_THRESHOLD_PX) {
        armed.current = false
        // Distance from the current position to the bottom of content; preserved
        // across the prepend so the same messages stay under the viewport.
        pendingAnchor.current = el.scrollHeight - el.scrollTop
        onLoadOlder()
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollRef, onLoadOlder])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (pendingAnchor.current != null) {
      el.scrollTop = el.scrollHeight - pendingAnchor.current
      pendingAnchor.current = null
    }
    // Re-arm only once we're clear of the trigger zone, so the programmatic
    // scroll above can't immediately re-fire and run away.
    if (el.scrollTop > LOAD_OLDER_THRESHOLD_PX) armed.current = true
  })

  return (
    <div className="flex justify-center" data-boring-agent-part="transcript-load-older">
      <button
        type="button"
        onClick={onLoadOlder}
        className="rounded-full border border-border/60 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        Load {olderCount} older message{olderCount === 1 ? '' : 's'}
      </button>
    </div>
  )
}

function buildMessageRenderItems(messages: BoringChatMessage[]): Array<{ message: BoringChatMessage; key: string }> {
  const assistantTurnCounts = new Map<string, number>()
  for (const message of messages) {
    if (message.role === 'assistant' && message.turnId) {
      assistantTurnCounts.set(message.turnId, (assistantTurnCounts.get(message.turnId) ?? 0) + 1)
    }
  }

  const assistantTurnIndexes = new Map<string, number>()
  return messages.map((message) => {
    if (message.role !== 'assistant' || !message.turnId) return { message, key: `message:${message.role}:${message.id}` }
    const count = assistantTurnCounts.get(message.turnId) ?? 0
    if (count <= 1) return { message, key: `assistant-turn:${message.turnId}` }
    const index = assistantTurnIndexes.get(message.turnId) ?? 0
    assistantTurnIndexes.set(message.turnId, index + 1)
    return {
      message,
      key: index === 0
        ? `assistant-turn:${message.turnId}`
        : `assistant-turn:${message.turnId}:message:${message.id}`,
    }
  })
}
