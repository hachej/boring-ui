import { resolve } from 'node:path'
import { createCoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'
import { createAskUserBridgeTool } from './askUserBridgeTool'

async function main(): Promise<void> {
  const appRoot = resolve(import.meta.dirname, '../..')
  const app = await createCoreWorkspaceAgentServer({
    appRoot,
    appPackageJsonPath: resolve(appRoot, 'package.json'),
    serveFrontend: true,
    getWorkspaceBridgeExtraTools: (ctx) => [createAskUserBridgeTool(ctx)],
  })
  const address = await app.listen({ host: app.config.host, port: app.config.port })
  app.log.info({ event: 'core.server.ready', address }, 'core.server.ready')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
