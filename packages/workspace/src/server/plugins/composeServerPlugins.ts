import type { RuntimeProvisioningContribution } from "@hachej/boring-agent/server"
import type { FastifyPluginAsync } from "fastify"
import type { AgentTool } from "../../shared/types/agent-tool"
import {
  defineServerPlugin,
  type WorkspaceExtensionFactory,
  type WorkspaceServerPlugin,
} from "./defineServerPlugin"
import {
  compactPiPackages,
  type WorkspacePiPackageSource,
} from "./piPackages"

export interface ComposeServerPluginsOptions {
  id: string
  label?: string
  plugins: WorkspaceServerPlugin[]
  piPackages?: WorkspacePiPackageSource[]
  extensionPaths?: string[]
  extensionFactories?: WorkspaceExtensionFactory[]
  systemPrompt?: string
  agentTools?: AgentTool[]
  provisioning?: RuntimeProvisioningContribution
  routes?: FastifyPluginAsync
  preservedUiStateKeys?: string[]
}

function compactPrompts(
  prompts: Array<string | undefined>,
): string | undefined {
  const text = prompts
    .map((prompt) => prompt?.trim())
    .filter((prompt): prompt is string => Boolean(prompt))
    .join("\n\n")
  return text || undefined
}

function mergeProvisioning(
  contributions: Array<RuntimeProvisioningContribution | undefined>,
): RuntimeProvisioningContribution | undefined {
  const templateDirs = contributions.flatMap((entry) => entry?.templateDirs ?? [])
  const python = contributions.flatMap((entry) => entry?.python ?? [])
  const nodePackages = contributions.flatMap((entry) => entry?.nodePackages ?? [])
  if (templateDirs.length === 0 && python.length === 0 && nodePackages.length === 0) return undefined
  return {
    ...(templateDirs.length > 0 ? { templateDirs } : {}),
    ...(python.length > 0 ? { python } : {}),
    ...(nodePackages.length > 0 ? { nodePackages } : {}),
  }
}

function composeRoutes(
  routes: Array<FastifyPluginAsync | undefined>,
): FastifyPluginAsync | undefined {
  const routePlugins = routes.filter((route): route is FastifyPluginAsync =>
    Boolean(route),
  )
  if (routePlugins.length === 0) return undefined
  return async (app) => {
    for (const routePlugin of routePlugins) {
      await app.register(routePlugin)
    }
  }
}

/**
 * Compose a server plugin from smaller server plugin fragments. Child
 * contributions are concatenated before parent contributions. Composed routes
 * are registered without extra Fastify options; use an explicit routes plugin
 * when a child needs scoped registration options.
 */
export function composeServerPlugins(
  options: ComposeServerPluginsOptions,
): WorkspaceServerPlugin {
  const piPackages = compactPiPackages([
    ...options.plugins.flatMap((plugin) => plugin.piPackages ?? []),
    ...(options.piPackages ?? []),
  ])
  const extensionPaths = [
    ...options.plugins.flatMap((plugin) => plugin.extensionPaths ?? []),
    ...(options.extensionPaths ?? []),
  ]
  const extensionFactories = [
    ...options.plugins.flatMap((plugin) => plugin.extensionFactories ?? []),
    ...(options.extensionFactories ?? []),
  ]
  const agentTools = [
    ...options.plugins.flatMap((plugin) => plugin.agentTools ?? []),
    ...(options.agentTools ?? []),
  ]
  const systemPrompt = compactPrompts([
    ...options.plugins.map((plugin) => plugin.systemPrompt),
    options.systemPrompt,
  ])
  const provisioning = mergeProvisioning([
    ...options.plugins.map((plugin) => plugin.provisioning),
    options.provisioning,
  ])
  const routes = composeRoutes([
    ...options.plugins.map((plugin) => plugin.routes),
    options.routes,
  ])
  const preservedUiStateKeys = [...new Set([
    ...options.plugins.flatMap((plugin) => plugin.preservedUiStateKeys ?? []),
    ...(options.preservedUiStateKeys ?? []),
  ])]

  return defineServerPlugin({
    id: options.id,
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(piPackages.length > 0 ? { piPackages } : {}),
    ...(extensionPaths.length > 0 ? { extensionPaths } : {}),
    ...(extensionFactories.length > 0 ? { extensionFactories } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(agentTools.length > 0 ? { agentTools } : {}),
    ...(provisioning ? { provisioning } : {}),
    ...(routes ? { routes } : {}),
    ...(preservedUiStateKeys.length > 0 ? { preservedUiStateKeys } : {}),
  })
}
