import { PluginError } from "./defineFrontPlugin"
import type { WorkspaceFrontPlugin } from "./defineFrontPlugin"
import type {
  CatalogConfig,
  PluginOutput,
} from "./types"
import type { CommandConfig, PanelRegistration } from "../types/panel"
import type { SurfaceResolverRegistration } from "../types/surface"

export interface PanelRegistryLike {
  register(id: string, config: PanelRegistration): void
}

export interface CommandRegistryLike {
  registerCommand(command: CommandConfig): void
}

export interface CatalogRegistryLike {
  register(catalog: CatalogConfig, pluginId: string): void
}

export interface SurfaceResolverRegistryLike {
  register(id: string, config: SurfaceResolverRegistration): void
}

export interface BootstrapOptions {
  chatPanel: unknown
  plugins?: WorkspaceFrontPlugin[]
  defaults?: WorkspaceFrontPlugin[]
  excludeDefaults?: string[]
  registries: {
    panels: PanelRegistryLike
    commands: CommandRegistryLike
    catalogs: CatalogRegistryLike
    surfaceResolvers?: SurfaceResolverRegistryLike
  }
}

export interface BootstrapResult {
  registered: string[]
}

function registerOutput(
  output: PluginOutput,
  plugin: WorkspaceFrontPlugin,
  registries: BootstrapOptions["registries"],
): void {
  const ownedOutput = output as PluginOutput & { pluginId?: string }
  const ownerPluginId = ownedOutput.pluginId ?? plugin.id
  switch (output.type) {
    case "left-tab": {
      const ownedLeftTab = output as Extract<PluginOutput, { type: "left-tab" }> & {
        pluginId?: string
      }
      const { type: _type, id, pluginId: _pluginId, ...registration } = ownedLeftTab
      registries.panels.register(id, {
        ...registration,
        placement: "left-tab",
        pluginId: ownerPluginId,
      })
      return
    }
    case "panel": {
      const { id, ...registration } = output.panel
      registries.panels.register(id, {
        ...registration,
        pluginId: ownerPluginId,
      })
      return
    }
    case "command":
      registries.commands.registerCommand({
        ...output.command,
        pluginId: ownerPluginId,
      })
      return
    case "catalog":
      registries.catalogs.register(output.catalog, ownerPluginId)
      return
    case "surface-resolver": {
      const { id, ...registration } = output.resolver
      registries.surfaceResolvers?.register(id, {
        ...registration,
        pluginId: ownerPluginId,
      })
      return
    }
    case "binding":
    case "provider":
      return
  }
}

export function bootstrap(options: BootstrapOptions): BootstrapResult {
  if (!options.chatPanel) {
    throw new PluginError("validation", "bootstrap requires chatPanel")
  }

  const excludedDefaults = new Set(options.excludeDefaults ?? [])
  const finalPlugins = [
    ...(options.defaults ?? []).filter(
      (plugin) => !excludedDefaults.has(plugin.id),
    ),
    ...(options.plugins ?? []),
  ]

  const seenPluginIds = new Set<string>()
  for (const plugin of finalPlugins) {
    if (seenPluginIds.has(plugin.id)) {
      throw new PluginError(
        "duplicate-id",
        `plugin "${plugin.id}" registered twice`,
      )
    }
    seenPluginIds.add(plugin.id)
  }

  for (const plugin of finalPlugins) {
    for (const output of plugin.outputs ?? []) {
      registerOutput(output, plugin, options.registries)
    }
  }

  return {
    registered: finalPlugins.map((plugin) => plugin.id),
  }
}
