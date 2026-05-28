import type { AgentTool, ToolReadinessRequirement } from '../../shared/tool'
import { withReadinessRequirements, wrapToolForReadiness, type ToolReadinessCheck } from './toolReadiness'

export interface PluginToolRegistration {
  pluginName: string
  tools: AgentTool[]
}

export interface ToolCollisionLogger {
  warn: (message: string) => void
}

export interface MergeToolsOptions {
  standardTools: AgentTool[]
  extraTools?: AgentTool[]
  pluginTools?: PluginToolRegistration[]
  logger?: ToolCollisionLogger
  checkReadiness?: ToolReadinessCheck
}

function setLastRegistered(
  merged: Map<string, AgentTool>,
  tool: AgentTool,
): void {
  merged.delete(tool.name)
  merged.set(tool.name, tool)
}

export function mergeTools(options: MergeToolsOptions): AgentTool[] {
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
