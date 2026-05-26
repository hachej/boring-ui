import { createCoreWorkspaceAgentServer, createVercelFastifyHandler } from '@hachej/boring-core/app/server'
import { createAskUserPiExtensionFactory } from '@hachej/boring-ask-user/agent'

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
    getWorkspaceBridgePi: (ctx) => ({
      extensionFactories: [createAskUserPiExtensionFactory({
        callHumanInputRequest: async (input, signal) => await ctx.callAsRuntime(
          { op: 'human-input.v1.request', requestId: input.requestId, input },
          { sessionId: input.sessionId, signal },
        ),
      })],
    }),
  }),
})
