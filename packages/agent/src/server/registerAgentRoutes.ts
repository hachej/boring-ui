import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { basename } from 'node:path'
import type { AgentTool } from '../shared/tool'
import type { AgentHarnessFactory } from '../shared/harness'
import type { SessionStore } from '../shared/session'
import type { SandboxHandleStore } from '../shared/sandbox-handle-store'
import type { TelemetrySink } from '../shared/telemetry'
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'
import { getEnv } from './config/env'
import type { RuntimeBundle, RuntimeModeAdapter, RuntimeModeId } from './runtime/mode'
import { getBoringAgentRuntimePaths, type BoringAgentRuntimePaths } from './workspace/runtimeLayout'
import { VERCEL_SANDBOX_WORKSPACE_ROOT } from './workspace/createVercelSandboxWorkspace'
import type { WorkspaceProvisioningAdapter, WorkspaceProvisioningResult } from './workspace/provisioning'
import type { Workspace } from '../shared/workspace'
import { ErrorCode } from '../shared/error-codes'
import { resolveMode, autoDetectMode } from './runtime/resolveMode'
import { createVercelSandboxModeAdapter } from './runtime/modes/vercel-sandbox'
import { evictSandboxHandleCacheForWorkspace } from './sandbox/vercel-sandbox/resolveSandboxHandle'
import { createPiCodingAgentHarness } from './harness/pi-coding-agent/createHarness'
import type { PiHarnessOptions } from './harness/pi-coding-agent/createHarness'
import { loadPlugins } from './harness/pi-coding-agent/pluginLoader'
import { registerConfiguredModelProviders } from './models/modelConfig'
import { mergeTools, type PluginToolRegistration } from './catalog/mergeTools'
import { buildFilesystemAgentTools } from './tools/filesystem'
import { buildHarnessAgentTools } from './tools/harness'
import { buildUploadAgentTools } from './tools/upload'
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
import type { ReloadHookResult } from './http/routes/reload'
import { searchRoutes } from './http/routes/search'
import { InMemorySessionChangesTracker } from './http/sessionChangesTracker'
import { ReadyStatusTracker } from './sandbox/vercel-sandbox/readyStatus'
import type { AgentHarness } from '../shared/harness'

const DEFAULT_VERSION = '0.1.0-dev'
const DEFAULT_WORKSPACE_ID = 'default'
const STANDARD_AGENT_TOOL_NAMES = ['bash', 'read', 'write', 'edit', 'find', 'grep', 'ls']
const VERCEL_BINDING_HEALTHCHECK_INTERVAL_MS = 15_000

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
  registerConfiguredModelProviders(registry)
  return Array.from(
    new Set(registry.getAvailable().map((model) => model.provider)),
  ).sort((a, b) => a.localeCompare(b))
}

interface RuntimeBinding {
  runtimeBundle: RuntimeBundle
  runtimeProvisioning?: WorkspaceProvisioningResult
  reprovision: (request?: FastifyRequest) => Promise<WorkspaceProvisioningResult | undefined>
  harness: AgentHarness
  tools: AgentTool[]
  readyTracker: ReadyStatusTracker
  lastHealthCheckMs?: number
}

interface RuntimeBindingEntry {
  promise: Promise<RuntimeBinding>
  state: 'pending' | 'ready' | 'failed'
  error?: unknown
}

interface RuntimeScope {
  root: string
  key: string
  templatePath?: string
  pi?: PiHarnessOptions
  sessionNamespace?: string
}

interface SkillScope {
  root: string
  pi?: PiHarnessOptions
}

function selectRuntimeModeAdapter(
  mode: RuntimeModeId,
  sandboxHandleStore: SandboxHandleStore | undefined,
): RuntimeModeAdapter {
  if (mode === 'vercel-sandbox' && sandboxHandleStore) {
    return createVercelSandboxModeAdapter({
      store: sandboxHandleStore,
      orphanGuardMaxIdleMs: null,
    })
  }
  return resolveMode(mode)
}

function getRequestWorkspaceId(request: FastifyRequest): string {
  return request.workspaceContext?.workspaceId ?? DEFAULT_WORKSPACE_ID
}

function isWorkspaceAgnosticAgentRequest(
  request: FastifyRequest,
  options?: { readyStatusWorkspaceScoped?: boolean },
): boolean {
  const pathname = request.url.split('?')[0] ?? request.url
  if (pathname === '/api/v1/ready-status') return !options?.readyStatusWorkspaceScoped
  return pathname === '/health' || pathname === '/ready' || pathname === '/api/v1/agent/models'
}

function extractHttpStatus(error: unknown): number | null {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode
  if (typeof statusCode === 'number') return statusCode

  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === 'number') return status

  const responseStatus = (error as { response?: { status?: unknown } } | null)?.response?.status
  return typeof responseStatus === 'number' ? responseStatus : null
}

function normalizeSessionNamespace(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isExpiredSandboxRuntimeError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (code === ErrorCode.enum.SANDBOX_EXPIRED) return true

  const status = extractHttpStatus(error)
  if (status === 404 || status === 410) return true

  const message = error instanceof Error ? error.message : String(error)
  return /status code (404|410) is not ok/i.test(message)
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

function createRuntimeProvisioningFailedError(workspaceId: string, cause: unknown): Error {
  const causeCode = (cause as { code?: unknown } | null)?.code
  const details = (cause as { details?: unknown } | null)?.details
  return createHttpError(
    ErrorCode.enum.RUNTIME_PROVISIONING_FAILED,
    'Agent runtime provisioning failed. Reload the workspace and try again.',
    {
      workspaceId,
      retryable: true,
      ...(typeof causeCode === 'string' ? { causeCode } : {}),
      ...(details && typeof details === 'object' ? { causeDetails: details } : {}),
    },
  )
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
  version?: string
  extraTools?: AgentTool[]
  getExtraTools?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    runtimeMode: RuntimeModeId
    workspaceFsCapability?: Workspace['fsCapability']
  }) => AgentTool[] | Promise<AgentTool[]>
  systemPromptAppend?: string
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
  /** Optional best-effort telemetry sink supplied by an embedding host. */
  telemetry?: TelemetrySink
  getSessionNamespace?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    request?: FastifyRequest
  }) => string | undefined | Promise<string | undefined>
  registerHealthRoute?: boolean
  sandboxHandleStore?: SandboxHandleStore
  getWorkspaceId?: (request: FastifyRequest) => string | Promise<string>
  getWorkspaceRoot?: (workspaceId: string, request: FastifyRequest) => string | Promise<string>
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
  }) => WorkspaceProvisioningResult | undefined | Promise<WorkspaceProvisioningResult | undefined>
  provisionWorkspace?: boolean
  /** Optional hook called before /api/v1/agent/reload reloads the harness. */
  beforeReload?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    request: FastifyRequest
  }) => void | ReloadHookResult | undefined | Promise<void | ReloadHookResult | undefined>
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

  const resolvedMode = opts.runtimeModeAdapter?.id ?? opts.mode ?? autoDetectMode()
  const modeAdapter = opts.runtimeModeAdapter ?? selectRuntimeModeAdapter(resolvedMode, opts.sandboxHandleStore)
  app.addHook('onClose', async () => {
    await modeAdapter.dispose?.()
  })
  const requestScopedRuntime =
    typeof opts.getWorkspaceId === 'function' ||
    typeof opts.getWorkspaceRoot === 'function' ||
    typeof opts.getTemplatePath === 'function' ||
    typeof opts.getPi === 'function' ||
    typeof opts.getSessionNamespace === 'function'
  const sessionChangesTracker = new InMemorySessionChangesTracker()
  const runtimeBindings = new Map<string, RuntimeBindingEntry>()
  const MAX_RUNTIME_BINDINGS = 256
  function evictRuntimeBindings(): void {
    if (runtimeBindings.size <= MAX_RUNTIME_BINDINGS) return
    const keys = Array.from(runtimeBindings.keys())
    for (let i = 0; i < keys.length - MAX_RUNTIME_BINDINGS; i++) {
      runtimeBindings.delete(keys[i])
    }
  }

  async function resolveRuntimeScope(
    workspaceId: string,
    request?: FastifyRequest,
  ): Promise<RuntimeScope> {
    const root = request && opts.getWorkspaceRoot
      ? await opts.getWorkspaceRoot(workspaceId, request)
      : workspaceRoot
    const scopedTemplatePath = opts.getTemplatePath
      ? await opts.getTemplatePath({ workspaceId, workspaceRoot: root, request })
      : templatePath
    const pi = opts.getPi
      ? await opts.getPi({ workspaceId, workspaceRoot: root, request })
      : opts.pi
    const sessionNamespace = normalizeSessionNamespace(opts.getSessionNamespace
      ? await opts.getSessionNamespace({ workspaceId, workspaceRoot: root, request })
      : opts.sessionNamespace)
    return {
      root,
      templatePath: scopedTemplatePath,
      pi,
      sessionNamespace,
      key: JSON.stringify([
        resolvedMode,
        workspaceId,
        root,
        scopedTemplatePath ?? null,
        pi ?? null,
        sessionNamespace ?? null,
      ]),
    }
  }

  async function resolveSkillScope(
    workspaceId: string,
    request?: FastifyRequest,
  ): Promise<SkillScope> {
    const root = request && opts.getWorkspaceRoot
      ? await opts.getWorkspaceRoot(workspaceId, request)
      : workspaceRoot
    const pi = opts.getPi
      ? await opts.getPi({ workspaceId, workspaceRoot: root, request })
      : opts.pi
    return { root, pi }
  }

  async function runRuntimeProvisioning(
    workspaceId: string,
    scope: RuntimeScope,
    request?: FastifyRequest,
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
    const runtimeLayout = getBoringAgentRuntimePaths(
      resolvedMode === 'vercel-sandbox' ? VERCEL_SANDBOX_WORKSPACE_ROOT : scope.root,
    )
    return await opts.provisionRuntime({
      workspaceId,
      workspaceRoot: scope.root,
      runtimeMode: resolvedMode,
      runtimeLayout,
      provisioningAdapter: modeAdapter.createProvisioningAdapter?.(runtimeLayout, modeCtx),
      request,
    })
  }

  async function createRuntimeBinding(
    workspaceId: string,
    scope: RuntimeScope,
    request?: FastifyRequest,
  ): Promise<RuntimeBinding> {
    const root = scope.root
    const modeCtx = {
      workspaceRoot: root,
      sessionId: workspaceId,
      workspaceId,
      templatePath: scope.templatePath,
      requestId: request?.id,
      telemetry: opts.telemetry,
    }
    let runtimeProvisioning = await runRuntimeProvisioning(workspaceId, scope, request)

    const runtimeBundle = await modeAdapter.create(modeCtx)

    // UI tools (get_ui_state / exec_ui) and the /api/v1/ui/* routes moved
    // to @hachej/boring-workspace. Hosts that want them register uiRoutes
    // alongside this plugin.
    const standardTools = [
      ...buildHarnessAgentTools(runtimeBundle, {
        getCurrent: () => runtimeProvisioning ? {
          env: runtimeProvisioning.env,
          pathEntries: runtimeProvisioning.pathEntries,
        } : undefined,
      }),
      ...buildFilesystemAgentTools(runtimeBundle),
      ...buildUploadAgentTools(runtimeBundle),
    ]
    const pluginTools: PluginToolRegistration[] = []

    if (modeAdapter.workspaceFsCapability === 'strong') {
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
    })
    const harnessFactory = opts.harnessFactory ?? ((input) => createPiCodingAgentHarness({
      ...input,
      pi: {
        noContextFiles: true,
        noSkills: true,
        ...scope.pi,
        additionalSkillPaths: [
          ...(runtimeProvisioning?.skillPaths ?? []),
          ...(scope.pi?.additionalSkillPaths ?? []),
        ],
      },
    }))
    const harness = await harnessFactory({
      tools,
      cwd: root,
      sessionNamespace: scope.sessionNamespace,
      systemPromptAppend: opts.systemPromptAppend,
      telemetry: opts.telemetry,
    })
    const readyTracker = new ReadyStatusTracker({
      sandboxReady: resolvedMode !== 'vercel-sandbox',
      harnessReady: true,
    })
    if (resolvedMode === 'vercel-sandbox') {
      queueMicrotask(() => readyTracker.markSandboxReady())
    }

    return {
      runtimeBundle,
      runtimeProvisioning,
      reprovision: async (reloadRequest?: FastifyRequest) => {
        runtimeProvisioning = await runRuntimeProvisioning(workspaceId, scope, reloadRequest)
        return runtimeProvisioning
      },
      harness,
      tools,
      readyTracker,
    }
  }

  function createRuntimeBindingEntry(
    workspaceId: string,
    scope: RuntimeScope,
    request?: FastifyRequest,
  ): RuntimeBindingEntry {
    const entry: RuntimeBindingEntry = {
      state: 'pending',
      promise: Promise.resolve(null as unknown as RuntimeBinding),
    }
    entry.promise = createRuntimeBinding(workspaceId, scope, request).then(
      (binding) => {
        entry.state = 'ready'
        return binding
      },
      (error) => {
        entry.state = 'failed'
        entry.error = error
        throw error
      },
    )
    entry.promise.catch(() => {})
    return entry
  }

  async function getOrCreateRuntimeBinding(
    workspaceId: string,
    request?: FastifyRequest,
    options: { failIfPending?: boolean } = {},
  ): Promise<RuntimeBinding> {
    const scope = await resolveRuntimeScope(workspaceId, request)
    const existing = runtimeBindings.get(scope.key)
    if (existing) {
      if (options.failIfPending && existing.state === 'pending') {
        throw createAgentRuntimeNotReadyError(workspaceId)
      }
      if (options.failIfPending && existing.state === 'failed') {
        throw createRuntimeProvisioningFailedError(workspaceId, existing.error)
      }
      return await ensureRuntimeBindingReady(
        workspaceId,
        scope,
        await existing.promise,
      )
    }

    const created = createRuntimeBindingEntry(workspaceId, scope, request)
    runtimeBindings.set(scope.key, created)
    evictRuntimeBindings()
    if (options.failIfPending) {
      throw createAgentRuntimeNotReadyError(workspaceId)
    }
    try {
      return await ensureRuntimeBindingReady(
        workspaceId,
        scope,
        await created.promise,
      )
    } catch (error) {
      if (runtimeBindings.get(scope.key) === created) runtimeBindings.delete(scope.key)
      throw error
    }
  }

  async function recreateRuntimeBinding(
    workspaceId: string,
    scope: RuntimeScope,
  ): Promise<RuntimeBinding> {
    runtimeBindings.delete(scope.key)
    evictSandboxHandleCacheForWorkspace(workspaceId)

    const created = createRuntimeBindingEntry(workspaceId, scope)
    runtimeBindings.set(scope.key, created)
    evictRuntimeBindings()
    try {
      const binding = await created.promise
      binding.lastHealthCheckMs = Date.now()
      return binding
    } catch (error) {
      if (runtimeBindings.get(scope.key) === created) runtimeBindings.delete(scope.key)
      throw error
    }
  }

  async function ensureRuntimeBindingReady(
    workspaceId: string,
    scope: RuntimeScope,
    binding: RuntimeBinding,
  ): Promise<RuntimeBinding> {
    if (resolvedMode !== 'vercel-sandbox') return binding

    const now = Date.now()
    if (
      binding.lastHealthCheckMs !== undefined &&
      now - binding.lastHealthCheckMs < VERCEL_BINDING_HEALTHCHECK_INTERVAL_MS
    ) {
      return binding
    }

    try {
      await binding.runtimeBundle.workspace.stat('.')
      binding.lastHealthCheckMs = now
      return binding
    } catch (error) {
      if (!isExpiredSandboxRuntimeError(error)) throw error

      app.log.warn({
        err: error,
        workspaceId,
      }, '[sandbox] cached runtime expired; recreating from persisted handle')

      return await recreateRuntimeBinding(workspaceId, scope)
    }
  }

  const hasRuntimeProvisioningInput = opts.provisionWorkspace !== false && Boolean(opts.provisionRuntime)
  const staticBinding = requestScopedRuntime
    ? null
    : await getOrCreateRuntimeBinding(sessionId)
  const skillsScopeByRequest = new WeakMap<FastifyRequest, Promise<SkillScope>>()

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
    if (opts.getWorkspaceId && !isWorkspaceAgnosticAgentRequest(request, { readyStatusWorkspaceScoped: requestScopedRuntime })) {
      try {
        workspaceId = (await opts.getWorkspaceId(request)).trim()
      } catch (error) {
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
  })
  await app.register(fsEventsRoutes, {
    getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
  })
  await app.register(treeRoutes, {
    getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
  })
  await app.register(searchRoutes, {
    getFileSearch: async (request) => (await getBindingForRequest(request)).runtimeBundle.fileSearch,
  })
  await app.register(chatRoutes, {
    getRuntime: async (request) => {
      const binding = await getBindingForRequest(request, { failIfPending: hasRuntimeProvisioningInput })
      return {
        harness: binding.harness,
        workdir: binding.runtimeBundle.workspace.root,
      }
    },
    sessionChangesTracker,
    telemetry: opts.telemetry,
  })
  await app.register(sessionRoutes, {
    getSessionStore: async (request) => {
      const binding = await getBindingForRequest(request)
      return binding.harness.sessions as unknown as SessionStore
    },
    getRuntime: async (request) => {
      const binding = await getBindingForRequest(request)
      return {
        harness: binding.harness,
        workdir: binding.runtimeBundle.workspace.root,
      }
    },
  })
  await app.register(systemPromptRoutes, {
    getHarness: async (request) => (await getBindingForRequest(request)).harness,
  })
  await app.register(modelsRoutes)
  await app.register(skillsRoutes, {
    workspaceRoot,
    additionalSkillPaths: [
      ...(staticBinding?.runtimeProvisioning?.skillPaths ?? []),
      ...(opts.pi?.additionalSkillPaths ?? []),
    ],
    piPackages: opts.pi?.packages,
    noSkills: opts.pi?.noSkills,
    getWorkspaceRoot: staticBinding
      ? undefined
      : async (request) => (await getSkillsScopeForRequest(request)).root,
    getAdditionalSkillPaths: staticBinding && !hasRuntimeProvisioningInput
      ? undefined
      : async (request) => {
          const scope = await getSkillsScopeForRequest(request)
          if (!hasRuntimeProvisioningInput) return scope.pi?.additionalSkillPaths
          const binding = await getBindingForRequest(request)
          return [
            ...(binding.runtimeProvisioning?.skillPaths ?? []),
            ...(scope.pi?.additionalSkillPaths ?? []),
          ]
        },
    getPiPackages: staticBinding
      ? undefined
      : async (request) => (await getSkillsScopeForRequest(request)).pi?.packages,
    getNoSkills: staticBinding
      ? undefined
      : async (request) => (await getSkillsScopeForRequest(request)).pi?.noSkills,
  })
  await app.register(sessionChangesRoutes, { tracker: sessionChangesTracker })
  app.post<{ Body: { sessionId?: string } }>('/api/v1/agent/reload', async (request, reply) => {
    const workspaceId = getRequestWorkspaceId(request)
    const binding = await getBindingForRequest(request)
    if (!binding.harness.reloadSession) {
      return reply.status(501).send({ ok: false, error: 'Agent harness does not support reload' })
    }

    try {
      binding.runtimeProvisioning = await binding.reprovision(request)
      const hookResult = await opts.beforeReload?.({
        workspaceId,
        workspaceRoot: binding.runtimeBundle.workspace.root,
        request,
      })
      const reloadSessionId = request.body?.sessionId || sessionId
      const reloaded = await binding.harness.reloadSession(reloadSessionId)
      const restart_warnings = hookResult?.restart_warnings
      const diagnostics = hookResult?.diagnostics
      return {
        ok: true,
        sessionId: reloadSessionId,
        reloaded,
        ...(restart_warnings && restart_warnings.length > 0 ? { restart_warnings } : {}),
        ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.status(422).send({ ok: false, error: message })
    }
  })
  await app.register(catalogRoutes, staticBinding
    ? { tools: staticBinding.tools }
    : { getTools: async (request) => (await getBindingForRequest(request)).tools },
  )
  await app.register(readyStatusRoutes, staticBinding
    ? { tracker: staticBinding.readyTracker }
    : { getTracker: async (request) => (await getBindingForRequest(request)).readyTracker },
  )
}
