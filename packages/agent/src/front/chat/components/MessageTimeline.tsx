"use client"

import type { HTMLAttributes, ReactNode } from 'react'
import { memo, useMemo } from 'react'
import type { BoringChatMessage, BoringChatPart, QueuedUserMessage } from '../../../shared/chat'
import { cn } from '../../lib'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
  type AttachmentData,
} from '../../primitives/attachments'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  type ConversationProps,
} from '../../primitives/conversation'
import { Message, MessageContent, MessageResponse } from '../../primitives/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '../../primitives/reasoning'
import { ToolCallGroup, type GroupedToolEntry } from '../../primitives/tool-call-group'
import type { ToolRendererOverrides } from '../../bareToolRenderers'

export interface MessageTimelineEmptyState {
  title?: string
  description?: string
  icon?: ReactNode
}

export interface MessageTimelineProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Already-selected render messages, normally selectMessagesForRender(state). */
  messages: BoringChatMessage[]
  /** Already-selected queue preview, normally selectQueuePreview(state). */
  queuePreview?: QueuedUserMessage[]
  emptyState?: MessageTimelineEmptyState
  toolRenderers?: ToolRendererOverrides
  onScrollToBottomReady?: ConversationProps['onScrollToBottomReady']
}

export const MessageTimeline = memo(({
  messages,
  queuePreview = [],
  emptyState,
  toolRenderers,
  onScrollToBottomReady,
  className,
  ...props
}: MessageTimelineProps) => {
  const isEmpty = messages.length === 0

  return (
    <Conversation
      data-boring-agent-part="message-timeline"
      aria-label="Agent conversation"
      aria-live="polite"
      onScrollToBottomReady={onScrollToBottomReady}
      className={cn('min-h-0', className)}
      {...props}
    >
      <ConversationContent data-boring-agent-part="message-timeline-content">
        {isEmpty ? (
          <ConversationEmptyState
            data-boring-agent-part="chat-empty-state"
            title={emptyState?.title ?? 'What are we building?'}
            description={emptyState?.description ?? 'Send a prompt to start a Pi-native agent session.'}
            icon={emptyState?.icon}
          />
        ) : (
          messages.map((message) => (
            <TimelineMessage key={message.id} message={message} toolRenderers={toolRenderers} />
          ))
        )}
        <QueuePreview followUps={queuePreview} />
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
})

MessageTimeline.displayName = 'MessageTimeline'

interface TimelineMessageProps {
  message: BoringChatMessage
  toolRenderers?: ToolRendererOverrides
}

const TimelineMessage = memo(({ message, toolRenderers }: TimelineMessageProps) => {
  const renderedParts = useMemo(() => renderMessageParts(message, toolRenderers), [message, toolRenderers])
  const statusLabel = message.status === 'pending' ? 'Pending' : message.status === 'streaming' ? 'Streaming' : undefined

  return (
    <Message
      data-boring-agent-part="message"
      data-boring-agent-message-id={message.id}
      data-boring-agent-message-status={message.status}
      from={message.role}
    >
      <MessageContent data-boring-agent-part="message-content">
        {renderedParts}
        {statusLabel ? (
          <span className="sr-only" role="status" aria-live="polite">{statusLabel}</span>
        ) : null}
      </MessageContent>
    </Message>
  )
})

TimelineMessage.displayName = 'TimelineMessage'

function renderMessageParts(message: BoringChatMessage, toolRenderers?: ToolRendererOverrides): ReactNode[] {
  const nodes: ReactNode[] = []
  let pendingTools: GroupedToolEntry[] = []

  const flushTools = () => {
    if (pendingTools.length === 0) return
    const firstKey = pendingTools[0]?.key ?? `tools:${nodes.length}`
    nodes.push(
      <div key={`tools:${firstKey}`} data-boring-agent-part="message-tools">
        <ToolCallGroup tools={pendingTools} mergedToolRenderers={toolRenderers ?? {}} />
      </div>,
    )
    pendingTools = []
  }

  message.parts.forEach((part, index) => {
    const key = partKey(message.id, part, index)
    if (part.type === 'tool-call') {
      pendingTools.push({ part, key })
      return
    }

    flushTools()
    nodes.push(renderNonToolPart(message, part, key))
  })

  flushTools()
  return nodes
}

function renderNonToolPart(message: BoringChatMessage, part: BoringChatPart, key: string): ReactNode {
  switch (part.type) {
    case 'text':
      return (
        <div key={key} data-boring-agent-part="message-text">
          <MessageResponse>{part.text}</MessageResponse>
        </div>
      )
    case 'reasoning':
      return (
        <div key={key} data-boring-agent-part="message-reasoning">
          <Reasoning isStreaming={part.state === 'streaming'}>
            <ReasoningTrigger />
            <ReasoningContent>{part.text}</ReasoningContent>
          </Reasoning>
        </div>
      )
    case 'file':
      return (
        <div key={key} data-boring-agent-part="message-file">
          <Attachments variant={message.role === 'user' ? 'grid' : 'inline'}>
            <Attachment data={toAttachmentData(part)}>
              <AttachmentPreview />
              <AttachmentInfo />
            </Attachment>
          </Attachments>
        </div>
      )
    case 'notice':
      return (
        <div
          key={key}
          data-boring-agent-part="message-notice"
          data-notice-level={part.level}
          className={cn(
            'rounded-md border px-3 py-2 text-xs',
            part.level === 'error' && 'border-destructive/30 bg-destructive/5 text-destructive',
            part.level === 'warning' && 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
            part.level === 'info' && 'border-border/60 bg-muted/40 text-muted-foreground',
          )}
        >
          {part.text}
        </div>
      )
  }
}

function toAttachmentData(part: Extract<BoringChatPart, { type: 'file' }>): AttachmentData {
  return {
    type: 'file',
    id: part.id ?? part.url ?? part.filename ?? 'file',
    filename: part.filename,
    mediaType: part.mediaType,
    url: part.url ?? '',
  } as AttachmentData
}

function partKey(messageId: string, part: BoringChatPart, index: number): string {
  if ('id' in part && part.id) return part.id
  return `${messageId}:${part.type}:${index}`
}

interface QueuePreviewProps {
  followUps: QueuedUserMessage[]
}

function QueuePreview({ followUps }: QueuePreviewProps) {
  if (followUps.length === 0) return null
  return (
    <div
      data-boring-agent-part="queue-preview"
      className="ml-auto flex w-fit max-w-[95%] flex-col gap-1 rounded-lg border border-dashed border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground"
    >
      <div className="font-medium text-foreground/80">Queued follow-ups</div>
      <ol className="list-decimal space-y-1 pl-4">
        {followUps.map((followUp) => (
          <li key={followUp.id} data-boring-agent-queue-item={followUp.id}>
            {followUp.displayText}
          </li>
        ))}
      </ol>
    </div>
  )
}
