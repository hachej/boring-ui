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
    for (const requirement of tool.readinessRequirements ?? []) {
      requirements.add(requirement)
    }
  }
  return [...requirements]
}

export function createAgentReadinessFromTracker(options: {
  requirements: readonly ToolReadinessRequirement[]
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
  requirement: ToolReadinessRequirement,
  options: {
    tracker: ReadyStatusTracker
    checkReadiness?: ToolReadinessCheck
  },
): AgentReadinessStatus {
  if (requirement === 'workspace-fs') {
    return statusFromCapability(requirement, options.tracker.getReadiness().capabilities.workspace)
  }
  if (requirement === 'sandbox-exec') {
    const snapshot = options.tracker.getReadiness()
    return {
      key: requirement,
      ready: snapshot.sandboxReady,
      state: snapshot.sandboxReady ? 'ready' : 'preparing',
    }
  }
  if (options.checkReadiness) {
    return statusFromToolReadiness(
      requirement,
      options.checkReadiness(requirement, READINESS_PROBE_TOOL),
    )
  }
  if (isRuntimeReadinessRequirement(requirement)) {
    return statusFromCapability(
      requirement,
      options.tracker.getReadiness().capabilities.runtimeDependencies,
      { readyWhenNotStarted: true },
    )
  }
  return { key: requirement, ready: true, state: 'ready' }
}

function statusFromToolReadiness(
  key: ToolReadinessRequirement,
  state: ToolReadinessState,
): AgentReadinessStatus {
  if (state === true || (typeof state === 'object' && state !== null && state.ready === true)) {
    return { key, ready: true, state: 'ready' }
  }
  if (state === false) return { key, ready: false, state: 'preparing', retryable: true }
  return {
    key,
    ready: false,
    state: state.state ?? 'preparing',
    ...(state.errorCode ? { errorCode: state.errorCode } : {}),
    ...(state.causeCode ? { causeCode: state.causeCode } : {}),
    ...(state.message ? { message: state.message } : {}),
    ...(state.workspaceId ? { workspaceId: state.workspaceId } : {}),
    ...(state.retryable !== undefined ? { retryable: state.retryable } : {}),
  }
}

function statusFromCapability(
  key: ToolReadinessRequirement,
  detail: CapabilityReadinessDetail,
  options: { readyWhenNotStarted?: boolean } = {},
): AgentReadinessStatus {
  const ready = detail.state === 'ready' || (options.readyWhenNotStarted === true && detail.state === 'not-started')
  return {
    key,
    ready,
    state: ready ? 'ready' : detail.state,
    ...(detail.errorCode ? { errorCode: detail.errorCode } : {}),
    ...(detail.causeCode ? { causeCode: detail.causeCode } : {}),
    ...(detail.message ? { message: detail.message } : {}),
    ...(detail.retryable !== undefined ? { retryable: detail.retryable } : {}),
  }
}

function isRuntimeReadinessRequirement(requirement: ToolReadinessRequirement): boolean {
  return requirement === 'runtime-dependencies' || requirement.startsWith('runtime:')
}
