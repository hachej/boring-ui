import { fileURLToPath } from "node:url"
import { createCoreWorkspaceAgentServer } from "@hachej/boring-core/app/server"
import { createMacroServerPlugin } from "../../../boring-macro-v2/src/plugins/macro/server"

export interface MacroAppOptions {
  port?: number
  host?: string
  workspaceRoot?: string
  appRoot?: string
}

export async function buildServer(opts: MacroAppOptions = {}) {
  const workspaceRoot =
    opts.workspaceRoot ?? (process.env.BORING_AGENT_WORKSPACE_ROOT ?? process.cwd())

  const macroPlugin = await createMacroServerPlugin()
  const macroTemplatePath = fileURLToPath(
    new URL("../../../boring-macro-v2/src/plugins/macro/server/workspace-template", import.meta.url),
  )

  const app = await createCoreWorkspaceAgentServer({
    workspaceRoot,
    appRoot: opts.appRoot,
    templatePath: macroTemplatePath,
    plugins: [macroPlugin],
  })

  return { app }
}
