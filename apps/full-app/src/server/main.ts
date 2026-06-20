import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
} from '@hachej/boring-core/app/server'
import { serverPlugins } from './plugins.js'
import { buildCreditsWiring } from './credits.js'

function pluginAuthoringEnabledFromEnv(): boolean {
  return process.env.BORING_PLUGIN_AUTHORING === '1'
}

function hostedExternalPluginsEnabledFromEnv(): boolean {
  return process.env.BORING_HOSTED_EXTERNAL_PLUGINS === '1'
}

async function main() {
  const appRoot = appRootFromImportMeta(import.meta.url, 2)
  // Build the metering sink up-front; the credit service attaches after the
  // server (and its db) exists.
  const credits = buildCreditsWiring()
  const app = await createCoreWorkspaceAgentServer({
    appRoot,
    serveFrontend: true,
    plugins: serverPlugins,
    externalPlugins: false,
    hostedExternalPlugins: hostedExternalPluginsEnabledFromEnv(),
    installPluginAuthoring: pluginAuthoringEnabledFromEnv(),
    metering: credits.meteringSink,
  })
  credits.attach(app)
  const address = await app.listen({ host: app.config.host, port: app.config.port })
  app.log.info({ event: 'core.server.ready', address }, 'core.server.ready')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
