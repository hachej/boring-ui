import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { AgentTool, ToolReadinessRequirement } from '../shared/tool'
import type { AgentCoreHarnessFactory, AgentHarnessFactory } from '../shared/harness'
import type { SessionStore } from '../shared/session'
import type { Agent } from '../shared/events'
import type { SandboxHandleStore } from '../shared/sandbox-handle-store'
import type { TelemetrySink } from '../shared/telemetry'
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent'
import { getEnv } from './config/env'
import type { RuntimeBundle, RuntimeModeAdapter, RuntimeModeId } from './runtime/mode'
import { getOptionalRuntimeBundleStorageRoot } from './runtime/mode'
import { getBoringAgentRuntimePaths, type BoringAgentRuntimePaths } from './workspace/runtimeLayout'
import type { WorkspaceProvisioningAdapter, WorkspaceProvisioningResult } from './workspace/provisioning'
import type { Workspace } from '../shared/workspace'
import { ErrorCode } from '../shared/error-codes'
import { resolveMode, autoDetectMode } from './runtime/resolveMode'
import { createPiCodingAgentHarness, withPiHarnessDefaults, withPurePiHarnessDefaults } from './harness/pi-coding-agent/createHarness'
import { PiSessionStore } from './harness/pi-coding-agent/sessions'
import type { PiHarnessOptions, ResolvedPiHarnessOptions } from './harness/pi-coding-agent/createHarness'
import { loadPlugins } from './harness/pi-coding-agent/pluginLoader'
import { registerConfiguredModelProviders } from './models/modelConfig'
import { mergeTools, type PluginToolRegistration } from './catalog/mergeTools'
import type { ToolReadinessState } from './catalog/toolReadiness'
import { buildFilesystemAgentTools } from './tools/filesystem'
import { buildHarnessAgentTools } from './tools/harness'
import { buildUploadAgentTools } from './tools/upload'
import type { PiChatSessionService } from '../core/piChatSessionService'
import type { ReloadHookResult } from './http/routes/reload'
import { InMemorySessionChangesTracker } from './http/sessionChangesTracker'
import { ReadyStatusTracker } from './runtime/readyStatus'
import { createRuntimeReadyStatusTracker } from './runtime/modeReadiness'
import { withRuntimeEnvContributions, type RuntimeEnvContribution } from './runtimeEnvContributions'
import type { AgentHarness } from '../shared/harness'
import type { AgentMeteringSink } from './pi-chat/metering'
import { createPluginDiagnosticsTool } from './tools/pluginDiagnostics'
import { createAgentRuntimeBridge } from './createAgent'
import {
  createPureAgentCapabilities,
  createWorkspaceAgentCapabilities,
  registerAgentRouteBindingProfile,
  toolNames,
  type AgentRouteBindingProfile,
} from './agentRouteBindingProfile'
import { collectToolReadinessRequirements, createAgentReadinessFromTracker } from './agentReadiness'

const DEFAULT_VERSION = '0.1.0-dev'
const DEFAULT_WORKSPACE_ID = 'default'
const PURE_RUNTIME_MODE = 'none'
const MAX_PURE_BINDINGS = 256
const STANDARD_AGENT_TOOL_NAMES = ['bash', 'read', 'write', 'edit', 'find', 'grep', 'ls']

type AgentCapabilities = {
  agent: AgentRouteBindingProfile['capabilities'] & {
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
  const hostWithCapabilitiesContributor = app as HostWithCapabilitiesContributor
  if (
    typeof hostWithCapabilitiesContributor.registerCapabilitiesContributor !==
    'function'
  ) {
    return
  }
  hostWithCapabilitiesContributor.registerCapabilitiesContributor(
    'agent',
    () => ({
      agent: {
        ...profile.capabilities,
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
  runtimeProvisioning?: WorkspaceProvisioningResult
  runtimeDependencies: RuntimeDependencyReadiness
  runtimeProvisioningTask?: Promise<WorkspaceProvisioningResult | undefined>
  reprovision: (request?: FastifyRequest) => Promise<WorkspaceProvisioningResult | undefined>
  agent: Agent
  harness: AgentHarness
  tools: AgentTool[]
  readyTracker: ReadyStatusTracker
  piChatService: PiChatSessionService
  lastHealthCheckMs?: number
  /**
   * Diagnostics from the most recent /api/v1/agent/reload (merged hook +
   * harness resource diagnostics). Stashed so the `plugin_diagnostics` tool
   * can replay them to the agent.
   */
  lastReloadDiagnostics?: Array<{ source: string; message: string; pluginId?: string }>
}

interface RuntimeBindingEntry {
  promise: Promise<RuntimeBinding>
  state: 'pending' | 'ready' | 'failed'
  workspaceId: string
  error?: unknown
}

interface RuntimeScope {
  root: string
  key: string
  templatePath?: string
  pi: ResolvedPiHarnessOptions
  sessionNamespace?: string
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
  options?: { readyStatusWorkspaceScoped?: boolean },
): boolean {
  const pathname = request.url.split('?')[0] ?? request.url
  if (pathname === '/api/v1/ready-status') return !options?.readyStatusWorkspaceScoped
  return pathname === '/health' || pathname === '/ready' || pathname === '/api/v1/agent/models'
}

function normalizeSessionNamespace(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function pureSessionNamespaceFromWorkspaceId(workspaceId: string): string {
  const digest = createHash('sha256').update(workspaceId).digest('hex').slice(0, 16)
  return `workspace-${digest}`
}

function pureSessionNamespaceFromScope(parts: unknown[]): string {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16)
  return `scope-${digest}`
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
  }) => string | undefined | Promise<string | undefined>
  registerHealthRoute?: boolean
  sandboxHandleStore?: SandboxHandleStore
  getWorkspaceId?: (request: FastifyRequest) => string | Promise<string>
  getWorkspaceRoot?: (workspaceId: string, request: FastifyRequest) => string | Promise<string>
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
  let profile: AgentRouteBindingProfile
  if (!opts.runtimeModeAdapter && resolvedMode === PURE_RUNTIME_MODE) {
    const sessionChangesTracker = new InMemorySessionChangesTracker()
    type PureBinding = {
      agent: Agent
      tools: AgentTool[]
      readyTracker: ReadyStatusTracker
      piChatService: PiChatSessionService
    }
    const pureBindings = new Map<string, Promise<PureBinding>>()
    const requestScopedPure =
      typeof opts.getWorkspaceId === 'function' ||
      typeof opts.getWorkspaceRoot === 'function' ||
      typeof opts.getExtraTools === 'function' ||
      typeof opts.getPi === 'function' ||
      typeof opts.getSessionNamespace === 'function' ||
      typeof opts.getSystemPromptDynamic === 'function'

    async function createPureBinding(request?: FastifyRequest): Promise<PureBinding> {
      const workspaceId = request ? getRequestWorkspaceId(request) : sessionId
      const workspaceRoot = request && opts.getWorkspaceRoot
        ? await opts.getWorkspaceRoot(workspaceId, request)
        : opts.workspaceRoot ?? ''
      const pi = withPurePiHarnessDefaults(opts.getPi
        ? await opts.getPi({ workspaceId, workspaceRoot, request })
        : opts.pi)
      const configuredSessionNamespace = normalizeSessionNamespace(opts.getSessionNamespace
        ? await opts.getSessionNamespace({ workspaceId, workspaceRoot, request })
        : opts.sessionNamespace)
      const authSubject = opts.getExtraTools ? getRequestAuthSubject(request) : undefined
      const pureScopeNamespace = opts.getWorkspaceId
        ? pureSessionNamespaceFromWorkspaceId(workspaceId)
        : requestScopedPure
          ? pureSessionNamespaceFromScope([resolvedMode, workspaceId, workspaceRoot, pi, authSubject ?? null])
          : undefined
      const sessionNamespace = configuredSessionNamespace && pureScopeNamespace
        ? `${configuredSessionNamespace}-${pureScopeNamespace}`
        : configuredSessionNamespace ?? pureScopeNamespace
      const key = JSON.stringify([
        resolvedMode,
        workspaceId,
        workspaceRoot,
        pi,
        sessionNamespace ?? null,
        authSubject ?? null,
      ])
      const existing = pureBindings.get(key)
      if (existing) return existing

      const bindingPromise = (async () => {
        const scopedExtraTools = opts.getExtraTools
          ? await opts.getExtraTools({
              workspaceId,
              workspaceRoot,
              runtimeMode: resolvedMode,
              workspaceFsCapability: 'none',
              authSubject,
            })
          : []
        const tools = mergeTools({
          standardTools: [],
          extraTools: [
            ...(opts.extraTools ?? []),
            ...scopedExtraTools,
          ],
          logger: app.log,
        })
        const baseHarnessFactory = opts.harnessFactory ?? ((input) => createPiCodingAgentHarness({
          ...input,
          pi,
        }))
        const systemPromptDynamic = opts.getSystemPromptDynamic
          ? () => opts.getSystemPromptDynamic?.({ workspaceId, workspaceRoot })
          : opts.systemPromptDynamic
        const harnessFactory = ((input) => baseHarnessFactory({
          ...input,
          sessionNamespace,
          sessionRoot: opts.sessionRoot,
          sessionDir: input.sessionDir,
        })) as AgentCoreHarnessFactory
        const capabilities = createPureAgentCapabilities(resolvedMode, toolNames(tools))
        const readyTracker = new ReadyStatusTracker({ sandboxReady: true, harnessReady: true })
        const coreAgent = createAgentRuntimeBridge({
          runtime: 'none',
          environments: capabilities.environments,
          tools,
          readiness: createAgentReadinessFromTracker({
            requirements: collectToolReadinessRequirements(tools),
            tracker: readyTracker,
          }),
          harnessFactory,
          systemPromptAppend: opts.systemPromptAppend,
          systemPromptDynamic,
          telemetry: opts.telemetry,
          metering: opts.metering,
          sessionStorageRoot: opts.sessionRoot,
        })
        const agentRuntime = await coreAgent.getRuntime()
        return {
          agent: coreAgent.agent,
          tools,
          readyTracker,
          piChatService: agentRuntime.service as PiChatSessionService,
        }
      })()
      pureBindings.set(key, bindingPromise)
      bindingPromise.catch(() => {
        if (pureBindings.get(key) === bindingPromise) pureBindings.delete(key)
      })
      evictPureBindings()
      return bindingPromise
    }

    function evictPureBindings(): void {
      if (pureBindings.size <= MAX_PURE_BINDINGS) return
      const keys = Array.from(pureBindings.keys())
      for (let i = 0; i < keys.length - MAX_PURE_BINDINGS; i += 1) {
        const key = keys[i]
        if (!key) continue
        const binding = pureBindings.get(key)
        pureBindings.delete(key)
        binding?.then((resolved) => resolved.agent.dispose()).catch(() => {})
      }
    }

    const staticBinding = requestScopedPure ? undefined : await createPureBinding()

    profile = {
      runtimeMode: resolvedMode,
      capabilities: createPureAgentCapabilities(
        resolvedMode,
        staticBinding ? toolNames(staticBinding.tools) : toolNames(opts.extraTools ?? []),
      ),
      sessionChangesTracker,
      health: {
        register: opts.registerHealthRoute ?? true,
        version: opts.version ?? DEFAULT_VERSION,
        getReadiness: () => ({ sandboxReady: true, harnessReady: true }),
      },
      chat: {
        ...(staticBinding
          ? { service: staticBinding.piChatService }
          : { getService: async (request) => (await createPureBinding(request)).piChatService }),
        defaultWorkspaceId: false,
      },
      catalog: staticBinding
        ? { tools: staticBinding.tools }
        : { getTools: async (request) => (await createPureBinding(request)).tools },
      readyStatus: staticBinding
        ? { tracker: staticBinding.readyTracker }
        : { getTracker: async (request) => (await createPureBinding(request)).readyTracker },
      dispose: async () => {
        const bindings = await Promise.allSettled(pureBindings.values())
        await Promise.all(bindings
          .filter((result): result is PromiseFulfilledResult<PureBinding> => result.status === 'fulfilled')
          .map((result) => result.value.agent.dispose()))
      },
      beforeRegister: (profileApp) => {
        profileApp.addHook('onRequest', async (request, reply) => {
          const user = (request as unknown as { user?: { id: string } | null }).user
          let workspaceId = DEFAULT_WORKSPACE_ID
          if (opts.getWorkspaceId && !isWorkspaceAgnosticAgentRequest(request, { readyStatusWorkspaceScoped: requestScopedPure })) {
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
      },
    }
  } else {
  const workspaceRoot = opts.workspaceRoot ?? process.cwd()
  const templatePath = opts.templatePath ?? getEnv('BORING_AGENT_TEMPLATE_PATH')
  const modeAdapter = opts.runtimeModeAdapter ?? resolveMode(resolvedMode, { sandboxHandleStore: opts.sandboxHandleStore })
  const requestScopedRuntime =
    typeof opts.getWorkspaceId === 'function' ||
    typeof opts.getWorkspaceRoot === 'function' ||
    typeof opts.getTemplatePath === 'function' ||
    typeof opts.getPi === 'function' ||
    typeof opts.getExtraTools === 'function' ||
    typeof opts.getSessionNamespace === 'function' ||
    typeof opts.getSystemPromptDynamic === 'function'
  const sessionChangesTracker = new InMemorySessionChangesTracker()
  const externalPluginsEnabled = opts.externalPlugins !== false
  const runtimeBindings = new Map<string, RuntimeBindingEntry>()
  const MAX_RUNTIME_BINDINGS = 256

  async function disposeRuntimeBindingEntry(entry: RuntimeBindingEntry | undefined): Promise<void> {
    if (!entry) return
    const binding = await entry.promise
    await binding.agent.dispose()
  }

  function disposeEvictedRuntimeBinding(entry: RuntimeBindingEntry | undefined): void {
    if (!entry) return
    modeAdapter.evictCachedRuntime?.({ workspaceId: entry.workspaceId })
    disposeRuntimeBindingEntry(entry).catch(() => {})
  }

  function evictRuntimeBindings(): void {
    if (runtimeBindings.size <= MAX_RUNTIME_BINDINGS) return
    const keys = Array.from(runtimeBindings.keys())
    for (let i = 0; i < keys.length - MAX_RUNTIME_BINDINGS; i++) {
      const key = keys[i]
      if (!key) continue
      const entry = runtimeBindings.get(key)
      runtimeBindings.delete(key)
      disposeEvictedRuntimeBinding(entry)
    }
  }

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
  ): Promise<RuntimeScope> {
    const root = request && opts.getWorkspaceRoot
      ? await opts.getWorkspaceRoot(workspaceId, request)
      : workspaceRoot
    const scopedTemplatePath = opts.getTemplatePath
      ? await opts.getTemplatePath({ workspaceId, workspaceRoot: root, request })
      : templatePath
    const pi = await resolveScopePi(workspaceId, root, request)
    const sessionNamespace = normalizeSessionNamespace(opts.getSessionNamespace
      ? await opts.getSessionNamespace({ workspaceId, workspaceRoot: root, request })
      : opts.sessionNamespace)
    const extraToolsAuthSubject = opts.getExtraTools ? getRequestAuthSubject(request) : undefined
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
        pi,
        sessionNamespace ?? null,
        extraToolsAuthSubject ?? null,
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
    const runtimeLayout = getBoringAgentRuntimePaths(modeAdapter.getRuntimeLayoutRoot?.(modeCtx) ?? scope.root)
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

    let runtimeBundle = await modeAdapter.create(modeCtx)
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
      const task = runRuntimeProvisioning(workspaceId, scope, provisionRequest).then(
        async (result) => {
          if (generation !== provisioningGeneration) return result
          runtimeProvisioning = result
          if (binding) binding.runtimeProvisioning = result
          if (binding?.harness.reloadSession) {
            try {
              const sessions = await binding.harness.sessions.list({ workspaceId })
              await Promise.allSettled(
                sessions.map((session) => binding?.harness.reloadSession?.(session.id)),
              )
            } catch (error) {
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
          if (generation !== provisioningGeneration) throw error
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
    const standardTools = [
      ...buildHarnessAgentTools(runtimeBundle, {
        getCurrent: () => runtimeProvisioning ? {
          env: runtimeProvisioning.env,
          pathEntries: runtimeProvisioning.pathEntries,
        } : undefined,
        getReadiness: () => checkReadiness('runtime:python', {} as AgentTool),
      }),
      ...buildFilesystemAgentTools(runtimeBundle),
      ...buildUploadAgentTools(runtimeBundle),
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
          authSubject: getRequestAuthSubject(request),
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
    const capabilities = createWorkspaceAgentCapabilities(resolvedMode, toolNames(tools))
    const coreAgent = createAgentRuntimeBridge({
      runtime: modeAdapter,
      environments: capabilities.environments,
      tools,
      readiness: createAgentReadinessFromTracker({
        requirements: collectToolReadinessRequirements(tools),
        tracker: readyTracker,
        checkReadiness,
      }),
      harnessFactory,
      systemPromptAppend: opts.systemPromptAppend,
      systemPromptDynamic,
      telemetry: opts.telemetry,
      metering: opts.metering,
      sessionStorageRoot: opts.sessionRoot,
      workdir: root,
    }, {
      disposeRuntime: false,
      service: {
        workdir: runtimeBundle.workspace.root,
        workspace: runtimeBundle.workspace,
      },
    })
    const agentRuntime = await coreAgent.getRuntime()
    const harness = agentRuntime.harness
    readyTracker.markHarnessReady()

    binding = {
      runtimeBundle,
      runtimeProvisioning,
      runtimeDependencies,
      runtimeProvisioningTask: undefined,
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
  }

  function createRuntimeBindingEntry(
    workspaceId: string,
    scope: RuntimeScope,
    request?: FastifyRequest,
  ): RuntimeBindingEntry {
    const entry: RuntimeBindingEntry = {
      state: 'pending',
      workspaceId,
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
      if (existing.state === 'failed') {
        if (options.failIfPending) throw createRuntimeProvisioningFailedError(workspaceId, existing.error)
        runtimeBindings.delete(scope.key)
      } else {
        return await ensureRuntimeBindingReady(
          workspaceId,
          scope,
          await existing.promise,
          request,
        )
      }
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
        request,
      )
    } catch (error) {
      if (runtimeBindings.get(scope.key) === created) runtimeBindings.delete(scope.key)
      throw error
    }
  }

  async function recreateRuntimeBinding(
    workspaceId: string,
    scope: RuntimeScope,
    request?: FastifyRequest,
  ): Promise<RuntimeBinding> {
    const previous = runtimeBindings.get(scope.key)
    runtimeBindings.delete(scope.key)
    disposeRuntimeBindingEntry(previous).catch(() => {})
    modeAdapter.evictCachedRuntime?.({ workspaceId })

    const created = createRuntimeBindingEntry(workspaceId, scope, request)
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
    request?: FastifyRequest,
  ): Promise<RuntimeBinding> {
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

    const result = await healthCheck.check({ runtimeBundle: binding.runtimeBundle, workspaceId })
    if (result.state === 'ok') {
      binding.lastHealthCheckMs = now
      return binding
    }

    app.log.warn({
      err: result.error,
      workspaceId,
    }, result.message ?? '[runtime] cached runtime invalid; recreating')

    return await recreateRuntimeBinding(workspaceId, scope, request)
  }

  const hasRuntimeProvisioningInput = opts.provisionWorkspace !== false && Boolean(opts.provisionRuntime)
  const staticBinding = requestScopedRuntime
    ? null
    : await getOrCreateRuntimeBinding(sessionId)
  const skillsScopeByRequest = new WeakMap<FastifyRequest, Promise<SkillScope>>()
  const earlySessionStores = new Map<string, SessionStore>()

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

  async function getSessionStoreForRequest(request: FastifyRequest): Promise<SessionStore> {
    if (staticBinding) return staticBinding.harness.sessions
    const scope = await resolveRuntimeScope(getRequestWorkspaceId(request), request)
    const cached = earlySessionStores.get(scope.key)
    if (cached) return cached
    const store = new PiSessionStore(scope.root, {
      sessionNamespace: scope.sessionNamespace,
      sessionRoot: opts.sessionRoot,
      storageCwd: scope.root,
    })
    earlySessionStores.set(scope.key, store)
    return store
  }

  profile = {
    runtimeMode: resolvedMode,
    capabilities: createWorkspaceAgentCapabilities(
      resolvedMode,
      staticBinding
        ? toolNames(staticBinding.tools)
        : [
            ...STANDARD_AGENT_TOOL_NAMES,
            ...toolNames(opts.extraTools ?? []),
          ],
    ),
    sessionChangesTracker,
    health: {
      register: opts.registerHealthRoute ?? true,
      version: opts.version ?? DEFAULT_VERSION,
      getReadiness: () => staticBinding?.readyTracker.getReadiness() ?? {
        sandboxReady: true,
        harnessReady: true,
      },
    },
    filesystem: {
      file: {
        getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
      },
      fsEvents: {
        getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
      },
      tree: {
        getWorkspace: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace,
        getFilesystemBindings: async (request) => (await getBindingForRequest(request)).runtimeBundle.filesystemBindings,
      },
      search: {
        getFileSearch: async (request) => (await getBindingForRequest(request)).runtimeBundle.fileSearch,
      },
      git: {
        getWorkspaceRoot: async (request) => getOptionalRuntimeBundleStorageRoot((await getBindingForRequest(request)).runtimeBundle),
      },
    },
    chat: {
      getService: async (request) => {
        const binding = await getBindingForRequest(request)
        return binding.piChatService
      },
    },
    systemPrompt: {
      getHarness: async (request) => (await getBindingForRequest(request)).harness,
    },
    skills: {
      workspaceRoot,
      additionalSkillPaths: [
        ...(staticBinding?.runtimeProvisioning?.skillPaths ?? []),
        ...(opts.pi?.additionalSkillPaths ?? []),
      ],
      piPackages: opts.pi?.packages,
      // Undefined is fine: skillsRoutes resolves it through the canonical
      // harness policy (withPiHarnessDefaults), same as the factory above.
      noSkills: opts.pi?.noSkills,
      getWorkspaceRoot: staticBinding
        ? undefined
        : async (request) => (await getSkillsScopeForRequest(request)).root,
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
    },
    reload: async (profileApp) => {
      profileApp.post<{ Body: { sessionId?: string } }>('/api/v1/agent/reload', async (request, reply) => {
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
          return reply.status(422).send({ ok: false, error: message })
        }
      })
    },
    catalog: staticBinding
      ? { tools: staticBinding.tools }
      : { getTools: async (request) => (await getBindingForRequest(request)).tools },
    commands: staticBinding
      ? {
          harness: staticBinding.harness,
          defaultSessionId: sessionId,
          workdir: staticBinding.runtimeBundle.workspace.root,
        }
      : {
          defaultSessionId: sessionId,
          getHarness: async (request) => (await getBindingForRequest(request)).harness,
          getWorkdir: async (request) => (await getBindingForRequest(request)).runtimeBundle.workspace.root,
        },
    readyStatus: staticBinding
      ? { tracker: staticBinding.readyTracker }
      : { getTracker: async (request) => (await getBindingForRequest(request)).readyTracker },
    dispose: async () => {
      const entries = [...runtimeBindings.values()]
      runtimeBindings.clear()
      const disposed = await Promise.allSettled(entries.map((entry) => disposeRuntimeBindingEntry(entry)))
      for (const result of disposed) {
        if (result.status === 'rejected') {
          app.log.warn({ err: result.reason }, '[agent] failed to dispose runtime binding')
        }
      }
      await modeAdapter.dispose?.()
    },
    beforeRegister: (profileApp) => {
      // Bridge host app's request.user -> agent's request.workspaceContext.
      // In embedded mode core's authHook already populates request.user;
      // this hook maps it to the shape agent routes expect. Scoped to agent
      // routes only (Fastify encapsulates hooks within the plugin).
      profileApp.addHook('onRequest', async (request, reply) => {
        const user = (request as unknown as { user?: { id: string } | null }).user
        let workspaceId = DEFAULT_WORKSPACE_ID
        promoteRawFileWorkspaceQueryToHeader(request)
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
    },
  }
  }
  registerAgentCapabilitiesContributor(app, profile)
  await registerAgentRouteBindingProfile(app, profile)
}
