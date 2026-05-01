/**
 * Standalone workspace + agent Fastify composition.
 *
 * This entry intentionally imports @boring/agent/server. Browser-facing
 * workspace entrypoints must not.
 */
import { createAgentApp, type CreateAgentAppOptions } from "@boring/agent/server"
import type { FastifyInstance } from "fastify"
import { join } from "node:path"
import { createInMemoryBridge } from "../../server/bridge/createInMemoryBridge"
import { createWorkspaceUiTools } from "../../server/ui-control/tools/uiTools"
import { uiRoutes } from "../../server/ui-control/http/uiRoutes"
import { bootstrapServer, type ServerBootstrapOptions } from "../../server/plugins/bootstrapServer"
import type { UiBridge } from "../../shared/ui-bridge"

export interface CreateWorkspaceAgentServerOptions
  extends CreateAgentAppOptions,
    Pick<ServerBootstrapOptions, "plugins" | "excludeDefaults"> {}

export interface WorkspaceAgentServerBindings {
  bridge: UiBridge
  agentOptions: Pick<CreateAgentAppOptions, "extraTools" | "systemPromptAppend" | "resourceLoaderOptions">
}

export function createWorkspaceAgentServerBindings(
  opts: CreateWorkspaceAgentServerOptions = {},
): WorkspaceAgentServerBindings {
  const bridge = createInMemoryBridge()
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const uiTools = createWorkspaceUiTools(bridge, { workspaceRoot })
  const result = bootstrapServer({
    plugins: opts.plugins,
    excludeDefaults: opts.excludeDefaults,
  })
  const workspaceSkillsDir = join(workspaceRoot, ".agents", "skills")
  const callerAdditional = opts.resourceLoaderOptions?.additionalSkillPaths ?? []

  return {
    bridge,
    agentOptions: {
      extraTools: [...(opts.extraTools ?? []), ...uiTools, ...result.agentTools],
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

export async function createWorkspaceAgentServer(
  opts: CreateWorkspaceAgentServerOptions = {},
): Promise<FastifyInstance> {
  const bindings = createWorkspaceAgentServerBindings(opts)
  const app = await createAgentApp({
    ...opts,
    extraTools: bindings.agentOptions.extraTools,
    systemPromptAppend: bindings.agentOptions.systemPromptAppend,
    resourceLoaderOptions: bindings.agentOptions.resourceLoaderOptions,
  })
  await app.register(uiRoutes, { bridge: bindings.bridge })
  return app
}
