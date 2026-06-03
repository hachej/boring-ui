import { ErrorCode } from '../shared/error-codes'
import type { ToolReadinessRequirement } from '../shared/tool'

const COPY: Partial<Record<ToolReadinessRequirement, string>> = {
  'runtime-dependencies': 'Runtime dependencies are still installing.',
  'runtime:python': 'Python runtime dependencies are still installing.',
  'runtime:node': 'Node runtime dependencies are still installing.',
}

function isRuntimeRequirement(requirement: string): requirement is ToolReadinessRequirement {
  return requirement === 'runtime-dependencies' || requirement.startsWith('runtime:')
}

export interface RuntimeReadinessStatus {
  code: typeof ErrorCode.enum.AGENT_RUNTIME_NOT_READY | typeof ErrorCode.enum.RUNTIME_PROVISIONING_FAILED
  retryable: boolean
  requirement: ToolReadinessRequirement
  state?: string
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

export function getRuntimeReadinessStatus(output: unknown): RuntimeReadinessStatus | null {
  const details = detailsFromOutput(output)
  if (!details) return null
  if (
    details.code !== ErrorCode.enum.AGENT_RUNTIME_NOT_READY &&
    details.code !== ErrorCode.enum.RUNTIME_PROVISIONING_FAILED
  ) return null
  const requirement = details.requirement
  if (typeof requirement !== 'string' || !isRuntimeRequirement(requirement)) return null
  const failed = details.code === ErrorCode.enum.RUNTIME_PROVISIONING_FAILED || details.state === 'failed'
  return {
    code: details.code,
    retryable: details.retryable === true,
    requirement: requirement as ToolReadinessRequirement,
    state: typeof details.state === 'string' ? details.state : undefined,
    message: failed
      ? 'Runtime setup failed. Retry or reload the workspace.'
      : COPY[requirement as ToolReadinessRequirement] ?? 'Runtime dependencies are still installing.',
  }
}
