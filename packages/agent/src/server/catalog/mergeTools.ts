import type { AgentTool } from '../../shared/tool'

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
    setLastRegistered(merged, tool)
  }

  for (const plugin of options.pluginTools ?? []) {
    for (const tool of plugin.tools) {
      if (merged.has(tool.name)) {
        options.logger?.warn(
          `[catalog] Tool "${tool.name}" overridden by plugin ${plugin.pluginName}`,
        )
      }
      setLastRegistered(merged, tool)
    }
  }

  return [...merged.values()]
}
