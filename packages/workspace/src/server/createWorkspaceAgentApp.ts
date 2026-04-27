/**
 * Convenience wrapper around @boring/agent's createAgentApp that adds the
 * workspace UI bridge surface — both the LLM tools (get_ui_state, exec_ui)
 * and the HTTP routes (/api/v1/ui/*) — closed over a single in-memory
 * bridge instance. App shells that want a fully-wired chat-aware agent
 * call this one function and get everything; standalone agent users
 * (CLI, embedders that don't have a workspace) keep using `createAgentApp`
 * directly and ship zero UI surface.
 */
import { createAgentApp, type CreateAgentAppOptions } from "@boring/agent/server"
import type { FastifyInstance } from "fastify"
import { createInMemoryBridge } from "./ui-bridge/createInMemoryBridge"
import { createWorkspaceUiTools } from "./uiTools"
import { uiRoutes } from "./http/uiRoutes"

export async function createWorkspaceAgentApp(
  opts: CreateAgentAppOptions = {},
): Promise<FastifyInstance> {
  const bridge = createInMemoryBridge()
  const uiTools = createWorkspaceUiTools(bridge)
  const app = await createAgentApp({
    ...opts,
    // Merge — the host's extraTools come first so they can override the UI
    // tool names if they really want to (e.g. swap exec_ui for a permissions-
    // gated variant). Tool registration is last-write-wins by name, so
    // putting host tools first means workspace tools take precedence on
    // collision; flipping the order would let hosts shadow workspace tools.
    // Lean: workspace tools are the contract, hosts EXTEND it; collision
    // by accident should keep the workspace tool. Putting workspace tools
    // last accomplishes that.
    extraTools: [...(opts.extraTools ?? []), ...uiTools],
  })
  await app.register(uiRoutes, { bridge })
  return app
}
