"use client"

import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { Button } from '@hachej/boring-ui-kit'
import type { BoringChatMessage, BoringChatPart } from '../../../shared/chat'
import type { ToolRendererOverrides } from '../../bareToolRenderers'
import { cn } from '../../lib'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from '../../primitives/attachments'
import { Message, MessageContent, MessageResponse } from '../../primitives/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '../../primitives/reasoning'
import { ToolCallGroup, type GroupedToolEntry } from '../../primitives/tool-call-group'
import { noticeSurfaceClass, noticeTextClass } from './noticeStyles'

export interface PiTimelineMessageProps {
  message: BoringChatMessage
  isLast: boolean
  isStreaming: boolean
  showThoughts: boolean
  toolRenderers: ToolRendererOverrides
}

export function PiTimelineMessage({ message, isLast, isStreaming, showThoughts, toolRenderers }: PiTimelineMessageProps) {
  const role = message.role
  const isAssistant = role === 'assistant'
  const textParts = message.parts.filter((part): part is Extract<BoringChatPart, { type: 'text' }> => part.type === 'text')
  const fileParts = message.parts.filter((part): part is Extract<BoringChatPart, { type: 'file' }> => part.type === 'file')
  const finalParts = groupRenderableParts(message)
  const shouldReserveStreamingActions = isStreaming && isAssistant && isLast

  return (
    <Message
      from={role}
      data-boring-agent-part="message"
      data-boring-agent-message-id={message.id}
      data-boring-agent-message-role={role}
      data-boring-agent-message-status={message.status}
      className="!max-w-full !gap-1.5"
    >
      <MessageContent
        className={cn(
          '!overflow-visible text-[13px] leading-relaxed text-foreground',
          role === 'user'
            ? cn(
                '!ml-auto !max-w-[80%] !rounded-[var(--radius-lg)]',
                '!px-4 !py-2.5',
                '!bg-secondary !text-secondary-foreground',
              )
            : '!w-full !bg-transparent !p-0',
        )}
      >
        {fileParts.length > 0 ? (
          <Attachments
            variant="list"
            className={cn(
              'gap-1.5',
              role === 'user'
                ? '[&>div]:border-0 [&>div]:bg-transparent [&>div]:px-0 [&>div]:py-1 [&>div:hover]:bg-transparent'
                : undefined,
            )}
          >
            {fileParts.map((file, index) => (
              <Attachment key={`file-${message.id}-${index}`} data={toAttachmentData(file, `file-${message.id}-${index}`)}>
                <AttachmentPreview className="size-10 shrink-0 rounded-[var(--radius-md)]" />
                <AttachmentInfo className="min-w-0 flex-1" />
              </Attachment>
            ))}
          </Attachments>
        ) : null}
        {finalParts.map((item) => {
          if (item.kind === 'reasoning') {
            return (
              <TimelineReasoningPart
                key={item.key}
                item={item}
                showThoughts={showThoughts}
              />
            )
          }
          if (item.kind === 'tool-group') {
            return (
              <div key={item.key} data-boring-agent-part="message-tools">
                <ToolCallGroup tools={item.tools} mergedToolRenderers={toolRenderers} />
              </div>
            )
          }
          if (item.part.type === 'text') {
            return (
              <div key={item.key} data-boring-agent-part="message-text">
                <MessageResponse
                  className={cn(
                    'max-w-none',
                    'prose prose-invert prose-neutral',
                    'prose-p:my-3 prose-p:leading-[1.7] prose-p:text-[13px]',
                    'prose-headings:mt-5 prose-headings:mb-2 prose-headings:font-semibold prose-headings:tracking-[-0.01em]',
                    'prose-ul:my-3 prose-ul:pl-6 prose-ol:my-3 prose-ol:pl-6',
                    'prose-li:my-1.5 prose-li:leading-[1.7] prose-li:pl-1 prose-li:marker:text-muted-foreground/70',
                    'prose-strong:font-semibold prose-strong:text-foreground',
                    'prose-em:text-foreground/90',
                    'prose-a:text-[color:var(--accent)] prose-a:underline-offset-4 hover:prose-a:underline',
                    'prose-code:before:content-none prose-code:after:content-none',
                    'prose-pre:my-0 prose-pre:rounded-none prose-pre:border-0',
                    'prose-pre:bg-transparent prose-pre:p-0',
                  )}
                >
                  {item.part.text}
                </MessageResponse>
              </div>
            )
          }
          if (item.part.type === 'notice') {
            return <NoticeBubble key={item.key} level={item.part.level} text={item.part.text} />
          }
          return null
        })}
      </MessageContent>
      {isAssistant && (textParts.length > 0 || shouldReserveStreamingActions) ? (
        <MessageActionsBar
          text={textParts.map((part) => part.text).join('\n\n')}
          visible={!isStreaming}
        />
      ) : null}
    </Message>
  )
}

function TimelineReasoningPart({ item, showThoughts }: { item: Extract<RenderablePart, { kind: 'reasoning' }>; showThoughts: boolean }) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const isStreaming = item.state === 'streaming'
  const isOpen = manualOpen ?? showThoughts

  useEffect(() => {
    setManualOpen(null)
  }, [showThoughts])

  const handleOpenChange = useCallback((open: boolean) => {
    setManualOpen(open)
  }, [])

  const toggleManualOpen = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setManualOpen((open) => !(open ?? showThoughts))
  }, [showThoughts])

  return (
    <Reasoning
      data-boring-agent-part="message-reasoning"
      isStreaming={isStreaming}
      defaultOpen={false}
      open={isOpen}
      onOpenChange={handleOpenChange}
      autoClose={false}
    >
      <ReasoningTrigger
        className="mb-1 w-fit rounded-[var(--radius-sm)] px-0 py-0 !text-xs !font-normal !text-muted-foreground/75 hover:bg-transparent hover:!text-muted-foreground/75 [&_svg]:!text-muted-foreground/75"
        getThinkingMessage={(streaming) => <span>{streaming ? 'thinking' : 'thoughts'}</span>}
        onClick={toggleManualOpen}
      />
      <ReasoningContent>{item.text}</ReasoningContent>
    </Reasoning>
  )
}

type RenderablePart =
  | { kind: 'reasoning'; key: string; text: string; state?: Extract<BoringChatPart, { type: 'reasoning' }>['state'] }
  | { kind: 'part'; key: string; part: Exclude<BoringChatPart, { type: 'reasoning' | 'tool-call' | 'file' }> }
  | { kind: 'tool-group'; key: string; tools: GroupedToolEntry[] }

function groupRenderableParts(message: BoringChatMessage): RenderablePart[] {
  const grouped: RenderablePart[] = []
  let pendingTools: GroupedToolEntry[] = []

  const flushTools = () => {
    if (pendingTools.length === 0) return
    grouped.push({ kind: 'tool-group', key: `tools:${pendingTools[0]?.key ?? grouped.length}`, tools: pendingTools })
    pendingTools = []
  }

  message.parts.forEach((part, index) => {
    const key = partKey(message.id, part, index)
    if (part.type === 'file') return
    if (part.type === 'tool-call') {
      pendingTools.push({ part, key })
      return
    }
    flushTools()
    if (part.type === 'reasoning') {
      const previous = grouped[grouped.length - 1]
      if (previous?.kind === 'reasoning') {
        previous.text = `${previous.text}\n\n${part.text}`
        if (part.state === 'streaming') previous.state = 'streaming'
      } else {
        grouped.push({ kind: 'reasoning', key, text: part.text, state: part.state })
      }
      return
    }
    grouped.push({ kind: 'part', key, part })
  })

  flushTools()
  return grouped
}

function NoticeBubble({ level, text }: { level: 'info' | 'warning' | 'error'; text: string }) {
  return (
    <div
      data-boring-agent-part="message-notice"
      data-notice-level={level}
      className={noticeSurfaceClass(level, 'text-xs')}
    >
      <div className={noticeTextClass()}>
        {text}
      </div>
    </div>
  )
}

function MessageActionsBar({
  text,
  visible = true,
}: {
  text: string
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
      } catch {}
    }
    if (typeof document === 'undefined') return
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      if (document.execCommand('copy')) markCopied()
    } catch {
    } finally {
      document.body.removeChild(textarea)
    }
  }
  const iconActionBtnClass = cn(
    'inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)]',
    'text-muted-foreground/35 transition-colors',
    'hover:bg-foreground/[0.04] hover:text-muted-foreground/80',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--accent)]/40',
  )
  const hiddenActionProps = visible ? {} : { tabIndex: -1 }
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'flex min-h-6 items-center gap-0.5 -mt-1 transition-opacity duration-200',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={handleCopy}
        className={iconActionBtnClass}
        aria-label={copied ? 'Copied' : 'Copy message'}
        title={copied ? 'Copied' : 'Copy'}
        {...hiddenActionProps}
      >
        {copied ? <CheckIcon className="h-3.5 w-3.5 text-[color:var(--accent)]" /> : <CopyIcon className="h-3.5 w-3.5" />}
      </Button>
    </div>
  )
}

function toAttachmentData(part: Extract<BoringChatPart, { type: 'file' }>, fallbackId: string) {
  return {
    type: 'file' as const,
    id: part.id ?? part.url ?? part.filename ?? fallbackId,
    filename: part.filename,
    mediaType: part.mediaType ?? 'application/octet-stream',
    url: part.url ?? '',
  }
}

function partKey(messageId: string, part: BoringChatPart, index: number): string {
  if ('id' in part && part.id) return `${messageId}:${part.type}:${part.id}`
  return `${messageId}:${part.type}:${index}`
}
