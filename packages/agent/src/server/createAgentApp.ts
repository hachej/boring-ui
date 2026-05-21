import Fastify, { type FastifyInstance } from 'fastify'
import type { AgentTool } from '../shared/tool'
import type { AgentHarnessFactory } from '../shared/harness'
import type { SessionStore } from '../shared/session'
import { getEnv } from './config/env'
import type { RuntimeBundle, RuntimeModeAdapter, RuntimeModeId } from './runtime/mode'
import { resolveMode, autoDetectMode } from './runtime/resolveMode'
import { createPiCodingAgentHarness } from './harness/pi-coding-agent/createHarness'
import type { PiHarnessOptions } from './harness/pi-coding-agent/createHarness'
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
import { skillsRoutes } from './http/routes/skills'
import { sessionRoutes } from './http/routes/sessions'
import { systemPromptRoutes } from './http/routes/systemPrompt'
import { sessionChangesRoutes } from './http/routes/sessionChanges'
import { catalogRoutes } from './http/routes/catalog'
import { readyStatusRoutes } from './http/routes/readyStatus'
import { reloadRoutes } from './http/routes/reload'
import { searchRoutes } from './http/routes/search'
import { InMemorySessionChangesTracker } from './http/sessionChangesTracker'
import { ReadyStatusTracker } from './sandbox/vercel-sandbox/readyStatus'

const DEFAULT_VERSION = '0.1.0-dev'
const DEFAULT_SESSION_ID = 'default'

export interface CreateAgentAppOptions {
  workspaceRoot?: string
  sessionId?: string
  templatePath?: string
  mode?: RuntimeModeId
  /** Supply a custom runtime adapter to plug in non-built-in sandbox/workspace modes. */
  runtimeModeAdapter?: RuntimeModeAdapter
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
  /** Override the default pi-backed harness with a custom agent runtime. */
  harnessFactory?: AgentHarnessFactory
  /** Optional pi adapter/runtime knobs used by the default harness. */
  pi?: PiHarnessOptions
  /** Optional stable namespace for file-backed session storage. */
  sessionNamespace?: string
  /** Runtime-aware provisioning hook. Runs after Workspace/Sandbox creation and before tools/harness. */
  runtimeProvisioner?: (ctx: {
    workspaceRoot: string
    runtimeMode: RuntimeModeId
    runtimeBundle: RuntimeBundle
  }) => Promise<void>
  /** Optional explicit file-backed session directory. Mostly for tests/hosts. */
  sessionDir?: string
  /**
   * Called BEFORE the harness reloads its session. May return a
   * `ReloadHookResult` (with `restart_warnings` and/or diagnostics) —
   * surfaced verbatim on the /api/v1/agent/reload response. `void` /
   * undefined return = no warnings (backwards compatible).
   */
  beforeReload?: () =>
    | void
    | import("./http/routes/reload.js").ReloadHookResult
    | undefined
    | Promise<void | import("./http/routes/reload.js").ReloadHookResult | undefined>
  /**
   * Optional dynamic system-prompt source forwarded to the harness. The
   * harness calls it whenever it builds or rebuilds a session prompt. Used by
   * the workspace plugin layer.
   */
  systemPromptDynamic?: () => string | undefined | Promise<string | undefined>
}

export async function createAgentApp(
  opts: CreateAgentAppOptions = {},
): Promise<FastifyInstance> {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const sessionId = opts.sessionId ?? DEFAULT_SESSION_ID
  const templatePath = opts.templatePath ?? getEnv('BORING_AGENT_TEMPLATE_PATH')
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 16 * 1024 * 1024 })

  const resolvedMode = opts.runtimeModeAdapter?.id ?? opts.mode ?? autoDetectMode()
  const modeAdapter = opts.runtimeModeAdapter ?? resolveMode(resolvedMode)
  const runtimeBundle = await modeAdapter.create({
    workspaceRoot,
    sessionId,
    templatePath,
  })
  await opts.runtimeProvisioner?.({
    workspaceRoot,
    runtimeMode: resolvedMode,
    runtimeBundle,
  })

  // UI-aware tools (get_ui_state, exec_ui) and the /api/v1/ui/* routes
  // are now owned by @hachej/boring-workspace. Hosts that want them call
  // @hachej/boring-workspace/app's createWorkspaceAgentApp() instead of
  // createAgentApp() directly. Standalone agent (CLI, no workspace)
  // ships zero UI surface — smaller bundle, honest contract.
  const pluginTools: AgentTool[] = []
  if (modeAdapter.workspaceFsCapability === 'strong') {
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

  const harnessFactory = opts.harnessFactory ?? ((input) => createPiCodingAgentHarness({
    ...input,
    pi: {
      noContextFiles: true,
      noSkills: true,
      ...opts.pi,
    },
  }))
  const harness = await harnessFactory({
    tools,
    cwd: workspaceRoot,
    runtimeCwd: runtimeBundle.runtimeContext.runtimeCwd,
    sessionNamespace: opts.sessionNamespace,
    sessionDir: opts.sessionDir,
    systemPromptAppend: opts.systemPromptAppend,
    systemPromptDynamic: opts.systemPromptDynamic,
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
  // FileSearch instance the LLM's `find` tool already uses
  // (runtimeBundle.fileSearch). One impl, one set of glob semantics,
  // one bound-to-workspace-root guarantee.
  await app.register(searchRoutes, { fileSearch: runtimeBundle.fileSearch })
  await app.register(chatRoutes, {
    harness,
    workdir: runtimeBundle.runtimeContext.runtimeCwd,
    sessionChangesTracker,
  })
  await app.register(sessionRoutes, {
    sessionStore: harness.sessions as unknown as SessionStore,
    harness,
    workdir: runtimeBundle.runtimeContext.runtimeCwd,
  })
  await app.register(systemPromptRoutes, { harness })
  await app.register(modelsRoutes)
  await app.register(skillsRoutes, {
    workspaceRoot,
    additionalSkillPaths: opts.pi?.additionalSkillPaths,
    piPackages: opts.pi?.packages,
    noSkills: opts.pi?.noSkills,
  })
  await app.register(sessionChangesRoutes, { tracker: sessionChangesTracker })
  await app.register(catalogRoutes, { tools })
  await app.register(reloadRoutes, { harness, defaultSessionId: sessionId, beforeReload: opts.beforeReload })
  await app.register(readyStatusRoutes, { tracker: readyTracker })

  return app
}
