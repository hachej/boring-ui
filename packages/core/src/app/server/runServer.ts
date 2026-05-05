import { appRootFromImportMeta } from './appRootFromImportMeta.js'
import { createCoreWorkspaceAgentServer } from './createCoreWorkspaceAgentServer.js'

export interface RunCoreWorkspaceAgentServerOptions {
  workspaceRoot?: string
  /** How many directory levels up from the entry file is the app root. Default: 2 (src/server → app). */
  levelsUp?: number
}

export async function runCoreWorkspaceAgentServer(
  importMetaUrl: string,
  opts: RunCoreWorkspaceAgentServerOptions = {},
): Promise<void> {
  const appRoot = appRootFromImportMeta(importMetaUrl, opts.levelsUp ?? 2)
  const app = await createCoreWorkspaceAgentServer({
    appRoot,
    workspaceRoot: opts.workspaceRoot,
    serveFrontend: true,
  })
  const address = await app.listen({ host: app.config.host, port: app.config.port })
  app.log.info({ event: 'core.server.ready', address }, 'core.server.ready')
}
