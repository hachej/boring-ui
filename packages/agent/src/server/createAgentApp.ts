import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import type { Agent } from '../shared/events'
import type { AgentTool } from '../shared/tool'
import type { AgentHarnessFactory } from '../shared/harness'
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
import { withPiHarnessDefaults } from './harness/pi-coding-agent/createHarness'
import type { PiHarnessOptions } from './harness/pi-coding-agent/createHarness'
import type { WorkspaceProvisioningResult } from './workspace/provisioning'
import type { AgentRuntimeHostOperations } from './runtime/runtimeHost'
import { loadPlugins } from './harness/pi-coding-agent/pluginLoader'
import { createAuthMiddleware } from './http/middleware'
import { InMemorySessionChangesTracker } from './http/sessionChangesTracker'
import type { AgentMeteringSink } from './pi-chat/metering'
import { createPluginDiagnosticsTool } from './tools/pluginDiagnostics'
import type { ReloadHookDiagnostic } from './http/routes/reload'
import type { CompatibilityResolvedAgentRuntimeScope } from './agent-host/buildAgentComposition'
import {
  createAgentHost,
  createAgentHostCompatibilityRoutes,
  createAgentHostLegacyPiChatCompatibilityService,
  resolveAgentHostCompatibilityComposition,
} from './agent-host/createAgentHost'
import { createCompatibilityScopeIssuer } from './agent-host/compatibilityScope'
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
  const resolvedMode = opts.runtimeModeAdapter?.id ?? opts.mode ?? autoDetectMode()
  const modeAdapter = opts.runtimeModeAdapter ?? resolveMode(resolvedMode)
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const templatePath = opts.templatePath ?? getEnv('BORING_AGENT_TEMPLATE_PATH')
  const runtimeHost = opts.runtimeHost ?? modeAdapter.runtimeHost
  const getRuntimeProvisioning = opts.getRuntimeProvisioning ?? (() => opts.runtimeProvisioning)
  const runtimePi: PiHarnessOptions = {
    ...withPiHarnessDefaults(opts.pi),
    additionalSkillPaths: [
      ...(getRuntimeProvisioning()?.skillPaths ?? []),
      ...(opts.pi?.additionalSkillPaths ?? []),
    ],
  }
  const issuer = createCompatibilityScopeIssuer<void>()
  const scope = issuer.issue({ workspaceScopeId: sessionId, authSubjectId: 'standalone' }, undefined)
  let lastReloadDiagnostics: ReloadHookDiagnostic[] = []
  let host: Awaited<ReturnType<typeof createAgentHost>> | undefined

  try {
    host = await createAgentHost({
      agents: [{ agentTypeId: 'default', legacyDefault: true }],
      fleetCompiler: { async compile({ agents }) { return agents } },
      hostId: 'legacy-create-agent-app',
      scopeVerifier: issuer.verifier,
      runtimeModeAdapter: modeAdapter,
      runtimeHost,
      sessionRoot: opts.sessionRoot,
      telemetry: opts.telemetry,
      metering: opts.metering,
      harnessFactory: opts.harnessFactory,
      async resolveRuntimeScope(): Promise<CompatibilityResolvedAgentRuntimeScope> {
        return {
          identity: JSON.stringify([resolvedMode, sessionId, workspaceRoot, templatePath ?? null, runtimePi, opts.sessionNamespace ?? null]),
          environment: {
            placementIdentity: JSON.stringify([resolvedMode, workspaceRoot, templatePath ?? null]),
            workspaceRoot,
            templatePath,
            provisioningFingerprint: JSON.stringify([resolvedMode, workspaceRoot, templatePath ?? null]),
          },
          sessionNamespace: opts.sessionNamespace ?? '',
          pi: runtimePi,
          extraTools: opts.extraTools,
          systemPromptAppend: opts.systemPromptAppend,
          loadSystemPromptAppend: opts.systemPromptDynamic
            ? async () => await opts.systemPromptDynamic?.()
            : undefined,
          compatibility: {
            includeFilesystemTools: !opts.disableDefaultFileTools,
            sessionDir: opts.sessionDir,
            harnessFactory: opts.harnessFactory,
            harnessRuntime: {
              getCurrent: () => {
                const current = getRuntimeProvisioning()
                return current ? { env: current.env, pathEntries: current.pathEntries } : undefined
              },
            },
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
            transformRuntimeBundle: async (input) => {
              let bundle = input
              if (opts.runtimeEnvContributions && opts.runtimeEnvContributions.length > 0) {
                bundle = withRuntimeEnvContributions(bundle, {
                  workspaceId: sessionId,
                  workspaceRoot,
                  runtimeMode: resolvedMode,
                  runtimeBundle: bundle,
                }, opts.runtimeEnvContributions, opts.telemetry)
              }
              await opts.runtimeProvisioner?.({ workspaceRoot, runtimeMode: resolvedMode, runtimeBundle: bundle })
              return bundle
            },
            resolveExtraTools: async () => {
              const tools: AgentTool[] = []
              const externalPluginsEnabled = opts.externalPlugins !== false
              if (externalPluginsEnabled && modeAdapter.workspaceFsCapability === 'strong') {
                const pluginResult = await loadPlugins({ cwd: workspaceRoot })
                for (const error of pluginResult.errors) {
                  app.log.warn(`[plugin] failed to load ${error.source}: ${error.error}`)
                }
                for (const plugin of pluginResult.plugins) tools.push(...plugin.tools)
              }
              if (externalPluginsEnabled) {
                tools.push(createPluginDiagnosticsTool({
                  getLastReloadDiagnostics: () => lastReloadDiagnostics,
                  getHarness: () => composition?.harness,
                  ...(opts.getPluginDiagnostics
                    ? { getPluginErrors: () => opts.getPluginDiagnostics!({ workspaceId: sessionId, workspaceRoot }) }
                    : {}),
                }))
              }
              return tools
            },
          },
        }
      },
    })
    const composition = await resolveAgentHostCompatibilityComposition(host, 'default', scope)
    const legacyPiChatService = createAgentHostLegacyPiChatCompatibilityService(
      host,
      composition.service,
      scope,
      'default',
    )
    opts.onWorkspaceAgentDispatcher?.(createStaticWorkspaceAgentDispatcherResolver(composition.agent, sessionId))
    const runtimeBundle = composition.runtimeBundle
    const projectedRuntimeHost = runtimeHost ?? runtimeBundle.runtimeHost
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
      : projectedRuntimeHost?.createNodeWorkspace(gitStorageRoot) ?? runtimeBundle.workspace
    const skillsWorkspace = projectedRuntimeHost?.createNodeWorkspace(workspaceRoot) ?? runtimeBundle.workspace
    const profile: AgentRouteBindingProfile = {
      runtimeMode: resolvedMode,
      capabilities: { tools: toolNames(composition.tools) },
      sessionChangesTracker: new InMemorySessionChangesTracker(),
      health: { version: opts.version ?? DEFAULT_VERSION, getReadiness: () => composition.readyTracker.getReadiness() },
      filesystem: {
        file: { workspace: runtimeBundle.workspace, getFilesystemBindings: filesystemBindingsForRequest, filesystemBindings: runtimeBundle.filesystemBindings },
        fsEvents: { workspace: runtimeBundle.workspace },
        tree: { workspace: runtimeBundle.workspace, getFilesystemBindings: filesystemBindingsForRequest, filesystemBindings: runtimeBundle.filesystemBindings },
        search: { fileSearch: runtimeBundle.fileSearch },
        git: { workspace: gitWorkspace, getWorkspaceHostRoot: projectedRuntimeHost?.getNodeWorkspaceHostRoot },
      },
      chat: { service: legacyPiChatService },
      systemPrompt: { harness: composition.harness },
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
      catalog: { tools: [...composition.tools] },
      commands: { harness: composition.harness, defaultSessionId: sessionId, workdir: runtimeBundle.workspace.root, metering: opts.metering },
      reload: {
        harness: composition.harness,
        defaultSessionId: sessionId,
        beforeReload: opts.beforeReload,
        onDiagnostics: (diagnostics) => { lastReloadDiagnostics = diagnostics },
      },
      readyStatus: { tracker: composition.readyTracker },
      dispose: () => host!.host.close(),
    }

    app.addHook('onRequest', createAuthMiddleware({
      authToken: opts.authToken,
      publicPaths: ['/health', '/ready', '/api/v1/ready-status'],
    }))
    await app.register(createAgentHostCompatibilityRoutes(host, {
      async authorizeRequest(request) {
        // Standalone legacy routes already bind transcript authority to the
        // middleware's app-selected workspace context. Addressed additions
        // must use that same context or they cannot see/rename legacy rows.
        return issuer.issue({
          workspaceScopeId: request.workspaceContext.workspaceId,
          authSubjectId: 'standalone',
        }, undefined)
      },
      defaultAgentTypeId: 'default',
    }))
    await registerAgentRouteBindingProfile(app, profile)
    return app
  } catch (error) {
    try { await app.close() } catch {}
    try { await host?.host.close() } catch {}
    if (!host) {
      try { await modeAdapter.dispose?.() } catch {}
    }
    throw error
  }
}
