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
import type { AgentTool } from "@boring/agent/shared"
import type { FastifyInstance } from "fastify"
import type { UiBridge } from "../shared/ui-bridge"
import { createInMemoryBridge } from "./ui-bridge/createInMemoryBridge"
import { createWorkspaceUiTools } from "./uiTools"
import { uiRoutes } from "./http/uiRoutes"

export interface WorkspaceAgentDeps {
  /** Same in-memory bridge instance the workspace UI tools and HTTP routes share. */
  uiBridge: UiBridge
}

export interface CreateWorkspaceAgentAppOptions extends CreateAgentAppOptions {
  /**
   * Host-supplied tool factories — receive the SAME bridge instance that
   * powers the workspace UI tools, so they can dispatch openPanel /
   * openFile / etc. through the bridge under their own typed wrapper. This
   * is the seam for app-specific domain tools (e.g. boring-macro's
   * `open_series(seriesId)`) that should appear in the LLM catalog with
   * structured JSON-schema parameters instead of being expressed as raw
   * `exec_ui({kind:"openPanel", params:{...}})` calls.
   *
   * Each factory runs once at app boot, gets the deps, and returns an
   * AgentTool[]. The result is appended to `extraTools` after the host's
   * static `extraTools` and before the workspace UI tools, so on a name
   * collision the workspace UI tools still win (workspace is the contract,
   * hosts EXTEND it).
   */
  toolFactories?: Array<(deps: WorkspaceAgentDeps) => AgentTool[]>
}

export async function createWorkspaceAgentApp(
  opts: CreateWorkspaceAgentAppOptions = {},
): Promise<FastifyInstance> {
  const bridge = createInMemoryBridge()
  const uiTools = createWorkspaceUiTools(bridge, {
    workspaceRoot: opts.workspaceRoot,
  })
  const factoryTools = (opts.toolFactories ?? []).flatMap((f) => f({ uiBridge: bridge }))
  const app = await createAgentApp({
    ...opts,
    // Merge order matters on name collision (last wins per mergeTools):
    //   1. host extraTools (static) — first
    //   2. host toolFactories result (closes over bridge) — second
    //   3. workspace UI tools — last, so workspace contract wins on
    //      accidental shadowing
    extraTools: [...(opts.extraTools ?? []), ...factoryTools, ...uiTools],
  })
  await app.register(uiRoutes, { bridge })
  return app
}
