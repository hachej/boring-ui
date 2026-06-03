import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
  startCoreWorkspaceAgentDevServer,
} from '@hachej/boring-core/app/server'
import { serverPlugins } from './plugins.js'

const appRoot = appRootFromImportMeta(import.meta.url, 2)

startCoreWorkspaceAgentDevServer({
  appRoot,
  buildServer: (options) =>
    createCoreWorkspaceAgentServer({ ...options, plugins: serverPlugins }),
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
