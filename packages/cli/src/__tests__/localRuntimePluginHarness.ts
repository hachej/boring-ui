import type { FastifyInstance } from "fastify"
import { createFolderModeApp, createWorkspacesModeApp, type RuntimeMode } from "../server/modeApps.js"

export async function createLocalFolderModeApp(opts: {
  workspaceRoot: string
  mode: RuntimeMode
  projectName?: string
}): Promise<FastifyInstance> {
  return await createFolderModeApp({
    workspaceRoot: opts.workspaceRoot,
    mode: opts.mode,
    projectName: opts.projectName,
    provisionWorkspace: false,
    allowInsecureLocalBridgeAuth: true,
  })
}

export async function createLocalWorkspacesModeApp(opts: {
  mode: RuntimeMode
  registryPath: string
}): Promise<FastifyInstance> {
  return await createWorkspacesModeApp({
    mode: opts.mode,
    registryPath: opts.registryPath,
    provisionWorkspace: false,
  })
}
