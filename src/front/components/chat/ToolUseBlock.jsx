import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'

/**
 * ToolUseBlock - Wrapper component for tool use displays
 *
 * Provides consistent styling for all tool renderers:
 * - Bullet indicator (colored based on status)
 * - Tool name label
 * - Collapsible content area
 * - Status indicators (running, complete, error)
 *
 * From reference screenshots:
 * - Green bullet (●) for success
 * - Grey bullet for pending/running
 * - Red bullet for errors
 * - Tool name in bold, then description
 */

// Status colors use CSS variables from chatThemeVars
const STATUS_COLORS = {
  running: 'var(--color-text-secondary)',
  streaming: 'var(--color-text-secondary)',
  complete: 'var(--color-success)',
  error: 'var(--color-error)',
  pending: 'var(--color-text-secondary)',
}

const ToolUseBlock = ({
  toolName,
  description,
  subtitle,
  status = 'complete',
  children,
  collapsible = false,
  defaultExpanded = true,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const bulletColor = STATUS_COLORS[status] || STATUS_COLORS.complete
  const isInProgress = ['pending', 'running', 'streaming'].includes(status)
  const isComplete = status === 'complete'
  const toggleExpanded = () => setIsExpanded((prev) => !prev)
  const onHeaderKeyDown = (event) => {
    if (!collapsible) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleExpanded()
    }
  }

  return (
    <div className={`tool-use-block status-${status} ${className}`.trim()}>
      {/* Header row with bullet, tool name, and description */}
      <div
        className={`tool-use-header ${collapsible ? 'clickable' : ''}`}
        onClick={collapsible ? toggleExpanded : undefined}
        onKeyDown={onHeaderKeyDown}
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? isExpanded : undefined}
      >
        {/* Status bullet - color is dynamic */}
        <span className="tool-use-bullet" style={{ color: bulletColor }}>
          ●
        </span>

        {/* Tool name, description, and subtitle */}
        <div className="tool-use-info">
          <div className="tool-use-title-row">
            <span className="tool-use-name">{toolName}</span>
            {description && (
              <span className="tool-use-description">{description}</span>
            )}
            {isInProgress && (
              <span className="tool-use-status-indicator running" aria-label="In progress">
                <Loader2 size={12} />
              </span>
            )}
            {isComplete && (
              <span className="tool-use-status-indicator complete" aria-label="Completed">
                <Check size={12} />
              </span>
            )}
            {collapsible && (
              <span className="tool-use-collapse-icon">
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
            )}
          </div>
          {subtitle && <span className="tool-use-subtitle">{subtitle}</span>}
        </div>
      </div>

      {/* Content area (collapsible) */}
      {(!collapsible || isExpanded) && children && (
        <div className="tool-use-content">{children}</div>
      )}
    </div>
  )
}

/**
 * ToolOutput - Styled container for tool output/results
 */
export const ToolOutput = ({ children, style = {}, className = '' }) => (
  <div className={`tool-output ${className}`} style={style}>
    {children}
  </div>
)

/**
 * ToolCommand - Styled command/input display
 */
export const ToolCommand = ({ command, language }) => (
  <div className="tool-command">
    {language && <span className="tool-command-language">{language}</span>}
    <code className="tool-command-code">{command}</code>
  </div>
)

/**
 * ToolError - Styled error message display
 */
export const ToolError = ({ message }) => (
  <div className="tool-error">{message}</div>
)

/**
 * InlineCode - Styled inline code element
 */
export const InlineCode = ({ children }) => (
  <code className="inline-code">{children}</code>
)

export default ToolUseBlock
