"use client"

import type { ReactNode } from 'react'
import { cn } from '../../lib'

/**
 * Generic clickable mention pattern - matches various mention types:
 * - Slash commands: /command
 * - File paths: @path/to/file
 * - Skills: !skill-name
 * - Future: #tags, $variables, etc.
 */
export interface ClickableMention {
  kind: 'slash-command' | 'file-path' | 'skill' | string
  value: string
  label: string
  data?: Record<string, string>
}

export interface ClickableMentionLinkProps {
  mention: ClickableMention
  onClick?: (mention: ClickableMention) => void
  className?: string
  'aria-disabled'?: boolean
  title?: string
  children?: ReactNode
}

export function ClickableMentionLink({ mention, onClick, className, 'aria-disabled': ariaDisabled, title, children, ...rest }: ClickableMentionLinkProps) {
  const disabled = ariaDisabled === true
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) onClick?.(mention)
  }

  const kindStyles = {
    'slash-command': 'border-[color:var(--accent)]/30 bg-[color:var(--accent-soft)] text-[color:var(--accent)] hover:border-[color:var(--accent)]/50 hover:bg-[color:var(--accent-soft)]/80',
    'file-path': 'border-border/60 bg-muted/50 text-foreground hover:bg-muted',
    'skill': 'border-[color:var(--accent)]/20 bg-[color:var(--accent-soft)]/50 text-[color:var(--accent)] hover:bg-[color:var(--accent-soft)]',
  }

  const style = kindStyles[mention.kind as keyof typeof kindStyles] ?? 'border-border/60 bg-muted/30 text-muted-foreground'

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[12px] font-medium no-underline transition-colors',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        style,
        className,
      )}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      title={title}
      onClick={handleClick}
      {...rest}
    >
      {mention.label}
    </button>
  )
}
