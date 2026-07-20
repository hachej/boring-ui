import { ErrorCode, type ErrorCode as AgentErrorCode } from '../../shared/error-codes'
import type { AgentTool, ToolReadinessRequirement } from '../../shared/tool'
import {
  withReadinessRequirements,
  wrapToolForReadiness,
  type ToolReadinessCheck,
} from '@hachej/boring-bash/agent'

export interface PluginToolRegistration {
  pluginName: string
  tools: AgentTool[]
}

export interface ToolCollisionLogger {
  warn: (message: string) => void
}

export type ToolCollisionPolicy = 'last-wins' | 'error'

export class ToolCatalogCollisionError extends Error {
  readonly code: Extract<AgentErrorCode, 'AUTHORED_AGENT_TOOL_COLLISION'>
  readonly field = 'tools'

  constructor() {
    super('tool name collision is not allowed by this catalog policy')
    this.name = 'ToolCatalogCollisionError'
    this.code = ErrorCode.enum.AUTHORED_AGENT_TOOL_COLLISION
  }
}

export interface MergeToolsOptions {
  standardTools: AgentTool[]
  extraTools?: AgentTool[]
  pluginTools?: PluginToolRegistration[]
  logger?: ToolCollisionLogger
  checkReadiness?: ToolReadinessCheck
  collisionPolicy?: ToolCollisionPolicy
}

function setLastRegistered(
  merged: Map<string, AgentTool>,
  tool: AgentTool,
): void {
  merged.delete(tool.name)
  merged.set(tool.name, tool)
}

function assertNoToolCollisions(options: MergeToolsOptions): void {
  const seen = new Set<string>()
  const inspect = (tool: AgentTool): void => {
    if (seen.has(tool.name)) throw new ToolCatalogCollisionError()
    seen.add(tool.name)
  }

  for (const tool of options.standardTools) inspect(tool)
  for (const tool of options.extraTools ?? []) inspect(tool)
  for (const plugin of options.pluginTools ?? []) {
    for (const tool of plugin.tools) inspect(tool)
  }
}

export function mergeTools(options: MergeToolsOptions): AgentTool[] {
  if (options.collisionPolicy === 'error') assertNoToolCollisions(options)

  const merged = new Map<string, AgentTool>()

  for (const tool of options.standardTools) {
    setLastRegistered(merged, tool)
  }

  for (const tool of options.extraTools ?? []) {
    if (merged.has(tool.name)) {
      options.logger?.warn(
        `[catalog] Tool "${tool.name}" overridden by extraTools`,
      )
    }
    setLastRegistered(merged, tool)
  }

  for (const plugin of options.pluginTools ?? []) {
    for (const tool of plugin.tools) {
      if (merged.has(tool.name)) {
        options.logger?.warn(
          `[catalog] Tool "${tool.name}" overridden by plugin ${plugin.pluginName}`,
        )
      }
      const pluginTool = tool.readinessRequirements === undefined
        ? withReadinessRequirements(tool, ['workspace-fs'] satisfies ToolReadinessRequirement[])
        : tool
      setLastRegistered(merged, pluginTool)
    }
  }

  return [...merged.values()].map((tool) => wrapToolForReadiness(tool, options.checkReadiness))
}
