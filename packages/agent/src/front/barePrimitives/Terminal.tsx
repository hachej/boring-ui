/**
 * Adapted from @ai-sdk/react's ai-elements (vercel-labs/ai).
 * Source: https://github.com/vercel-labs/ai/tree/main/packages/ai-elements
 * Copied: 2026-04-23. We own this file; upstream updates require re-port.
 */
import type { ReactNode } from 'react'

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
      className={className}
      style={{
        background: 'var(--boring-chat-terminal-bg, #1e1e1e)',
        color: 'var(--boring-chat-terminal-fg, #d4d4d4)',
        borderRadius: 'var(--boring-chat-terminal-radius, 0.375rem)',
        fontFamily: 'var(--boring-chat-font-mono, monospace)',
        fontSize: '0.8125rem',
        lineHeight: 1.5,
        overflow: 'hidden',
      }}
    >
      {title && (
        <div
          style={{
            padding: '0.375rem 0.75rem',
            background: 'var(--boring-chat-terminal-header-bg, #2d2d2d)',
            borderBottom: '1px solid var(--boring-chat-terminal-border, #404040)',
            fontSize: '0.75rem',
            opacity: 0.8,
          }}
        >
          {title}
        </div>
      )}
      <div style={{ padding: '0.75rem' }}>
        {children ?? (
          <>
            {stdout && (
              <pre data-stream="stdout" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                {stdout}
              </pre>
            )}
            {stderr && (
              <pre
                data-stream="stderr"
                style={{
                  margin: stdout ? '0.5rem 0 0' : 0,
                  whiteSpace: 'pre-wrap',
                  color: 'var(--boring-chat-terminal-stderr, #f87171)',
                }}
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
          style={{
            padding: '0.25rem 0.75rem',
            borderTop: '1px solid var(--boring-chat-terminal-border, #404040)',
            fontSize: '0.75rem',
            opacity: 0.6,
            color: exitCode === 0
              ? 'var(--boring-chat-terminal-success, #4ade80)'
              : 'var(--boring-chat-terminal-error, #f87171)',
          }}
        >
          exit {exitCode}
        </div>
      )}
    </div>
  )
}
