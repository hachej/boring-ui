import { ErrorCode } from '../shared/error-codes'
import type { ToolReadinessRequirement } from '../shared/tool'

const COPY: Record<ToolReadinessRequirement, string> = {
  'workspace-fs': 'Files are still loading.',
  'sandbox-exec': 'Sandbox is still waking.',
  'ui-bridge': 'Workspace UI is still connecting.',
}

const VALID_REQUIREMENTS = new Set<ToolReadinessRequirement>([
  'workspace-fs',
  'sandbox-exec',
  'ui-bridge',
])

export interface WorkspaceNotReadyStatus {
  code: typeof ErrorCode.enum.WORKSPACE_NOT_READY
  retryable: true
  requirement: ToolReadinessRequirement
  message: string
}

function detailsFromOutput(output: unknown): Record<string, unknown> | null {
  if (!output || typeof output !== 'object') return null
  const record = output as { details?: unknown; code?: unknown; retryable?: unknown; requirement?: unknown }
  const details = record.details && typeof record.details === 'object'
    ? record.details as Record<string, unknown>
    : record as Record<string, unknown>
  return details
}

export function getWorkspaceNotReadyStatus(output: unknown): WorkspaceNotReadyStatus | null {
  const details = detailsFromOutput(output)
  if (!details) return null
  if (details.code !== ErrorCode.enum.WORKSPACE_NOT_READY) return null
  if (details.retryable !== true) return null
  const requirement = details.requirement
  if (typeof requirement !== 'string' || !VALID_REQUIREMENTS.has(requirement as ToolReadinessRequirement)) return null
  return {
    code: ErrorCode.enum.WORKSPACE_NOT_READY,
    retryable: true,
    requirement: requirement as ToolReadinessRequirement,
    message: COPY[requirement as ToolReadinessRequirement],
  }
}
