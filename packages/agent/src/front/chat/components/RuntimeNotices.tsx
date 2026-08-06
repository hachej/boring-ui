"use client"

import type { HTMLAttributes, ReactNode } from 'react'
import { memo } from 'react'
import { AlertTriangleIcon, InfoIcon, Loader2Icon, PlugZapIcon, RefreshCwIcon, XIcon } from 'lucide-react'
import { Button } from '@hachej/boring-ui-kit'
import { cn } from '../../lib'
import type { PiChatRuntimeNotice } from '../pi/piChatReducer'
import { noticeIconClass, noticeSurfaceClass, noticeTextClass } from './noticeStyles'
import { isTerminalChatErrorNotice } from './terminalChatErrors'

export type RuntimeNoticeKind = 'reconnect' | 'protocol' | 'warmup' | 'plugin' | 'retry' | 'generic'

export interface RuntimeNotice extends PiChatRuntimeNotice {
  kind?: RuntimeNoticeKind
  actionLabel?: string
}

export interface RuntimeNoticesProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  notices: RuntimeNotice[]
  onDismiss?: (id: string) => void
  onAction?: (id: string) => void
  /** Host-supplied action node for a notice, rendered before the built-in
   * onAction button. Lets a host attach a recovery action for a specific error
   * code without this component knowing the code. */
  renderAction?: (notice: RuntimeNotice) => ReactNode
  /** True when the transcript has no messages. Gates the terminal-error
   * presentation (plain-language title, collapsible details, reload action):
   * a terminal-error id like 'chat-error' can also carry a mid-conversation
   * turn failure that survived a snapshot resync, and that case must keep its
   * raw headline instead of claiming "history unavailable". */
  historyEmpty?: boolean
}

export const RuntimeNotices = memo(({ notices, onDismiss, onAction, renderAction, historyEmpty, className, ...props }: RuntimeNoticesProps) => {
  if (notices.length === 0) return null

  return (
    <div
      data-boring-agent-part="runtime-notices"
      className={cn('flex flex-col gap-2 px-4 py-2', className)}
      {...props}
    >
      {notices.map((notice) => (
        <RuntimeNoticeRow
          key={notice.id}
          notice={notice}
          onDismiss={onDismiss}
          onAction={onAction}
          renderAction={renderAction}
          historyEmpty={historyEmpty ?? false}
        />
      ))}
    </div>
  )
})

RuntimeNotices.displayName = 'RuntimeNotices'

interface RuntimeNoticeRowProps {
  notice: RuntimeNotice
  onDismiss?: (id: string) => void
  onAction?: (id: string) => void
  renderAction?: (notice: RuntimeNotice) => ReactNode
  historyEmpty: boolean
}

function RuntimeNoticeRow({ notice, onDismiss, onAction, renderAction, historyEmpty }: RuntimeNoticeRowProps) {
  const kind = inferNoticeKind(notice)
  const Icon = iconForNotice(kind, notice.level)
  const actionLabel = notice.actionLabel ?? defaultActionLabel(kind)
  const hostAction = renderAction?.(notice)
  // A terminal chat error means the transcript itself failed to load, with no
  // message history to show. See terminalChatErrors.ts for why this needs
  // both the id check and the empty-history gate.
  const isTerminalError = isTerminalChatErrorNotice(notice.id, historyEmpty)
  // Never stack a second action next to a host- or notice-supplied one: prefer
  // whichever the host/notice already set, and only fall back to the built-in
  // reload action when neither exists.
  const explicitAction = actionLabel && onAction
    ? <Button type="button" variant="ghost" size="sm" onClick={() => onAction(notice.id)}>{actionLabel}</Button>
    : null
  const primaryAction = hostAction
    ?? explicitAction
    ?? (isTerminalError ? (
      <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => window.location.reload()}>
        Reload workspace
      </Button>
    ) : null)

  return (
    <div
      role={notice.level === 'error' ? 'alert' : 'status'}
      aria-live={notice.level === 'error' ? 'assertive' : 'polite'}
      data-boring-agent-part="runtime-notice"
      data-runtime-notice-id={notice.id}
      data-runtime-notice-kind={kind}
      data-runtime-notice-level={notice.level}
      className={cn(
        noticeSurfaceClass(notice.level),
        'flex items-start gap-2.5 motion-reduce:transition-none',
      )}
    >
      <Icon className={cn(noticeIconClass(notice.level), kind === 'retry' && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {isTerminalError ? (
          <>
            <p className="text-sm font-semibold text-foreground">Chat history unavailable</p>
            <p className={noticeTextClass('mt-0.5')}>
              The saved conversation could not be loaded. Reload the workspace to try again.
            </p>
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Error details</summary>
              <p className="mt-1 break-words">{notice.text}</p>
            </details>
          </>
        ) : (
          <p className={noticeTextClass()}>{notice.text}</p>
        )}
      </div>
      {primaryAction}
      {notice.dismissible && onDismiss ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss notice"
          onClick={() => onDismiss(notice.id)}
          className="-mr-1 -mt-1 shrink-0 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-3" />
        </Button>
      ) : null}
    </div>
  )
}

function inferNoticeKind(notice: RuntimeNotice): RuntimeNoticeKind {
  if (notice.kind) return notice.kind
  if (notice.id.includes('reconnect')) return 'reconnect'
  if (notice.id.includes('protocol')) return 'protocol'
  if (notice.id.includes('warmup')) return 'warmup'
  if (notice.id.includes('plugin')) return 'plugin'
  if (notice.id.includes('retry')) return 'retry'
  return 'generic'
}

function iconForNotice(kind: RuntimeNoticeKind, level: RuntimeNotice['level']) {
  if (kind === 'reconnect') return RefreshCwIcon
  if (kind === 'warmup' || kind === 'retry') return Loader2Icon
  if (kind === 'plugin') return PlugZapIcon
  if (level === 'info') return InfoIcon
  return AlertTriangleIcon
}

function defaultActionLabel(kind: RuntimeNoticeKind): string | undefined {
  if (kind === 'reconnect') return 'Retry now'
  return undefined
}
