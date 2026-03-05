import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import ToolUseBlock, { ToolOutput, ToolError } from './ToolUseBlock'

/**
 * BashToolRenderer - Displays bash command executions
 *
 * From reference screenshots:
 * - Header: "Bash DESCRIPTION" with command description
 * - Command line in mono font
 * - Output section showing terminal output
 * - Collapsible for long outputs
 * - Error state for failed commands
 */

const MAX_LINES = 8

const BashToolRenderer = ({
  command,
  description,
  output,
  exitCode,
  error,
  status = 'complete',
  compact = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const getOutputInfo = (text) => {
    if (!text) return { lines: [], totalLines: 0, hasMore: false }
    const lines = text.split('\n')
    return {
      lines,
      totalLines: lines.length,
      hasMore: lines.length > MAX_LINES,
    }
  }

  const outputInfo = getOutputInfo(output)

  // Determine status based on exit code if not provided
  const hasExitCode = typeof exitCode === 'number'
  const effectiveStatus = error ? 'error' : hasExitCode && exitCode !== 0 ? 'error' : status
  const isStreaming = ['pending', 'running', 'streaming'].includes(effectiveStatus)

  return (
    <ToolUseBlock
      toolName="Bash"
      description={description || (command?.length > 60 ? command.slice(0, 60) + '...' : command)}
      status={effectiveStatus}
      collapsible={output && output.length > 300}
      defaultExpanded={true}
    >
      {/* Command display */}
      {command && !compact && (
        <div
          style={{
            marginBottom: 'var(--space-2, 8px)',
          }}
        >
          <code
            style={{
              display: 'block',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-sm)',
              color: 'var(--chat-text)',
              backgroundColor: 'var(--chat-command-bg, var(--chat-input-bg))',
              padding: 'var(--space-3, 12px) var(--space-4, 16px)',
              borderRadius: 'var(--radius-md, 8px)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              border: '1px solid var(--chat-border)',
              lineHeight: '1.5',
            }}
          >
            <span style={{ color: 'var(--chat-text-tertiary)', marginRight: '8px', userSelect: 'none' }}>$</span>
            {command}
          </code>
        </div>
      )}

      {/* Error display */}
      {error && <ToolError message={error} />}

      {/* Output display */}
      {output && !error && compact && (
        <pre className="claude-bash-compact">
          {(() => {
            const rawLines = output.split('\n')
            const maxLines = 3
            const shown = rawLines.slice(0, maxLines)
            const formatted = shown.map((line, idx) =>
              `${idx === 0 ? '└' : ' '} ${line}`.trimEnd()
            )
            if (rawLines.length > maxLines) {
              formatted.push(`  ... +${rawLines.length - maxLines} lines`)
            }
            return formatted.join('\n')
          })()}
          {isStreaming && <span className="claude-streaming-cursor" aria-hidden="true">▌</span>}
        </pre>
      )}

      {output && !error && !compact && (
        <ToolOutput
          className="claude-tool-output"
          streaming={isStreaming}
          style={{
            maxHeight: isExpanded ? '500px' : '220px',
          }}
        >
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: '1.4',
            }}
          >
            {isExpanded
              ? output
              : outputInfo.lines.slice(0, MAX_LINES).join('\n')}
          </pre>
          {outputInfo.hasMore && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: 'var(--space-2, 8px)',
                padding: '6px 12px',
                background: 'var(--color-bg-active, rgba(255,255,255,0.1))',
                border: '1px solid var(--chat-border)',
                borderRadius: 'var(--radius-md, 8px)',
                color: 'var(--chat-text-muted)',
                fontSize: '12px',
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-bg-hover, rgba(255,255,255,0.15))'
                e.currentTarget.style.color = 'var(--chat-text)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--color-bg-active, rgba(255,255,255,0.1))'
                e.currentTarget.style.color = 'var(--chat-text-muted)'
              }}
            >
              {isExpanded ? (
                <>
                  <ChevronDown size={14} />
                  <span>Show less</span>
                </>
              ) : (
                <>
                  <ChevronRight size={14} />
                  <span>+{outputInfo.totalLines - MAX_LINES} more lines</span>
                </>
              )}
            </button>
          )}
        </ToolOutput>
      )}

      {/* Exit code indicator for non-zero */}
      {exitCode !== undefined && exitCode !== 0 && !error && (
        <div
          style={{
            marginTop: 'var(--chat-spacing-xs, 4px)',
            fontSize: '12px',
            color: 'var(--chat-error)',
          }}
        >
          Exit code: {exitCode}
        </div>
      )}

      {/* Pending state */}
      {status === 'pending' && !output && (
        <div
          style={{
            color: 'var(--chat-text-muted)',
            fontSize: 'var(--text-sm)',
            fontStyle: 'italic',
          }}
        >
          Waiting for permission...
        </div>
      )}

      {/* Running state */}
      {status === 'running' && !output && (
        <div
          style={{
            color: 'var(--chat-text-muted)',
            fontSize: 'var(--text-sm)',
            fontStyle: 'italic',
          }}
        >
          Running command...
        </div>
      )}
    </ToolUseBlock>
  )
}

export default BashToolRenderer
