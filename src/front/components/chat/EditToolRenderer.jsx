import ToolUseBlock, { ToolError } from './ToolUseBlock'

/**
 * EditToolRenderer - Displays file edit operations with diff view
 *
 * From reference screenshots:
 * - Header: "Edit FILENAME" + "Added X lines" / "Removed X lines"
 * - Diff display with green (additions) and red (deletions)
 * - Line-by-line diff with +/- prefixes
 */

const EditToolRenderer = ({
  filePath,
  oldContent,
  newContent,
  diff,
  linesAdded = 0,
  linesRemoved = 0,
  error,
  status = 'complete',
}) => {
  const fileName = filePath?.split('/').pop() || filePath

  // Build subtitle from line changes
  const changes = []
  if (linesAdded > 0) changes.push(`Added ${linesAdded} line${linesAdded > 1 ? 's' : ''}`)
  if (linesRemoved > 0) changes.push(`Removed ${linesRemoved} line${linesRemoved > 1 ? 's' : ''}`)
  const subtitle = changes.join(', ')

  // Parse diff lines if provided as string
  const diffLines = typeof diff === 'string' ? diff.split('\n') : diff || []
  const hasDiffContent = diffLines.length > 0 || Boolean(oldContent && newContent)

  return (
    <ToolUseBlock
      toolName="Edit"
      description={fileName}
      subtitle={subtitle}
      status={status}
      collapsible={hasDiffContent}
      defaultExpanded={status !== 'complete' || Boolean(error)}
    >
      {error ? (
        <ToolError message={error} />
      ) : diffLines.length > 0 ? (
        <DiffView lines={diffLines} />
      ) : oldContent && newContent ? (
        <SimpleDiff oldContent={oldContent} newContent={newContent} />
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
          Editing file
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

/**
 * DiffView - Renders unified diff with syntax highlighting
 */
const DiffView = ({ lines }) => (
  <div
    style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--text-sm)',
      lineHeight: '1.5',
      borderRadius: 'var(--chat-radius-sm, 4px)',
      overflow: 'hidden',
    }}
  >
    {lines.map((line, i) => {
      const isAddition = line.startsWith('+') && !line.startsWith('+++')
      const isDeletion = line.startsWith('-') && !line.startsWith('---')
      const isHeader = line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')

      let bgColor = 'transparent'
      let textColor = 'var(--chat-text)'

      if (isAddition) {
        bgColor = 'var(--chat-diff-add-bg)'
        textColor = 'var(--chat-diff-add-text)'
      } else if (isDeletion) {
        bgColor = 'var(--chat-diff-remove-bg)'
        textColor = 'var(--chat-diff-remove-text)'
      } else if (isHeader) {
        textColor = 'var(--chat-text-muted)'
      }

      return (
        <div
          key={i}
          style={{
            backgroundColor: bgColor,
            padding: '0 8px',
            color: textColor,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {line || ' '}
        </div>
      )
    })}
  </div>
)

/**
 * SimpleDiff - Basic before/after diff when no unified diff provided
 */
const SimpleDiff = ({ oldContent, newContent }) => {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-sm)',
        lineHeight: '1.5',
        borderRadius: 'var(--chat-radius-sm, 4px)',
        overflow: 'hidden',
      }}
    >
      {/* Show removed lines */}
      {oldLines.map((line, i) => (
        <div
          key={`old-${i}`}
          style={{
            backgroundColor: 'var(--chat-diff-remove-bg)',
            padding: '0 8px',
            color: 'var(--chat-diff-remove-text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          -{line || ' '}
        </div>
      ))}
      {/* Show added lines */}
      {newLines.map((line, i) => (
        <div
          key={`new-${i}`}
          style={{
            backgroundColor: 'var(--chat-diff-add-bg)',
            padding: '0 8px',
            color: 'var(--chat-diff-add-text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          +{line || ' '}
        </div>
      ))}
    </div>
  )
}

export default EditToolRenderer
