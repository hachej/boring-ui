import { ErrorCode } from '../shared/error-codes'
import type { AgentReadiness, AgentReadinessStatus } from '../shared/events'
import type { AgentTool, ToolReadinessRequirement } from '../shared/tool'
import type { ToolReadinessCheck, ToolReadinessState } from './catalog/toolReadiness'
import type { CapabilityReadinessDetail, ReadyStatusTracker } from './runtime/readyStatus'

const READINESS_PROBE_TOOL: AgentTool = {
  name: 'agent_readiness_probe',
  description: 'Internal readiness probe.',
  parameters: { type: 'object', properties: {} },
  async execute() {
    return { content: [] }
  },
}

export function collectToolReadinessRequirements(tools: readonly AgentTool[]): ToolReadinessRequirement[] {
  const requirements = new Set<ToolReadinessRequirement>()
  for (const tool of tools) {
    for (const requirement of tool.readinessRequirements ?? []) requirements.add(requirement)
  }
  return [...requirements]
}

export function createAgentReadinessFromTracker(options: {
  requirements: readonly string[]
  tracker: ReadyStatusTracker
  checkReadiness?: ToolReadinessCheck
}): AgentReadiness {
  const requirements = [...new Set(options.requirements)]
  return {
    requirements,
    async status() {
      return requirements.map((requirement) => readinessStatusForRequirement(requirement, options))
    },
  }
}

function readinessStatusForRequirement(
  requirement: string,
  options: {
    tracker: ReadyStatusTracker
    checkReadiness?: ToolReadinessCheck
  },
): AgentReadinessStatus {
  const snapshot = options.tracker.getReadiness()
  if (requirement === 'workspace-fs') {
    return statusFromCapability(requirement, snapshot.capabilities.workspace, ErrorCode.enum.WORKSPACE_NOT_READY)
  }
  if (requirement === 'sandbox-exec') {
    return snapshot.sandboxReady
      ? { key: requirement, ready: true, state: 'ready' }
      : {
          key: requirement,
          ready: false,
          state: 'preparing',
          errorCode: ErrorCode.enum.SANDBOX_NOT_READY,
          retryable: true,
        }
  }
  if (isRuntimeReadinessRequirement(requirement)) {
    const status = statusFromCapability(
      requirement,
      snapshot.capabilities.runtimeDependencies,
      ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
    )
    if (status.ready || !options.checkReadiness) return status
    return enrichRuntimeStatus(
      status,
      options.checkReadiness(requirement, READINESS_PROBE_TOOL),
    )
  }
  return { key: requirement, ready: false }
}

function enrichRuntimeStatus(
  status: AgentReadinessStatus,
  readiness: ToolReadinessState,
): AgentReadinessStatus {
  if (readiness === true || (typeof readiness === 'object' && readiness !== null && readiness.ready === true)) {
    return status
  }
  if (readiness === false) {
    return { ...status, retryable: status.retryable ?? true }
  }
  return {
    ...status,
    ...(readiness.errorCode ? { errorCode: readiness.errorCode } : {}),
    ...(readiness.causeCode ? { causeCode: readiness.causeCode } : {}),
    ...(readiness.message ? { message: readiness.message } : {}),
    ...(readiness.workspaceId ? { workspaceId: readiness.workspaceId } : {}),
    retryable: readiness.retryable ?? status.retryable ?? true,
  }
}

function statusFromCapability(
  key: string,
  detail: CapabilityReadinessDetail,
  fallbackErrorCode: string,
): AgentReadinessStatus {
  const ready = detail.state === 'ready'
  const errorCode = detail.errorCode ?? (
    detail.state === 'failed' && isRuntimeReadinessRequirement(key)
      ? ErrorCode.enum.RUNTIME_PROVISIONING_FAILED
      : fallbackErrorCode
  )
  return {
    key,
    ready,
    state: detail.state,
    ...(!ready ? { errorCode } : {}),
    ...(detail.causeCode ? { causeCode: detail.causeCode } : {}),
    ...(detail.message ? { message: detail.message } : {}),
    ...(detail.retryable !== undefined ? { retryable: detail.retryable } : {}),
  }
}

function isRuntimeReadinessRequirement(requirement: string): requirement is ToolReadinessRequirement {
  return requirement === 'runtime-dependencies' || requirement.startsWith('runtime:')
}
