/**
 * Adapted from @ai-sdk/react's ai-elements (vercel-labs/ai).
 * Source: https://github.com/vercel-labs/ai/tree/main/packages/ai-elements
 * Copied: 2026-04-23. We own this file; upstream updates require re-port.
 */
import type { ReactNode } from 'react'
import { cn } from '../lib'

export interface TerminalProps {
  children?: ReactNode
  stdout?: string
  stderr?: string
  exitCode?: number | null
  className?: string
  title?: string
}

export function Terminal({
  children,
  stdout,
  stderr,
  exitCode,
  className,
  title,
}: TerminalProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--boring-agent-terminal-radius,0.375rem)] bg-[var(--boring-agent-terminal-bg,#1e1e1e)] font-[family-name:var(--boring-agent-font-mono,monospace)] text-[0.8125rem] leading-normal text-[var(--boring-agent-terminal-fg,#d4d4d4)]',
        className,
      )}
    >
      {title && (
        <div className="border-b border-[var(--boring-agent-terminal-border,#404040)] bg-[var(--boring-agent-terminal-header-bg,#2d2d2d)] px-3 py-1.5 text-xs opacity-80">
          {title}
        </div>
      )}
      <div className="p-3">
        {children ?? (
          <>
            {stdout && (
              <pre data-stream="stdout" className="m-0 whitespace-pre-wrap">
                {stdout}
              </pre>
            )}
            {stderr && (
              <pre
                data-stream="stderr"
                className={cn(
                  'm-0 whitespace-pre-wrap text-[var(--boring-agent-terminal-stderr,#f87171)]',
                  stdout && 'mt-2',
                )}
              >
                {stderr}
              </pre>
            )}
          </>
        )}
      </div>
      {exitCode != null && (
        <div
          data-testid="exit-code"
          className={cn(
            'border-t border-[var(--boring-agent-terminal-border,#404040)] px-3 py-1 text-xs opacity-60',
            exitCode === 0
              ? 'text-[var(--boring-agent-terminal-success,#4ade80)]'
              : 'text-[var(--boring-agent-terminal-error,#f87171)]',
          )}
        >
          exit {exitCode}
        </div>
      )}
    </div>
  )
}
