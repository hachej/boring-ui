import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
  startCoreWorkspaceAgentDevServer,
} from '@hachej/boring-core/app/server'
import { serverPlugins } from './plugins.js'
import { buildCreditsWiring } from './credits.js'

const appRoot = appRootFromImportMeta(import.meta.url, 2)

function pluginAuthoringEnabledFromEnv(): boolean {
  return process.env.BORING_PLUGIN_AUTHORING === '1'
}

startCoreWorkspaceAgentDevServer({
  appRoot,
  buildServer: async (options) => {
    const credits = buildCreditsWiring()
    const app = await createCoreWorkspaceAgentServer({
      ...options,
      plugins: serverPlugins,
      externalPlugins: false,
      installPluginAuthoring: pluginAuthoringEnabledFromEnv(),
      metering: credits.meteringSink,
    })
    credits.attach(app)
    return app
  },
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
