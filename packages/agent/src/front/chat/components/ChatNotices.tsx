"use client"

import { AlertCircleIcon, ListRestartIcon, Loader2, XIcon } from 'lucide-react'
import { IconButton } from '@hachej/boring-ui-kit'
import type { QueuedUserMessage } from '../../../shared/chat'
import { ErrorCode } from '../../../shared/error-codes'
import { cn } from '../../lib'
import { Message, MessageContent } from '../../primitives/message'

export interface PanelNotice {
  id: string
  level: 'info' | 'warning' | 'error'
  text: string
  dismissible?: boolean
}

export interface ComposerBlockerAction {
  id: string
  label: string
}

export interface ComposerBlocker {
  id: string
  reason?: string
  label?: string
  sessionId?: string
  actions?: ComposerBlockerAction[]
  surfaceKind?: string
  target?: unknown
}

export function RuntimeNoticeMessages({ notices, onDismiss }: { notices: PanelNotice[]; onDismiss: (id: string) => void }) {
  const visible = notices.filter((notice) =>
    notice.level === 'error' ||
    notice.level === 'warning' ||
    notice.id === 'connection-reconnecting' ||
    notice.id === 'auto-retry' ||
    notice.id === 'large-state-warning' ||
    notice.id.startsWith('command:') ||
    notice.id.startsWith('composer-warning:'),
  )
  if (visible.length === 0) return null
  return (
    <div data-boring-agent-part="runtime-notices" className="contents">
      {visible.map((notice) => (
        <Message key={notice.id} from="assistant" className="!max-w-full">
          <MessageContent className={cn(
            'rounded-xl border px-4 py-3',
            notice.level === 'error'
              ? 'border-destructive/40 bg-destructive/10'
              : 'border-accent/40 bg-[color:var(--accent-soft)]',
          )}>
            <div
              role={notice.level === 'error' ? 'alert' : 'status'}
              aria-live={notice.level === 'error' ? 'assertive' : 'polite'}
              data-boring-agent-part="runtime-notice"
              data-runtime-notice-id={notice.id}
              data-runtime-notice-level={notice.level}
              className={cn('flex items-start gap-3 text-sm', notice.level === 'error' ? 'text-destructive' : 'text-foreground')}
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <NoticeText className="flex-1">{notice.text}</NoticeText>
              {notice.dismissible ? (
                <IconButton
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onDismiss(notice.id)}
                  className="shrink-0 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
                  aria-label="Dismiss notice"
                >
                  <XIcon className="size-3" aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
          </MessageContent>
        </Message>
      ))}
    </div>
  )
}

export function ComposerRuntimeNotice({ notice }: { notice: { title: string; detail?: string; code?: string } }) {
  return (
    <div
      data-testid="chat-composer-runtime-notice"
      role="status"
      aria-live="polite"
      className={cn(
        'mx-auto mb-2 w-full max-w-3xl rounded-[var(--radius-md)] border border-accent/40 bg-[color:var(--accent-soft)]',
        'px-3 py-2 text-xs text-foreground',
      )}
    >
      <div className="flex items-start gap-2">
        {notice.code === ErrorCode.enum.AGENT_RUNTIME_NOT_READY ? (
          <Loader2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <AlertCircleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        )}
        <div className="min-w-0">
          <div className="font-medium">{notice.title}</div>
          {notice.detail ? <NoticeText className="mt-0.5 text-muted-foreground">{notice.detail}</NoticeText> : null}
        </div>
      </div>
    </div>
  )
}

function NoticeText({ className, children }: { className?: string; children: string }) {
  return (
    <div className={cn('min-w-0 whitespace-pre-wrap break-words leading-5 [overflow-wrap:anywhere]', className)}>
      {children}
    </div>
  )
}

export function ComposerBlockerNotice({
  blocker,
  label,
  onAction,
}: {
  blocker?: ComposerBlocker
  label: string
  onAction?: (blocker: ComposerBlocker, action: string) => void
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'mx-auto mb-2 w-full max-w-3xl rounded-[var(--radius-md)] border border-primary/30 bg-primary/10',
        'px-3 py-2 text-xs text-foreground',
      )}
    >
      <span>{label}</span>
      {blocker?.actions?.map((action) => (
        <button
          key={action.id}
          type="button"
          className="ml-2 rounded border border-primary/30 px-2 py-0.5 text-[11px] font-medium hover:bg-primary/10"
          onClick={() => onAction?.(blocker, action.id)}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}

export function QueuedComposerNotice({ followUps, onEdit }: { followUps: QueuedUserMessage[]; onEdit: () => void }) {
  return (
    <div
      data-boring-agent-part="composer-queue-preview"
      className={cn(
        'mx-auto mb-2 flex w-full max-w-3xl items-start justify-between gap-3 rounded-[var(--radius-md)]',
        'border border-dashed border-[color:var(--border)] bg-[color:oklch(from_var(--muted)_l_c_h/0.45)] px-3 py-2 text-xs text-[color:var(--foreground)]',
      )}
    >
      <div className="min-w-0 text-[color:var(--muted-foreground)]">
        <div className="font-medium text-[color:var(--foreground)]">{followUps.length} queued follow-up{followUps.length === 1 ? '' : 's'}</div>
        <div className="truncate text-[color:var(--muted-foreground)]" data-boring-agent-part="composer-queue-preview-text">
          {followUps.map((followUp) => followUp.displayText).join(' - ')}
        </div>
      </div>
      <IconButton
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onEdit}
        className="shrink-0 text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)] hover:text-[color:var(--foreground)]"
        aria-label="Edit queued follow-ups"
        title="Edit queued follow-ups"
      >
        <ListRestartIcon className="size-3.5" aria-hidden="true" />
      </IconButton>
    </div>
  )
}
