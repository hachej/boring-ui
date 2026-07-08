import path from 'node:path'
import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
} from '@hachej/boring-core/app/server'
import { loadConfig } from '@hachej/boring-core/server'
import {
  createFullAppHostPluginComposition,
} from './plugins.js'
import { buildCreditsWiring } from './credits.js'
import {
  createFullAppBoringMcpAgentToolsForRequest,
  fullAppAgentSessionNamespace,
  registerFullAppBoringMcpRoutes,
} from './boringMcp.js'
import {
  registerFullAppManagedAgentMcpRoutes,
} from './managedAgentMcp.js'
import { assertProductionAgentModeIsSafe } from './productionSafety.js'
import type { WorkspaceAgentDispatcherResolver } from '@hachej/boring-agent/server'

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
  const { governance, ...pluginComposition } = await createFullAppHostPluginComposition(config)
  // Build the metering sink up-front; the credit service attaches after the
  // server (and its db) exists.
  const credits = buildCreditsWiring()
  let appDb: unknown
  let appRef: Awaited<ReturnType<typeof createCoreWorkspaceAgentServer>> | undefined
  let managedAgentDispatcherResolver: WorkspaceAgentDispatcherResolver | undefined
  const app = await createCoreWorkspaceAgentServer({
    appRoot,
    config,
    serveFrontend: true,
    plugins: [...pluginComposition.plugins],
    defaultPluginPackages: [...pluginComposition.defaultPluginPackages],
    externalPlugins: false,
    installPluginAuthoring: pluginAuthoringEnabledFromEnv(),
    metering: governance.createMeteringSink(credits.meteringSink, () => {
      if (!appDb) throw new Error('governance metering db is not attached')
      return appDb as never
    }),
    filterModels: governance.filterModels,
    getSkillAccess: governance.getSkillAccess(),
    getFilesystemBindings: governance.getFilesystemBindings(),
    pi: governance.pi,
    getSessionNamespace: ({ workspaceId, request, userId }) => fullAppAgentSessionNamespace({ workspaceId, request, userId }),
    getExtraTools: (ctx) => appRef ? createFullAppBoringMcpAgentToolsForRequest(appRef, ctx) : [],
    onWorkspaceAgentDispatcher: (resolver) => {
      managedAgentDispatcherResolver = resolver
    },
  })
  appDb = app.db
  appRef = app
  credits.attach(app)
  registerFullAppBoringMcpRoutes(app)
  registerFullAppManagedAgentMcpRoutes(app, { dispatcherResolver: managedAgentDispatcherResolver })
  const address = await app.listen({ host: app.config.host, port: app.config.port })
  app.log.info({ event: 'core.server.ready', address }, 'core.server.ready')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
