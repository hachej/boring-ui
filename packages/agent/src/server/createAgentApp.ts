import Fastify, { type FastifyInstance } from 'fastify'
import type { AgentTool } from '../shared/tool'
import type { AgentHarness, AgentHarnessFactory } from '../shared/harness'
import type { TelemetrySink } from '../shared/telemetry'
import { getEnv } from './config/env'
import type { RuntimeBundle, RuntimeModeAdapter, RuntimeModeId } from './runtime/mode'
import { getOptionalRuntimeBundleStorageRoot } from './runtime/mode'
import { withRuntimeEnvContributions, type RuntimeEnvContribution } from './runtimeEnvContributions'
import { resolveMode, autoDetectMode } from './runtime/resolveMode'
import { createPiCodingAgentHarness, withPiHarnessDefaults } from './harness/pi-coding-agent/createHarness'
import type { PiHarnessOptions } from './harness/pi-coding-agent/createHarness'
import type { WorkspaceProvisioningResult } from './workspace/provisioning'
import { loadPlugins } from './harness/pi-coding-agent/pluginLoader'
import { buildFilesystemAgentTools } from './tools/filesystem'
import { buildHarnessAgentTools } from './tools/harness'
import { createAuthMiddleware } from './http/middleware'
import { healthRoutes } from './http/routes/health'
import { fileRoutes } from './http/routes/file'
import { fsEventsRoutes } from './http/routes/fsEvents'
import { treeRoutes } from './http/routes/tree'
import { modelsRoutes } from './http/routes/models'
import { skillsRoutes } from './http/routes/skills'
import { piChatRoutes } from './http/routes/piChat'
import { systemPromptRoutes } from './http/routes/systemPrompt'
import { sessionChangesRoutes } from './http/routes/sessionChanges'
import { catalogRoutes } from './http/routes/catalog'
import { readyStatusRoutes } from './http/routes/readyStatus'
import { commandsRoutes } from './http/routes/commands'
import { reloadRoutes } from './http/routes/reload'
import { searchRoutes } from './http/routes/search'
import { gitRoutes } from './http/routes/git'
import { InMemorySessionChangesTracker } from './http/sessionChangesTracker'
import { ReadyStatusTracker } from './runtime/readyStatus'
import { HarnessPiChatService } from './pi-chat/harnessPiChatService'
import type { AgentMeteringSink } from './pi-chat/metering'
import { createPluginDiagnosticsTool } from './tools/pluginDiagnostics'
import type { ReloadHookDiagnostic } from './http/routes/reload'

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
  /** Optional runtime provisioning result used to wire generated PATH/env/skills into tools and Pi. */
  runtimeProvisioning?: WorkspaceProvisioningResult
  /** Optional dynamic runtime provisioning source used after /reload refreshes generated env/PATH. */
  getRuntimeProvisioning?: () => WorkspaceProvisioningResult | undefined
  /** Optional stable namespace for file-backed session storage. */
  sessionNamespace?: string
  /** Optional best-effort telemetry sink supplied by an embedding host. */
  telemetry?: TelemetrySink
  /** Optional billing sink for native Pi usage (see AgentMeteringSink). */
  metering?: AgentMeteringSink
  /** Generic runtime env contributors. Agent stays workspace-neutral; hosts decide env names/values. */
  runtimeEnvContributions?: RuntimeEnvContribution[]
  /** Runtime-aware provisioning hook. Runs after Workspace/Sandbox creation and before tools/harness. */
  runtimeProvisioner?: (ctx: {
    workspaceRoot: string
    runtimeMode: RuntimeModeId
    runtimeBundle: RuntimeBundle
  }) => Promise<void>
  /** Optional explicit file-backed session directory. Mostly for tests/hosts. */
  sessionDir?: string
  /**
   * Enable user/global Pi extension auto-discovery from .pi/ and ~/.pi.
   * App/internal plugins should be passed through extraTools/pi instead.
   * Defaults to true for standalone agent compatibility.
   */
  externalPlugins?: boolean
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
  /**
   * Optional host callback returning current plugin/skill load diagnostics
   * for this workspace. Surfaced by the `plugin_diagnostics` agent tool so the
   * model can iterate on plugin/skill load errors after a /reload.
   */
  getPluginDiagnostics?: (args: {
    workspaceId: string
    workspaceRoot: string
  }) => Promise<Array<{ source: string; message: string; pluginId?: string }>>
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
  let runtimeBundle = await modeAdapter.create({
    workspaceRoot,
    sessionId,
    templatePath,
  })
  if (opts.runtimeEnvContributions && opts.runtimeEnvContributions.length > 0) {
    runtimeBundle = withRuntimeEnvContributions(runtimeBundle, {
      workspaceId: sessionId,
      workspaceRoot,
      runtimeMode: resolvedMode,
      runtimeBundle,
    }, opts.runtimeEnvContributions, opts.telemetry)
  }
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
  const externalPluginsEnabled = opts.externalPlugins !== false
  if (externalPluginsEnabled && modeAdapter.workspaceFsCapability === 'strong') {
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

  const getRuntimeProvisioning = opts.getRuntimeProvisioning ?? (() => opts.runtimeProvisioning)
  const runtimePi: PiHarnessOptions = {
    ...withPiHarnessDefaults(opts.pi),
    additionalSkillPaths: [
      ...(getRuntimeProvisioning()?.skillPaths ?? []),
      ...(opts.pi?.additionalSkillPaths ?? []),
    ],
  }

  // Captured after the harness is built; read through thunks because the
  // plugin_diagnostics tool is added to the tool catalog before the harness
  // exists, and diagnostics accumulate on each /reload.
  let harnessRef: AgentHarness | undefined
  let lastReloadDiagnostics: ReloadHookDiagnostic[] = []

  const tools: AgentTool[] = [
    ...buildHarnessAgentTools(runtimeBundle, {
      getCurrent: () => {
        const current = getRuntimeProvisioning()
        return current ? { env: current.env, pathEntries: current.pathEntries } : undefined
      },
    }),
    ...(opts.disableDefaultFileTools ? [] : buildFilesystemAgentTools(runtimeBundle)),
    ...(opts.extraTools ?? []),
    ...pluginTools,
    ...(externalPluginsEnabled ? [createPluginDiagnosticsTool({
      getLastReloadDiagnostics: () => lastReloadDiagnostics,
      getHarness: () => harnessRef,
      ...(opts.getPluginDiagnostics
        ? {
            getPluginErrors: () =>
              opts.getPluginDiagnostics!({ workspaceId: sessionId, workspaceRoot }),
          }
        : {}),
    })] : []),
  ]

  const harnessFactory = opts.harnessFactory ?? ((input) => createPiCodingAgentHarness({
    ...input,
    pi: runtimePi,
  }))
  const harness = await harnessFactory({
    tools,
    cwd: workspaceRoot,
    sessionNamespace: opts.sessionNamespace,
    sessionDir: opts.sessionDir,
    systemPromptAppend: opts.systemPromptAppend,
    systemPromptDynamic: opts.systemPromptDynamic,
    telemetry: opts.telemetry,
  })
  harnessRef = harness
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
  // Powers the file-tree "Copy Git URL" action. Must use the HOST storage root
  // (where .git lives), not workspace.root — in sandbox modes the latter is the
  // in-sandbox cwd (e.g. /workspace) and git would not find the repo.
  await app.register(gitRoutes, {
    getWorkspaceRoot: () => getOptionalRuntimeBundleStorageRoot(runtimeBundle),
  })
  const piChatService = new HarnessPiChatService({
    harness,
    sessionStore: harness.sessions,
    workdir: runtimeBundle.workspace.root,
    workspace: runtimeBundle.workspace,
    metering: opts.metering,
  })
  await app.register(piChatRoutes, { service: piChatService })
  await app.register(systemPromptRoutes, { harness })
  await app.register(modelsRoutes)
  await app.register(skillsRoutes, {
    workspaceRoot,
    additionalSkillPaths: runtimePi.additionalSkillPaths,
    piPackages: runtimePi.packages,
    noSkills: runtimePi.noSkills,
    getAdditionalSkillPaths: () => [
      ...(getRuntimeProvisioning()?.skillPaths ?? []),
      ...(opts.pi?.additionalSkillPaths ?? []),
      ...(opts.pi?.getHotReloadableResources?.().additionalSkillPaths ?? []),
    ],
    getPiPackages: () => [
      ...(opts.pi?.packages ?? []),
      ...(opts.pi?.getHotReloadableResources?.().packages ?? []),
    ],
  })
  await app.register(sessionChangesRoutes, { tracker: sessionChangesTracker })
  await app.register(catalogRoutes, { tools })
  await app.register(commandsRoutes, { harness, defaultSessionId: sessionId, workdir: runtimeBundle.workspace.root })
  await app.register(reloadRoutes, {
    harness,
    defaultSessionId: sessionId,
    beforeReload: opts.beforeReload,
    onDiagnostics: (diagnostics) => {
      lastReloadDiagnostics = diagnostics
    },
  })
  await app.register(readyStatusRoutes, { tracker: readyTracker })

  return app
}
