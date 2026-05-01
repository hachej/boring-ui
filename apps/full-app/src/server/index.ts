import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCoreWorkspaceAgentServer } from '@boring/core/app/server'

export type FullAppServer = Awaited<ReturnType<typeof createCoreWorkspaceAgentServer>>

export interface FullAppServerOptions {
  appRoot?: string
  workspaceRoot?: string
  serveFrontend?: boolean
}

export function defaultAppRoot(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(thisDir, '../..')
}

export async function buildServer(options: FullAppServerOptions = {}): Promise<FullAppServer> {
  return createCoreWorkspaceAgentServer({
    appRoot: options.appRoot ?? defaultAppRoot(),
    workspaceRoot: options.workspaceRoot,
    serveFrontend: options.serveFrontend,
  })
}
