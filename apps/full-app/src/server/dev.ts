import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
  startCoreWorkspaceAgentDevServer,
} from '@hachej/boring-core/app/server'
import { serverPlugins } from './plugins.js'

const appRoot = appRootFromImportMeta(import.meta.url, 2)

function pluginAuthoringEnabledFromEnv(): boolean {
  return process.env.BORING_PLUGIN_AUTHORING === '1'
}

startCoreWorkspaceAgentDevServer({
  appRoot,
  buildServer: (options) =>
    createCoreWorkspaceAgentServer({
      ...options,
      plugins: serverPlugins,
      externalPlugins: false,
      installPluginAuthoring: pluginAuthoringEnabledFromEnv(),
    }),
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
