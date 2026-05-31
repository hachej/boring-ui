import { resolve } from 'node:path'
import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
} from '@hachej/boring-core/app/server'
import { createAskUserPiExtensionFactory } from '@hachej/boring-ask-user/agent'
import { demoServerPlugin } from '../plugins/demo/server'

async function main(): Promise<void> {
  const appRoot = appRootFromImportMeta(import.meta.url, 2)
  const app = await createCoreWorkspaceAgentServer({
    appRoot,
    appPackageJsonPath: resolve(appRoot, 'package.json'),
    serveFrontend: true,
    plugins: [demoServerPlugin],
    getWorkspaceBridgePi: (ctx) => ({
      extensionFactories: [createAskUserPiExtensionFactory({
        callHumanInputRequest: async (input, signal) => await ctx.callAsRuntime(
          { op: 'human-input.v1.request', requestId: input.requestId, input },
          { sessionId: input.sessionId, signal },
        ),
      })],
    }),
  })
  const address = await app.listen({ host: app.config.host, port: app.config.port })
  app.log.info({ event: 'core.server.ready', address }, 'core.server.ready')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
