import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
  startCoreWorkspaceAgentDevServer,
} from '@hachej/boring-core/app/server'
import { demoCliPlugin } from './demoPlugin'

const appRoot = appRootFromImportMeta(import.meta.url, 2)

startCoreWorkspaceAgentDevServer({
  appRoot,
  buildServer: (options) =>
    createCoreWorkspaceAgentServer({ ...options, plugins: [demoCliPlugin] }),
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
