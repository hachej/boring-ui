import path from 'node:path'
import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
  startCoreWorkspaceAgentDevServer,
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
import type { WorkspaceAgentDispatcherResolver } from '@hachej/boring-agent/server'
import { registerDevLoginRoute } from './devLogin.js'

const appRoot = appRootFromImportMeta(import.meta.url, 2)

function pluginAuthoringEnabledFromEnv(): boolean {
  return process.env.BORING_PLUGIN_AUTHORING === '1'
}

const frontendPort = Number(process.env.FRONTEND_PORT) || undefined

startCoreWorkspaceAgentDevServer({
  appRoot,
  ...(frontendPort ? { frontendPort } : {}),
  buildServer: async (options) => {
    const config = await loadConfig({
      allowMissingSecrets: process.env.NODE_ENV !== 'production',
      tomlPath: path.resolve(appRoot, 'boring.app.toml'),
    })
    const { governance, ...pluginComposition } = await createFullAppHostPluginComposition(config)
    const credits = buildCreditsWiring()
    let appDb: unknown
    let appRef: Awaited<ReturnType<typeof createCoreWorkspaceAgentServer>> | undefined
    let managedAgentDispatcherResolver: WorkspaceAgentDispatcherResolver | undefined
    const app = await createCoreWorkspaceAgentServer({
      ...options,
      config,
      defaultAgentTypeId: 'default',
      plugins: [...pluginComposition.plugins],
      defaultPluginPackages: [...pluginComposition.defaultPluginPackages],
      externalPlugins: false,
      installPluginAuthoring: pluginAuthoringEnabledFromEnv(),
      metering: governance.createMeteringSink(credits.meteringSink, () => {
        if (!appDb) throw new Error('governance metering db is not attached')
        return appDb as never
      }),
      filterModels: governance.filterModels,
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
    registerDevLoginRoute(app)
    return app
  },
}).catch((error) => {
  console.error(error)
  process.exit(1)
})
