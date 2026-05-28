import { ErrorCode } from '../../shared/error-codes'
import type { AgentTool, ToolReadinessRequirement, ToolResult } from '../../shared/tool'

const WORKSPACE_PREPARING_MESSAGE = 'Workspace is still preparing. Try again in a moment.'

export type ToolReadinessCheck = (requirement: ToolReadinessRequirement, tool: AgentTool) => boolean

export function workspaceNotReadyToolResult(requirement: ToolReadinessRequirement): ToolResult {
  return {
    content: [{ type: 'text', text: WORKSPACE_PREPARING_MESSAGE }],
    isError: true,
    details: {
      code: ErrorCode.enum.WORKSPACE_NOT_READY,
      retryable: true,
      requirement,
    },
  }
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
        if (!checkReadiness(requirement, tool)) return workspaceNotReadyToolResult(requirement)
      }
      return await tool.execute(params, ctx)
    },
  }
}
