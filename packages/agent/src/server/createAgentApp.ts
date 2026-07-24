import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import {
  buildFilesystemAgentTools,
  buildHarnessAgentTools,
} from '@hachej/boring-bash/agent'
import type { Agent } from '../shared/events'
import type { AgentTool } from '../shared/tool'
import type { AgentCoreHarnessFactory, AgentHarness, AgentHarnessFactory } from '../shared/harness'
import type { TelemetrySink } from '../shared/telemetry'
import { getEnv } from './config/env'
import {
  getOptionalRuntimeBundleStorageRoot,
  type RuntimeBundle,
  type RuntimeFilesystemBinding,
  type RuntimeModeAdapter,
  type RuntimeModeId,
} from './runtime/mode'
import { withRuntimeEnvContributions, type RuntimeEnvContribution } from './runtimeEnvContributions'
import { resolveMode, autoDetectMode } from './runtime/resolveMode'
import { nativeSessionStartEnabledForRuntime } from './nativeSessionStartCapability'
import { createPiCodingAgentHarness, withPiHarnessDefaults } from './harness/pi-coding-agent/createHarness'
import type { PiHarnessOptions } from './harness/pi-coding-agent/createHarness'
import type { WorkspaceProvisioningResult } from './workspace/provisioning'
import type { AgentRuntimeHostOperations } from './runtime/runtimeHost'
import { loadPlugins } from './harness/pi-coding-agent/pluginLoader'
import { createAuthMiddleware } from './http/middleware'
import type { PiChatSessionService } from '../core/piChatSessionService'
import { InMemorySessionChangesTracker } from './http/sessionChangesTracker'
import { createRuntimeReadyStatusTracker } from './runtime/modeReadiness'
import type { AgentMeteringSink } from './pi-chat/metering'
import { createPluginDiagnosticsTool } from './tools/pluginDiagnostics'
import type { ReloadHookDiagnostic } from './http/routes/reload'
import { createAgentRuntimeBridge } from './createAgent'
import {
  registerAgentRouteBindingProfile,
  toolNames,
  type AgentRouteBindingProfile,
} from './agentRouteBindingProfile'
import {
  assertWorkspaceAgentDispatcherRequestContext,
  createBoundWorkspaceAgentDispatcher,
  createWorkspaceAgentDispatcherError,
  normalizeWorkspaceAgentDispatcherContext,
  type WorkspaceAgentDispatcherResolver,
} from './workspaceAgentDispatcher'
import { ErrorCode } from '../shared/error-codes'
import { collectToolReadinessRequirements, createAgentReadinessFromTracker } from './agentReadiness'

const DEFAULT_VERSION = '0.1.0-dev'
const DEFAULT_SESSION_ID = 'default'

export interface CreateAgentAppOptions {
  workspaceRoot?: string
  sessionId?: string
  templatePath?: string
  mode?: RuntimeModeId
  /** Supply a custom runtime adapter to plug in non-built-in sandbox/workspace modes. */
  runtimeModeAdapter?: RuntimeModeAdapter
  /** Provider/runtime values supplied by the embedding host. */
  runtimeHost?: AgentRuntimeHostOperations
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
  /** Generic filesystem binding seam for standalone embeddings. */
  getFilesystemBindings?: (ctx: { request?: FastifyRequest; sessionId?: string; workspaceId: string; workspaceRoot: string; userId?: string; userEmail?: string; userEmailVerified?: boolean; requestId?: string }) => RuntimeFilesystemBinding[] | undefined | Promise<RuntimeFilesystemBinding[] | undefined>
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
  /** Optional explicit root for file-backed session directories. */
  sessionRoot?: string
  /** Explicit opt-in for bare native Pi transcripts in direct/local hosts. */
  trustedDirectLocalNativeSessions?: boolean
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
  /**
   * Trusted in-process host composition seam. The resolver trusts caller-supplied
   * workspace/user context; callers must authorize that context before resolving.
   */
  onWorkspaceAgentDispatcher?: (resolver: WorkspaceAgentDispatcherResolver) => void
}

function createStaticWorkspaceAgentDispatcherResolver(
  agent: Agent,
  workspaceId: string,
): WorkspaceAgentDispatcherResolver {
  return {
    async resolve(ctx, options) {
      const boundCtx = normalizeWorkspaceAgentDispatcherContext(ctx)
      assertWorkspaceAgentDispatcherRequestContext(boundCtx, options?.request)
      if (boundCtx.workspaceId !== workspaceId) {
        throw createWorkspaceAgentDispatcherError(
          ErrorCode.enum.UNAUTHORIZED,
          'workspace agent dispatcher context does not match bound workspace',
          401,
        )
      }
      return createBoundWorkspaceAgentDispatcher(agent, boundCtx)
    },
  }
}

export async function createAgentApp(
  opts: CreateAgentAppOptions = {},
): Promise<FastifyInstance> {
  const sessionId = opts.sessionId ?? DEFAULT_SESSION_ID
  const app = Fastify({ logger: opts.logger ?? true, bodyLimit: 16 * 1024 * 1024 })
  let modeAdapter: RuntimeModeAdapter | undefined
  let disposeProfile: (() => Promise<void>) | undefined
  let disposeRuntime: (() => Promise<void>) | undefined

  try {
    const resolvedMode = opts.runtimeModeAdapter?.id ?? opts.mode ?? autoDetectMode()
    modeAdapter = opts.runtimeModeAdapter ?? resolveMode(resolvedMode)
    const profile = await createWorkspaceAgentAppProfile(
      opts,
      sessionId,
      resolvedMode,
      app,
      modeAdapter,
      (bundle) => { disposeRuntime = bundle.disposeRuntime },
    )
    const disposeBinding = profile.dispose
    let disposal: Promise<void> | undefined
    disposeProfile = () => {
      disposal ??= (async () => {
        let firstError: unknown
        try {
          await disposeBinding?.()
        } catch (error) {
          firstError = error
        }
        try {
          await modeAdapter?.dispose?.()
        } catch (error) {
          if (firstError === undefined) firstError = error
          else app.log.warn({ err: error }, '[agent] failed to close runtime provider after an earlier cleanup error')
        }
        if (firstError !== undefined) throw firstError
      })()
      return disposal
    }
    profile.dispose = disposeProfile

    app.addHook(
      'onRequest',
      createAuthMiddleware({
        authToken: opts.authToken,
        publicPaths: ['/health', '/ready', '/api/v1/ready-status'],
      }),
    )

    await registerAgentRouteBindingProfile(app, profile)
    return app
  } catch (error) {
    try {
      await app.close()
    } catch {
      // Construction failure remains the actionable error; close is best effort.
    }
    if (disposeProfile) {
      try {
        await disposeProfile()
      } catch {
        // Initialization failure remains the actionable error; cleanup is best effort.
      }
    } else {
      try {
        await disposeRuntime?.()
      } catch {
        // Initialization failure remains the actionable error; cleanup is best effort.
      }
      try {
        await modeAdapter?.dispose?.()
      } catch {
        // Pair cleanup failure must not prevent provider shutdown.
      }
    }
    throw error
  }
}

async function createWorkspaceAgentAppProfile(
  opts: CreateAgentAppOptions,
  sessionId: string,
  resolvedMode: RuntimeModeId,
  app: FastifyInstance,
  modeAdapter: RuntimeModeAdapter,
  onRuntimeBundleCreated: (bundle: RuntimeBundle) => void,
): Promise<AgentRouteBindingProfile> {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const templatePath = opts.templatePath ?? getEnv('BORING_AGENT_TEMPLATE_PATH')
  let runtimeBundle = await modeAdapter.create({
    workspaceRoot,
    sessionId,
    templatePath,
  })
  const runtimeHost = opts.runtimeHost ?? modeAdapter.runtimeHost ?? runtimeBundle.runtimeHost
  if (runtimeHost) runtimeBundle = { ...runtimeBundle, runtimeHost }
  onRuntimeBundleCreated(runtimeBundle)
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
  // createAgentApp() directly. A standalone agent with no workspace
  // UI/presentation ships zero UI surface — smaller bundle, honest contract.
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
  const bashRuntimeBundle = {
    ...runtimeBundle,
    storageRoot: getOptionalRuntimeBundleStorageRoot(runtimeBundle),
  }

  const tools: AgentTool[] = [
    ...buildHarnessAgentTools(bashRuntimeBundle, {
      getCurrent: () => {
        const current = getRuntimeProvisioning()
        return current ? { env: current.env, pathEntries: current.pathEntries } : undefined
      },
    }),
    ...(opts.disableDefaultFileTools ? [] : buildFilesystemAgentTools(bashRuntimeBundle, {
      getFilesystemBindings: opts.getFilesystemBindings
        ? (ctx) => opts.getFilesystemBindings?.({
            sessionId: ctx.sessionId,
            workspaceId: ctx.workspaceId ?? sessionId,
            workspaceRoot,
            userId: ctx.userId,
            userEmail: ctx.userEmail,
            userEmailVerified: ctx.userEmailVerified,
            requestId: ctx.requestId,
          })
        : undefined,
    })),
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

  const baseHarnessFactory = opts.harnessFactory ?? ((input) => createPiCodingAgentHarness({
    ...input,
    pi: runtimePi,
  }))
  const harnessFactory = ((input) => baseHarnessFactory({
    ...input,
    sessionNamespace: opts.sessionNamespace,
    sessionRoot: opts.sessionRoot,
    sessionDir: opts.sessionDir ?? input.sessionDir,
  })) as AgentCoreHarnessFactory
  const readyTracker = createRuntimeReadyStatusTracker(modeAdapter, {
    harnessReady: true,
  })
  const nativeSessionStartEnabled = nativeSessionStartEnabledForRuntime(
    resolvedMode,
    opts.trustedDirectLocalNativeSessions,
  )
  const coreAgent = createAgentRuntimeBridge({
    runtime: modeAdapter,
    tools,
    readiness: createAgentReadinessFromTracker({
      requirements: collectToolReadinessRequirements(tools),
      tracker: readyTracker,
    }),
    harnessFactory,
    systemPromptAppend: opts.systemPromptAppend,
    systemPromptDynamic: opts.systemPromptDynamic,
    telemetry: opts.telemetry,
    metering: opts.metering,
    sessionStorageRoot: opts.sessionRoot,
    workdir: workspaceRoot,
  }, {
    harness: { nativeSessionStartEnabled },
    service: {
      workdir: runtimeBundle.workspace.root,
      workspace: runtimeBundle.workspace,
    },
  })
  const agentRuntime = await coreAgent.getRuntime()
  opts.onWorkspaceAgentDispatcher?.(createStaticWorkspaceAgentDispatcherResolver(coreAgent.agent, sessionId))
  const harness = agentRuntime.harness
  harnessRef = harness

  const filesystemBindingsForRequest = opts.getFilesystemBindings
    ? (request: FastifyRequest) => {
        const user = (request as FastifyRequest & { user?: { id: string; email: string; emailVerified?: boolean } | null }).user
        return opts.getFilesystemBindings?.({
          request,
          workspaceId: request.workspaceContext.workspaceId,
          workspaceRoot,
          userId: user?.id,
          userEmail: user?.email,
          userEmailVerified: user?.emailVerified === true,
          requestId: request.id,
        })
      }
    : undefined
  const gitStorageRoot = getOptionalRuntimeBundleStorageRoot(runtimeBundle)
  const gitWorkspace = gitStorageRoot === undefined
    ? runtimeBundle.workspace
    : runtimeHost?.createNodeWorkspace(gitStorageRoot) ?? runtimeBundle.workspace
  const skillsWorkspace = runtimeHost?.createNodeWorkspace(workspaceRoot) ?? runtimeBundle.workspace

  return {
    runtimeMode: resolvedMode,
    capabilities: { tools: toolNames(tools) },
    sessionChangesTracker: new InMemorySessionChangesTracker(),
    health: {
      version: opts.version ?? DEFAULT_VERSION,
      getReadiness: () => readyTracker.getReadiness(),
    },
    filesystem: {
      file: {
        workspace: runtimeBundle.workspace,
        getFilesystemBindings: filesystemBindingsForRequest,
        filesystemBindings: runtimeBundle.filesystemBindings,
      },
      fsEvents: { workspace: runtimeBundle.workspace },
      tree: {
        workspace: runtimeBundle.workspace,
        getFilesystemBindings: filesystemBindingsForRequest,
        filesystemBindings: runtimeBundle.filesystemBindings,
      },
      // File search shares the same bound implementation as the model tool.
      search: { fileSearch: runtimeBundle.fileSearch },
      // Git metadata resolves against host storage, not a sandbox-internal cwd.
      git: {
        workspace: gitWorkspace,
        getWorkspaceHostRoot: runtimeHost?.getNodeWorkspaceHostRoot,
      },
    },
    chat: {
      service: agentRuntime.service as PiChatSessionService,
      nativeSessionStartEnabled,
    },
    systemPrompt: { harness },
    skills: {
      workspace: skillsWorkspace,
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
    },
    catalog: { tools },
    commands: {
      harness,
      defaultSessionId: sessionId,
      workdir: runtimeBundle.workspace.root,
      metering: opts.metering,
    },
    reload: {
      harness,
      defaultSessionId: sessionId,
      beforeReload: opts.beforeReload,
      onDiagnostics: (diagnostics) => {
        lastReloadDiagnostics = diagnostics
      },
    },
    readyStatus: { tracker: readyTracker },
    dispose: async () => {
      let firstError: unknown
      try {
        await coreAgent.agent.dispose()
      } catch (error) {
        firstError = error
      }
      try {
        await runtimeBundle.disposeRuntime?.()
      } catch (error) {
        firstError ??= error
      }
      if (firstError) throw firstError
    },
  }
}
