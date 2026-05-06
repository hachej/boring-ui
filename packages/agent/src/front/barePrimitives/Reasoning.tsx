/**
 * Adapted from @ai-sdk/react's ai-elements (vercel-labs/ai).
 * Source: https://github.com/vercel-labs/ai/tree/main/packages/ai-elements
 * Copied: 2026-04-23. We own this file; upstream updates require re-port.
 */
import { useState, type ReactNode } from 'react'
import { Button } from '@hachej/boring-ui-kit
import { cn } from '../lib'

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
      className={cn(
        'overflow-hidden rounded-[var(--boring-agent-reasoning-radius,0.375rem)] border border-[var(--boring-agent-reasoning-border,#e5e7eb)] text-[length:var(--boring-agent-font-size,0.875rem)]',
        className,
      )}
      data-state={state}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={() => setExpanded((v) => !v)}
        className="h-auto w-full justify-start gap-2 rounded-none bg-[var(--boring-agent-reasoning-header-bg,#f9fafb)] px-3 py-2 text-left text-[0.8125rem] text-[var(--boring-agent-reasoning-fg,inherit)]"
        aria-expanded={expanded}
      >
        <span className={cn('transition-transform duration-150', expanded && 'rotate-90')}>▶</span>
        <span className="opacity-70">{displayLabel}</span>
        {isStreaming && (
          <span
            className="ml-auto size-1.5 animate-pulse rounded-full bg-[var(--boring-agent-reasoning-streaming,#8b5cf6)]"
            aria-label="streaming"
          />
        )}
      </Button>

      {expanded && (
        <div className="whitespace-pre-wrap border-t border-[var(--boring-agent-reasoning-border,#e5e7eb)] p-3 text-[0.8125rem] leading-relaxed text-[var(--boring-agent-reasoning-text,#6b7280)]">
          {children ?? text}
        </div>
      )}
    </div>
  )
}
