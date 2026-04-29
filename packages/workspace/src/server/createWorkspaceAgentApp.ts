/**
 * Convenience wrapper around @boring/agent's createAgentApp that adds the
 * workspace UI bridge surface — both the LLM tools (get_ui_state, exec_ui)
 * and the HTTP routes (/api/v1/ui/*) — closed over a single in-memory
 * bridge instance. App shells that want a fully-wired chat-aware agent
 * call this one function and get everything; standalone agent users
 * (CLI, embedders that don't have a workspace) keep using `createAgentApp`
 * directly and ship zero UI surface.
 *
 * App-specific domain tools (e.g. boring-macro's `execute_sql`) ship via
 * the v7.0 plugin model: define a `Plugin` with an `agentTools` field and
 * pass it through `plugins: [...]` (wired via `bootstrap()` once Plugin
 * Step 3 lands). Tools that need to drive UI use the generic `exec_ui`
 * tool registered here — no typed-wrapper-around-bridge pattern needed.
 * See packages/workspace/docs/plans/PLUGIN_MODEL.md.
 */
import { createAgentApp, type CreateAgentAppOptions } from "@boring/agent/server"
import type { FastifyInstance } from "fastify"
import { createInMemoryBridge } from "./ui-bridge/createInMemoryBridge"
import { createWorkspaceUiTools } from "./uiTools"
import { uiRoutes } from "./http/uiRoutes"
import { bootstrapServer, type ServerBootstrapOptions } from "./bootstrapServer"

export interface CreateWorkspaceAgentAppOptions
  extends CreateAgentAppOptions,
    Pick<ServerBootstrapOptions, "plugins" | "excludeDefaults"> {}

export async function createWorkspaceAgentApp(
  opts: CreateWorkspaceAgentAppOptions = {},
): Promise<FastifyInstance> {
  const bridge = createInMemoryBridge()
  const uiTools = createWorkspaceUiTools(bridge, {
    workspaceRoot: opts.workspaceRoot,
  })

  const result = bootstrapServer({
    plugins: opts.plugins,
    excludeDefaults: opts.excludeDefaults,
  })

  const app = await createAgentApp({
    ...opts,
    extraTools: [...(opts.extraTools ?? []), ...uiTools, ...result.agentTools],
    systemPromptAppend: [opts.systemPromptAppend, result.systemPromptAppend]
      .filter(Boolean)
      .join("\n\n") || undefined,
  })
  await app.register(uiRoutes, { bridge })
  return app
}
