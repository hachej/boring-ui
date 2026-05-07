import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { basename } from 'node:path'
import type { AgentTool } from '../shared/tool'
import type { SessionStore } from '../shared/session'
import type { SandboxHandleStore } from '../shared/sandbox-handle-store'
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'
import { getEnv } from './config/env'
import type { RuntimeBundle, RuntimeModeAdapter, RuntimeModeId } from './runtime/mode'
import { ErrorCode } from '../shared/error-codes'
import { resolveMode, autoDetectMode } from './runtime/resolveMode'
import { createVercelSandboxModeAdapter } from './runtime/modes/vercel-sandbox'
import { evictSandboxHandleCacheForWorkspace } from './sandbox/vercel-sandbox/resolveSandboxHandle'
import { createPiCodingAgentHarness } from './harness/pi-coding-agent/createHarness'
import type { PiResourceLoaderOptions } from './harness/pi-coding-agent/createHarness'
import { loadPlugins } from './harness/pi-coding-agent/pluginLoader'
import { registerConfiguredModelProviders } from './models/modelConfig'
import { mergeTools, type PluginToolRegistration } from './catalog/mergeTools'
import { buildFilesystemAgentTools } from './tools/filesystem'
import { buildHarnessAgentTools } from './tools/harness'
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
  harness: AgentHarness
  tools: AgentTool[]
  readyTracker: ReadyStatusTracker
  lastHealthCheckMs?: number
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

function isWorkspaceAgnosticAgentRequest(request: FastifyRequest): boolean {
  const pathname = request.url.split('?')[0] ?? request.url
  return pathname === '/api/v1/agent/models' || pathname === '/api/v1/agent/skills' || pathname === '/api/v1/ready-status'
}

function extractHttpStatus(error: unknown): number | null {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode
  if (typeof statusCode === 'number') return statusCode

  const status = (error as { status?: unknown } | null)?.status
  if (typeof status === 'number') return status

  const responseStatus = (error as { response?: { status?: unknown } } | null)?.response?.status
  return typeof responseStatus === 'number' ? responseStatus : null
}

function isExpiredSandboxRuntimeError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (code === ErrorCode.enum.SANDBOX_EXPIRED) return true

  const status = extractHttpStatus(error)
  if (status === 404 || status === 410) return true

  const message = error instanceof Error ? error.message : String(error)
  return /status code (404|410) is not ok/i.test(message)
}

export interface RegisterAgentRoutesOptions {
  workspaceRoot?: string
  sessionId?: string
  templatePath?: string
  mode?: RuntimeModeId
  version?: string
  extraTools?: AgentTool[]
  getExtraTools?: (ctx: {
    workspaceId: string
    workspaceRoot: string
    runtimeMode: RuntimeModeId
  }) => AgentTool[] | Promise<AgentTool[]>
  systemPromptAppend?: string
  resourceLoaderOptions?: PiResourceLoaderOptions
  registerHealthRoute?: boolean
  sandboxHandleStore?: SandboxHandleStore
  getWorkspaceId?: (request: FastifyRequest) => string | Promise<string>
  getWorkspaceRoot?: (workspaceId: string, request: FastifyRequest) => string | Promise<string>
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
  const modeAdapter = selectRuntimeModeAdapter(resolvedMode, opts.sandboxHandleStore)
  app.addHook('onClose', async () => {
    await modeAdapter.dispose?.()
  })
  const requestScopedRuntime =
    typeof opts.getWorkspaceId === 'function' ||
    typeof opts.getWorkspaceRoot === 'function'
  const sessionChangesTracker = new InMemorySessionChangesTracker()
  const runtimeBindings = new Map<string, Promise<RuntimeBinding>>()

  async function resolveRuntimeScope(
    workspaceId: string,
    request?: FastifyRequest,
  ): Promise<{ root: string; key: string }> {
    const root = request && opts.getWorkspaceRoot
      ? await opts.getWorkspaceRoot(workspaceId, request)
      : workspaceRoot
    return {
      root,
      key: `${resolvedMode}:${workspaceId}:${root}`,
    }
  }

  async function createRuntimeBinding(
    workspaceId: string,
    root: string,
  ): Promise<RuntimeBinding> {
    const runtimeBundle = await modeAdapter.create({
      workspaceRoot: root,
      sessionId: workspaceId,
      workspaceId,
      templatePath,
    })

    // UI tools (get_ui_state / exec_ui) and the /api/v1/ui/* routes moved
    // to @hachej/boring-workspace. Hosts that want them register uiRoutes
    // alongside this plugin.
    const standardTools = [
      ...buildHarnessAgentTools(runtimeBundle),
      ...buildFilesystemAgentTools(runtimeBundle),
    ]
    const pluginTools: PluginToolRegistration[] = []

    if (resolvedMode !== 'vercel-sandbox') {
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
    const harness = createPiCodingAgentHarness({
      tools,
      cwd: root,
      systemPromptAppend: opts.systemPromptAppend,
      resourceLoaderOptions: {
        noContextFiles: true,
        noSkills: true,
        ...opts.resourceLoaderOptions,
      },
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
      harness,
      tools,
      readyTracker,
    }
  }

  async function getOrCreateRuntimeBinding(
    workspaceId: string,
    request?: FastifyRequest,
  ): Promise<RuntimeBinding> {
    const scope = await resolveRuntimeScope(workspaceId, request)
    const existing = runtimeBindings.get(scope.key)
    if (existing) {
      return await ensureRuntimeBindingReady(
        workspaceId,
        scope,
        await existing,
      )
    }

    const created = createRuntimeBinding(workspaceId, scope.root)
    runtimeBindings.set(scope.key, created)
    try {
      return await ensureRuntimeBindingReady(
        workspaceId,
        scope,
        await created,
      )
    } catch (error) {
      if (runtimeBindings.get(scope.key) === created) runtimeBindings.delete(scope.key)
      throw error
    }
  }

  async function recreateRuntimeBinding(
    workspaceId: string,
    scope: { root: string; key: string },
  ): Promise<RuntimeBinding> {
    runtimeBindings.delete(scope.key)
    evictSandboxHandleCacheForWorkspace(workspaceId)

    const created = createRuntimeBinding(workspaceId, scope.root)
    runtimeBindings.set(scope.key, created)
    try {
      const binding = await created
      binding.lastHealthCheckMs = Date.now()
      return binding
    } catch (error) {
      if (runtimeBindings.get(scope.key) === created) runtimeBindings.delete(scope.key)
      throw error
    }
  }

  async function ensureRuntimeBindingReady(
    workspaceId: string,
    scope: { root: string; key: string },
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

  const staticBinding = requestScopedRuntime
    ? null
    : await getOrCreateRuntimeBinding(sessionId)

  async function getBindingForRequest(request: FastifyRequest): Promise<RuntimeBinding> {
    if (staticBinding) return staticBinding
    return await getOrCreateRuntimeBinding(getRequestWorkspaceId(request), request)
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
    if (opts.getWorkspaceId && !isWorkspaceAgnosticAgentRequest(request)) {
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
      const binding = await getBindingForRequest(request)
      return {
        harness: binding.harness,
        workdir: binding.runtimeBundle.workspace.root,
      }
    },
    sessionChangesTracker,
  })
  await app.register(sessionRoutes, {
    getSessionStore: async (request) => {
      const binding = await getBindingForRequest(request)
      return binding.harness.sessions as unknown as SessionStore
    },
  })
  await app.register(systemPromptRoutes, {
    getHarness: async (request) => (await getBindingForRequest(request)).harness,
  })
  await app.register(modelsRoutes)
  await app.register(skillsRoutes, {
    workspaceRoot,
    additionalSkillPaths: opts.resourceLoaderOptions?.additionalSkillPaths,
  })
  await app.register(sessionChangesRoutes, { tracker: sessionChangesTracker })
  await app.register(catalogRoutes, staticBinding
    ? { tools: staticBinding.tools }
    : { getTools: async (request) => (await getBindingForRequest(request)).tools },
  )
  await app.register(readyStatusRoutes, {
    tracker: staticBinding?.readyTracker ?? new ReadyStatusTracker({
      sandboxReady: true,
      harnessReady: true,
    }),
  })
}
