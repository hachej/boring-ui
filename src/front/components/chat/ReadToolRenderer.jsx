import ToolUseBlock, { ToolOutput, ToolError } from './ToolUseBlock'

/**
 * ReadToolRenderer - Displays file read operations
 *
 * From reference screenshots:
 * - Header: "Read FILENAME" with file path
 * - Content: Shows file contents (truncated if large)
 * - Collapsible for large files
 * - Error state for failed reads
 */

const ReadToolRenderer = ({
  filePath,
  content,
  error,
  status = 'complete',
  lineCount,
  truncated = false,
  hideContent = false,
}) => {
  // Extract just the filename from the path
  const fileName = filePath?.split('/').pop() || filePath

  // Determine description
  let description = fileName
  if (lineCount) {
    description = `${fileName} (${lineCount} lines)`
  }
  if (truncated) {
    description = `${fileName} (truncated)`
  }

  return (
    <ToolUseBlock
      toolName="Read"
      description={description}
      status={status}
      collapsible={Boolean(content && !hideContent)}
      defaultExpanded={status !== 'complete' || Boolean(error) || !truncated}
    >
      {error ? (
        <ToolError message={error} />
      ) : content && !hideContent ? (
        <ToolOutput>
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
      ) : hideContent && lineCount ? (
        <div
          style={{
            color: 'var(--chat-text-muted)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {lineCount} line{lineCount === 1 ? '' : 's'} read
        </div>
      ) : status === 'running' ? (
        <div
          style={{
            color: 'var(--chat-text-muted)',
            fontSize: 'var(--text-sm)',
            fontStyle: 'italic',
          }}
        >
          Reading file...
        </div>
      ) : null}
    </ToolUseBlock>
  )
}

export default ReadToolRenderer
