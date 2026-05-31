import { resolve } from 'node:path'
import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
  startCoreWorkspaceAgentDevServer,
} from '@hachej/boring-core/app/server'
import { createAskUserPiExtensionFactory } from '@hachej/boring-ask-user/agent'
import { demoServerPlugin } from '../plugins/demo/server'

const appRoot = appRootFromImportMeta(import.meta.url, 2)

startCoreWorkspaceAgentDevServer({
  appRoot,
  buildServer: (options) => createCoreWorkspaceAgentServer({
    ...options,
    appPackageJsonPath: resolve(appRoot, 'package.json'),
    plugins: [demoServerPlugin],
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
