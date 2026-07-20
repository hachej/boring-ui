import type {
  AgentTool,
  ToolResult,
} from '@hachej/boring-agent/shared'

export type ToolReadinessRequirement = NonNullable<AgentTool['readinessRequirements']>[number]

const WORKSPACE_PREPARING_MESSAGE = 'Workspace is still preparing. Try again in a moment.'

export type CapabilityReadinessState = 'not-started' | 'preparing' | 'ready' | 'failed'

export interface ToolReadinessBlockedState {
  ready: false
  state?: Exclude<CapabilityReadinessState, 'ready'>
  errorCode?: string
  causeCode?: string
  message?: string
  workspaceId?: string
  retryable?: boolean
}

export type ToolReadinessState = true | false | { ready: true } | ToolReadinessBlockedState

export type ToolReadinessCheck = (requirement: ToolReadinessRequirement, tool: AgentTool) => ToolReadinessState

function isRuntimeRequirement(requirement: ToolReadinessRequirement): boolean {
  return requirement === 'runtime-dependencies' || requirement.startsWith('runtime:')
}

function isReadyState(state: ToolReadinessState): boolean {
  return state === true || (typeof state === 'object' && state !== null && state.ready === true)
}

function blockedState(state: ToolReadinessState): ToolReadinessBlockedState {
  if (state && typeof state === 'object' && state.ready === false) return state
  return { ready: false, state: 'preparing', retryable: true }
}

function runtimeRequirementMessage(requirement: ToolReadinessRequirement, state: CapabilityReadinessState | undefined): string {
  if (state === 'failed') {
    return 'Runtime setup failed. Retry provisioning or reload the workspace.'
  }
  switch (requirement) {
    case 'runtime:python':
      return 'Python runtime dependencies are still installing. This usually takes a few seconds.'
    case 'runtime:node':
      return 'Node runtime dependencies are still installing. This usually takes a few seconds.'
    default:
      return 'Runtime dependencies are still installing. This usually takes a few seconds.'
  }
}

export function workspaceNotReadyToolResult(requirement: ToolReadinessRequirement): ToolResult {
  return {
    content: [{ type: 'text', text: WORKSPACE_PREPARING_MESSAGE }],
    isError: true,
    details: {
      code: 'WORKSPACE_NOT_READY',
      retryable: true,
      requirement,
    },
  }
}

export function runtimeNotReadyToolResult(
  requirement: ToolReadinessRequirement,
  state: ToolReadinessBlockedState = { ready: false, state: 'preparing', retryable: true },
): ToolResult {
  const readinessState = state.state ?? 'preparing'
  const code = readinessState === 'failed'
    ? 'RUNTIME_PROVISIONING_FAILED'
    : 'AGENT_RUNTIME_NOT_READY'
  const message = state.message ?? runtimeRequirementMessage(requirement, readinessState)
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
    details: {
      code,
      retryable: state.retryable ?? true,
      requirement,
      state: readinessState,
      ...(state.workspaceId ? { workspaceId: state.workspaceId } : {}),
      ...(state.errorCode ? { errorCode: state.errorCode } : {}),
      ...(state.causeCode ? { causeCode: state.causeCode } : {}),
    },
  }
}

export function readinessToolResult(requirement: ToolReadinessRequirement, state: ToolReadinessState): ToolResult {
  if (isRuntimeRequirement(requirement)) return runtimeNotReadyToolResult(requirement, blockedState(state))
  return workspaceNotReadyToolResult(requirement)
}

export function withReadinessRequirements(
  tool: AgentTool,
  readinessRequirements: ToolReadinessRequirement[] | undefined,
): AgentTool {
  if (tool.readinessRequirements === readinessRequirements) return tool
  return { ...tool, readinessRequirements }
}

export function wrapToolForReadiness(
  tool: AgentTool,
  checkReadiness?: ToolReadinessCheck,
): AgentTool {
  if (!checkReadiness || !tool.readinessRequirements || tool.readinessRequirements.length === 0) return tool
  return {
    ...tool,
    async execute(params, ctx) {
      for (const requirement of tool.readinessRequirements ?? []) {
        const readiness = checkReadiness(requirement, tool)
        if (!isReadyState(readiness)) return readinessToolResult(requirement, readiness)
      }
      return await tool.execute(params, ctx)
    },
  }
}
