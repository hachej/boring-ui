import ToolUseBlock, { ToolOutput, ToolError } from './ToolUseBlock'

/**
 * WriteToolRenderer - Displays file write operations
 *
 * From reference screenshots:
 * - Header: "Write FILENAME"
 * - Shows file content that will be written
 * - Permission dialog for approval (handled by PermissionPanel)
 */

const WriteToolRenderer = ({
  filePath,
  content,
  error,
  status = 'complete',
  lineCount,
}) => {
  const fileName = filePath?.split('/').pop() || filePath
  const lines = lineCount || (content ? content.split('\n').length : 0)
  const subtitle = lines > 0 ? `${lines} line${lines !== 1 ? 's' : ''}` : null
  const isStreaming = ['pending', 'running', 'streaming'].includes(status)

  return (
    <ToolUseBlock
      toolName="Write"
      description={fileName}
      subtitle={subtitle}
      status={status}
      collapsible={Boolean(content)}
      defaultExpanded={status !== 'complete' || Boolean(error)}
    >
      {error ? (
        <ToolError message={error} />
      ) : content ? (
        <ToolOutput streaming={isStreaming}>
          <pre
            style={{
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: '1.5',
            }}
          >
            {content}
          </pre>
        </ToolOutput>
      ) : status === 'pending' ? (
        <div
          style={{
            color: 'var(--chat-text-muted)',
            fontSize: 'var(--text-sm)',
            fontStyle: 'italic',
          }}
        >
          Waiting for permission...
        </div>
      ) : status === 'running' ? (
        <div
          style={{
            color: 'var(--chat-text-muted)',
            fontSize: 'var(--text-sm)',
            fontStyle: 'italic',
          }}
        >
          Writing file
          <span className="claude-waiting-dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </div>
      ) : null}
    </ToolUseBlock>
  )
}

export default WriteToolRenderer
