import { useEffect, useState } from 'react'
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
  const [isCompactResultExpanded, setIsCompactResultExpanded] = useState(false)

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
  const compactOutputLines = output ? output.split('\n') : []

  useEffect(() => {
    if (isStreaming && compactOutputLines.length > 0) {
      setIsCompactResultExpanded(true)
    }
  }, [isStreaming, compactOutputLines.length])

  return (
    <ToolUseBlock
      toolName="Bash"
      description={description || (command?.length > 60 ? command.slice(0, 60) + '...' : command)}
      status={effectiveStatus}
      collapsible={!compact && Boolean(output)}
      defaultExpanded={!compact ? isStreaming : true}
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
              border: 'none',
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
        <div className="tool-result-collapsible">
          <button
            type="button"
            className="tool-result-toggle"
            onClick={() => setIsCompactResultExpanded((prev) => !prev)}
          >
            {isCompactResultExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span>
              {isCompactResultExpanded
                ? 'Hide result'
                : `Show result (${compactOutputLines.length} line${compactOutputLines.length === 1 ? '' : 's'})`}
            </span>
          </button>
          {isCompactResultExpanded && (
            <pre className="claude-bash-compact">
              {(() => {
                const maxLines = 3
                const shown = compactOutputLines.slice(0, maxLines)
                const formatted = shown.map((line, idx) =>
                  `${idx === 0 ? '└' : ' '} ${line}`.trimEnd()
                )
                if (compactOutputLines.length > maxLines) {
                  formatted.push(`  ... +${compactOutputLines.length - maxLines} lines`)
                }
                return formatted.join('\n')
              })()}
              {isStreaming && <span className="claude-streaming-cursor" aria-hidden="true">▌</span>}
            </pre>
          )}
        </div>
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
              type="button"
              className="tool-result-toggle"
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
