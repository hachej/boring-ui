import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

export function defaultWorkspaceRoot(): string {
  return (
    process.env.FULL_APP_WORKSPACE_ROOT ??
    path.resolve(tmpdir(), 'boring-ui-v2-full-app-workspace')
  )
}

export async function buildServer(options: FullAppServerOptions = {}): Promise<FullAppServer> {
  const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot()
  await mkdir(workspaceRoot, { recursive: true })

  return createCoreWorkspaceAgentServer({
    appRoot: options.appRoot ?? defaultAppRoot(),
    workspaceRoot,
    serveFrontend: options.serveFrontend,
  })
}
