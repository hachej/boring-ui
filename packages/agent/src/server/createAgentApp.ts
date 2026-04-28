import Fastify, { type FastifyInstance } from 'fastify'
import { basename } from 'node:path'
import type { AgentTool } from '../shared/tool'
import type { SessionStore } from '../shared/session'
import { getEnv } from './config/env'
import type { RuntimeModeId } from './runtime/mode'
import { resolveMode, autoDetectMode } from './runtime/resolveMode'
import { createPiCodingAgentHarness } from './harness/pi-coding-agent/createHarness'
import { loadPlugins } from './harness/pi-coding-agent/pluginLoader'
import { buildFilesystemAgentTools } from './tools/filesystem'
import { buildHarnessAgentTools } from './tools/harness'
import { createAuthMiddleware } from './http/middleware'
import { healthRoutes } from './http/routes/health'
import { fileRoutes } from './http/routes/file'
import { fsEventsRoutes } from './http/routes/fsEvents'
import { treeRoutes } from './http/routes/tree'
import { chatRoutes } from './http/routes/chat'
import { modelsRoutes } from './http/routes/models'
import { sessionRoutes } from './http/routes/sessions'
import { systemPromptRoutes } from './http/routes/systemPrompt'
import { sessionChangesRoutes } from './http/routes/sessionChanges'
import { catalogRoutes } from './http/routes/catalog'
import { readyStatusRoutes } from './http/routes/readyStatus'
import { searchRoutes } from './http/routes/search'
import { InMemorySessionChangesTracker } from './http/sessionChangesTracker'
import { ReadyStatusTracker } from './sandbox/vercel-sandbox/readyStatus'

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
  /** When true, omit the six filesystem tools (read/write/edit/find/grep/ls). */
  disableDefaultFileTools?: boolean
  /**
   * Append-only addendum to the underlying agent's system prompt. Cannot
   * replace the base prompt — host apps EXTEND it (e.g. document app-
   * specific tools, panes, data conventions). Plumbed to pi-coding-agent
   * via DefaultResourceLoader's `appendSystemPromptSource`.
   */
  systemPromptAppend?: string
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

  // UI-aware tools (get_ui_state, exec_ui) and the /api/v1/ui/* routes
  // are now owned by @boring/workspace. Hosts that want them call
  // @boring/workspace/server's createWorkspaceAgentApp() instead of
  // createAgentApp() directly. Standalone agent (CLI, no workspace)
  // ships zero UI surface — smaller bundle, honest contract.
  const pluginTools: AgentTool[] = []
  if (resolvedMode !== 'vercel-sandbox') {
    const pluginResult = await loadPlugins({ cwd: workspaceRoot })
    if (pluginResult.errors.length > 0) {
      for (const e of pluginResult.errors) {
        app.log.warn(`[plugin] failed to load ${e.source}: ${e.error}`)
      }
    }
    for (const plugin of pluginResult.plugins) {
      pluginTools.push(...plugin.tools)
    }
  }

  const tools: AgentTool[] = [
    ...buildHarnessAgentTools(runtimeBundle),
    ...(opts.disableDefaultFileTools ? [] : buildFilesystemAgentTools(runtimeBundle)),
    ...(opts.extraTools ?? []),
    ...pluginTools,
  ]

  const harness = createPiCodingAgentHarness({
    tools,
    cwd: workspaceRoot,
    systemPromptAppend: opts.systemPromptAppend,
  })
  const sessionChangesTracker = new InMemorySessionChangesTracker()

  const readyTracker = new ReadyStatusTracker({
    sandboxReady: resolvedMode !== 'vercel-sandbox',
    harnessReady: true,
  })
  if (resolvedMode === 'vercel-sandbox') {
    queueMicrotask(() => readyTracker.markSandboxReady())
  }

  app.addHook(
    'onRequest',
    createAuthMiddleware({
      authToken: opts.authToken,
      publicPaths: ['/health', '/ready', '/api/v1/ready-status'],
    }),
  )

  await app.register(healthRoutes, {
    version: opts.version ?? DEFAULT_VERSION,
    getReadiness: () => readyTracker.getReadiness(),
  })

  await app.register(fileRoutes, { workspace: runtimeBundle.workspace })
  await app.register(fsEventsRoutes, { workspace: runtimeBundle.workspace })
  await app.register(treeRoutes, { workspace: runtimeBundle.workspace })
  // /api/v1/files/search powers BOTH the cmd-palette / file-tree
  // search (browser → fetchClient.search) AND shares the same
  // FileSearch instance the LLM's `find_files` tool already uses
  // (runtimeBundle.fileSearch). One impl, one set of glob semantics,
  // one bound-to-workspace-root guarantee.
  await app.register(searchRoutes, { fileSearch: runtimeBundle.fileSearch })
  await app.register(chatRoutes, {
    harness,
    workdir: runtimeBundle.workspace.root,
    sessionChangesTracker,
  })
  await app.register(sessionRoutes, {
    sessionStore: harness.sessions as unknown as SessionStore,
  })
  await app.register(systemPromptRoutes, { harness })
  await app.register(modelsRoutes)
  await app.register(sessionChangesRoutes, { tracker: sessionChangesTracker })
  await app.register(catalogRoutes, { tools })
  await app.register(readyStatusRoutes, { tracker: readyTracker })

  return app
}
