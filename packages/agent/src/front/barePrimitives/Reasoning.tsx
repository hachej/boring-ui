/**
 * Adapted from @ai-sdk/react's ai-elements (vercel-labs/ai).
 * Source: https://github.com/vercel-labs/ai/tree/main/packages/ai-elements
 * Copied: 2026-04-23. We own this file; upstream updates require re-port.
 */
import { useState, type ReactNode } from 'react'

export interface ReasoningProps {
  text: string
  state?: 'streaming' | 'done'
  className?: string
  defaultExpanded?: boolean
  label?: string
  children?: ReactNode
}

export function Reasoning({
  text,
  state = 'done',
  className,
  defaultExpanded = false,
  label,
  children,
}: ReasoningProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const isStreaming = state === 'streaming'

  const displayLabel = label ?? (isStreaming ? 'Thinking…' : 'Thought process')

  return (
    <div
      className={className}
      data-state={state}
      style={{
        border: '1px solid var(--boring-agent-reasoning-border, #e5e7eb)',
        borderRadius: 'var(--boring-agent-reasoning-radius, 0.375rem)',
        overflow: 'hidden',
        fontSize: 'var(--boring-agent-font-size, 0.875rem)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          width: '100%',
          padding: '0.5rem 0.75rem',
          background: 'var(--boring-agent-reasoning-header-bg, #f9fafb)',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontSize: '0.8125rem',
          color: 'var(--boring-agent-reasoning-fg, inherit)',
        }}
        aria-expanded={expanded}
      >
        <span style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }}>
          ▶
        </span>
        <span style={{ opacity: 0.7 }}>{displayLabel}</span>
        {isStreaming && (
          <span
            style={{
              marginLeft: 'auto',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--boring-agent-reasoning-streaming, #8b5cf6)',
              animation: 'boring-pulse 1.5s ease-in-out infinite',
            }}
            aria-label="streaming"
          />
        )}
      </button>

      {expanded && (
        <div
          style={{
            padding: '0.75rem',
            borderTop: '1px solid var(--boring-agent-reasoning-border, #e5e7eb)',
            whiteSpace: 'pre-wrap',
            color: 'var(--boring-agent-reasoning-text, #6b7280)',
            fontSize: '0.8125rem',
            lineHeight: 1.6,
          }}
        >
          {children ?? text}
        </div>
      )}
    </div>
  )
}
