import type { FastifyPluginAsync } from 'fastify'
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
import { healthRoutes } from './http/routes/health'
import { fileRoutes } from './http/routes/file'
import { treeRoutes } from './http/routes/tree'
import { chatRoutes } from './http/routes/chat'
import { modelsRoutes } from './http/routes/models'
import { sessionRoutes } from './http/routes/sessions'
import { sessionChangesRoutes } from './http/routes/sessionChanges'
import { catalogRoutes } from './http/routes/catalog'
import { uiRoutes } from './http/routes/ui'
import { readyStatusRoutes } from './http/routes/readyStatus'
import { InMemorySessionChangesTracker } from './http/sessionChangesTracker'
import { createInMemoryBridge } from './ui-bridge/createInMemoryBridge'
import { ReadyStatusTracker } from './sandbox/vercel-sandbox/readyStatus'

const DEFAULT_VERSION = '0.1.0-dev'
const DEFAULT_WORKSPACE_ID = 'default'

function pluginNameFromPath(path: string): string {
  const fileName = basename(path)
  if (fileName.endsWith('.mjs')) return fileName.slice(0, -4)
  if (fileName.endsWith('.js')) return fileName.slice(0, -3)
  return fileName
}

export interface RegisterAgentRoutesOptions {
  workspaceRoot?: string
  sessionId?: string
  templatePath?: string
  mode?: RuntimeModeId
  version?: string
  extraTools?: AgentTool[]
}

/**
 * Fastify plugin that mounts agent routes onto a host app (typically core-built).
 *
 * Shape B counterpart to createAgentApp (Shape A). The host provides its own
 * Fastify instance, auth, and stores; this plugin only adds routes + runtime.
 * No auth middleware is registered — the host's authHook handles authentication.
 */
export const registerAgentRoutes: FastifyPluginAsync<RegisterAgentRoutesOptions> = async (app, opts) => {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const sessionId = opts.sessionId ?? DEFAULT_WORKSPACE_ID
  const templatePath = opts.templatePath ?? getEnv('BORING_AGENT_TEMPLATE_PATH')

  const resolvedMode = opts.mode ?? autoDetectMode()
  const runtimeBundle = await resolveMode(resolvedMode).create({
    workspaceRoot,
    sessionId,
    templatePath,
  })

  const uiBridge = createInMemoryBridge()

  const standardTools = standardCatalog({ ...runtimeBundle, uiBridge })
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

  const readyTracker = new ReadyStatusTracker({
    sandboxReady: resolvedMode !== 'vercel-sandbox',
    harnessReady: true,
  })
  if (resolvedMode === 'vercel-sandbox') {
    queueMicrotask(() => readyTracker.markSandboxReady())
  }

  // Bridge host app's request.user → agent's request.workspaceContext.
  // In embedded mode core's authHook already populates request.user;
  // this hook maps it to the shape agent routes expect. Scoped to agent
  // routes only (Fastify encapsulates hooks within the plugin).
  app.addHook('onRequest', async (request) => {
    const user = (request as unknown as { user?: { id: string } | null }).user
    request.workspaceContext = {
      workspaceId: DEFAULT_WORKSPACE_ID,
      authenticated: !!user,
    }
  })

  await app.register(healthRoutes, {
    version: opts.version ?? DEFAULT_VERSION,
    getReadiness: () => readyTracker.getReadiness(),
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
  await app.register(modelsRoutes)
  await app.register(sessionChangesRoutes, { tracker: sessionChangesTracker })
  await app.register(catalogRoutes, { tools })
  await app.register(uiRoutes, { bridge: uiBridge })
  await app.register(readyStatusRoutes, { tracker: readyTracker })
}
