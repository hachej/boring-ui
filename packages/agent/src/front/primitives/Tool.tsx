/**
 * Adapted from @ai-sdk/react's ai-elements (vercel-labs/ai).
 * Source: https://github.com/vercel-labs/ai/tree/main/packages/ai-elements
 * Copied: 2026-04-23. We own this file; upstream updates require re-port.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

export type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied'

export interface ToolProps {
  toolName: string
  toolCallId: string
  state: ToolState
  input?: unknown
  output?: unknown
  errorText?: string
  children?: ReactNode
  className?: string
  defaultExpanded?: boolean
  renderInput?: (input: unknown) => ReactNode
  renderOutput?: (output: unknown) => ReactNode
}

function stateLabel(state: ToolState): string {
  switch (state) {
    case 'input-streaming':
      return 'Running…'
    case 'input-available':
      return 'Running…'
    case 'approval-requested':
      return 'Approval needed'
    case 'approval-responded':
      return 'Approved'
    case 'output-available':
      return 'Done'
    case 'output-error':
      return 'Error'
    case 'output-denied':
      return 'Denied'
  }
}

export function Tool({
  toolName,
  state,
  input,
  output,
  errorText,
  children,
  className,
  defaultExpanded = false,
  renderInput,
  renderOutput,
}: ToolProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const isRunning = state === 'input-streaming' || state === 'input-available'
  const isComplete = state === 'output-available' || state === 'output-error' || state === 'output-denied'

  const [elapsedSec, setElapsedSec] = useState(0)
  const startRef = useRef(0)

  useEffect(() => {
    if (!isRunning) {
      setElapsedSec(0)
      return
    }
    startRef.current = Date.now()
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [isRunning])

  return (
    <div
      className={className}
      data-tool-state={state}
      style={{
        border: '1px solid var(--boring-chat-tool-border, #e5e7eb)',
        borderRadius: 'var(--boring-chat-tool-radius, 0.375rem)',
        overflow: 'hidden',
        fontSize: 'var(--boring-chat-font-size, 0.875rem)',
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
          background: 'var(--boring-chat-tool-header-bg, #f9fafb)',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'var(--boring-chat-font-mono, monospace)',
          fontSize: '0.8125rem',
        }}
        aria-expanded={expanded}
      >
        <span style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.15s' }}>
          ▶
        </span>
        <span style={{ fontWeight: 500 }}>{toolName}</span>
        <span
          style={{
            marginLeft: 'auto',
            opacity: 0.6,
            fontSize: '0.75rem',
          }}
        >
          {isRunning && elapsedSec >= 1 ? `Running… (${elapsedSec}s)` : stateLabel(state)}
        </span>
        {!isComplete && (
          <span
            style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--boring-chat-tool-running, #3b82f6)' }}
            aria-label="running"
          />
        )}
      </button>

      {expanded && (
        <div style={{ padding: '0.5rem 0.75rem', borderTop: '1px solid var(--boring-chat-tool-border, #e5e7eb)' }}>
          {children ?? (
            <>
              {input !== undefined && (
                <div data-testid="tool-input">
                  {renderInput ? renderInput(input) : (
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.8125rem' }}>
                      {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
                    </pre>
                  )}
                </div>
              )}
              {output !== undefined && (
                <div data-testid="tool-output" style={{ marginTop: '0.5rem' }}>
                  {renderOutput ? renderOutput(output) : (
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.8125rem' }}>
                      {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
                    </pre>
                  )}
                </div>
              )}
              {errorText && (
                <div
                  data-testid="tool-error"
                  style={{ color: 'var(--boring-chat-tool-error, #ef4444)', marginTop: '0.5rem' }}
                >
                  {errorText}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
