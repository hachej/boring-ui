import Fastify, { type FastifyInstance } from 'fastify'
import { basename } from 'node:path'
import type { AgentTool } from '../shared/tool'
import type { SessionStore } from '../shared/session'
import { getEnv } from './config/env'
import type { RuntimeModeId } from './runtime/mode'
import { resolveMode, autoDetectMode } from './runtime/resolveMode'
import { standardCatalog } from './catalog/standardCatalog'
import { createPiCodingAgentHarness } from './harness/pi-coding-agent/createHarness'
import { loadPlugins } from './harness/pi-coding-agent/pluginLoader'
import { mergeTools, type PluginToolRegistration } from './catalog/mergeTools'
import { createAuthMiddleware } from './http/middleware'
import { healthRoutes } from './http/routes/health'
import { fileRoutes } from './http/routes/file'
import { treeRoutes } from './http/routes/tree'
import { chatRoutes } from './http/routes/chat'
import { sessionRoutes } from './http/routes/sessions'
import { sessionChangesRoutes } from './http/routes/sessionChanges'
import { catalogRoutes } from './http/routes/catalog'
import { uiRoutes } from './http/routes/ui'
import { InMemorySessionChangesTracker } from './http/sessionChangesTracker'
import { createInMemoryBridge } from './ui-bridge/createInMemoryBridge'

const DEFAULT_VERSION = '0.1.0-dev'
const DEFAULT_SESSION_ID = 'default'

function pluginNameFromPath(path: string): string {
  const fileName = basename(path)
  if (fileName.endsWith('.mjs')) return fileName.slice(0, -4)
  if (fileName.endsWith('.js')) return fileName.slice(0, -3)
  return fileName
}

export interface CreateAgentAppOptions {
  workspaceRoot?: string
  sessionId?: string
  templatePath?: string
  mode?: RuntimeModeId
  authToken?: string
  version?: string
  logger?: boolean
  extraTools?: AgentTool[]
}

export async function createAgentApp(
  opts: CreateAgentAppOptions = {},
): Promise<FastifyInstance> {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const sessionId = opts.sessionId ?? DEFAULT_SESSION_ID
  const templatePath = opts.templatePath ?? getEnv('BORING_AGENT_TEMPLATE_PATH')
  const app = Fastify({ logger: opts.logger ?? true })

  const resolvedMode = opts.mode ?? autoDetectMode()
  const runtimeBundle = await resolveMode(resolvedMode).create({
    workspaceRoot,
    sessionId,
    templatePath,
  })

  const standardTools = standardCatalog(runtimeBundle)
  const pluginTools: PluginToolRegistration[] = []

  if (resolvedMode !== 'vercel-sandbox') {
    const pluginResult = await loadPlugins({ cwd: workspaceRoot })
    if (pluginResult.errors.length > 0) {
      for (const e of pluginResult.errors) {
        app.log.warn(`[plugin] failed to load ${e.source}: ${e.error}`)
      }
    }
    pluginTools.push(
      ...pluginResult.plugins.map((plugin) => ({
        pluginName: pluginNameFromPath(plugin.path),
        tools: plugin.tools,
      })),
    )
  }

  const tools = mergeTools({
    standardTools,
    extraTools: opts.extraTools,
    pluginTools,
    logger: app.log,
  })

  const harness = createPiCodingAgentHarness({ tools, cwd: workspaceRoot })
  const sessionChangesTracker = new InMemorySessionChangesTracker()

  app.addHook(
    'onRequest',
    createAuthMiddleware({
      authToken: opts.authToken,
      publicPaths: ['/health', '/ready'],
    }),
  )

  await app.register(healthRoutes, {
    version: opts.version ?? DEFAULT_VERSION,
    getReadiness: () => ({
      sandboxReady: true,
      harnessReady: true,
    }),
  })

  await app.register(fileRoutes, { workspace: runtimeBundle.workspace })
  await app.register(treeRoutes, { workspace: runtimeBundle.workspace })
  await app.register(chatRoutes, {
    harness,
    workdir: runtimeBundle.workspace.root,
    sessionChangesTracker,
  })
  await app.register(sessionRoutes, {
    sessionStore: harness.sessions as unknown as SessionStore,
  })
  await app.register(sessionChangesRoutes, { tracker: sessionChangesTracker })
  await app.register(catalogRoutes, { tools })
  await app.register(uiRoutes, { bridge: createInMemoryBridge() })

  return app
}
