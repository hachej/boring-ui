"use client"

import type { HTMLAttributes, ReactNode } from 'react'
import { memo, useMemo } from 'react'
import type { BoringChatMessage, BoringChatPart } from '../../../shared/chat'
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
import { ToolCallGroup, type GroupedToolEntry, type ResolveApprovalHandler } from '../../primitives/tool-call-group'
import type { ToolRendererOverrides } from '../../bareToolRenderers'
import { noticeSurfaceClass, noticeTextClass } from './noticeStyles'

export interface MessageTimelineEmptyState {
  title?: string
  description?: string
  icon?: ReactNode
}

export interface MessageTimelineProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Already-selected render messages, normally selectMessagesForRender(state). */
  messages: BoringChatMessage[]
  emptyState?: MessageTimelineEmptyState
  toolRenderers?: ToolRendererOverrides
  onResolveApproval?: ResolveApprovalHandler
  onScrollToBottomReady?: ConversationProps['onScrollToBottomReady']
}

export const MessageTimeline = memo(({
  messages,
  emptyState,
  toolRenderers,
  onResolveApproval,
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
            description={emptyState?.description ?? 'Send a prompt to start an assistant session.'}
            icon={emptyState?.icon}
          />
        ) : (
          messages.map((message) => (
            <TimelineMessage
              key={message.id}
              message={message}
              toolRenderers={toolRenderers}
              onResolveApproval={onResolveApproval}
            />
          ))
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
})

MessageTimeline.displayName = 'MessageTimeline'

interface TimelineMessageProps {
  message: BoringChatMessage
  toolRenderers?: ToolRendererOverrides
  onResolveApproval?: ResolveApprovalHandler
}

const TimelineMessage = memo(({ message, toolRenderers, onResolveApproval }: TimelineMessageProps) => {
  const renderedParts = useMemo(
    () => renderMessageParts(message, toolRenderers, onResolveApproval),
    [message, onResolveApproval, toolRenderers],
  )
  const statusLabel = message.status === 'pending' ? 'Pending' : message.status === 'streaming' ? 'Streaming' : undefined

  return (
    <Message
      data-boring-agent-part="message"
      data-boring-agent-message-id={message.id}
      data-boring-agent-message-role={message.role}
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

function renderMessageParts(
  message: BoringChatMessage,
  toolRenderers?: ToolRendererOverrides,
  onResolveApproval?: ResolveApprovalHandler,
): ReactNode[] {
  const nodes: ReactNode[] = []
  let pendingTools: GroupedToolEntry[] = []

  const flushTools = () => {
    if (pendingTools.length === 0) return
    const firstKey = pendingTools[0]?.key ?? `tools:${nodes.length}`
    nodes.push(
      <div key={`tools:${firstKey}`} data-boring-agent-part="message-tools">
        <ToolCallGroup
          tools={pendingTools}
          mergedToolRenderers={toolRenderers ?? {}}
          onResolveApproval={onResolveApproval}
        />
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
          className={noticeSurfaceClass(part.level, 'text-xs')}
        >
          <div className={noticeTextClass()}>{part.text}</div>
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
  if ('id' in part && part.id) return `${messageId}:${part.type}:${part.id}`
  return `${messageId}:${part.type}:${index}`
}
