import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { basename } from 'node:path'
import {
  buildFilesystemAgentTools,
  buildHarnessAgentTools,
  buildUploadAgentTools,
  type ToolReadinessState,
} from '@hachej/boring-bash/agent'
import {
  fileRoutes,
  fsEventsRoutes,
  gitRoutes,
  searchRoutes,
  treeRoutes,
} from '@hachej/boring-bash/server'
import type { AgentTool, ToolReadinessRequirement } from '../shared/tool'
import type { AgentCoreHarnessFactory, AgentHarness, AgentHarnessFactory } from '../shared/harness'
import type { Agent } from '../shared/events'
import type { TelemetrySink } from '../shared/telemetry'
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'
import { getEnv } from './config/env'
import {
  getOptionalRuntimeBundleStorageRoot,
  type RuntimeBundle,
  type RuntimeFilesystemBinding,
  type RuntimeModeAdapter,
  type RuntimeModeId,
} from './runtime/mode'
import type { BoringAgentRuntimePaths } from '@hachej/boring-sandbox/providers/node-workspace'
import type { AgentRuntimeHostOperations } from './runtime/runtimeHost'
import type { WorkspaceProvisioningAdapter, WorkspaceProvisioningResult } from './workspace/provisioning'
import type { Workspace } from '../shared/workspace'
import { ErrorCode } from '../shared/error-codes'
import { collectToolReadinessRequirements, createAgentReadinessFromTracker } from './agentReadiness'
import { resolveMode, autoDetectMode } from './runtime/resolveMode'
import { createPiCodingAgentHarness, withPiHarnessDefaults } from './harness/pi-coding-agent/createHarness'
import type { PiHarnessOptions, ResolvedPiHarnessOptions } from './harness/pi-coding-agent/createHarness'
import { loadPlugins } from './harness/pi-coding-agent/pluginLoader'
import { registerConfiguredModelProviders } from './models/modelConfig'
import { mergeTools, type PluginToolRegistration } from './catalog/mergeTools'
import { healthRoutes } from './http/routes/health'
import { modelsRoutes, type ModelsRoutesOptions } from './http/routes/models'
import { skillsRoutes } from './http/routes/skills'
import { piChatRoutes } from './http/routes/piChat'
import { AgentEffectAdmissionError, type AgentEffectAdmission, type PiChatSessionService } from '../core/piChatSessionService'
import { systemPromptRoutes } from './http/routes/systemPrompt'
import { sessionChangesRoutes } from './http/routes/sessionChanges'
import { catalogRoutes } from './http/routes/catalog'
import { readyStatusRoutes } from './http/routes/readyStatus'
import { commandsRoutes } from './http/routes/commands'
import type { ReloadHookResult } from './http/routes/reload'
import { deepLinkRoutes } from './http/routes/deepLink'
import type { ShareEntryStore } from '../shared/share-entry'
import { InMemorySessionChangesTracker } from './http/sessionChangesTracker'
import { ReadyStatusTracker } from './runtime/readyStatus'
import { createRuntimeReadyStatusTracker } from './runtime/modeReadiness'
import { withRuntimeEnvContributions, type RuntimeEnvContribution } from './runtimeEnvContributions'
import type { AgentMeteringSink } from './pi-chat/metering'
import { createPluginDiagnosticsTool } from './tools/pluginDiagnostics'
import { createCompositionRuntimeBridge } from './agent-host/buildAgentComposition'
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
import type { WorkspaceAgentDispatcher, WorkspaceAgentDispatcherContext } from '../shared/workspaceAgentDispatcher'
import {
  createRuntimeBindingLifecycle,
  type RuntimeBindingEntry as ManagedRuntimeBindingEntry,
} from './runtime/runtimeBindingLifecycle'

const DEFAULT_VERSION = '0.1.0-dev'
const DEFAULT_WORKSPACE_ID = 'default'
const STANDARD_AGENT_TOOL_NAMES = ['bash', 'read', 'write', 'edit', 'find', 'grep', 'ls']

type AgentCapabilities = {
  agent: {
    runtimeMode: RuntimeModeId
    tools: string[]
    modelProviders: string[]
  }
}

type HostWithCapabilitiesContributor = FastifyInstance & {
  registerCapabilitiesContributor?: (
    name: string,
    fn: (ctx: { config: unknown }) => AgentCapabilities | Promise<AgentCapabilities>,
  ) => void
}

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

function registerAgentCapabilitiesContributor(
  app: FastifyInstance,
  profile: AgentRouteBindingProfile,
): void {
  const host = app as HostWithCapabilitiesContributor
  if (typeof host.registerCapabilitiesContributor !== 'function') return
  host.registerCapabilitiesContributor(
    'agent',
    () => ({
      agent: {
        runtimeMode: profile.runtimeMode,
        tools: profile.capabilities.tools,
        modelProviders: getAvailableModelProviders(),
      },
    }),
  )
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
  piChatService: PiChatSessionService
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

export interface RegisterAgentRoutesOptions {
  workspaceRoot?: string
  sessionId?: string
  templatePath?: string
  getTemplatePath?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    request?: FastifyRequest
  }) => string | undefined | Promise<string | undefined>
  mode?: RuntimeModeId
  /** Supply a custom runtime adapter to plug in non-built-in sandbox/workspace modes. */
  runtimeModeAdapter?: RuntimeModeAdapter
  /** Provider/runtime values supplied by the embedding host. */
  runtimeHost?: AgentRuntimeHostOperations
  version?: string
  extraTools?: AgentTool[]
  getExtraTools?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    runtimeMode: RuntimeModeId
    workspaceFsCapability?: Workspace['fsCapability']
    authSubject?: string
  }) => AgentTool[] | Promise<AgentTool[]>
  systemPromptAppend?: string
  /** Optional dynamic system-prompt source forwarded to the harness. */
  systemPromptDynamic?: () => string | undefined | Promise<string | undefined>
  getSystemPromptDynamic?: (ctx: {
    workspaceId: string
    workspaceRoot: string
  }) => string | undefined | Promise<string | undefined>
  /** Immutable host contribution captured once in the runtime binding scope. */
  getRuntimeScopeContribution?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    request?: FastifyRequest
  }) => Readonly<{ identity: string; loadSystemPromptAppend?: () => Promise<string | undefined> }>
    | Promise<Readonly<{ identity: string; loadSystemPromptAppend?: () => Promise<string | undefined> }>>
  /** Override the default pi-backed harness with a custom agent runtime. */
  harnessFactory?: AgentHarnessFactory
  /** Optional pi adapter/runtime knobs used by the default harness. */
  pi?: PiHarnessOptions
  getPi?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    request?: FastifyRequest
  }) => PiHarnessOptions | undefined | Promise<PiHarnessOptions | undefined>
  sessionNamespace?: string
  /** Optional explicit root for file-backed Pi chat transcript storage. */
  sessionRoot?: string
  /** Optional best-effort telemetry sink supplied by an embedding host. */
  telemetry?: TelemetrySink
  /** Optional host admission called immediately before each agent effect. */
  admitEffect?: AgentEffectAdmission
  /** Generic request-aware model filtering seam. Hosts may filter per user/workspace. */
  filterModels?: ModelsRoutesOptions['filterModels']
  /** Generic per-request/per-run filesystem binding seam. Hosts may return user/session-filtered bindings. */
  getFilesystemBindings?: (ctx: {
    request?: FastifyRequest
    workspaceId: string
    workspaceRoot: string
    sessionId?: string
    userId?: string
    userEmail?: string
    userEmailVerified?: boolean
    requestId?: string
  }) => RuntimeFilesystemBinding[] | undefined | Promise<RuntimeFilesystemBinding[] | undefined>
  /**
   * Optional billing sink for native Pi usage. Reserve happens before
   * accepted prompt/follow-up execution (fail closed), usage is recorded from
   * native assistant message_end events, and runs settle/release from native
   * terminal lifecycle. See AgentMeteringSink.
   */
  metering?: AgentMeteringSink
  /**
   * Enable user/global Pi extension auto-discovery from .pi/ and ~/.pi.
   * App/internal plugins should be passed through extraTools/pi instead.
   * Defaults to true for standalone agent compatibility.
   */
  externalPlugins?: boolean
  getSessionNamespace?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    request?: FastifyRequest
    /** Verified actor id for trusted requestless dispatcher resolution. */
    userId?: string
  }) => string | undefined | Promise<string | undefined>
  registerHealthRoute?: boolean
  /**
   * Optional Lane W share-entry store (AR1-002/AR1-003, same-workspace
   * shareable links, `docs/issues/391/runtime-refactor/work/
   * AR1-shareable-artifacts/AR1-001-SPEC.md` §3). When supplied, mounts the
   * membership-gated `GET /a/:id` deep-link route. Omit to leave Lane W
   * entirely unmounted (no widening for hosts that don't use it yet).
   */
  shareEntryStore?: ShareEntryStore
  getWorkspaceId?: (request: FastifyRequest) => string | Promise<string>
  getWorkspaceRoot?: (workspaceId: string, request: FastifyRequest) => string | Promise<string>
  getTrustedWorkspaceRoot?: (ctx: WorkspaceAgentDispatcherContext) => string | Promise<string>
  /** Generic runtime env contributors. Agent stays workspace-neutral; hosts decide env names/values. */
  runtimeEnvContributions?: RuntimeEnvContribution[]
  /**
   * Optional runtime reconciliation hook. Callers own plugin discovery and may
   * call provisionWorkspaceRuntime() with the normalized structural inputs.
   * registerAgentRoutes only consumes the returned env/PATH/skill paths.
   */
  provisionRuntime?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    runtimeMode: RuntimeModeId
    runtimeLayout: BoringAgentRuntimePaths
    provisioningAdapter?: WorkspaceProvisioningAdapter
    request?: FastifyRequest
    /** Aborted when this binding retires; retirement still drains the task before provider disposal. */
    signal: AbortSignal
  }) => WorkspaceProvisioningResult | undefined | Promise<WorkspaceProvisioningResult | undefined>
  provisionWorkspace?: boolean
  /** Optional hook called before /api/v1/agent/reload reloads the harness. */
  beforeReload?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    request: FastifyRequest
  }) => void | ReloadHookResult | undefined | Promise<void | ReloadHookResult | undefined>
  /**
   * Optional host callback returning current plugin/skill load diagnostics
   * for a workspace. Surfaced by the `plugin_diagnostics` agent tool so the
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

/**
 * Fastify plugin that mounts agent routes onto a host app (typically core-built).
 *
 * Shape B counterpart to createAgentApp (Shape A). The host provides its own
 * Fastify instance, auth, and stores; this plugin only adds routes + runtime.
 * No auth middleware is registered — the host's authHook handles authentication.
 */
export const registerAgentRoutes: FastifyPluginAsync<RegisterAgentRoutesOptions> = async (app, opts) => {
  const sessionId = opts.sessionId ?? DEFAULT_WORKSPACE_ID
  const resolvedMode = opts.runtimeModeAdapter?.id ?? opts.mode ?? autoDetectMode()
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const templatePath = opts.templatePath ?? getEnv('BORING_AGENT_TEMPLATE_PATH')
  const modeAdapter = opts.runtimeModeAdapter ?? resolveMode(resolvedMode)
  const runtimeHost = opts.runtimeHost ?? modeAdapter.runtimeHost
  const bindingLifecycle = createRuntimeBindingLifecycle<RuntimeBinding>({
    app,
    capacity: 256,
    createDisposedError: createAgentBindingDisposedError,
    ...(modeAdapter.evictCachedRuntime
      ? { evictCachedRuntime: (ctx: { workspaceId: string }) => modeAdapter.evictCachedRuntime?.(ctx) }
      : {}),
  })
  app.addHook('preClose', async () => {
    bindingLifecycle.startDraining()
  })
  app.addHook('onClose', async () => {
    let firstError: unknown
    try {
      await bindingLifecycle.close()
    } catch (error) {
      firstError = error
    }
    try {
      await modeAdapter.dispose?.()
    } catch (error) {
      if (firstError === undefined) firstError = error
      else app.log.warn({ err: error }, '[agent] failed to close runtime provider after an earlier cleanup error')
    }
    if (firstError !== undefined) throw firstError
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
    return await opts.provisionRuntime({
      workspaceId,
      workspaceRoot: scope.root,
      runtimeMode: resolvedMode,
      runtimeLayout,
      provisioningAdapter: runtimeBundle?.provisioningAdapter,
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
    const modeCtx = {
      workspaceRoot: root,
      sessionId: workspaceId,
      workspaceId,
      templatePath: scope.templatePath,
      requestId: request?.id,
      telemetry: opts.telemetry,
    }
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

    let runtimeBundle = await modeAdapter.create(modeCtx)
    if (runtimeHost) runtimeBundle = { ...runtimeBundle, runtimeHost }
    try {
    if (opts.runtimeEnvContributions && opts.runtimeEnvContributions.length > 0) {
      runtimeBundle = withRuntimeEnvContributions(runtimeBundle, {
        workspaceId,
        workspaceRoot: root,
        runtimeMode: resolvedMode,
        runtimeBundle,
      }, opts.runtimeEnvContributions, opts.telemetry)
    }
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

    // UI tools (get_ui_state / exec_ui) and the /api/v1/ui/* routes moved
    // to @hachej/boring-workspace. Hosts that want them register uiRoutes
    // alongside this plugin.
    const bashRuntimeBundle = {
      ...runtimeBundle,
      storageRoot: getOptionalRuntimeBundleStorageRoot(runtimeBundle),
    }
    const standardTools = [
      ...buildHarnessAgentTools(bashRuntimeBundle, {
        getCurrent: () => runtimeProvisioning ? {
          env: runtimeProvisioning.env,
          pathEntries: runtimeProvisioning.pathEntries,
        } : undefined,
        getReadiness: () => checkReadiness('runtime:python', {} as AgentTool),
      }),
      ...buildFilesystemAgentTools(bashRuntimeBundle, {
        getFilesystemBindings: opts.getFilesystemBindings
          ? async (ctx) => opts.getFilesystemBindings?.({
              workspaceId,
              workspaceRoot: root,
              sessionId: ctx.sessionId,
              userId: ctx.userId,
              userEmail: ctx.userEmail,
              userEmailVerified: ctx.userEmailVerified,
              requestId: ctx.requestId,
            })
          : undefined,
      }),
      ...buildUploadAgentTools(bashRuntimeBundle),
      ...(externalPluginsEnabled ? [createPluginDiagnosticsTool({
        // `binding` is assigned later in this function; read through thunks.
        getLastReloadDiagnostics: () => binding?.lastReloadDiagnostics ?? [],
        getHarness: () => binding?.harness,
        ...(opts.getPluginDiagnostics
          ? {
              getPluginErrors: () =>
                opts.getPluginDiagnostics!({ workspaceId, workspaceRoot: root }),
            }
          : {}),
      })] : []),
    ]
    const pluginTools: PluginToolRegistration[] = []

    if (externalPluginsEnabled && modeAdapter.workspaceFsCapability === 'strong') {
      const pluginResult = await loadPlugins({ cwd: root })
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

    const scopedExtraTools = opts.getExtraTools
      ? await opts.getExtraTools({
          workspaceId,
          workspaceRoot: root,
          runtimeMode: resolvedMode,
          workspaceFsCapability: runtimeBundle.workspace.fsCapability,
          authSubject: trustedCtx?.userId ?? getRequestAuthSubject(request),
        })
      : []
    const tools = mergeTools({
      standardTools,
      extraTools: [
        ...(opts.extraTools ?? []),
        ...scopedExtraTools,
      ],
      pluginTools,
      logger: app.log,
      checkReadiness,
    })
    const baseHarnessFactory = opts.harnessFactory ?? ((input) => createPiCodingAgentHarness({
      ...input,
      pi: {
        // scope.pi is already defaulted at the resolveScopePi chokepoint.
        ...scope.pi,
        additionalSkillPaths: [
          ...(scope.pi.additionalSkillPaths ?? []),
        ],
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
      },
    }))
    const systemPromptDynamic = opts.getSystemPromptDynamic
      ? () => opts.getSystemPromptDynamic?.({ workspaceId, workspaceRoot: root })
      : opts.systemPromptDynamic
    const harnessFactory = ((input) => baseHarnessFactory({
      ...input,
      sessionNamespace: scope.sessionNamespace,
      sessionRoot: opts.sessionRoot,
    })) as AgentCoreHarnessFactory
    const { bridge: coreAgent, runtime: agentRuntime } = await createCompositionRuntimeBridge({
      runtime: modeAdapter,
      tools,
      readiness: createAgentReadinessFromTracker({
        requirements: collectToolReadinessRequirements(tools),
        tracker: readyTracker,
        checkReadiness,
      }),
      harnessFactory,
      systemPromptAppend: [opts.systemPromptAppend, scopedSystemPromptAppend].filter(Boolean).join('\n\n') || undefined,
      systemPromptDynamic,
      telemetry: opts.telemetry,
      metering: opts.metering,
      sessionStorageRoot: opts.sessionRoot,
      workdir: root,
    }, {
      service: {
        admitEffect: opts.admitEffect,
        workdir: runtimeBundle.workspace.root,
        workspace: runtimeBundle.workspace,
      },
    })
    const harness = agentRuntime.harness
    readyTracker.markHarnessReady()

    binding = {
      runtimeBundle,
      disposeRuntime: runtimeBundle.disposeRuntime,
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
      agent: coreAgent.agent,
      harness,
      tools,
      readyTracker,
      piChatService: agentRuntime.service as PiChatSessionService,
    }
    startRuntimeProvisioning(request)
    return binding
    } catch (error) {
      try {
        await runtimeBundle.disposeRuntime?.()
      } catch {
        // Runtime binding initialization failure remains the actionable error.
      }
      throw error
    }
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
  ): Promise<{ dispatcher: WorkspaceAgentDispatcher; release: () => void }> {
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
          dispatcher: createBoundWorkspaceAgentDispatcher(binding.agent, boundCtx),
          release,
        }
      }
      if (staticBinding) throw createAgentBindingDisposedError(boundCtx.workspaceId)
      binding = await getOrCreateRuntimeBinding(boundCtx.workspaceId, undefined, { trustedCtx: boundCtx })
    }
  }

  function createLeasedWorkspaceAgentDispatcher(
    initialBinding: RuntimeBinding,
    boundCtx: WorkspaceAgentDispatcherContext,
    request?: FastifyRequest,
  ): WorkspaceAgentDispatcher {
    return {
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
        }
      }
      const binding = await getOrCreateRuntimeBinding(boundCtx.workspaceId, options?.request, { trustedCtx: boundCtx })
      bindingLifecycle.assertAdmission(boundCtx.workspaceId, options?.request)
      return {
        dispatcher: createLeasedWorkspaceAgentDispatcher(binding, boundCtx, options?.request),
        workspace: binding.runtimeBundle.workspace,
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
        ...STANDARD_AGENT_TOOL_NAMES,
        ...(opts.extraTools ?? []).map((tool) => tool.name),
      ]

  const hostWithCapabilitiesContributor = app as HostWithCapabilitiesContributor
  if (
    typeof hostWithCapabilitiesContributor.registerCapabilitiesContributor ===
    'function'
  ) {
    hostWithCapabilitiesContributor.registerCapabilitiesContributor(
      'agent',
      () => ({
        agent: {
          runtimeMode: resolvedMode,
          tools: agentToolNames,
          modelProviders: getAvailableModelProviders(),
        },
      }),
    )
  }

  // Bridge host app's request.user → agent's request.workspaceContext.
  // In embedded mode core's authHook already populates request.user;
  // this hook maps it to the shape agent routes expect. Scoped to agent
  // routes only (Fastify encapsulates hooks within the plugin).
  app.addHook('onRequest', async (request, reply) => {
    const user = (request as unknown as { user?: { id: string } | null }).user
    let workspaceId = DEFAULT_WORKSPACE_ID
    promoteRawFileWorkspaceQueryToHeader(request)
    if (opts.getWorkspaceId && !isWorkspaceAgnosticAgentRequest(request, { readyStatusWorkspaceScoped: requestScopedRuntime, modelsWorkspaceScoped })) {
      try {
        workspaceId = (await opts.getWorkspaceId(request)).trim()
      } catch (error) {
        if (
          typeof error === 'object'
          && error !== null
          && 'status' in error
          && error.status === 421
          && 'code' in error
          && error.code === ErrorCode.enum.AGENT_HOST_SCOPE_VIOLATION
        ) {
          throw error
        }
        const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
          ? (error as { statusCode: number }).statusCode
          : 400
        const message = statusCode >= 500
          ? 'workspace scope failed'
          : error instanceof Error
            ? error.message
            : 'workspace id is required'
        return reply.code(statusCode).send({
          error: { code: ErrorCode.enum.WORKSPACE_UNINITIALIZED, message },
        })
      }
      if (workspaceId.length === 0) {
        return reply.code(400).send({
          error: {
            code: ErrorCode.enum.WORKSPACE_UNINITIALIZED,
            message: 'workspace id is required',
          },
        })
      }
    }
    request.workspaceContext = {
      workspaceId,
      authenticated: !!user,
    }
  })

  const registerHealthRoute = opts.registerHealthRoute ?? true
  if (registerHealthRoute) {
    await app.register(healthRoutes, {
      version: opts.version ?? DEFAULT_VERSION,
      getReadiness: () => staticBinding?.readyTracker.getReadiness() ?? {
        sandboxReady: true,
        harnessReady: true,
      },
    })
  }

  await app.register(fileRoutes, {
    getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
    getFilesystemBindings: getFilesystemBindingsForRequest,
  })
  await app.register(fsEventsRoutes, {
    getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
    deferLeaseRelease: bindingLifecycle.deferRequestUntilTransportClose,
  })
  await app.register(treeRoutes, {
    getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
    getFilesystemBindings: getFilesystemBindingsForRequest,
  })
  await app.register(searchRoutes, {
    getFileSearch: async (request) => (await getBindingForRequest(request)).runtimeBundle.fileSearch,
  })
  if (opts.shareEntryStore) {
    await app.register(deepLinkRoutes, {
      store: opts.shareEntryStore,
      getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
    })
  }
  await app.register(gitRoutes, {
    getWorkspace: async (request) => {
      const runtimeBundle = (await getBindingForRequest(request)).runtimeBundle
      const storageRoot = getOptionalRuntimeBundleStorageRoot(runtimeBundle)
      return storageRoot === undefined
        ? runtimeBundle.workspace
        : runtimeHost?.createNodeWorkspace(storageRoot) ?? runtimeBundle.workspace
    },
    getWorkspaceHostRoot: runtimeHost?.getNodeWorkspaceHostRoot,
  })
  await app.register(piChatRoutes, {
    getService: async (request) => {
      const binding = await getBindingForRequest(request)
      return binding.piChatService
    },
    deferLeaseRelease: bindingLifecycle.deferRequestUntilTransportClose,
  })
  await app.register(systemPromptRoutes, {
    getHarness: async (request) => (await getBindingForRequest(request)).harness,
  })
  await app.register(modelsRoutes, {
    filterModels: opts.filterModels,
  })
  await app.register(skillsRoutes, {
    workspace: staticBinding
      ? runtimeHost?.createNodeWorkspace(workspaceRoot) ?? staticBinding.runtimeBundle.workspace
      : undefined,
    additionalSkillPaths: [
      ...(staticBinding?.runtimeProvisioning?.skillPaths ?? []),
      ...(opts.pi?.additionalSkillPaths ?? []),
    ],
    piPackages: opts.pi?.packages,
    // Undefined is fine: skillsRoutes resolves it through the canonical
    // harness policy (withPiHarnessDefaults), same as the factory above.
    noSkills: opts.pi?.noSkills,
    getWorkspace: staticBinding
      ? undefined
      : async (request) => {
          const scope = await getSkillsScopeForRequest(request)
          if (runtimeHost) return runtimeHost.createNodeWorkspace(scope.root)
          return (await getBindingForRequest(request)).runtimeBundle.workspace
        },
    getAdditionalSkillPaths: staticBinding && !hasRuntimeProvisioningInput
      ? undefined
      : async (request) => {
          const scope = await getSkillsScopeForRequest(request)
          if (!hasRuntimeProvisioningInput) return scope.pi.additionalSkillPaths
          const binding = await getBindingForRequest(request)
          return [
            ...(binding.runtimeProvisioning?.skillPaths ?? []),
            ...(scope.pi.additionalSkillPaths ?? []),
          ]
        },
    getPiPackages: staticBinding
      ? undefined
      : async (request) => (await getSkillsScopeForRequest(request)).pi.packages,
    getNoSkills: staticBinding
      ? undefined
      : async (request) => (await getSkillsScopeForRequest(request)).pi.noSkills,
  })
  await app.register(sessionChangesRoutes, { tracker: sessionChangesTracker })
  app.post<{ Body: { sessionId?: string } }>('/api/v1/agent/reload', async (request, reply) => {
    const workspaceId = getRequestWorkspaceId(request)
    const binding = await getBindingForRequest(request)
    if (!binding.harness.reloadSession) {
      return reply.status(501).send({ ok: false, error: 'Agent harness does not support reload' })
    }

    try {
      await opts.admitEffect?.({ workspaceId, requestId: request.id })
      await binding.reprovision(request)
      binding.assertActive()
      const hookResult = await opts.beforeReload?.({
        workspaceId,
        workspaceRoot: binding.workspaceRoot,
        request,
      })
      binding.assertActive()
      const reloadSessionId = request.body?.sessionId || sessionId
      const reloaded = await binding.harness.reloadSession(reloadSessionId)
      binding.assertActive()
      const restart_warnings = hookResult?.restart_warnings
      const diagnostics: Array<{ source: string; message: string; pluginId?: string }> = [
        ...(hookResult?.diagnostics ?? []),
        ...(binding.harness.getResourceDiagnostics?.(reloadSessionId) ?? []).map((d) => ({
          source: d.source,
          // The harness already folds the path into the message (front only
          // renders `.message`).
          message: d.message,
        })),
      ]
      // If the harness reported nothing reloaded (no live agent session yet),
      // surface a note so a "/reload had no effect" state is observable rather
      // than looking like a clean reload.
      if (!reloaded) {
        diagnostics.push({
          source: 'reload',
          message: 'No live agent session to reload yet — changes apply to the next session.',
        })
      }
      binding.lastReloadDiagnostics = diagnostics
      return {
        ok: true,
        sessionId: reloadSessionId,
        reloaded,
        ...(restart_warnings && restart_warnings.length > 0 ? { restart_warnings } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof AgentEffectAdmissionError) {
        return reply.status(error.statusCode).send({ ok: false, error: { code: error.code, message } })
      }
      return reply.status(422).send({ ok: false, error: message })
    }
  })
  await app.register(catalogRoutes, staticBinding
    ? { tools: staticBinding.tools }
    : { getTools: async (request) => (await getBindingForRequest(request)).tools },
  )
  await app.register(commandsRoutes, staticBinding
    ? {
        harness: staticBinding.harness,
        defaultSessionId: sessionId,
        workdir: staticBinding.runtimeBundle.workspace.root,
        metering: opts.metering,
        admitEffect: opts.admitEffect,
      }
    : {
        defaultSessionId: sessionId,
        getHarness: async (request) => (await getBindingForRequest(request)).harness,
        getWorkdir: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace.root,
        metering: opts.metering,
        admitEffect: opts.admitEffect,
      },
  )
  await app.register(readyStatusRoutes, staticBinding
    ? { tracker: staticBinding.readyTracker, deferLeaseRelease: bindingLifecycle.deferRequestUntilTransportClose }
    : {
        getTracker: async (request) => (await getBindingForRequest(request)).readyTracker,
        deferLeaseRelease: bindingLifecycle.deferRequestUntilTransportClose,
      },
  )
}
