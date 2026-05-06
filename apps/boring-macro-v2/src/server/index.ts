// boring.macro server entry. The workspace server composer owns the agent,
// UI bridge, plugin tools, plugin provisioning, and plugin routes.
import { createCoreWorkspaceAgentServer } from "@hachej/boring-core/app/server"
import { createMacroServerPlugin } from "../plugins/macro/server"

export interface MacroAppOptions {
  port?: number
  host?: string
  workspaceRoot?: string
  logger?: boolean
  appRoot?: string
}

export async function buildMacroServer(opts: MacroAppOptions = {}) {
  const port = opts.port ?? (Number(process.env.PORT ?? process.env.API_PORT) || 5210)
  const host = opts.host ?? (process.env.HOST || "0.0.0.0")
  const workspaceRoot =
    opts.workspaceRoot ??
    (process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd())

  const macroPlugin = await createMacroServerPlugin()

  const app = await createCoreWorkspaceAgentServer({
    workspaceRoot,
    appRoot: opts.appRoot,
    plugins: [macroPlugin],
  })

  return { app, port, host }
}

export { buildMacroServer as buildServer }
