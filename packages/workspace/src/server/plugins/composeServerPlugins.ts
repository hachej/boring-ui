import type { RuntimeProvisioningContribution } from "@boring/agent/server"
import type { FastifyPluginAsync } from "fastify"
import type { AgentTool } from "../../shared/types/agent-tool"
import {
  defineServerPlugin,
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
  systemPrompt?: string
  agentTools?: AgentTool[]
  provisioning?: RuntimeProvisioningContribution
  routes?: FastifyPluginAsync
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
  if (templateDirs.length === 0 && python.length === 0) return undefined
  return {
    ...(templateDirs.length > 0 ? { templateDirs } : {}),
    ...(python.length > 0 ? { python } : {}),
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
    for (const routes of routePlugins) {
      await app.register(routes)
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

  return defineServerPlugin({
    id: options.id,
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(piPackages.length > 0 ? { piPackages } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(agentTools.length > 0 ? { agentTools } : {}),
    ...(provisioning ? { provisioning } : {}),
    ...(routes ? { routes } : {}),
  })
}
