import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import type { PiSessionRequestContext } from '../core/piChatSessionService'
import type { AuthorizedAgentScope, VerifiedAgentScopeClaim } from '../shared/index'
import { ErrorCode } from '../shared/error-codes'
import type { AgentHarnessFactory } from '../shared/harness'
import type { TelemetrySink } from '../shared/telemetry'
import type { AgentTool } from '../shared/tool'
import { createAgentHost } from './agent-host/createAgentHost'
import { registerAgentHostEnvironmentRoutes } from './agent-host/environmentHttpProjection'
import { resolveRequestLedgerPath } from './agent-host/requestLedgerPath'
import type { AgentMeteringSink } from './pi-chat/metering'
import { getEnv } from './config/env'
import { loadPlugins } from './harness/pi-coding-agent/pluginLoader'
import { withPiHarnessDefaults, type PiHarnessOptions } from './harness/pi-coding-agent/createHarness'
import { createAuthMiddleware } from './http/middleware'
import { healthRoutes } from './http/routes/health'
import type { RuntimeBundle, RuntimeFilesystemBinding, RuntimeModeAdapter, RuntimeModeId } from './runtime/mode'
import { autoDetectMode, resolveMode } from './runtime/resolveMode'
import type { AgentRuntimeHostOperations } from './runtime/runtimeHost'
import { withRuntimeEnvContributions, type RuntimeEnvContribution } from './runtimeEnvContributions'
import { createPiResourceDigestFence, createPiResourceDigestInput } from './piResourceDigest'
import { createPluginDiagnosticsTool } from './tools/pluginDiagnostics'
import type { WorkspaceProvisioningResult } from './workspace/provisioning'
import {
  createBoundWorkspaceAgentDispatcher,
  createWorkspaceAgentDispatcherError,
  type WorkspaceAgentDispatcherResolver,
} from './workspaceAgentDispatcher'

const DEFAULT_VERSION = '0.1.0-dev'
const DEFAULT_SESSION_ID = 'default'

export interface CreateStandaloneAgentHostAppOptions {
  workspaceRoot?: string
  sessionId?: string
  templatePath?: string
  mode?: RuntimeModeId
  runtimeModeAdapter?: RuntimeModeAdapter
  runtimeHost?: AgentRuntimeHostOperations
  authToken?: string
  version?: string
  logger?: boolean
  /** Standalone defaults to a warm runtime; readiness smokes may keep binding lazy. */
  initializeRuntime?: boolean
  extraTools?: AgentTool[]
  disableDefaultFileTools?: boolean
  systemPromptAppend?: string
  harnessFactory?: AgentHarnessFactory
  pi?: PiHarnessOptions
  /** Additional host roots allowed to contribute local Pi resource bytes. */
  piResourceAuthorizedRoots?: string[]
  runtimeProvisioning?: WorkspaceProvisioningResult
  getRuntimeProvisioning?: () => WorkspaceProvisioningResult | undefined
  sessionNamespace?: string
  telemetry?: TelemetrySink
  metering?: AgentMeteringSink
  getFilesystemBindings?: (ctx: {
    request?: FastifyRequest
    sessionId?: string
    workspaceId: string
    workspaceRoot: string
    userId?: string
    userEmail?: string
    userEmailVerified?: boolean
    requestId?: string
  }) => RuntimeFilesystemBinding[] | undefined | Promise<RuntimeFilesystemBinding[] | undefined>
  resolvePiSessionRequestContext?: (
    request: FastifyRequest,
    defaultContext: PiSessionRequestContext,
  ) => PiSessionRequestContext | Promise<PiSessionRequestContext>
  runtimeEnvContributions?: RuntimeEnvContribution[]
  runtimeProvisioner?: (ctx: {
    workspaceRoot: string
    runtimeMode: RuntimeModeId
    runtimeBundle: RuntimeBundle
  }) => Promise<void>
  sessionDir?: string
  sessionRoot?: string
  /**
   * Durable request ledger file. Host application state, not workspace content:
   * point it at host-owned storage. Defaults per
   * {@link resolveRequestLedgerPath}.
   */
  requestLedgerPath?: string
  externalPlugins?: boolean
  beforeReload?: () => void | {
    readonly diagnostics?: ReadonlyArray<{ source: string; message: string; pluginId?: string }>
    readonly restart_warnings?: ReadonlyArray<{ id: string; surfaces: readonly string[]; message: string }>
  } | undefined | Promise<void | {
    readonly diagnostics?: ReadonlyArray<{ source: string; message: string; pluginId?: string }>
    readonly restart_warnings?: ReadonlyArray<{ id: string; surfaces: readonly string[]; message: string }>
  } | undefined>
  systemPromptDynamic?: () => string | undefined | Promise<string | undefined>
  getPluginDiagnostics?: (args: {
    workspaceId: string
    workspaceRoot: string
  }) => Promise<Array<{ source: string; message: string; pluginId?: string }>>
  onWorkspaceAgentDispatcher?: (resolver: WorkspaceAgentDispatcherResolver) => void
}

function createStandaloneScopeAuthority() {
  const issued = new WeakSet<object>()
  const issue = (workspaceScopeId: string): AuthorizedAgentScope => {
    const scope = Object.freeze({
      workspaceScopeId,
      authSubjectId: 'standalone',
    }) as AuthorizedAgentScope
    issued.add(scope as object)
    return scope
  }
  return {
    issue,
    verifier: {
      async verify(scope: AuthorizedAgentScope): Promise<VerifiedAgentScopeClaim> {
        if (!issued.has(scope as object)) throw new Error('standalone Agent Host scope denied')
        return { workspaceScopeId: scope.workspaceScopeId, authSubjectId: 'standalone' }
      },
    },
  }
}

function withStandaloneRuntimeContributions(
  adapter: RuntimeModeAdapter,
  options: CreateStandaloneAgentHostAppOptions,
  workspaceRoot: string,
): RuntimeModeAdapter {
  if (!options.runtimeEnvContributions?.length) return adapter
  return {
    ...adapter,
    async create(context) {
      const bundle = await adapter.create(context)
      return withRuntimeEnvContributions(bundle, {
        workspaceId: context.workspaceId ?? context.sessionId,
        workspaceRoot,
        runtimeMode: adapter.id,
        runtimeBundle: bundle,
      }, options.runtimeEnvContributions!, options.telemetry)
    },
  }
}

/** Thin standalone HTTP shell over one directly composed CreatedAgentHost. */
export async function createStandaloneAgentHostApp(
  options: CreateStandaloneAgentHostAppOptions = {},
): Promise<FastifyInstance> {
  const sessionId = options.sessionId ?? DEFAULT_SESSION_ID
  const workspaceRoot = options.workspaceRoot ?? process.cwd()
  const templatePath = options.templatePath ?? getEnv('BORING_AGENT_TEMPLATE_PATH')
  const resolvedMode = options.runtimeModeAdapter?.id ?? options.mode ?? autoDetectMode()
  const baseModeAdapter = options.runtimeModeAdapter ?? resolveMode(resolvedMode)
  const modeAdapter = withStandaloneRuntimeContributions(baseModeAdapter, options, workspaceRoot)
  const runtimeHost = options.runtimeHost ?? modeAdapter.runtimeHost
  const getRuntimeProvisioning = options.getRuntimeProvisioning ?? (() => options.runtimeProvisioning)
  // Local standalone/native Pi keeps its historical `default` transcript
  // coordinate. A remote worker, however, requires the host-selected UUID as
  // its runtime workspace identity; forwarding `default` is invalid and would
  // route filesystem operations to the wrong tenant.
  const authority = createStandaloneScopeAuthority()
  const httpWorkspaceScopeId = resolvedMode === 'remote-worker' ? sessionId : DEFAULT_SESSION_ID
  const httpScope = authority.issue(httpWorkspaceScopeId)
  const dispatcherScope = sessionId === httpWorkspaceScopeId ? httpScope : authority.issue(sessionId)
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 16 * 1024 * 1024 })
  let created: Awaited<ReturnType<typeof createAgentHost>> | undefined
  let lastReloadDiagnostics: ReadonlyArray<{ source: string; message: string; pluginId?: string }> = []

  const authorizeAgentRequest = async () => httpScope
  const resolvePi = () => ({
    ...withPiHarnessDefaults(options.pi),
    additionalSkillPaths: [
      ...(getRuntimeProvisioning()?.skillPaths ?? []),
      ...(options.pi?.additionalSkillPaths ?? []),
    ],
  })
  const resolveEnvironment = () => ({
    placementIdentity: JSON.stringify([resolvedMode, workspaceRoot, templatePath ?? null]),
    workspaceRoot,
    runtimeWorkspaceId: sessionId,
    templatePath,
    provisioningFingerprint: JSON.stringify([resolvedMode, workspaceRoot, templatePath ?? null]),
    async provisionRuntime({ runtimeBundle }: { runtimeBundle: RuntimeBundle; signal: AbortSignal }) {
      await options.runtimeProvisioner?.({ workspaceRoot, runtimeMode: resolvedMode, runtimeBundle })
      return getRuntimeProvisioning()
    },
    ...(options.getFilesystemBindings
      ? {
          async resolveFilesystemBindings({ verifiedClaim, requestId }: {
            verifiedClaim: VerifiedAgentScopeClaim
            requestId: string
          }) {
            return await options.getFilesystemBindings?.({
              workspaceId: verifiedClaim.workspaceScopeId,
              workspaceRoot,
              userId: verifiedClaim.authSubjectId,
              requestId,
            })
          },
        }
      : {}),
  })

  try {
    created = await createAgentHost({
      agents: [{ agentTypeId: 'default', legacyDefault: true }],
      fleetCompiler: { async compile({ agents }) { return agents } },
      hostId: 'standalone-agent-host',
      scopeVerifier: authority.verifier,
      runtimeModeAdapter: modeAdapter,
      runtimeHost,
      sessionRoot: options.sessionRoot,
      requestLedgerPath: resolveRequestLedgerPath({
        requestLedgerPath: options.requestLedgerPath,
        sessionRoot: options.sessionRoot,
        acceptSessionRootEnv: true,
        legacy: { layout: 'workspace-boring-dir', workspaceRoot },
      }),
      telemetry: options.telemetry,
      metering: options.metering,
      harnessFactory: options.harnessFactory,
      async resolveAuthorizedEnvironmentScope() {
        return resolveEnvironment()
      },
      async resolveAuthorizedAgentRuntimeScope({ verifiedClaim, intent }) {
        const pi = resolvePi()
        const identity = JSON.stringify([resolvedMode, sessionId, workspaceRoot, templatePath ?? null, pi, options.sessionNamespace ?? null])
        const physicalBindingIdentity = JSON.stringify([resolvedMode, sessionId, workspaceRoot, templatePath ?? null])
        const buildResourceDigestInput = async () => {
          const hotResources = pi.getHotReloadableResources?.()
          return createPiResourceDigestInput({
            piCwd: workspaceRoot,
            noSkills: pi.noSkills,
            noContextFiles: pi.noContextFiles,
            resourceSets: [{
              promptParts: [
                options.systemPromptAppend,
                await options.systemPromptDynamic?.(),
              ],
              additionalSkillPaths: [
                ...(pi.additionalSkillPaths ?? []),
                ...(hotResources?.additionalSkillPaths ?? []),
              ],
              packages: [
                ...(pi.packages ?? []),
                ...(hotResources?.packages ?? []),
              ],
              extensionPaths: [
                ...(pi.extensionPaths ?? []),
                ...(hotResources?.extensionPaths ?? []),
              ],
            }],
            authorizedRoots: [workspaceRoot, ...(options.piResourceAuthorizedRoots ?? [])],
          })
        }
        const { resourceInputDigest, revalidateResourceInputs } = await createPiResourceDigestFence(buildResourceDigestInput)
        if (intent.operation === 'reload') {
          return {
            identity,
            physicalBindingIdentity,
            resourceInputDigest,
            revalidateResourceInputs,
            sessionNamespace: options.sessionNamespace ?? '',
            async applyReload() {
              const result = await options.beforeReload?.()
              lastReloadDiagnostics = result?.diagnostics ?? []
              return result ? {
                ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}),
                ...(result.restart_warnings ? { restartWarnings: result.restart_warnings } : {}),
              } : undefined
            },
          }
        }
        const externalTools: AgentTool[] = []
        if (options.externalPlugins !== false && modeAdapter.workspaceFsCapability === 'strong') {
          const loaded = await loadPlugins({ cwd: workspaceRoot })
          for (const error of loaded.errors) app.log.warn(`[plugin] failed to load ${error.source}: ${error.error}`)
          for (const plugin of loaded.plugins) externalTools.push(...plugin.tools)
        }
        if (options.externalPlugins !== false) {
          externalTools.push(createPluginDiagnosticsTool({
            getLastReloadDiagnostics: () => lastReloadDiagnostics,
            getHarness: () => undefined,
            ...(options.getPluginDiagnostics
              ? { getPluginErrors: () => options.getPluginDiagnostics!({ workspaceId: sessionId, workspaceRoot }) }
              : {}),
          }))
        }
        return {
          identity,
          physicalBindingIdentity,
          resourceInputDigest,
          sessionNamespace: options.sessionNamespace ?? '',
          pi,
          extraTools: [...(options.extraTools ?? []), ...externalTools],
          systemPromptAppend: options.systemPromptAppend,
          loadSystemPromptAppend: options.systemPromptDynamic
            ? async () => await options.systemPromptDynamic?.()
            : undefined,
          ...(options.getFilesystemBindings
            ? {
                async getFilesystemBindings(input: { sessionId?: string; requestId: string }) {
                  return await options.getFilesystemBindings?.({
                    sessionId: input.sessionId,
                    workspaceId: verifiedClaim.workspaceScopeId,
                    workspaceRoot,
                    userId: verifiedClaim.authSubjectId,
                    requestId: input.requestId,
                  })
                },
              }
            : {}),
          ...(options.disableDefaultFileTools ? { includeFilesystemTools: false } : {}),
          ...(options.sessionDir ? { sessionDir: options.sessionDir } : {}),
        }
      },
    })

    options.onWorkspaceAgentDispatcher?.({
      async runWithWorkspaceAgent(input, run) {
        if (input.context.workspaceId !== sessionId) {
          throw createWorkspaceAgentDispatcherError(
            ErrorCode.enum.UNAUTHORIZED,
            'workspace agent dispatcher context does not match bound workspace',
            401,
          )
        }
        await created!.runWithWorkspaceAgent({ ...input, authorizedScope: dispatcherScope }, run)
      },
      async resolve(context) {
        if (context.workspaceId !== sessionId) {
          throw createWorkspaceAgentDispatcherError(
            ErrorCode.enum.UNAUTHORIZED,
            'workspace agent dispatcher context does not match bound workspace',
            401,
          )
        }
        return createBoundWorkspaceAgentDispatcher({
          gateway: created!.gateway,
          scope: dispatcherScope,
          agentTypeId: 'default',
        }, context)
      },
    })

    app.addHook('onRequest', createAuthMiddleware({
      authToken: options.authToken,
      workspaceId: DEFAULT_SESSION_ID,
      publicPaths: ['/health', '/ready'],
    }))
    await app.register(healthRoutes, {
      version: options.version ?? DEFAULT_VERSION,
      getReadiness: () => ({ sandboxReady: true, harnessReady: true }),
    })
    await registerAgentHostEnvironmentRoutes(app, {
      created,
      authorizeAgentRequest,
      runtimeHost,
      getWorkspaceHostRoot: modeAdapter.workspaceFsCapability === 'strong'
        ? async () => workspaceRoot
        : undefined,
    })
    await app.register(created.registerDirectRoutes({
      authorizeAgentRequest,
      defaultSessionId: sessionId,
    }))
    if (options.initializeRuntime !== false) {
      await created.runWithWorkspaceAgent({
        authorizedScope: dispatcherScope,
        agentTypeId: 'default',
        context: { workspaceId: sessionId, userId: 'standalone' },
        requestId: 'standalone-initialize',
      }, async () => undefined)
    }
    return app
  } catch (error) {
    try { await app.close() } catch {}
    if (!created) {
      try { await modeAdapter.dispose?.() } catch {}
    } else {
      try { await created.host.close() } catch {}
    }
    throw error
  }
}
