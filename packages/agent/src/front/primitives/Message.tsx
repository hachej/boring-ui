/**
 * Adapted from @ai-sdk/react's ai-elements (vercel-labs/ai).
 * Source: https://github.com/vercel-labs/ai/tree/main/packages/ai-elements
 * Copied: 2026-04-23. We own this file; upstream updates require re-port.
 */
import type { ReactNode } from 'react'

export interface MessageProps {
  role: 'user' | 'assistant' | 'system'
  children: ReactNode
  className?: string
  avatar?: ReactNode
}

export function Message({ role, children, className, avatar }: MessageProps) {
  return (
    <div
      className={className}
      data-role={role}
      style={{
        display: 'flex',
        gap: 'var(--boring-chat-message-gap, 0.75rem)',
        padding: 'var(--boring-chat-message-padding, 1rem)',
        flexDirection: role === 'user' ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
      }}
    >
      {avatar && (
        <div
          style={{
            flexShrink: 0,
            width: 'var(--boring-chat-avatar-size, 2rem)',
            height: 'var(--boring-chat-avatar-size, 2rem)',
          }}
        >
          {avatar}
        </div>
      )}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          background:
            role === 'user'
              ? 'var(--boring-chat-user-bg, transparent)'
              : 'var(--boring-chat-assistant-bg, transparent)',
          borderRadius: 'var(--boring-chat-message-radius, 0.5rem)',
          padding:
            role === 'user'
              ? 'var(--boring-chat-user-padding, 0.5rem 0.75rem)'
              : undefined,
        }}
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
  return (
    <div className={className} style={{ marginTop: 'var(--boring-chat-part-gap, 0.5rem)' }}>
      {children}
    </div>
  )
}
