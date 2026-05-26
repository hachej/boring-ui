import { resolve } from 'node:path'
import {
  createCoreWorkspaceAgentServer,
  startCoreWorkspaceAgentDevServer,
} from '@hachej/boring-core/app/server'
import { createAskUserPiExtensionFactory } from '@hachej/boring-ask-user/agent'

const appRoot = resolve(import.meta.dirname, '../..')

startCoreWorkspaceAgentDevServer({
  appRoot,
  buildServer: (options) => createCoreWorkspaceAgentServer({
    ...options,
    appPackageJsonPath: resolve(appRoot, 'package.json'),
    getWorkspaceBridgePi: (ctx) => ({
      extensionFactories: [createAskUserPiExtensionFactory({
        callHumanInputRequest: async (input, signal) => await ctx.callAsRuntime(
          { op: 'human-input.v1.request', requestId: input.requestId, input },
          { sessionId: input.sessionId, signal },
        ),
      })],
    }),
  }),
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
