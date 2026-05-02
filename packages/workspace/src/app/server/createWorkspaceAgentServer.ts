/**
 * Standalone workspace + agent Fastify composition.
 *
 * This entry intentionally imports @boring/agent/server. Browser-facing
 * workspace entrypoints must not.
 */
import {
  createAgentApp,
  provisionRuntimeWorkspace,
  type CreateAgentAppOptions,
} from "@boring/agent/server"
import type { FastifyInstance } from "fastify"
import { join } from "node:path"
import { createInMemoryBridge } from "../../server/bridge/createInMemoryBridge"
import { createWorkspaceUiTools } from "../../server/ui-control/tools/uiTools"
import { uiRoutes } from "../../server/ui-control/http/uiRoutes"
import {
  ServerPluginError,
  bootstrapServer,
  composeServerPlugins,
  defineServerPlugin,
  validateServerPlugin,
  compactPiPackages,
  type ServerBootstrapOptions,
  type ComposeServerPluginsOptions,
  type WorkspacePiPackageSource,
  type WorkspaceServerPlugin,
  type WorkspaceProvisioningContribution,
  type WorkspaceRouteContribution,
} from "../../server/plugins/bootstrapServer"

export interface WorkspaceAgentResourceLoaderOptions {
  noContextFiles?: boolean
  noSkills?: boolean
  additionalSkillPaths?: string[]
  piPackages?: WorkspacePiPackageSource[]
}

type WorkspaceAgentCreateOptions = Omit<
  CreateAgentAppOptions,
  "resourceLoaderOptions"
> & {
  resourceLoaderOptions?: WorkspaceAgentResourceLoaderOptions
}

export interface CreateWorkspaceAgentServerOptions
  extends WorkspaceAgentCreateOptions,
    Pick<ServerBootstrapOptions, "plugins" | "defaults" | "excludeDefaults"> {
  provisionWorkspace?: boolean
  workspaceProvisioning?: { force?: boolean }
}

export {
  ServerPluginError,
  composeServerPlugins,
  defineServerPlugin,
  validateServerPlugin,
}
export type {
  ComposeServerPluginsOptions,
  WorkspacePiPackageSource,
  WorkspaceServerPlugin,
  WorkspaceProvisioningContribution,
  WorkspaceRouteContribution,
}

export interface WorkspaceAgentServerPluginCollection {
  provisioningContributions: WorkspaceProvisioningContribution[]
  routeContributions: WorkspaceRouteContribution[]
  agentOptions: Pick<
    WorkspaceAgentCreateOptions,
    "extraTools" | "systemPromptAppend" | "resourceLoaderOptions"
  >
}

export interface CollectWorkspaceAgentServerPluginsOptions
  extends Pick<
      WorkspaceAgentCreateOptions,
      "workspaceRoot" | "systemPromptAppend" | "resourceLoaderOptions"
    >,
    Pick<ServerBootstrapOptions, "plugins" | "defaults" | "excludeDefaults"> {}

export function collectWorkspaceAgentServerPlugins(
  opts: CollectWorkspaceAgentServerPluginsOptions = {},
): WorkspaceAgentServerPluginCollection {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const result = bootstrapServer({
    defaults: opts.defaults,
    plugins: opts.plugins,
    excludeDefaults: opts.excludeDefaults,
  })
  const workspaceSkillsDir = join(workspaceRoot, ".agents", "skills")
  const callerAdditional = opts.resourceLoaderOptions?.additionalSkillPaths ?? []
  const callerPiPackages = opts.resourceLoaderOptions?.piPackages ?? []

  return {
    provisioningContributions: result.provisioningContributions,
    routeContributions: result.routeContributions,
    agentOptions: {
      extraTools: result.agentTools,
      systemPromptAppend: [opts.systemPromptAppend, result.systemPromptAppend]
        .filter(Boolean)
        .join("\n\n") || undefined,
      resourceLoaderOptions: {
        ...opts.resourceLoaderOptions,
        additionalSkillPaths: [workspaceSkillsDir, ...callerAdditional],
        piPackages: compactPiPackages([...result.piPackages, ...callerPiPackages]),
      },
    },
  }
}

export async function provisionWorkspaceAgentServer(opts: {
  workspaceRoot: string
  provisioningContributions?: WorkspaceProvisioningContribution[]
  force?: boolean
}) {
  if (!opts.provisioningContributions?.length) return

  await provisionRuntimeWorkspace({
    workspaceRoot: opts.workspaceRoot,
    contributions: opts.provisioningContributions,
    force: opts.force,
  })
}

export async function createWorkspaceAgentServer(
  opts: CreateWorkspaceAgentServerOptions = {},
): Promise<FastifyInstance> {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const bridge = createInMemoryBridge()
  const uiTools = createWorkspaceUiTools(bridge, { workspaceRoot })
  const pluginCollection = collectWorkspaceAgentServerPlugins(opts)

  if (opts.provisionWorkspace !== false) {
    await provisionWorkspaceAgentServer({
      workspaceRoot,
      provisioningContributions: pluginCollection.provisioningContributions,
      force: opts.workspaceProvisioning?.force,
    })
  }

  const app = await createAgentApp({
    ...opts,
    workspaceRoot,
    extraTools: [
      ...(opts.extraTools ?? []),
      ...uiTools,
      ...(pluginCollection.agentOptions.extraTools ?? []),
    ],
    systemPromptAppend: pluginCollection.agentOptions.systemPromptAppend,
    resourceLoaderOptions: pluginCollection.agentOptions.resourceLoaderOptions,
  })
  await app.register(uiRoutes, { bridge })
  for (const { routes } of pluginCollection.routeContributions) {
    await app.register(routes)
  }
  return app
}
