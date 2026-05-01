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
  bootstrapServer,
  defineServerPlugin,
  type ServerBootstrapOptions,
  type WorkspaceServerPlugin,
  type WorkspaceProvisioningContribution,
  type WorkspaceRouteContribution,
} from "../../server/plugins/bootstrapServer"

export interface CreateWorkspaceAgentServerOptions
  extends CreateAgentAppOptions,
    Pick<ServerBootstrapOptions, "plugins" | "defaults" | "excludeDefaults"> {
  provisionWorkspace?: boolean
  workspaceProvisioning?: { force?: boolean }
}

export { defineServerPlugin }
export type { WorkspaceServerPlugin, WorkspaceProvisioningContribution }
export type { WorkspaceRouteContribution }

export interface WorkspaceAgentServerPluginCollection {
  provisioningContributions: WorkspaceProvisioningContribution[]
  routeContributions: WorkspaceRouteContribution[]
  agentOptions: Pick<CreateAgentAppOptions, "extraTools" | "systemPromptAppend" | "resourceLoaderOptions">
}

export interface CollectWorkspaceAgentServerPluginsOptions
  extends Pick<
      CreateAgentAppOptions,
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
