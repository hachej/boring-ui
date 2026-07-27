import type { FastifyInstance, FastifyRequest } from 'fastify'
import { basename } from 'node:path'
import { type ToolReadinessState } from '@hachej/boring-bash/agent'
import type { AgentTool, ToolReadinessRequirement } from '../shared/tool'
import type {
  AuthorizedAgentScope,
  VerifiedAgentScopeClaim,
} from '../shared/gateway/types'
import type { AgentHarness } from '../shared/harness'
import type { Agent } from '../shared/events'
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'
import { getEnv } from './config/env'
import {
  type RuntimeBundle,
  type RuntimeFilesystemBinding,
  type RuntimeModeAdapter,
  type RuntimeModeId,
} from './runtime/mode'
import type { AgentRuntimeHostOperations } from './runtime/runtimeHost'
import type { WorkspaceProvisioningResult } from './workspace/provisioning'
import type { Workspace } from '../shared/workspace'
import { ErrorCode } from '../shared/error-codes'
import { withPiHarnessDefaults } from './harness/pi-coding-agent/createHarness'
import type { ResolvedPiHarnessOptions } from './harness/pi-coding-agent/createHarness'
import { loadPlugins } from './harness/pi-coding-agent/pluginLoader'
import { registerConfiguredModelProviders } from './models/modelConfig'
import { mergeTools, type PluginToolRegistration } from './catalog/mergeTools'
import type { AgentCoreSessionService, PiChatSessionService } from '../core/piChatSessionService'
import { InMemorySessionChangesTracker } from './http/sessionChangesTracker'
import { ReadyStatusTracker } from './runtime/readyStatus'
import { createRuntimeReadyStatusTracker } from './runtime/modeReadiness'
import { withRuntimeEnvContributions } from './runtimeEnvContributions'
import { createPluginDiagnosticsTool } from './tools/pluginDiagnostics'
import type { CompatibilityResolvedAgentRuntimeScope } from './agent-host/buildAgentComposition'
import type {
  AgentHostLegacyRoutePolicyMountInput,
  ResolvedAgentRuntimeScope,
} from './agent-host/types'
import {
  assertWorkspaceAgentDispatcherRequestContext,
  createBoundWorkspaceAgentDispatcher,
  createWorkspaceAgentDispatcherError,
  normalizeWorkspaceAgentDispatcherContext,
  type WorkspaceAgentDispatcherResolver,
} from './workspaceAgentDispatcher'
import type { WorkspaceAgentDispatcher, WorkspaceAgentDispatcherContext } from '../shared/workspaceAgentDispatcher'
import {
  createRuntimeBindingLifecycle,
  type RuntimeBindingEntry as ManagedRuntimeBindingEntry,
} from './runtime/runtimeBindingLifecycle'
import { mountOrderedAgentHostLegacyRoutes } from './agentHostLegacyRouteMount'
import { bindTrustedPiSession } from './trustedPiSessionBinding'

const DEFAULT_WORKSPACE_ID = 'default'
const STANDARD_AGENT_TOOL_NAMES = ['bash', 'read', 'write', 'edit', 'find', 'grep', 'ls']

function pluginNameFromPath(path: string): string {
  const fileName = basename(path)
  if (fileName.endsWith('.mjs')) return fileName.slice(0, -4)
  if (fileName.endsWith('.js')) return fileName.slice(0, -3)
  return fileName
}

function getAvailableModelProviders(): string[] {
  const authStorage = AuthStorage.create()
  const registry = ModelRegistry.create(authStorage)
  const configuredModels = registerConfiguredModelProviders(registry)
  const configuredModelSet = new Set(
    configuredModels.map((model) => `${model.provider}:${model.id}`),
  )
  const availableModels = configuredModelSet.size > 0
    ? registry.getAvailable().filter((model) => configuredModelSet.has(`${model.provider}:${model.id}`))
    : registry.getAvailable()
  return Array.from(
    new Set(availableModels.map((model) => model.provider)),
  ).sort((a, b) => a.localeCompare(b))
}

type RuntimeDependencyState = 'not-started' | 'preparing' | 'ready' | 'failed'

interface RuntimeDependencyReadiness {
  state: RuntimeDependencyState
  requirement?: ToolReadinessRequirement
  startedAt?: string
  completedAt?: string
  errorCode?: string
  causeCode?: string
  retryable?: boolean
  message?: string
}

interface RuntimeBinding {
  runtimeBundle: RuntimeBundle
  disposeRuntime?: () => Promise<void>
  workspaceRoot: string
  runtimeProvisioning?: WorkspaceProvisioningResult
  runtimeDependencies: RuntimeDependencyReadiness
  runtimeProvisioningTask?: Promise<WorkspaceProvisioningResult | undefined>
  assertActive: () => void
  retire: () => Promise<void>
  reprovision: (request?: FastifyRequest) => Promise<WorkspaceProvisioningResult | undefined>
  agent: Agent
  harness: AgentHarness
  tools: AgentTool[]
  readyTracker: ReadyStatusTracker
  piChatService: AgentCoreSessionService
  trustedPiChatService: PiChatSessionService
  authorizedScope: import('../shared').AuthorizedAgentScope
  hostScope: CompatibilityResolvedAgentRuntimeScope
  lastHealthCheckMs?: number
  /** Latest reload diagnostics retained for the plugin_diagnostics agent tool. */
  lastReloadDiagnostics?: Array<{ source: string; message: string; pluginId?: string }>
}

type RuntimeBindingEntry = ManagedRuntimeBindingEntry<RuntimeBinding>

interface RuntimeScope {
  root: string
  key: string
  templatePath?: string
  pi: ResolvedPiHarnessOptions
  sessionNamespace?: string
  loadSystemPromptAppend?: () => Promise<string | undefined>
}

interface SkillScope {
  root: string
  pi: ResolvedPiHarnessOptions
}

function getRequestWorkspaceId(request: FastifyRequest): string {
  return request.workspaceContext?.workspaceId ?? DEFAULT_WORKSPACE_ID
}

function promoteRawFileWorkspaceQueryToHeader(request: FastifyRequest): void {
  const pathname = request.url.split('?')[0] ?? request.url
  // Browser media previews (img/object/etc.) cannot attach custom headers, so
  // raw workspace file URLs carry workspaceId as a query param. Promote it into
  // the existing header-based resolver path instead of bypassing host auth.
  if (pathname !== '/api/v1/files/raw') return
  const hasWorkspaceHeader = Object.keys(request.headers)
    .some((key) => key.toLowerCase() === 'x-boring-workspace-id')
  if (hasWorkspaceHeader) return
  const queryIndex = request.url.indexOf('?')
  if (queryIndex < 0) return
  const workspaceId = new URLSearchParams(request.url.slice(queryIndex + 1)).get('workspaceId')?.trim()
  if (!workspaceId) return
  request.headers['x-boring-workspace-id'] = workspaceId
}

function isWorkspaceAgnosticAgentRequest(
  request: FastifyRequest,
  options?: { readyStatusWorkspaceScoped?: boolean; modelsWorkspaceScoped?: boolean },
): boolean {
  const pathname = request.url.split('?')[0] ?? request.url
  if (pathname === '/api/v1/ready-status') return !options?.readyStatusWorkspaceScoped
  if (pathname === '/api/v1/agent/models') return !options?.modelsWorkspaceScoped
  return pathname === '/health' || pathname === '/ready'
}

function normalizeSessionNamespace(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function getRequestAuthSubject(request: FastifyRequest | undefined): string | undefined {
  const userId = (request as { user?: { id?: unknown } } | undefined)?.user?.id
  if (typeof userId === 'string' && userId.trim()) return userId.trim()
  const authSubject = (request?.workspaceContext as { authSubject?: unknown } | undefined)?.authSubject
  return typeof authSubject === 'string' && authSubject.trim() ? authSubject.trim() : undefined
}

function createHttpError(
  code: typeof ErrorCode.enum[keyof typeof ErrorCode.enum],
  message: string,
  details: Record<string, unknown> = {},
): Error & { code: string; statusCode: number; details: Record<string, unknown> } {
  const error = new Error(message) as Error & { code: string; statusCode: number; details: Record<string, unknown> }
  error.code = code
  error.statusCode = 503
  error.details = details
  return error
}

function createAgentRuntimeNotReadyError(workspaceId: string): Error {
  return createHttpError(
    ErrorCode.enum.AGENT_RUNTIME_NOT_READY,
    'Agent runtime is still preparing. Try again in a moment.',
    { workspaceId, retryable: true },
  )
}

function createAgentBindingDisposedError(workspaceId: string): Error {
  const error = createHttpError(
    ErrorCode.enum.AGENT_BINDING_DISPOSED,
    'Agent runtime host is closing.',
    { workspaceId, retryable: false },
  )
  error.statusCode = 410
  return error
}

async function drainRuntimeProvisioning(
  task: Promise<WorkspaceProvisioningResult | undefined> | undefined,
): Promise<void> {
  if (!task) return
  await task.then(() => undefined, () => undefined)
}

function createRuntimeProvisioningFailedError(workspaceId: string, cause: unknown): Error {
  const causeCode = (cause as { code?: unknown } | null)?.code
  return createHttpError(
    ErrorCode.enum.RUNTIME_PROVISIONING_FAILED,
    'Agent runtime provisioning failed. Reload the workspace and try again.',
    {
      workspaceId,
      retryable: true,
      ...(typeof causeCode === 'string' ? { causeCode } : {}),
    },
  )
}

function isRuntimeReadinessRequirement(requirement: ToolReadinessRequirement): boolean {
  return requirement === 'runtime-dependencies' || requirement.startsWith('runtime:')
}

function causeCodeFrom(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

function createRuntimeReadinessCheck(
  workspaceId: string,
  getRuntimeDependencies: () => RuntimeDependencyReadiness,
): (requirement: ToolReadinessRequirement, tool: AgentTool) => ToolReadinessState {
  return (requirement) => {
    if (!isRuntimeReadinessRequirement(requirement)) return true
    const runtimeDependencies = getRuntimeDependencies()
    if (runtimeDependencies.state === 'ready' || runtimeDependencies.state === 'not-started') return true
    return {
      ready: false,
      state: runtimeDependencies.state,
      errorCode: runtimeDependencies.errorCode,
      causeCode: runtimeDependencies.causeCode,
      message: runtimeDependencies.message,
      workspaceId,
      retryable: runtimeDependencies.retryable ?? true,
    }
  }
}

import type {
  AgentHostLegacyRoutePolicyOptions,
  AgentHostLegacyRouteScopePolicy,
} from './agentHostLegacyRouteOptions'
export type {
  AgentHostLegacyRoutePolicyOptions,
  AgentHostLegacyRouteScopePolicy,
  PrebuiltAgentHostRoutePolicy,
  RegisterAgentRoutesOptions,
} from './agentHostLegacyRouteOptions'

export async function mountAgentHostLegacyRouteRuntime(
  app: FastifyInstance,
  opts: AgentHostLegacyRoutePolicyOptions,
  mountInput: AgentHostLegacyRoutePolicyMountInput,
  scopePolicy: AgentHostLegacyRouteScopePolicy,
): Promise<void> {
  const sessionId = opts.sessionId ?? DEFAULT_WORKSPACE_ID
  const modeAdapter = opts.runtimeModeAdapter
  const resolvedMode = modeAdapter.id
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const templatePath = opts.templatePath ?? getEnv('BORING_AGENT_TEMPLATE_PATH')
  const runtimeHost = opts.runtimeHost ?? modeAdapter.runtimeHost
  const agentHost = mountInput.runtime
  const defaultAgentTypeId = mountInput.defaultAgentTypeId
  const issueScope = (
    claim: VerifiedAgentScopeClaim,
    runtimeScope: CompatibilityResolvedAgentRuntimeScope,
  ): AuthorizedAgentScope => scopePolicy.issueScope({ claim, runtimeScope })
  const bindingLifecycle = createRuntimeBindingLifecycle<RuntimeBinding>({
    app,
    capacity: 256,
    createDisposedError: createAgentBindingDisposedError,
    ...(modeAdapter.evictCachedRuntime
      ? { evictCachedRuntime: (ctx: { workspaceId: string }) => modeAdapter.evictCachedRuntime?.(ctx) }
      : {}),
  })
  mountInput.registerLifecycle({
    startDraining: bindingLifecycle.startDraining,
    closeBindings: bindingLifecycle.close,
  })
  const modelsWorkspaceScoped = Boolean(opts.filterModels)
  const requestScopedRuntime =
    typeof opts.getWorkspaceId === 'function' ||
    typeof opts.getWorkspaceRoot === 'function' ||
    typeof opts.getTemplatePath === 'function' ||
    typeof opts.getPi === 'function' ||
    typeof opts.getExtraTools === 'function' ||
    typeof opts.getSessionNamespace === 'function' ||
    typeof opts.getSystemPromptDynamic === 'function' ||
    typeof opts.getRuntimeScopeContribution === 'function' ||
    typeof opts.getTrustedWorkspaceRoot === 'function'
  const runtimeScopeByRequest = new WeakMap<FastifyRequest, Map<string, Promise<RuntimeScope>>>()
  const sessionChangesTracker = new InMemorySessionChangesTracker()
  const externalPluginsEnabled = opts.externalPlugins !== false

  // Chokepoint where a scope's pi options are born: resolve the host's
  // static/dynamic pi config and apply boring's canonical harness defaults,
  // so every downstream consumer (harness factory, skills routes) reads
  // already-defaulted flags instead of re-applying the policy themselves.
  async function resolveScopePi(
    workspaceId: string,
    root: string,
    request?: FastifyRequest,
  ): Promise<ResolvedPiHarnessOptions> {
    return withPiHarnessDefaults(opts.getPi
      ? await opts.getPi({ workspaceId, workspaceRoot: root, request })
      : opts.pi)
  }

  async function resolveRuntimeScope(
    workspaceId: string,
    request?: FastifyRequest,
    trustedCtx?: WorkspaceAgentDispatcherContext,
  ): Promise<RuntimeScope> {
    let root = workspaceRoot
    if (request && opts.getWorkspaceRoot) {
      root = await opts.getWorkspaceRoot(workspaceId, request)
    } else if (trustedCtx && opts.getTrustedWorkspaceRoot) {
      root = await opts.getTrustedWorkspaceRoot(trustedCtx)
    } else if (!request && opts.getWorkspaceRoot) {
      throw createWorkspaceAgentDispatcherError(
        ErrorCode.enum.WORKSPACE_UNINITIALIZED,
        'workspace root resolution requires trusted workspace context',
        400,
      )
    }
    const scopedTemplatePath = opts.getTemplatePath
      ? await opts.getTemplatePath({ workspaceId, workspaceRoot: root, request })
      : templatePath
    const pi = await resolveScopePi(workspaceId, root, request)
    const sessionNamespace = normalizeSessionNamespace(opts.getSessionNamespace
      ? await opts.getSessionNamespace({ workspaceId, workspaceRoot: root, request, userId: trustedCtx?.userId })
      : opts.sessionNamespace)
    const extraToolsAuthSubject = opts.getExtraTools ? trustedCtx?.userId ?? getRequestAuthSubject(request) : undefined
    const contribution = await opts.getRuntimeScopeContribution?.({ workspaceId, workspaceRoot: root, request })
    return {
      root,
      templatePath: scopedTemplatePath,
      pi,
      sessionNamespace,
      loadSystemPromptAppend: contribution?.loadSystemPromptAppend,
      key: JSON.stringify([
        resolvedMode,
        workspaceId,
        root,
        scopedTemplatePath ?? null,
        pi,
        sessionNamespace ?? null,
        extraToolsAuthSubject ?? null,
        contribution?.identity ?? null,
      ]),
    }
  }

  function getRuntimeScope(
    workspaceId: string,
    request?: FastifyRequest,
    trustedCtx?: WorkspaceAgentDispatcherContext,
  ): Promise<RuntimeScope> {
    if (!request) return resolveRuntimeScope(workspaceId, undefined, trustedCtx)
    let scopes = runtimeScopeByRequest.get(request)
    if (!scopes) {
      scopes = new Map()
      runtimeScopeByRequest.set(request, scopes)
    }
    const identity = JSON.stringify([workspaceId, trustedCtx?.userId ?? null])
    let promise = scopes.get(identity)
    if (!promise) {
      promise = resolveRuntimeScope(workspaceId, request, trustedCtx)
      scopes.set(identity, promise)
    }
    return promise
  }

  async function resolveSkillScope(
    workspaceId: string,
    request?: FastifyRequest,
  ): Promise<SkillScope> {
    const root = request && opts.getWorkspaceRoot
      ? await opts.getWorkspaceRoot(workspaceId, request)
      : workspaceRoot
    const pi = await resolveScopePi(workspaceId, root, request)
    const hot = pi.getHotReloadableResources?.()
    return {
      root,
      pi: hot ? {
        ...pi,
        additionalSkillPaths: [
          ...(pi.additionalSkillPaths ?? []),
          ...(hot.additionalSkillPaths ?? []),
        ],
        packages: [
          ...(pi.packages ?? []),
          ...(hot.packages ?? []),
        ],
        extensionPaths: [
          ...(pi.extensionPaths ?? []),
          ...(hot.extensionPaths ?? []),
        ],
      } : pi,
    }
  }

  async function runRuntimeProvisioning(
    workspaceId: string,
    scope: RuntimeScope,
    request: FastifyRequest | undefined,
    signal: AbortSignal,
    runtimeBundle?: RuntimeBundle,
  ): Promise<WorkspaceProvisioningResult | undefined> {
    if (opts.provisionWorkspace === false || !opts.provisionRuntime) return undefined
    const modeCtx = {
      workspaceRoot: scope.root,
      sessionId: workspaceId,
      workspaceId,
      templatePath: scope.templatePath,
      requestId: request?.id,
      telemetry: opts.telemetry,
    }
    if (!runtimeHost) throw new Error('runtime provisioning requires injected host operations')
    const runtimeLayout = runtimeHost.getBoringAgentRuntimePaths(modeAdapter.getRuntimeLayoutRoot?.(modeCtx) ?? scope.root)
    if (!runtimeBundle) throw new Error('runtime provisioning requires an active runtime bundle')
    return await opts.provisionRuntime({
      workspaceId,
      workspaceRoot: scope.root,
      runtimeMode: resolvedMode,
      runtimeLayout,
      provisioningAdapter: runtimeBundle.provisioningAdapter,
      runtimeBundle,
      request,
      signal,
    })
  }

  async function createRuntimeBinding(
    workspaceId: string,
    scope: RuntimeScope,
    request?: FastifyRequest,
    trustedCtx?: WorkspaceAgentDispatcherContext,
  ): Promise<RuntimeBinding> {
    const root = scope.root
    const scopedSystemPromptAppend = await scope.loadSystemPromptAppend?.()
    let runtimeProvisioning: WorkspaceProvisioningResult | undefined
    let runtimeDependencies: RuntimeDependencyReadiness = hasRuntimeProvisioningInput
      ? {
          state: 'preparing',
          requirement: 'runtime-dependencies',
          startedAt: new Date().toISOString(),
          retryable: true,
        }
      : { state: 'ready' }
    let provisioningGeneration = 0
    let retired = false
    const provisioningAbort = new AbortController()
    let retirePromise: Promise<void> | undefined
    let runtimeBundle!: RuntimeBundle
    const readyTracker = createRuntimeReadyStatusTracker(modeAdapter, {
      harnessReady: false,
      capabilities: {
        chat: { state: 'preparing' },
        runtimeDependencies,
      },
    })

    let binding: RuntimeBinding | undefined
    const updateRuntimeDependencies = (next: RuntimeDependencyReadiness) => {
      runtimeDependencies = next
      if (binding) binding.runtimeDependencies = next
      readyTracker.updateRuntimeDependencies(next)
    }

    const startRuntimeProvisioning = (provisionRequest?: FastifyRequest) => {
      if (retired) throw createAgentBindingDisposedError(workspaceId)
      if (!hasRuntimeProvisioningInput) return undefined
      if (binding?.runtimeProvisioningTask && runtimeDependencies.state === 'preparing') {
        return binding.runtimeProvisioningTask
      }
      const generation = ++provisioningGeneration
      readyTracker.clearDegraded()
      updateRuntimeDependencies({
        state: 'preparing',
        requirement: 'runtime-dependencies',
        startedAt: new Date().toISOString(),
        retryable: true,
      })
      const task = runRuntimeProvisioning(
        workspaceId,
        scope,
        provisionRequest,
        provisioningAbort.signal,
        runtimeBundle,
      ).then(
        async (result) => {
          if (retired || generation !== provisioningGeneration) {
            throw createAgentBindingDisposedError(workspaceId)
          }
          runtimeProvisioning = result
          if (binding) binding.runtimeProvisioning = result
          if (binding?.harness.reloadSession) {
            try {
              const sessions = await binding.harness.sessions.list({ workspaceId })
              if (retired || generation !== provisioningGeneration) {
                throw createAgentBindingDisposedError(workspaceId)
              }
              await Promise.allSettled(
                sessions.map((session) => binding?.harness.reloadSession?.(session.id)),
              )
              if (retired || generation !== provisioningGeneration) {
                throw createAgentBindingDisposedError(workspaceId)
              }
            } catch (error) {
              if (retired || generation !== provisioningGeneration) throw error
              app.log.warn({ err: error, workspaceId }, '[agent] failed to refresh harness sessions after runtime provisioning')
            }
          }
          updateRuntimeDependencies({
            state: 'ready',
            requirement: 'runtime-dependencies',
            completedAt: new Date().toISOString(),
            retryable: true,
          })
          return result
        },
        (error) => {
          if (retired || generation !== provisioningGeneration) {
            throw createAgentBindingDisposedError(workspaceId)
          }
          const causeCode = causeCodeFrom(error)
          updateRuntimeDependencies({
            state: 'failed',
            requirement: 'runtime-dependencies',
            completedAt: new Date().toISOString(),
            errorCode: ErrorCode.enum.RUNTIME_PROVISIONING_FAILED,
            ...(causeCode ? { causeCode } : {}),
            retryable: true,
            message: 'Agent runtime provisioning failed. Reload the workspace and try again.',
          })
          readyTracker.markDegraded('runtime dependency provisioning failed')
          app.log.warn({ err: error, workspaceId }, '[agent] background runtime provisioning failed')
          throw error
        },
      )
      task.catch(() => {})
      if (binding) binding.runtimeProvisioningTask = task
      return task
    }

    const checkReadiness = createRuntimeReadinessCheck(workspaceId, () => runtimeDependencies)

    // UI tools/routes remain app-owned. The Host receives only normalized tool
    // and prompt contributions and performs the one construction sequence.
    let pluginTools: PluginToolRegistration[] = []
    const compositionPi = {
      ...scope.pi,
      additionalSkillPaths: [...(scope.pi.additionalSkillPaths ?? [])],
      getHotReloadableResources: () => {
        const hot = scope.pi.getHotReloadableResources?.() ?? {}
        return {
          ...hot,
          additionalSkillPaths: [
            ...(runtimeProvisioning?.skillPaths ?? []),
            ...(hot.additionalSkillPaths ?? []),
          ],
        }
      },
    }
    const systemPromptDynamic = opts.getSystemPromptDynamic
      ? () => opts.getSystemPromptDynamic?.({ workspaceId, workspaceRoot: root })
      : opts.systemPromptDynamic
    const hostScope: CompatibilityResolvedAgentRuntimeScope = {
      identity: scope.key,
      environment: {
        // Compatibility projection preserves the legacy one-provider-per-binding
        // lifecycle; canonical multi-Agent consumers supply shared placement IDs.
        placementIdentity: scope.key,
        workspaceRoot: root,
        templatePath: scope.templatePath,
        compatibilityModeContext: {
          sessionId: workspaceId,
          workspaceId,
          requestId: request?.id,
          telemetry: opts.telemetry,
        },
        provisioningFingerprint: JSON.stringify([
          resolvedMode,
          root,
          scope.templatePath ?? null,
          opts.runtimeEnvContributions?.map((contribution) => contribution.id) ?? [],
        ]),
      },
      sessionNamespace: scope.sessionNamespace ?? '',
      pi: compositionPi,
      extraTools: opts.extraTools,
      systemPromptAppend: [opts.systemPromptAppend, scopedSystemPromptAppend].filter(Boolean).join('\n\n') || undefined,
      loadSystemPromptAppend: systemPromptDynamic
        ? async () => await systemPromptDynamic()
        : undefined,
      compatibility: {
        includeFilesystemTools: !opts.disableDefaultFileTools,
        includeUploadTools: true,
        readyTracker,
        checkReadiness,
        harnessFactory: opts.harnessFactory,
        // A prebuilt Host owns admission for AgentGateway effects. Keep the
        // legacy callback only on this plugin's non-Gateway reload/command
        // routes; compatibility Hosts still use it for their Gateway aliases.
        admitEffect: scopePolicy.gatewayUsesLegacyAdmission ? opts.admitEffect : undefined,
        harnessRuntime: {
          getCurrent: () => runtimeProvisioning ? {
            env: runtimeProvisioning.env,
            pathEntries: runtimeProvisioning.pathEntries,
          } : undefined,
          getReadiness: () => checkReadiness('runtime:python', {} as AgentTool),
        },
        getFilesystemBindings: opts.getFilesystemBindings
          ? (ctx) => opts.getFilesystemBindings?.({
              workspaceId,
              workspaceRoot: root,
              sessionId: ctx.sessionId,
              userId: ctx.userId,
              userEmail: ctx.userEmail,
              userEmailVerified: ctx.userEmailVerified,
              requestId: ctx.requestId,
            })
          : undefined,
        transformRuntimeBundle: (input) => opts.runtimeEnvContributions && opts.runtimeEnvContributions.length > 0
          ? withRuntimeEnvContributions(input, {
              workspaceId,
              workspaceRoot: root,
              runtimeMode: resolvedMode,
              runtimeBundle: input,
            }, opts.runtimeEnvContributions, opts.telemetry)
          : input,
        additionalStandardTools: externalPluginsEnabled ? [createPluginDiagnosticsTool({
          getLastReloadDiagnostics: () => binding?.lastReloadDiagnostics ?? [],
          getHarness: () => binding?.harness,
          ...(opts.getPluginDiagnostics
            ? { getPluginErrors: () => opts.getPluginDiagnostics!({ workspaceId, workspaceRoot: root }) }
            : {}),
        })] : [],
        resolveExtraTools: async (bundle) => {
          pluginTools = []
          if (externalPluginsEnabled && modeAdapter.workspaceFsCapability === 'strong') {
            const pluginResult = await loadPlugins({ cwd: root })
            for (const error of pluginResult.errors) {
              app.log.warn(`[plugin] failed to load ${error.source}: ${error.error}`)
            }
            pluginTools = pluginResult.plugins.map((plugin) => ({
              pluginName: pluginNameFromPath(plugin.path),
              tools: plugin.tools,
            }))
          }
          return opts.getExtraTools
            ? await opts.getExtraTools({
                workspaceId,
                workspaceRoot: root,
                runtimeMode: resolvedMode,
                workspaceFsCapability: bundle.workspace.fsCapability,
                authSubject: trustedCtx?.userId ?? getRequestAuthSubject(request),
              })
            : []
        },
        finalizeTools: ({ standardTools, extraTools }) => mergeTools({
          standardTools,
          extraTools,
          pluginTools,
          logger: app.log,
          checkReadiness,
        }),
      },
    }
    const authorizedScope = issueScope({
      workspaceScopeId: workspaceId,
      authSubjectId: trustedCtx?.userId ?? getRequestAuthSubject(request) ?? 'legacy',
    }, hostScope)
    const composition = await agentHost.resolveComposition(defaultAgentTypeId, authorizedScope)
    runtimeBundle = composition.runtimeBundle
    const tools = [...composition.tools]
    const harness = composition.harness
    readyTracker.markHarnessReady()

    binding = {
      runtimeBundle,
      workspaceRoot: root,
      runtimeProvisioning,
      runtimeDependencies,
      runtimeProvisioningTask: undefined,
      assertActive: () => {
        if (retired) throw createAgentBindingDisposedError(workspaceId)
      },
      retire: () => {
        retirePromise ??= (async () => {
          retired = true
          provisioningAbort.abort()
          provisioningGeneration += 1
          const task = binding?.runtimeProvisioningTask
          if (binding) binding.runtimeProvisioningTask = undefined
          await drainRuntimeProvisioning(task)
        })()
        return retirePromise
      },
      reprovision: async (reloadRequest?: FastifyRequest) => {
        const result = await startRuntimeProvisioning(reloadRequest)
        return await result
      },
      agent: {
        ...composition.agent,
        dispose: () => composition.retire(),
      },
      harness,
      tools,
      readyTracker,
      piChatService: composition.service,
      trustedPiChatService: agentHost.createPiChatService({
        service: composition.service,
        scope: authorizedScope,
        agentTypeId: defaultAgentTypeId,
      }),
      authorizedScope,
      hostScope,
    }
    startRuntimeProvisioning(request)
    return binding
  }

  async function getOrCreateRuntimeBinding(
    workspaceId: string,
    request?: FastifyRequest,
    options: { failIfPending?: boolean; trustedCtx?: WorkspaceAgentDispatcherContext } = {},
  ): Promise<RuntimeBinding> {
    while (true) {
      const binding = await resolveRuntimeBinding(workspaceId, request, options)
      if (!requestScopedRuntime || !request) return binding
      if (!bindingLifecycle.tracksRequestLifetime(request)) return binding
      if (bindingLifecycle.leaseRequestBinding(request, binding)) return binding
    }
  }

  async function resolveRuntimeBinding(
    workspaceId: string,
    request?: FastifyRequest,
    options: { failIfPending?: boolean; trustedCtx?: WorkspaceAgentDispatcherContext } = {},
  ): Promise<RuntimeBinding> {
    bindingLifecycle.assertAdmission(workspaceId, request)
    const scope = await getRuntimeScope(workspaceId, request, options.trustedCtx)
    bindingLifecycle.assertAdmission(workspaceId, request)
    const existing = bindingLifecycle.getEntry(scope.key)
    if (existing) {
      if (bindingLifecycle.requestLeasesEntry(request, existing)) return await existing.promise
      if (existing.state === 'retiring') {
        await existing.retirementPromise
        return getOrCreateRuntimeBinding(workspaceId, request, options)
      }
      bindingLifecycle.touchEntry(scope.key, existing)
      if (options.failIfPending && existing.state === 'pending') {
        throw createAgentRuntimeNotReadyError(workspaceId)
      }
      if (existing.state === 'failed') {
        const failure = createRuntimeProvisioningFailedError(workspaceId, existing.error)
        try {
          await bindingLifecycle.retire(scope.key, existing)
        } catch {
          // The cached creation error remains the actionable failure.
        }
        if (options.failIfPending) throw failure
      } else {
        return await ensureRuntimeBindingReady(
          workspaceId,
          scope,
          existing,
          await existing.promise,
          request,
          options.trustedCtx,
        )
      }
    }

    const admitted = await bindingLifecycle.admit({
      key: scope.key,
      workspaceId,
      request,
      create: () => createRuntimeBinding(workspaceId, scope, request, options.trustedCtx),
    })
    if (!admitted.created) return getOrCreateRuntimeBinding(workspaceId, request, options)
    const created = admitted.entry
    if (options.failIfPending) {
      throw createAgentRuntimeNotReadyError(workspaceId)
    }
    try {
      return await ensureRuntimeBindingReady(
        workspaceId,
        scope,
        created,
        await created.promise,
        request,
        options.trustedCtx,
      )
    } catch (error) {
      try {
        await bindingLifecycle.retire(scope.key, created)
      } catch {
        // Binding creation failure remains the actionable error.
      }
      throw error
    }
  }

  async function recreateRuntimeBinding(
    workspaceId: string,
    scope: RuntimeScope,
    staleEntry: RuntimeBindingEntry,
    request?: FastifyRequest,
    trustedCtx?: WorkspaceAgentDispatcherContext,
  ): Promise<RuntimeBinding> {
    if (!bindingLifecycle.isCurrentEntry(scope.key, staleEntry)) {
      return await getOrCreateRuntimeBinding(workspaceId, request, { trustedCtx })
    }
    await bindingLifecycle.retire(scope.key, staleEntry)
    return await getOrCreateRuntimeBinding(workspaceId, request, { trustedCtx })
  }

  async function ensureRuntimeBindingReady(
    workspaceId: string,
    scope: RuntimeScope,
    entry: RuntimeBindingEntry,
    binding: RuntimeBinding,
    request?: FastifyRequest,
    trustedCtx?: WorkspaceAgentDispatcherContext,
  ): Promise<RuntimeBinding> {
    if (entry.retirementPromise !== undefined || !bindingLifecycle.isCurrentEntry(scope.key, entry)) {
      await entry.retirementPromise
      return getOrCreateRuntimeBinding(workspaceId, request, { trustedCtx })
    }
    const healthCheck = modeAdapter.cachedBindingHealthCheck
    if (!healthCheck) return binding

    const now = Date.now()
    const intervalMs = healthCheck.intervalMs ?? 15_000
    if (
      binding.lastHealthCheckMs !== undefined &&
      now - binding.lastHealthCheckMs < intervalMs
    ) {
      return binding
    }

    const releaseHealthLease = bindingLifecycle.tryLeaseEntryOperation(entry)
    if (!releaseHealthLease) {
      await entry.retirementPromise
      return getOrCreateRuntimeBinding(workspaceId, request, { trustedCtx })
    }
    let result: Awaited<ReturnType<typeof healthCheck.check>>
    try {
      result = await healthCheck.check({ runtimeBundle: binding.runtimeBundle, workspaceId })
    } finally {
      releaseHealthLease()
    }
    if (entry.state === 'retiring' || !bindingLifecycle.isCurrentEntry(scope.key, entry)) {
      await entry.retirementPromise
      return getOrCreateRuntimeBinding(workspaceId, request, { trustedCtx })
    }
    if (result.state === 'ok') {
      binding.lastHealthCheckMs = now
      return binding
    }

    app.log.warn({
      err: result.error,
      workspaceId,
    }, result.message ?? '[runtime] cached runtime invalid; recreating')

    return await recreateRuntimeBinding(workspaceId, scope, entry, request, trustedCtx)
  }

  const hasRuntimeProvisioningInput = opts.provisionWorkspace !== false && Boolean(opts.provisionRuntime)
  const staticBinding = requestScopedRuntime
    ? null
    : await getOrCreateRuntimeBinding(sessionId)
  const skillsScopeByRequest = new WeakMap<FastifyRequest, Promise<SkillScope>>()

  async function acquireDispatcherOperation(
    initialBinding: RuntimeBinding,
    boundCtx: WorkspaceAgentDispatcherContext,
    request?: FastifyRequest,
  ): Promise<{ binding: RuntimeBinding; dispatcher: WorkspaceAgentDispatcher; release: () => void }> {
    let binding = initialBinding
    while (true) {
      bindingLifecycle.assertAdmission(boundCtx.workspaceId, request)
      const release = bindingLifecycle.tryLeaseOperation(binding)
      if (release) {
        try {
          bindingLifecycle.assertAdmission(boundCtx.workspaceId, request)
        } catch (error) {
          release()
          throw error
        }
        return {
          binding,
          dispatcher: createBoundWorkspaceAgentDispatcher({
            gateway: agentHost.gateway,
            scope: binding.authorizedScope,
            agentTypeId: defaultAgentTypeId,
          }, boundCtx),
          release,
        }
      }
      if (staticBinding) throw createAgentBindingDisposedError(boundCtx.workspaceId)
      binding = await getOrCreateRuntimeBinding(boundCtx.workspaceId, undefined, { trustedCtx: boundCtx })
    }
  }

  async function ensureTrustedPiSessionBound(
    initialBinding: RuntimeBinding,
    boundCtx: WorkspaceAgentDispatcherContext,
    boundSessionId: string,
    request?: FastifyRequest,
    requestedSessionCtx?: { workspaceId?: string; userId?: string },
  ) {
    return await bindTrustedPiSession({
      ctx: boundCtx,
      request,
      sessionId: boundSessionId,
      requested: requestedSessionCtx,
      withServices: async (effect) => {
        const operation = await acquireDispatcherOperation(initialBinding, boundCtx, request)
        try {
          return await effect({
            binding: operation.binding.piChatService,
            prompt: operation.binding.trustedPiChatService,
          })
        } finally {
          operation.release()
        }
      },
    })
  }

  function createLeasedWorkspaceAgentDispatcher(
    initialBinding: RuntimeBinding,
    boundCtx: WorkspaceAgentDispatcherContext,
    request?: FastifyRequest,
  ): WorkspaceAgentDispatcher {
    return {
      async dispatch(input) {
        const operation = await acquireDispatcherOperation(initialBinding, boundCtx, request)
        try {
          if (!operation.dispatcher.dispatch) {
            throw createWorkspaceAgentDispatcherError(
              ErrorCode.enum.AGENT_BINDING_DISPOSED,
              'workspace agent dispatcher does not support addressed dispatch',
              500,
            )
          }
          const dispatched = await operation.dispatcher.dispatch(input)
          return {
            ...dispatched,
            events: {
              async *[Symbol.asyncIterator]() {
                try {
                  yield* dispatched.events
                } finally {
                  operation.release()
                }
              },
            },
          }
        } catch (error) {
          operation.release()
          throw error
        }
      },
      send(input) {
        return {
          async *[Symbol.asyncIterator]() {
            const operation = await acquireDispatcherOperation(initialBinding, boundCtx, request)
            try {
              yield* operation.dispatcher.send(input)
            } finally {
              operation.release()
            }
          },
        }
      },
      async interrupt(sessionId) {
        const operation = await acquireDispatcherOperation(initialBinding, boundCtx, request)
        try {
          return await operation.dispatcher.interrupt(sessionId)
        } finally {
          operation.release()
        }
      },
      async stop(sessionId) {
        const operation = await acquireDispatcherOperation(initialBinding, boundCtx, request)
        try {
          return await operation.dispatcher.stop(sessionId)
        } finally {
          operation.release()
        }
      },
    }
  }

  opts.onWorkspaceAgentDispatcher?.({
    async resolve(ctx, options) {
      return (await this.resolveWithWorkspace!(ctx, options)).dispatcher
    },
    async resolveWithWorkspace(ctx, options) {
      const boundCtx = normalizeWorkspaceAgentDispatcherContext(ctx)
      assertWorkspaceAgentDispatcherRequestContext(boundCtx, options?.request)
      bindingLifecycle.assertAdmission(boundCtx.workspaceId, options?.request)
      if (staticBinding) {
        if (boundCtx.workspaceId !== sessionId) {
          throw createWorkspaceAgentDispatcherError(
            ErrorCode.enum.UNAUTHORIZED,
            'workspace agent dispatcher context does not match bound workspace',
            401,
          )
        }
        return {
          dispatcher: createLeasedWorkspaceAgentDispatcher(staticBinding, boundCtx, options?.request),
          workspace: staticBinding.runtimeBundle.workspace,
          ensurePiSessionBound: async (boundSessionId, requestedSessionCtx) => await ensureTrustedPiSessionBound(
            staticBinding,
            boundCtx,
            boundSessionId,
            options?.request,
            requestedSessionCtx,
          ),
        }
      }
      const binding = await getOrCreateRuntimeBinding(boundCtx.workspaceId, options?.request, { trustedCtx: boundCtx })
      bindingLifecycle.assertAdmission(boundCtx.workspaceId, options?.request)
      return {
        dispatcher: createLeasedWorkspaceAgentDispatcher(binding, boundCtx, options?.request),
        workspace: binding.runtimeBundle.workspace,
        ensurePiSessionBound: async (boundSessionId, requestedSessionCtx) => await ensureTrustedPiSessionBound(
          binding,
          boundCtx,
          boundSessionId,
          options?.request,
          requestedSessionCtx,
        ),
      }
    },
  })

  function getSkillsScopeForRequest(request: FastifyRequest): Promise<SkillScope> {
    let promise = skillsScopeByRequest.get(request)
    if (!promise) {
      promise = resolveSkillScope(getRequestWorkspaceId(request), request)
      skillsScopeByRequest.set(request, promise)
    }
    return promise
  }

  async function getBindingForRequest(
    request: FastifyRequest,
    options: { failIfPending?: boolean } = {},
  ): Promise<RuntimeBinding> {
    if (staticBinding) return staticBinding
    return await getOrCreateRuntimeBinding(getRequestWorkspaceId(request), request, options)
  }

  async function getFilesystemBindingsForRequest(request: FastifyRequest): Promise<RuntimeFilesystemBinding[] | undefined> {
    const binding = await getBindingForRequest(request)
    if (!opts.getFilesystemBindings) return binding.runtimeBundle.filesystemBindings
    const user = (request as FastifyRequest & { user?: { id: string; email: string; emailVerified?: boolean } | null }).user
    return await opts.getFilesystemBindings({
      request,
      workspaceId: getRequestWorkspaceId(request),
      workspaceRoot: binding.workspaceRoot,
      userId: user?.id,
      userEmail: user?.email,
      userEmailVerified: user?.emailVerified === true,
      requestId: request.id,
    })
  }

  const agentToolNames = staticBinding
    ? staticBinding.tools.map((tool) => tool.name)
    : [
        ...(opts.disableDefaultFileTools ? STANDARD_AGENT_TOOL_NAMES.slice(0, 1) : STANDARD_AGENT_TOOL_NAMES),
        ...(opts.extraTools ?? []).map((tool) => tool.name),
      ]

  await mountOrderedAgentHostLegacyRoutes({
    app,
    opts,
    runtime: agentHost,
    defaultAgentTypeId,
    sessionId,
    workspaceRoot,
    resolvedMode,
    runtimeHost,
    requestScopedRuntime,
    modelsWorkspaceScoped,
    staticBinding,
    hasRuntimeProvisioningInput,
    sessionChangesTracker,
    agentToolNames,
    getAvailableModelProviders,
    getRequestWorkspaceId,
    getRequestAuthSubject,
    promoteRawFileWorkspaceQueryToHeader,
    isWorkspaceAgnosticAgentRequest,
    getBindingForRequest,
    getFilesystemBindingsForRequest,
    getSkillsScopeForRequest,
    issueScope,
    deferLeaseRelease: bindingLifecycle.deferRequestUntilTransportClose,
  })
}
