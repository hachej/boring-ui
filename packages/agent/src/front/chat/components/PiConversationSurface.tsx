"use client"

import type { FileUIPart } from 'ai'
import { Loader2 } from 'lucide-react'
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

export interface PiConversationSurfaceProps {
  chrome: boolean
  emptyHero: boolean
  messages: BoringChatMessage[]
  emptyStateHydrating: boolean
  emptyState?: {
    eyebrow?: string
    title?: string
    description?: string
  }
  suggestions: ChatSuggestion[]
  isStreaming: boolean
  showThoughts: boolean
  toolRenderers: ToolRendererOverrides
  runtimeNotices: PanelNotice[]
  onDismissNotice: (id: string) => void
  onScrollToBottomReady: (scrollToBottom: () => void) => void
  onSuggestionSubmit: (payload: { text: string; files: FileUIPart[]; source: 'suggestion' }) => Promise<false | void>
  onRestoreDraft: (text: string) => void
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
  runtimeNotices,
  onDismissNotice,
  onScrollToBottomReady,
  onSuggestionSubmit,
  onRestoreDraft,
}: PiConversationSurfaceProps) {
  const messageItems = buildMessageRenderItems(messages)

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
        {messageItems.map(({ message, key }, index) => (
          <PiTimelineMessage
            key={key}
            message={message}
            isLast={index === messageItems.length - 1}
            isStreaming={isStreaming}
            showThoughts={showThoughts}
            toolRenderers={toolRenderers}
          />
        ))}
        <RuntimeNoticeMessages notices={runtimeNotices} onDismiss={onDismissNotice} />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
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
