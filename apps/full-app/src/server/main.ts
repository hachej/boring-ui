import { resolve } from 'node:path'
import { createCoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'
import { createAskUserPiExtensionFactory } from '@hachej/boring-ask-user/agent'

async function main(): Promise<void> {
  const appRoot = resolve(import.meta.dirname, '../..')
  const app = await createCoreWorkspaceAgentServer({
    appRoot,
    appPackageJsonPath: resolve(appRoot, 'package.json'),
    serveFrontend: true,
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
