import { PluginError } from "./errors"
import { adaptLegacyPanelToWorkspaceSource } from "./legacyWorkspaceSource"
import {
  captureFrontPlugin,
  normalizeFrontSurfaceResolver,
  type BoringFrontFactoryWithId,
  type BoringFrontPanelRegistration,
  type BoringFrontPanelCommandRegistration,
  type BoringFrontWorkspaceSourceRegistration,
  type CapturedFrontPlugin,
} from "./frontFactory"
import type { CatalogConfig } from "./types"
import { isWorkspaceSourcePlacement, type CommandConfig, type PanelRegistration, type WorkspaceSourceRegistration } from "../types/panel"
import type { SurfaceResolverRegistration } from "../types/surface"

export interface PanelRegistryLike {
  register(id: string, config: PanelRegistration): void
}

export interface WorkspaceSourceRegistryLike {
  register(id: string, config: WorkspaceSourceRegistration): void
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
  plugins?: BoringFrontFactoryWithId[]
  defaults?: BoringFrontFactoryWithId[]
  excludeDefaults?: string[]
  registries: {
    panels: PanelRegistryLike
    workspaceSources?: WorkspaceSourceRegistryLike
    commands: CommandRegistryLike
    catalogs: CatalogRegistryLike
    surfaceResolvers?: SurfaceResolverRegistryLike
  }
  panelCommandRunner?: (command: BoringFrontPanelCommandRegistration) => (() => void) | undefined
}

export interface BootstrapResult {
  registered: string[]
  plugins: CapturedFrontPlugin[]
}

function panelRegistration(panel: BoringFrontPanelRegistration<any>, pluginId: string): PanelRegistration {
  return {
    title: panel.label ?? panel.id,
    component: panel.component,
    placement: panel.placement ?? "center",
    source: panel.source ?? "plugin",
    pluginId,
    ...(panel.icon ? { icon: panel.icon } : {}),
    ...(panel.requiresCapabilities ? { requiresCapabilities: panel.requiresCapabilities } : {}),
    ...(panel.essential !== undefined ? { essential: panel.essential } : {}),
    ...(panel.lazy !== undefined ? { lazy: panel.lazy } : {}),
    ...(panel.chromeless !== undefined ? { chromeless: panel.chromeless } : {}),
    ...(panel.supportsFullPage !== undefined ? { supportsFullPage: panel.supportsFullPage } : {}),
  }
}

function legacyPanelWorkspaceSourceRegistration(panel: BoringFrontPanelRegistration<any>, pluginId: string): WorkspaceSourceRegistration {
  const title = panel.label ?? panel.id
  return {
    title,
    component: adaptLegacyPanelToWorkspaceSource(panel.id, title, panel.component, panel.lazy),
    source: panel.source ?? "plugin",
    pluginId,
    ...(panel.icon ? { icon: panel.icon } : {}),
    ...(panel.requiresCapabilities ? { requiresCapabilities: panel.requiresCapabilities } : {}),
    ...(panel.lazy !== undefined ? { lazy: panel.lazy } : {}),
    ...(panel.chromeless !== undefined ? { chromeless: panel.chromeless } : {}),
    ...(panel.defaultPanelId !== undefined ? { defaultPanelId: panel.defaultPanelId } : {}),
  }
}

function workspaceSourceRegistration(source: BoringFrontWorkspaceSourceRegistration<any>, pluginId: string): WorkspaceSourceRegistration {
  return {
    title: source.label ?? source.id,
    component: source.component,
    source: source.source ?? "plugin",
    pluginId,
    ...(source.icon ? { icon: source.icon } : {}),
    ...(source.requiresCapabilities ? { requiresCapabilities: source.requiresCapabilities } : {}),
    ...(source.lazy !== undefined ? { lazy: source.lazy } : {}),
    ...(source.chromeless !== undefined ? { chromeless: source.chromeless } : {}),
    ...(source.defaultPanelId !== undefined ? { defaultPanelId: source.defaultPanelId } : {}),
  }
}

function commandRegistration(
  command: BoringFrontPanelCommandRegistration,
  pluginId: string,
  panelCommandRunner?: BootstrapOptions["panelCommandRunner"],
): CommandConfig {
  const run = command.run ?? panelCommandRunner?.(command) ?? (() => {
    throw new Error(`Panel command "${command.id}" must provide run() or panelId.`)
  })
  return {
    id: command.id,
    title: command.title,
    run,
    pluginId,
    ...(command.keywords ? { keywords: command.keywords } : command.panelId ? { keywords: [command.panelId] } : {}),
    ...(command.shortcut ? { shortcut: command.shortcut } : {}),
    ...(command.when ? { when: command.when } : {}),
  }
}

function hasWorkspaceSourceContributions(registrations: CapturedFrontPlugin["registrations"]): boolean {
  return registrations.workspaceSources.length > 0 ||
    registrations.panels.some((panel) => isWorkspaceSourcePlacement(panel.placement))
}

export function registerCapturedFrontPlugin(
  plugin: CapturedFrontPlugin,
  registries: BootstrapOptions["registries"],
  panelCommandRunner?: BootstrapOptions["panelCommandRunner"],
): void {
  const { registrations } = plugin
  if (!registries.workspaceSources && hasWorkspaceSourceContributions(registrations)) {
    throw new PluginError("validation", `plugin "${plugin.id}" registered workspace sources but bootstrap registries.workspaceSources is missing`)
  }
  for (const panel of registrations.panels) {
    if (isWorkspaceSourcePlacement(panel.placement) && registries.workspaceSources) {
      registries.workspaceSources.register(panel.id, legacyPanelWorkspaceSourceRegistration(panel, plugin.id))
      continue
    }
    registries.panels.register(panel.id, panelRegistration(panel, plugin.id))
  }
  for (const source of registrations.workspaceSources) {
    registries.workspaceSources?.register(source.id, workspaceSourceRegistration(source, plugin.id))
  }
  for (const command of registrations.panelCommands) {
    registries.commands.registerCommand(commandRegistration(command, plugin.id, panelCommandRunner))
  }
  for (const catalog of registrations.catalogs) {
    registries.catalogs.register(catalog, plugin.id)
  }
  for (const resolver of registrations.surfaceResolvers) {
    const { id, config } = normalizeFrontSurfaceResolver(resolver, plugin.id)
    registries.surfaceResolvers?.register(id, config)
  }
}

export function bootstrap(options: BootstrapOptions): BootstrapResult {
  if (!options.chatPanel) {
    throw new PluginError("validation", "bootstrap requires chatPanel")
  }

  const excludedDefaults = new Set(options.excludeDefaults ?? [])
  const finalPlugins = [
    ...(options.defaults ?? []).filter(
      (plugin) => !excludedDefaults.has(plugin.pluginId),
    ),
    ...(options.plugins ?? []),
  ]

  const seenPluginIds = new Set<string>()
  for (const plugin of finalPlugins) {
    if (seenPluginIds.has(plugin.pluginId)) {
      throw new PluginError(
        "duplicate-id",
        `plugin "${plugin.pluginId}" registered twice`,
      )
    }
    seenPluginIds.add(plugin.pluginId)
  }

  const captured = finalPlugins.map(captureFrontPlugin)
  for (const plugin of captured) {
    registerCapturedFrontPlugin(plugin, options.registries, options.panelCommandRunner)
  }

  return {
    registered: captured.map((plugin) => plugin.id),
    plugins: captured,
  }
}
