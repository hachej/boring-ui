/**
 * Adapted from @ai-sdk/react's ai-elements (vercel-labs/ai).
 * Source: https://github.com/vercel-labs/ai/tree/main/packages/ai-elements
 * Copied: 2026-04-23. We own this file; upstream updates require re-port.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@hachej/boring-ui'
import { cn } from '../lib'

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

function ToolValue({ value }: { value: unknown }) {
  return (
    <pre className="m-0 whitespace-pre-wrap text-[0.8125rem]">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
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
      className={cn(
        'overflow-hidden rounded-[var(--boring-agent-tool-radius,0.375rem)] border border-[var(--boring-agent-tool-border,#e5e7eb)] text-[length:var(--boring-agent-font-size,0.875rem)]',
        className,
      )}
      data-tool-state={state}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={() => setExpanded((v) => !v)}
        className="h-auto w-full justify-start gap-2 rounded-none bg-[var(--boring-agent-tool-header-bg,#f9fafb)] px-3 py-2 text-left font-[family-name:var(--boring-agent-font-mono,monospace)] text-[0.8125rem]"
        aria-expanded={expanded}
      >
        <span className={cn('transition-transform duration-150', expanded && 'rotate-90')}>▶</span>
        <span className="font-medium">{toolName}</span>
        <span className="ml-auto text-xs opacity-60">
          {isRunning && elapsedSec >= 1 ? `Running… (${elapsedSec}s)` : stateLabel(state)}
        </span>
        {!isComplete && (
          <span className="size-2 rounded-full bg-[var(--boring-agent-tool-running,#3b82f6)]" aria-label="running" />
        )}
      </Button>

      {expanded && (
        <div className="border-t border-[var(--boring-agent-tool-border,#e5e7eb)] px-3 py-2">
          {children ?? (
            <>
              {input !== undefined && (
                <div data-testid="tool-input">
                  {renderInput ? renderInput(input) : <ToolValue value={input} />}
                </div>
              )}
              {output !== undefined && (
                <div data-testid="tool-output" className="mt-2">
                  {renderOutput ? renderOutput(output) : <ToolValue value={output} />}
                </div>
              )}
              {errorText && (
                <div data-testid="tool-error" className="mt-2 text-[var(--boring-agent-tool-error,#ef4444)]">
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
