import path from 'node:path'
import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
} from '@hachej/boring-core/app/server'
import { loadConfig } from '@hachej/boring-core/server'
import { createFullAppServerPlugins } from './plugins.js'
import { buildCreditsWiring } from './credits.js'
import { assertProductionAgentModeIsSafe } from './productionSafety.js'
import { buildGovernanceService, createDefaultCompanyContextRootResolver, createGovernanceFilesystemBindings, createGovernanceMeteringSink, createGovernanceModelFilter, createGovernanceServerPlugin } from './governance/index.js'

function pluginAuthoringEnabledFromEnv(): boolean {
  return process.env.BORING_PLUGIN_AUTHORING === '1'
}

async function main() {
  assertProductionAgentModeIsSafe()
  const appRoot = appRootFromImportMeta(import.meta.url, 2)
  const config = await loadConfig({
    allowMissingSecrets: process.env.NODE_ENV !== 'production',
    tomlPath: path.resolve(appRoot, 'boring.app.toml'),
  })
  const governance = await buildGovernanceService({ config })
  // Build the metering sink up-front; the credit service attaches after the
  // server (and its db) exists.
  const credits = buildCreditsWiring()
  let appDb: unknown
  const app = await createCoreWorkspaceAgentServer({
    appRoot,
    config,
    serveFrontend: true,
    plugins: createFullAppServerPlugins([createGovernanceServerPlugin(governance)]),
    externalPlugins: false,
    installPluginAuthoring: pluginAuthoringEnabledFromEnv(),
    metering: createGovernanceMeteringSink({
      service: governance,
      delegate: credits.meteringSink,
      getDb: () => {
        if (!appDb) throw new Error('governance metering db is not attached')
        return appDb as never
      },
    }),
    filterModels: createGovernanceModelFilter(governance),
    getFilesystemBindings: createGovernanceFilesystemBindings(governance, {
      resolveCompanyContextRoot: createDefaultCompanyContextRootResolver(),
    }),
    pi: { strictModelResolution: governance.isEnabled() } as never,
  })
  appDb = app.db
  credits.attach(app)
  const address = await app.listen({ host: app.config.host, port: app.config.port })
  app.log.info({ event: 'core.server.ready', address }, 'core.server.ready')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
