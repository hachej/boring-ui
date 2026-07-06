import path from 'node:path'
import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
} from '@hachej/boring-core/app/server'
import { createGovernance } from '@hachej/boring-governance/server'
import { loadConfig } from '@hachej/boring-core/server'
import { createFullAppServerPlugins } from './plugins.js'
import { buildCreditsWiring } from './credits.js'
import {
  createFullAppBoringMcpAgentToolsForRequest,
  fullAppAgentSessionNamespace,
  registerFullAppBoringMcpRoutes,
} from './boringMcp.js'
import { assertProductionAgentModeIsSafe } from './productionSafety.js'

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
  const governance = await createGovernance(config)
  // Build the metering sink up-front; the credit service attaches after the
  // server (and its db) exists.
  const credits = buildCreditsWiring()
  let appDb: unknown
  let appRef: Awaited<ReturnType<typeof createCoreWorkspaceAgentServer>> | undefined
  const app = await createCoreWorkspaceAgentServer({
    appRoot,
    config,
    serveFrontend: true,
    plugins: createFullAppServerPlugins([governance.serverPlugin]),
    externalPlugins: false,
    installPluginAuthoring: pluginAuthoringEnabledFromEnv(),
    metering: governance.createMeteringSink(credits.meteringSink, () => {
      if (!appDb) throw new Error('governance metering db is not attached')
      return appDb as never
    }),
    filterModels: governance.filterModels,
    getFilesystemBindings: governance.getFilesystemBindings(),
    pi: governance.pi,
    getSessionNamespace: ({ workspaceId, request }) => fullAppAgentSessionNamespace({ workspaceId, request }),
    getExtraTools: (ctx) => appRef ? createFullAppBoringMcpAgentToolsForRequest(appRef, ctx) : [],
  })
  appDb = app.db
  appRef = app
  credits.attach(app)
  registerFullAppBoringMcpRoutes(app)
  const address = await app.listen({ host: app.config.host, port: app.config.port })
  app.log.info({ event: 'core.server.ready', address }, 'core.server.ready')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
