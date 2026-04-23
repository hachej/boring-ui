import Fastify, { type FastifyInstance } from 'fastify'
import type { AgentTool } from '../shared/tool'
import type { SessionStore } from '../shared/session'
import type { RuntimeModeId } from './runtime/mode'
import { resolveMode } from './runtime/resolveMode'
import { standardCatalog } from './catalog/standardCatalog'
import { createPiCodingAgentHarness } from './harness/pi-coding-agent/createHarness'
import { createAuthMiddleware } from './http/middleware'
import { healthRoutes } from './http/routes/health'
import { fileRoutes } from './http/routes/file'
import { treeRoutes } from './http/routes/tree'
import { chatRoutes } from './http/routes/chat'
import { sessionRoutes } from './http/routes/sessions'

const DEFAULT_VERSION = '0.1.0-dev'
const DEFAULT_SESSION_ID = 'default'

export interface CreateAgentAppOptions {
  workspaceRoot?: string
  sessionId?: string
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

  const runtimeBundle = await resolveMode(opts.mode).create({
    workspaceRoot,
    sessionId,
  })

  const tools = standardCatalog(runtimeBundle)
  if (opts.extraTools?.length) {
    tools.push(...opts.extraTools)
  }

  const harness = createPiCodingAgentHarness({ tools })

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

  return app
}
