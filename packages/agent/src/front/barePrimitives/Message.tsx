/**
 * Adapted from @ai-sdk/react's ai-elements (vercel-labs/ai).
 * Source: https://github.com/vercel-labs/ai/tree/main/packages/ai-elements
 * Copied: 2026-04-23. We own this file; upstream updates require re-port.
 */
import type { ReactNode } from 'react'
import { cn } from '../lib'

export interface MessageProps {
  role: 'user' | 'assistant' | 'system'
  children: ReactNode
  className?: string
  avatar?: ReactNode
}

export function Message({ role, children, className, avatar }: MessageProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-[var(--boring-agent-message-gap,0.75rem)] p-[var(--boring-agent-message-padding,1rem)]',
        role === 'user' && 'flex-row-reverse',
        className,
      )}
      data-role={role}
    >
      {avatar && (
        <div className="size-[var(--boring-agent-avatar-size,2rem)] shrink-0">
          {avatar}
        </div>
      )}
      <div
        className={cn(
          'min-w-0 flex-1 rounded-[var(--boring-agent-message-radius,0.5rem)]',
          role === 'user'
            ? 'bg-[var(--boring-agent-user-bg,transparent)] p-[var(--boring-agent-user-padding,0.5rem_0.75rem)]'
            : 'bg-[var(--boring-agent-assistant-bg,transparent)]',
        )}
      >
        {children}
      </div>
    </div>
  )
}

export interface MessagePartContainerProps {
  children: ReactNode
  className?: string
}

export function MessagePartContainer({ children, className }: MessagePartContainerProps) {
  return <div className={cn('mt-[var(--boring-agent-part-gap,0.5rem)]', className)}>{children}</div>
}
