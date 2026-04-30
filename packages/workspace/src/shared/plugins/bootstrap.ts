import type { ComponentType } from "react"
import type { ChatPanelProps } from "@boring/agent"
import type { AgentTool } from "@boring/agent/shared"
import type { CommandRegistry } from "../../front/registry/CommandRegistry"
import type { PanelRegistry } from "../../front/registry/PanelRegistry"
import { PluginError } from "./definePlugin"
import type { CatalogRegistry } from "../../front/plugin/CatalogRegistry"
import type { Plugin, PluginOutput } from "./types"

export interface AgentToolRegistry {
  register(tool: AgentTool, pluginId: string): void
}

export interface BootstrapOptions {
  chatPanel: ComponentType<ChatPanelProps>
  plugins?: Plugin[]
  defaults?: Plugin[]
  excludeDefaults?: string[]
  registries: {
    panels: PanelRegistry
    commands: CommandRegistry
    catalogs: CatalogRegistry
    agentTools?: AgentToolRegistry
  }
}

export interface BootstrapResult {
  registered: string[]
  systemPromptAppend: string
}

function registerOutput(
  output: PluginOutput,
  plugin: Plugin,
  registries: BootstrapOptions["registries"],
): void {
  switch (output.type) {
    case "left-tab": {
      const { type: _type, id, ...registration } = output
      registries.panels.register(id, {
        ...registration,
        placement: "left-tab",
        pluginId: plugin.id,
      })
      return
    }
    case "panel": {
      const { id, ...registration } = output.panel
      registries.panels.register(id, { ...registration, pluginId: plugin.id })
      return
    }
    case "command":
      registries.commands.registerCommand({ ...output.command, pluginId: plugin.id })
      return
    case "catalog":
      registries.catalogs.register(output.catalog, plugin.id)
      return
    case "agent-tool":
      registries.agentTools?.register(output.tool, plugin.id)
      return
    case "binding":
      return
  }
}

export function bootstrap(options: BootstrapOptions): BootstrapResult {
  if (!options.chatPanel) {
    throw new PluginError("validation", "bootstrap requires chatPanel")
  }

  const excludedDefaults = new Set(options.excludeDefaults ?? [])
  const finalPlugins = [
    ...(options.defaults ?? []).filter((plugin) => !excludedDefaults.has(plugin.id)),
    ...(options.plugins ?? []),
  ]

  const seenPluginIds = new Set<string>()
  for (const plugin of finalPlugins) {
    if (seenPluginIds.has(plugin.id)) {
      throw new PluginError("duplicate-id", `plugin "${plugin.id}" registered twice`)
    }
    seenPluginIds.add(plugin.id)
  }

  for (const plugin of finalPlugins) {
    for (const panel of plugin.panels ?? []) {
      const { id, ...registration } = panel
      options.registries.panels.register(id, { ...registration, pluginId: plugin.id })
    }
    for (const command of plugin.commands ?? []) {
      options.registries.commands.registerCommand({ ...command, pluginId: plugin.id })
    }
    for (const catalog of plugin.catalogs ?? []) {
      options.registries.catalogs.register(catalog, plugin.id)
    }
    if (options.registries.agentTools) {
      for (const tool of plugin.agentTools ?? []) {
        options.registries.agentTools.register(tool, plugin.id)
      }
    }
    for (const output of plugin.outputs ?? []) {
      registerOutput(output, plugin, options.registries)
    }
  }

  const systemPromptAppend = finalPlugins
    .filter((p) => p.systemPrompt && p.systemPrompt.trim())
    .map((p) => p.systemPrompt!.trim())
    .join("\n\n")

  return { registered: finalPlugins.map((plugin) => plugin.id), systemPromptAppend }
}
