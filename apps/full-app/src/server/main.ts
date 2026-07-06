import {
  appRootFromImportMeta,
  createCoreWorkspaceAgentServer,
} from '@hachej/boring-core/app/server'
import { serverPlugins } from './plugins.js'
import { buildCreditsWiring } from './credits.js'
import {
  createFullAppBoringMcpAgentToolsForRequest,
  fullAppAgentSessionNamespace,
  registerFullAppBoringMcpRoutes,
} from './boringMcp.js'
import { DEMO_ENGAGEMENT_ANALYST_VERTICAL, registerFullAppMcpManagedAgentRoutes } from './mcpManagedAgent.js'
import { assertProductionAgentModeIsSafe } from './productionSafety.js'

function pluginAuthoringEnabledFromEnv(): boolean {
  return process.env.BORING_PLUGIN_AUTHORING === '1'
}

async function main() {
  assertProductionAgentModeIsSafe()
  const appRoot = appRootFromImportMeta(import.meta.url, 2)
  // Build the metering sink up-front; the credit service attaches after the
  // server (and its db) exists.
  const credits = buildCreditsWiring()
  let appRef: Awaited<ReturnType<typeof createCoreWorkspaceAgentServer>> | undefined
  const app = await createCoreWorkspaceAgentServer({
    appRoot,
    serveFrontend: true,
    plugins: serverPlugins,
    externalPlugins: false,
    installPluginAuthoring: pluginAuthoringEnabledFromEnv(),
    metering: credits.meteringSink,
    getSessionNamespace: ({ workspaceId, request }) => fullAppAgentSessionNamespace({ workspaceId, request }),
    getExtraTools: (ctx) => appRef ? createFullAppBoringMcpAgentToolsForRequest(appRef, ctx) : [],
  })
  appRef = app
  credits.attach(app)
  registerFullAppBoringMcpRoutes(app)
  registerFullAppMcpManagedAgentRoutes(app, DEMO_ENGAGEMENT_ANALYST_VERTICAL, { metering: credits.meteringSink })
  const address = await app.listen({ host: app.config.host, port: app.config.port })
  app.log.info({ event: 'core.server.ready', address }, 'core.server.ready')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
