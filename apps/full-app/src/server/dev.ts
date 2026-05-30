import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
  startCoreWorkspaceAgentDevServer,
} from '@hachej/boring-core/app/server'
import { demoServerPlugin } from '../plugins/demo/server'

const appRoot = appRootFromImportMeta(import.meta.url, 2)

startCoreWorkspaceAgentDevServer({
  appRoot,
  buildServer: (options) =>
    createCoreWorkspaceAgentServer({ ...options, plugins: [demoServerPlugin] }),
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
