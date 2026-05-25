import { resolve } from 'node:path'
import {
  createCoreWorkspaceAgentServer,
  startCoreWorkspaceAgentDevServer,
} from '@hachej/boring-core/app/server'
import { createAskUserBridgeTool } from './askUserBridgeTool'

const appRoot = resolve(import.meta.dirname, '../..')

startCoreWorkspaceAgentDevServer({
  appRoot,
  buildServer: (options) => createCoreWorkspaceAgentServer({
    ...options,
    appPackageJsonPath: resolve(appRoot, 'package.json'),
    getWorkspaceBridgeExtraTools: (ctx) => [createAskUserBridgeTool(ctx)],
  }),
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
