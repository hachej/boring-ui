import { createCoreWorkspaceAgentServer, createVercelFastifyHandler } from '@hachej/boring-core/app/server'
import { createAskUserBridgeTool } from './askUserBridgeTool'

process.env.BORING_AGENT_MODE ??= 'vercel-sandbox'
process.env.BORING_AGENT_WORKSPACE_ROOT ??= '/tmp/boring-workspaces'

const appRoot = process.cwd()
const workspaceRoot = process.env.BORING_AGENT_WORKSPACE_ROOT

export default createVercelFastifyHandler({
  createServer: () => createCoreWorkspaceAgentServer({
    appRoot,
    workspaceRoot,
    appPackageJsonPath: `${appRoot}/package.json`,
    serveFrontend: true,
    getWorkspaceBridgeExtraTools: (ctx) => [createAskUserBridgeTool(ctx)],
  }),
})
