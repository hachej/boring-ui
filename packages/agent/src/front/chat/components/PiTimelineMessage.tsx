"use client"

import type { ComponentProps, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { Button } from '@hachej/boring-ui-kit'
import type { BoringChatMessage, BoringChatPart } from '../../../shared/chat'
import { useOpenArtifact } from '../../ArtifactOpenContext'
import { resolveToolRendererForPart, toToolPart, type ToolRendererOverrides } from '../../bareToolRenderers'
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
import { TextWithClickableMentions } from './TextWithClickableMentions'
import type { ClickableMention } from './ClickableMention'

/**
 * Read-only / inspection tools collapse into the grouped "Used X · Y" summary;
 * everything else (bash, write, edit, and any tool with side effects) renders as
 * an individual card, expanded by default, so the command / diff / output is
 * visible without a click. Tweak this set to change which tools stay collapsed.
 */
const COLLAPSIBLE_TOOL_NAMES = new Set([
  'read', 'ls', 'find', 'grep', 'search', 'web_search', 'code_search', 'fetch_content',
])

function isCollapsibleTool(part: BoringChatPart): boolean {
  return part.type === 'tool-call' && COLLAPSIBLE_TOOL_NAMES.has(part.toolName)
}

export interface PiTimelineMessageProps {
  message: BoringChatMessage
  isLast: boolean
  isStreaming: boolean
  showThoughts: boolean
  toolRenderers: ToolRendererOverrides
  availableCommands?: string[]
  onMentionClick?: (mention: ClickableMention) => void
}

export function PiTimelineMessage({ message, isLast, isStreaming, showThoughts, toolRenderers, availableCommands, onMentionClick }: PiTimelineMessageProps) {
  const role = message.role
  const isAssistant = role === 'assistant'
  const textParts = message.parts.filter((part): part is Extract<BoringChatPart, { type: 'text' }> => part.type === 'text')
  const fileParts = message.parts.filter((part): part is Extract<BoringChatPart, { type: 'file' }> => part.type === 'file')
  const finalParts = groupRenderableParts(message)
  const attachmentSummaryPaths = role === 'user' ? attachmentPathsFromTextParts(textParts) : []
  const openArtifact = useOpenArtifact()
  const handleMentionClick = useCallback((mention: ClickableMention) => {
    if (mention.kind === 'file-path') {
      openArtifact?.(stripPathLocationSuffix(mention.value))
      return
    }
    onMentionClick?.(mention)
  }, [onMentionClick, openArtifact])
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
            variant={role === 'user' ? 'inline' : 'list'}
            className={cn(
              role === 'user' ? 'mb-2 w-full gap-2' : 'gap-1.5',
              role === 'user'
                ? '[&>div]:max-w-full [&>div]:border-input/60 [&>div]:bg-background/35 [&>div]:px-1.5 [&>div]:text-secondary-foreground [&>div:hover]:bg-background/45'
                : undefined,
            )}
          >
            {fileParts.map((file, index) => {
              const openPath = file.path ?? attachmentSummaryPaths[index]
              const openUrl = file.url && !openPath ? file.url : undefined
              const canOpen = Boolean((openArtifact && openPath) || openUrl)
              const openAttachment = () => {
                if (openPath) {
                  if (file.filesystem) openArtifact?.(openPath, { filesystem: file.filesystem })
                  else openArtifact?.(openPath)
                  return
                }
                if (openUrl) window.open(openUrl, '_blank', 'noopener,noreferrer')
              }
              const openAttachmentFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                openAttachment()
              }

              return (
                <Attachment
                  key={`file-${message.id}-${index}`}
                  data={toAttachmentData(file, `file-${message.id}-${index}`)}
                  {...(canOpen
                    ? {
                        role: 'button',
                        tabIndex: 0,
                        title: openPath ? `Open ${openPath} in workspace` : `Open ${file.filename ?? 'attachment'}`,
                        'aria-label': openPath ? `Open ${file.filename ?? openPath} in workspace` : `Open ${file.filename ?? 'attachment'}`,
                        ...(openPath ? { 'data-workspace-path': openPath } : {}),
                        onClick: openAttachment,
                        onKeyDown: openAttachmentFromKeyboard,
                      }
                    : undefined)}
                >
                  <AttachmentPreview className={role === 'user' ? '!size-5 shrink-0 rounded-[var(--radius-sm)]' : 'size-10 shrink-0 rounded-[var(--radius-md)]'} />
                  <AttachmentInfo className={role === 'user' ? 'min-w-0 max-w-[220px] flex-1 text-[12px]' : 'min-w-0 flex-1'} />
                </Attachment>
              )
            })}
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
          if (item.kind === 'tool-plain') {
            return (
              <div key={item.key} data-boring-agent-part="message-tools">
                <PlainToolCard part={item.part} renderers={toolRenderers} />
              </div>
            )
          }
          if (item.part.type === 'text') {
            const text = textForMessageDisplay(item.part.text, role)
            if (!text) return null
            const mentionMarkdownComponents = role === 'assistant' && availableCommands
              ? createMentionMarkdownComponents(availableCommands, handleMentionClick)
              : undefined
            return (
              <div key={item.key} data-boring-agent-part="message-text">
                <MessageResponse
                  components={mentionMarkdownComponents}
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
                  {text}
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

type MentionMarkdownComponents = NonNullable<ComponentProps<typeof MessageResponse>['components']>

function stripPathLocationSuffix(path: string): string {
  return path.replace(/:\d+(?::\d+)?$/, '')
}

function createMentionMarkdownComponents(
  availableCommands: string[],
  onMentionClick: ((mention: ClickableMention) => void) | undefined,
): MentionMarkdownComponents {
  const decorate = (children: ReactNode): ReactNode => {
    if (typeof children === 'string') {
      return (
        <TextWithClickableMentions availableCommands={availableCommands} onMentionClick={onMentionClick}>
          {children}
        </TextWithClickableMentions>
      )
    }
    if (Array.isArray(children)) {
      return children.map((child, index) => (
        <Fragment key={index}>{decorate(child)}</Fragment>
      ))
    }
    return children
  }

  const Paragraph = ({ children, ...props }: ComponentProps<'p'>) => <p {...props}>{decorate(children)}</p>
  const ListItem = ({ children, ...props }: ComponentProps<'li'>) => <li {...props}>{decorate(children)}</li>
  const Heading1 = ({ children, ...props }: ComponentProps<'h1'>) => <h1 {...props}>{decorate(children)}</h1>
  const Heading2 = ({ children, ...props }: ComponentProps<'h2'>) => <h2 {...props}>{decorate(children)}</h2>
  const Heading3 = ({ children, ...props }: ComponentProps<'h3'>) => <h3 {...props}>{decorate(children)}</h3>
  const Heading4 = ({ children, ...props }: ComponentProps<'h4'>) => <h4 {...props}>{decorate(children)}</h4>
  const Blockquote = ({ children, ...props }: ComponentProps<'blockquote'>) => <blockquote {...props}>{decorate(children)}</blockquote>
  const Code = ({
    inline,
    className,
    children,
    ...props
  }: {
    inline?: boolean
    className?: string
    children?: ReactNode
  } & Record<string, unknown>) => {
    const text = typeof children === 'string' ? children : undefined
    const commandName = text?.match(/^\/(\w[\w-]*)$/)?.[1]
    if (inline !== false && commandName && availableCommands.includes(commandName)) {
      return (
        <TextWithClickableMentions availableCommands={availableCommands} onMentionClick={onMentionClick}>
          {text}
        </TextWithClickableMentions>
      )
    }
    return (
      <code
        className={cn(
          inline === false ? undefined : 'rounded-[0.3em] bg-muted/55 px-[0.32em] py-[0.08em] font-mono text-[0.9em] font-medium text-foreground/90',
          className,
        )}
        {...props}
      >
        {children}
      </code>
    )
  }

  return {
    p: Paragraph,
    li: ListItem,
    h1: Heading1,
    h2: Heading2,
    h3: Heading3,
    h4: Heading4,
    blockquote: Blockquote,
    code: Code,
  } as MentionMarkdownComponents
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

/**
 * Renders a single action tool as its own standalone card (collapsed by
 * default; click the header to expand). Unlike read-only tools it is not folded
 * into the grouped "Used X · Y" summary — each action tool gets its own row.
 */
function PlainToolCard({ part, renderers }: { part: Extract<BoringChatPart, { type: 'tool-call' }>; renderers: ToolRendererOverrides }) {
  const toolPart = toToolPart(part)
  if (!toolPart) return null
  const { renderer, part: resolved, resolution } = resolveToolRendererForPart(toolPart, renderers)
  return (
    <div
      data-tool-call-id={resolved.toolCallId}
      data-tool-renderer-key={resolution.key}
      data-tool-renderer-source={resolution.source}
    >
      {renderer(resolved)}
    </div>
  )
}

type RenderablePart =
  | { kind: 'reasoning'; key: string; text: string; state?: Extract<BoringChatPart, { type: 'reasoning' }>['state'] }
  | { kind: 'part'; key: string; part: Exclude<BoringChatPart, { type: 'reasoning' | 'tool-call' | 'file' }> }
  | { kind: 'tool-group'; key: string; tools: GroupedToolEntry[] }
  | { kind: 'tool-plain'; key: string; part: Extract<BoringChatPart, { type: 'tool-call' }> }

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
      if (isCollapsibleTool(part)) {
        // read-only tools accumulate into the collapsed group summary.
        pendingTools.push({ part, key })
      } else {
        // action tools (bash/write/edit/…) render plain + expanded, each on
        // its own — so break any pending read-only group first.
        flushTools()
        grouped.push({ kind: 'tool-plain', key, part })
      }
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

function textForMessageDisplay(text: string, role: BoringChatMessage['role']): string {
  if (role !== 'user') return text
  return stripAttachmentSummaryBlocks(text)
}

function stripAttachmentSummaryBlocks(text: string): string {
  const lines = text.split('\n')
  const firstSummaryIndex = lines.findIndex(isAttachmentSummaryLine)
  if (firstSummaryIndex < 0) return text
  return lines.slice(0, firstSummaryIndex).join('\n').trim()
}

function isAttachmentSummaryLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('[attached: ')
    || (trimmed.startsWith('<attachment ') && trimmed.includes('data-boring-agent="composer-file"'))
}

function attachmentPathsFromTextParts(parts: Extract<BoringChatPart, { type: 'text' }>[]): string[] {
  return parts.flatMap((part) => part.text.split('\n').flatMap((line) => {
    const trimmed = line.trim()
    const taggedPath = attachmentTagAttr(trimmed, 'path')
    if (taggedPath) return [taggedPath]
    const oldInline = trimmed.match(/^\[attached: .+ Saved in workspace at: (.+?) Use the workspace file\/read tools/)
    if (oldInline?.[1]) return [oldInline[1]]
    const oldMultiline = trimmed.match(/^Saved in workspace at: (.+)$/)
    return oldMultiline?.[1] ? [oldMultiline[1]] : []
  }))
}

function attachmentTagAttr(line: string, name: string): string | undefined {
  if (!line.startsWith('<attachment ') || !line.includes('data-boring-agent="composer-file"')) return undefined
  const match = line.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match?.[1] ? unescapeAttachmentAttr(match[1]) : undefined
}

function unescapeAttachmentAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
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
