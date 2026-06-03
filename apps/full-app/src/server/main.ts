import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
} from '@hachej/boring-core/app/server'
import { serverPlugins } from './plugins.js'

async function main() {
  const appRoot = appRootFromImportMeta(import.meta.url, 2)
  const app = await createCoreWorkspaceAgentServer({
    appRoot,
    serveFrontend: true,
    plugins: serverPlugins,
  })
  const address = await app.listen({ host: app.config.host, port: app.config.port })
  app.log.info({ event: 'core.server.ready', address }, 'core.server.ready')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
