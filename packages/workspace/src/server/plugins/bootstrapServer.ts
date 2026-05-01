import type { AgentTool } from "../../shared/types/agent-tool"

interface ServerPlugin {
  id: string
  systemPrompt?: string
  agentTools?: AgentTool[]
}

export interface ServerBootstrapOptions {
  plugins?: ServerPlugin[]
  defaults?: ServerPlugin[]
  excludeDefaults?: string[]
}

export interface ServerBootstrapResult {
  registered: string[]
  systemPromptAppend: string
  agentTools: AgentTool[]
}

export function bootstrapServer(options: ServerBootstrapOptions): ServerBootstrapResult {
  const excludedDefaults = new Set(options.excludeDefaults ?? [])
  const finalPlugins = [
    ...(options.defaults ?? []).filter((p) => !excludedDefaults.has(p.id)),
    ...(options.plugins ?? []),
  ]

  const seenIds = new Set<string>()
  for (const plugin of finalPlugins) {
    if (seenIds.has(plugin.id)) {
      throw new Error(`plugin "${plugin.id}" registered twice`)
    }
    seenIds.add(plugin.id)
  }

  const agentTools: AgentTool[] = []
  for (const plugin of finalPlugins) {
    for (const tool of plugin.agentTools ?? []) {
      agentTools.push(tool)
    }
  }

  const systemPromptAppend = finalPlugins
    .filter((p) => p.systemPrompt && p.systemPrompt.trim())
    .map((p) => p.systemPrompt!.trim())
    .join("\n\n")

  return {
    registered: finalPlugins.map((p) => p.id),
    systemPromptAppend,
    agentTools,
  }
}
