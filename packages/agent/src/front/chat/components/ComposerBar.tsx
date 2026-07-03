"use client"

import type { KeyboardEvent, ReactNode } from 'react'
import { memo, useCallback, useEffect, useRef } from 'react'
import { AlertCircleIcon, ListRestartIcon } from 'lucide-react'
import { TooltipProvider } from '@hachej/boring-ui-kit'
import type { PiChatStatus, QueuedUserMessage } from '../../../shared/chat'
import { cn } from '../../lib'
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
  type PromptInputProps,
} from '../../primitives/prompt-input'
import { PromptInputButton } from '../../primitives/prompt-input-wrappers'
import { noticeIconClass, noticeSurfaceClass, noticeTextClass } from './noticeStyles'

export interface ComposerSendPayload {
  text: string
  files: PromptInputMessage['files']
}

export interface ComposerBarProps extends Omit<PromptInputProps, 'children' | 'onSubmit'> {
  status: PiChatStatus
  value?: string
  defaultValue?: string
  placeholder?: string
  disabled?: boolean
  queuePreview?: QueuedUserMessage[]
  commandError?: string
  leftControls?: ReactNode
  rightControls?: ReactNode
  /** Increment/change this value to restore focus to the composer textarea. */
  focusSignal?: unknown
  onValueChange?: (value: string) => void
  onSend: (payload: ComposerSendPayload) => false | void | Promise<false | void>
  onStop?: () => void
  onEditQueued?: (followUps: QueuedUserMessage[]) => void
  onEscape?: () => void
}

export const ComposerBar = memo(({
  status,
  value,
  defaultValue,
  placeholder = 'Message the agent…',
  disabled = false,
  queuePreview = [],
  commandError,
  leftControls,
  rightControls,
  focusSignal,
  onValueChange,
  onSend,
  onStop,
  onEditQueued,
  onEscape,
  className,
  ...promptInputProps
}: ComposerBarProps) => {
  const isBusy = status === 'submitted' || status === 'streaming' || status === 'aborting'
  const submitStatus = toPromptSubmitStatus(status)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (focusSignal === undefined) return
    rootRef.current?.querySelector<HTMLTextAreaElement>('[data-boring-agent-part="composer-input"]')?.focus()
  }, [focusSignal])

  const handleSubmit = useCallback((input: PromptInputMessage) => {
    const text = input.text.trim()
    if (!text && input.files.length === 0) return false
    return onSend({ text, files: input.files })
  }, [onSend])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Escape') return
    if (!onEscape && !(isBusy && onStop)) return
    event.preventDefault()
    if (isBusy && onStop) onStop()
    else onEscape?.()
  }, [isBusy, onEscape, onStop])

  return (
    <TooltipProvider>
      <div ref={rootRef} data-boring-agent-part="composer-bar" className={cn('border-t bg-background/95 p-3', className)}>
      <QueuedFollowUpsPreview followUps={queuePreview} onEditQueued={onEditQueued} />
      {commandError ? (
        <div
          role="alert"
          data-boring-agent-part="composer-command-error"
          className={cn(noticeSurfaceClass('error'), 'mb-2 flex items-start gap-2.5')}
        >
          <AlertCircleIcon className={noticeIconClass('error')} aria-hidden="true" />
          <span className={noticeTextClass('flex-1')}>{commandError}</span>
        </div>
      ) : null}
      <PromptInput onSubmit={handleSubmit} className="relative" {...promptInputProps}>
        <PromptInputTextarea
          value={value}
          defaultValue={defaultValue}
          onChange={(event) => onValueChange?.(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          aria-label="Agent prompt"
        />
        <PromptInputFooter data-boring-agent-part="composer-footer">
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger aria-label="Add attachment" disabled={disabled} />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            {leftControls}
          </PromptInputTools>
          <PromptInputTools>
            {rightControls}
            <PromptInputSubmit
              status={submitStatus}
              onStop={onStop}
              disabled={disabled || (status === 'hydrating' && !onStop)}
              data-boring-agent-part="composer-submit"
            />
          </PromptInputTools>
        </PromptInputFooter>
        </PromptInput>
      </div>
    </TooltipProvider>
  )
})

ComposerBar.displayName = 'ComposerBar'

function toPromptSubmitStatus(status: PiChatStatus): 'ready' | 'submitted' | 'streaming' | 'error' {
  if (status === 'submitted' || status === 'hydrating') return 'submitted'
  if (status === 'streaming' || status === 'aborting') return 'streaming'
  if (status === 'error') return 'error'
  return 'ready'
}

interface QueuedFollowUpsPreviewProps {
  followUps: QueuedUserMessage[]
  onEditQueued?: (followUps: QueuedUserMessage[]) => void
}

function QueuedFollowUpsPreview({ followUps, onEditQueued }: QueuedFollowUpsPreviewProps) {
  if (followUps.length === 0) return null
  return (
    <div
      data-boring-agent-part="composer-queue-preview"
      className="mb-2 flex items-start justify-between gap-3 rounded-md border border-dashed border-[color:var(--border)] bg-[color:oklch(from_var(--muted)_l_c_h/0.45)] px-3 py-2 text-sm text-[color:var(--foreground)] motion-reduce:transition-none"
    >
      <div className="min-w-0 text-[color:var(--muted-foreground)]">
        <div className="font-medium text-[color:var(--foreground)]">{followUps.length} queued follow-up{followUps.length === 1 ? '' : 's'}</div>
        <div className="truncate text-[color:var(--muted-foreground)]" data-boring-agent-part="composer-queue-preview-text">
          {followUps.map((followUp) => followUp.displayText).join(' · ')}
        </div>
      </div>
      {onEditQueued ? (
        <PromptInputButton
          type="button"
          tooltip="Edit queued follow-ups"
          onClick={() => onEditQueued(followUps)}
          aria-label="Edit queued follow-ups"
        >
          <ListRestartIcon className="size-4" />
        </PromptInputButton>
      ) : null}
    </div>
  )
}
