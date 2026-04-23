import Fastify, { type FastifyInstance } from 'fastify'
import type { AgentTool } from '../shared/tool'
import type { SessionStore } from '../shared/session'
import { getEnv } from './config/env'
import type { RuntimeModeId } from './runtime/mode'
import { resolveMode } from './runtime/resolveMode'
import { standardCatalog } from './catalog/standardCatalog'
import { createPiCodingAgentHarness } from './harness/pi-coding-agent/createHarness'
import { loadPlugins, flattenPluginTools } from './harness/pi-coding-agent/pluginLoader'
import { createAuthMiddleware } from './http/middleware'
import { healthRoutes } from './http/routes/health'
import { fileRoutes } from './http/routes/file'
import { treeRoutes } from './http/routes/tree'
import { chatRoutes } from './http/routes/chat'
import { sessionRoutes } from './http/routes/sessions'
import { catalogRoutes } from './http/routes/catalog'

const DEFAULT_VERSION = '0.1.0-dev'
const DEFAULT_SESSION_ID = 'default'

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

  const runtimeBundle = await resolveMode(opts.mode).create({
    workspaceRoot,
    sessionId,
    templatePath,
  })

  const tools = standardCatalog(runtimeBundle)
  if (opts.extraTools?.length) {
    tools.push(...opts.extraTools)
  }

  const resolvedMode = opts.mode ?? 'direct'
  if (resolvedMode !== 'vercel-sandbox') {
    const pluginResult = await loadPlugins({ cwd: workspaceRoot })
    if (pluginResult.errors.length > 0) {
      for (const e of pluginResult.errors) {
        console.warn(`[plugin] failed to load ${e.source}: ${e.error}`)
      }
    }
    tools.push(...flattenPluginTools(pluginResult))
  }

  const harness = createPiCodingAgentHarness({ tools, cwd: workspaceRoot })

  const app = Fastify({ logger: opts.logger ?? true })

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
  })
  await app.register(sessionRoutes, {
    sessionStore: harness.sessions as unknown as SessionStore,
  })
  await app.register(catalogRoutes, { tools })

  return app
}
