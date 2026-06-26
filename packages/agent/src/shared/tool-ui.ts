export interface ToolUiMetadata {
  /** Renderer key registered by the app shell, e.g. `pi-subagent`. */
  rendererId?: string
  /** Optional grouping label for future tool timelines/summaries. */
  displayGroup?: string
  /** Optional icon hint. Frontends decide whether/how to honor it. */
  icon?: string
  /** Renderer-specific structured data. */
  details?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isToolUiMetadata(value: unknown): value is ToolUiMetadata {
  if (!isRecord(value)) return false
  return (
    (value.rendererId === undefined || typeof value.rendererId === 'string') &&
    (value.displayGroup === undefined || typeof value.displayGroup === 'string') &&
    (value.icon === undefined || typeof value.icon === 'string')
  )
}

export function sanitizeToolUiMetadata(value: unknown): ToolUiMetadata | undefined {
  if (!isToolUiMetadata(value)) return undefined
  const rendererId = value.rendererId?.trim()
  const displayGroup = value.displayGroup?.trim()
  const icon = value.icon?.trim()
  return {
    ...(rendererId ? { rendererId } : {}),
    ...(displayGroup ? { displayGroup } : {}),
    ...(icon ? { icon } : {}),
    ...(value.details !== undefined ? { details: value.details } : {}),
  }
}

/**
 * Extract structured UI metadata from a ToolResult-like output.
 *
 * Shape:
 *   output.details.ui = { rendererId, displayGroup, icon, details }
 */
export function extractToolUiMetadata(output: unknown): ToolUiMetadata | undefined {
  if (!isRecord(output)) return undefined
  const details = output.details
  if (!isRecord(details)) return undefined

  return sanitizeToolUiMetadata(details.ui)
}
