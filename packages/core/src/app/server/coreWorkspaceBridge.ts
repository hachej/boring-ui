import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  createBrowserBridgeAuthPolicy,
  createInMemoryBridge,
  createWorkspaceBridgeRuntimeCore,
  createWorkspaceBridgeRuntimeEnvContribution,
  InMemoryWorkspaceBridgeIdempotencyStore,
  runWithWorkspaceBridgeIdempotency,
  verifyWorkspaceBridgeRuntimeToken,
  workspaceBridgeHttpRoutes,
  type UiCommand,
  type WorkspaceBridge,
  type WorkspaceBridgeCallRequest,
  type WorkspaceBridgeCallResponse,
  type WorkspaceBridgeHandler,
  type WorkspaceBridgeIdempotencyStore,
  type WorkspaceBridgeOperationDefinition,
  type WorkspaceBridgeRegistry,
  type WorkspaceBridgeRuntimeEnvOptions,
} from '@hachej/boring-workspace/server'
import type { RuntimeEnvContribution, RuntimeEnvContributionContext } from '@hachej/boring-agent/server'

const MAX_SESSION_OWNER_CACHE = 5_000

interface CoreWorkspaceBridgeRuntime {
  registry: WorkspaceBridgeRegistry
  idempotencyStore: WorkspaceBridgeIdempotencyStore
  sessionOwners: Map<string, string>
}

export interface CoreWorkspaceBridgeOptions {
  workspaceBridge?: {
    runtimeTokenSecret?: string
    runtimeRefreshTokenSecret?: string
    runtimeEnv?: WorkspaceBridgeRuntimeEnvOptions
    handlers?: ReadonlyArray<{ definition: WorkspaceBridgeOperationDefinition; handler: WorkspaceBridgeHandler }>
  }
  resolveWorkspaceId: (request: FastifyRequest) => Promise<string>
  workspaceStore: { isMember(workspaceId: string, userId: string): Promise<boolean> }
  corsOrigins: readonly string[]
  validateWorkspaceId: (value: string) => string
  agentSessionId: (request: FastifyRequest) => string | undefined
}

export interface CoreWorkspaceBridge {
  /** Per-workspace UI side-effect bridge (UI tools, emitUiEffect, ui routes). */
  getBridge: (workspaceId: string) => WorkspaceBridge
  /** Invoke a bridge op as the workspace runtime (agent/SDK), with idempotency. */
  callAsRuntime: <TOutput = unknown>(
    workspaceId: string,
    request: WorkspaceBridgeCallRequest,
    callOptions?: { sessionId?: string; signal?: AbortSignal },
  ) => Promise<WorkspaceBridgeCallResponse<TOutput>>
  /** Record the authenticated principal that owns a chat session (ownership checks). */
  rememberSessionOwner: (request: FastifyRequest) => Promise<void>
  /** Runtime-env contribution that injects the per-workspace bridge token, if configured. */
  runtimeEnvContribution?: RuntimeEnvContribution
  /** Register the out-of-process HTTP transport (`/api/v1/workspace-bridge/call`). */
  registerHttpRoutes: (app: FastifyInstance) => Promise<void>
}

/**
 * Multi-tenant WorkspaceBridge wiring for the core app server, extracted from
 * the server composition function. Owns the per-workspace UI bridge map and the
 * per-workspace bridge runtime (registry + idempotency store + session-owner
 * cache), and exposes the seams the server
 * needs (UI bridge, runtime calls, ownership tracking, env injection, HTTP route).
 */
export function createCoreWorkspaceBridge(options: CoreWorkspaceBridgeOptions): CoreWorkspaceBridge {
  const { resolveWorkspaceId, workspaceStore, validateWorkspaceId, agentSessionId } = options

  const bridges = new Map<string, WorkspaceBridge>()
  const getBridge = (workspaceId: string): WorkspaceBridge => {
    const safeWorkspaceId = validateWorkspaceId(workspaceId)
    let bridge = bridges.get(safeWorkspaceId)
    if (!bridge) {
      bridge = createInMemoryBridge()
      bridges.set(safeWorkspaceId, bridge)
    }
    return bridge
  }

  const runtimes = new Map<string, CoreWorkspaceBridgeRuntime>()
  const getRuntime = (workspaceId: string): CoreWorkspaceBridgeRuntime => {
    const safeWorkspaceId = validateWorkspaceId(workspaceId)
    let runtime = runtimes.get(safeWorkspaceId)
    if (!runtime) {
      const sessionOwners = new Map<string, string>()
      const core = createWorkspaceBridgeRuntimeCore({
        handlers: options.workspaceBridge?.handlers,
        ownerWorkspaceId: safeWorkspaceId,
      })
      runtime = {
        registry: core.registry,
        idempotencyStore: new InMemoryWorkspaceBridgeIdempotencyStore(),
        sessionOwners,
      }
      runtimes.set(safeWorkspaceId, runtime)
    }
    return runtime
  }

  const resolveBridgeWorkspaceId = async (request: FastifyRequest): Promise<string> => {
    const authHeader = request.headers.authorization
    if (options.workspaceBridge?.runtimeTokenSecret && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return verifyWorkspaceBridgeRuntimeToken(authHeader.slice('Bearer '.length), {
        secret: options.workspaceBridge.runtimeTokenSecret,
      }).authContext.workspaceId
    }
    return await resolveWorkspaceId(request)
  }

  const rememberSessionOwner = async (request: FastifyRequest): Promise<void> => {
    const user = request.user as { id?: string } | null | undefined
    if (!user?.id) return
    const sessionId = agentSessionId(request)
    if (!sessionId) return
    const workspaceId = await resolveWorkspaceId(request)
    const runtime = getRuntime(workspaceId)
    runtime.sessionOwners.delete(sessionId)
    runtime.sessionOwners.set(sessionId, user.id)
    // Synchronous FIFO eviction — never block the request on async store reads.
    // A dropped owner is harmless: the next chat request re-records it.
    while (runtime.sessionOwners.size > MAX_SESSION_OWNER_CACHE) {
      const oldest = runtime.sessionOwners.keys().next().value
      if (oldest === undefined) break
      runtime.sessionOwners.delete(oldest)
    }
  }

  const callAsRuntime = async <TOutput = unknown>(
    workspaceId: string,
    request: WorkspaceBridgeCallRequest,
    callOptions?: { sessionId?: string; signal?: AbortSignal },
  ): Promise<WorkspaceBridgeCallResponse<TOutput>> => {
    const runtime = getRuntime(workspaceId)
    const definition = runtime.registry.getDefinition(request.op)
    if (!definition) {
      return await runtime.registry.call(request, {
        callerClass: 'runtime',
        workspaceId,
        sessionId: callOptions?.sessionId,
        capabilities: [],
        actor: {
          actorKind: 'agent',
          performedBy: { label: 'agent-runtime' },
          onBehalfOf: callOptions?.sessionId
            ? { label: `session:${callOptions.sessionId}` }
            : { label: `workspace:${workspaceId}` },
        },
        signal: callOptions?.signal,
        emitUiEffect: (cmd) => getBridge(workspaceId).emitUiEffect(cmd),
      })
    }
    const ownerPrincipalId = callOptions?.sessionId
      ? runtime.sessionOwners.get(callOptions.sessionId)
      : undefined
    const authContext = {
      callerClass: 'runtime' as const,
      workspaceId,
      sessionId: callOptions?.sessionId,
      capabilities: [...definition.requiredCapabilities],
      actor: {
        actorKind: 'agent' as const,
        performedBy: { label: 'agent-runtime' },
        onBehalfOf: ownerPrincipalId
          ? { id: ownerPrincipalId, label: `user:${ownerPrincipalId}` }
          : callOptions?.sessionId
            ? { label: `session:${callOptions.sessionId}` }
            : { label: `workspace:${workspaceId}` },
      },
      signal: callOptions?.signal,
      emitUiEffect: (cmd: UiCommand) => getBridge(workspaceId).emitUiEffect(cmd),
    }
    return await runWithWorkspaceBridgeIdempotency(runtime.idempotencyStore, {
      definition,
      request,
      auth: authContext,
    }, async () => await runtime.registry.call(request, authContext))
  }

  const runtimeEnvContribution: RuntimeEnvContribution | undefined =
    options.workspaceBridge?.runtimeTokenSecret || options.workspaceBridge?.runtimeEnv
      ? {
          id: 'workspace-bridge-runtime-env',
          getEnv: async (ctx: RuntimeEnvContributionContext) => {
            const contribution = createWorkspaceBridgeRuntimeEnvContribution({
              workspaceId: ctx.workspaceId,
              runtimeMode: ctx.runtimeMode,
              registry: getRuntime(ctx.workspaceId).registry,
              runtimeTokenSecret: options.workspaceBridge?.runtimeTokenSecret,
              runtimeRefreshTokenSecret: options.workspaceBridge?.runtimeRefreshTokenSecret,
              runtimeEnv: options.workspaceBridge?.runtimeEnv,
            })
            return contribution ? await contribution.getEnv(ctx) : {}
          },
        }
      : undefined

  const registerHttpRoutes = async (app: FastifyInstance): Promise<void> => {
    await app.register(workspaceBridgeHttpRoutes, {
      getRegistry: async (request) => getRuntime(await resolveBridgeWorkspaceId(request)).registry,
      getIdempotencyStore: async (request) => getRuntime(await resolveBridgeWorkspaceId(request)).idempotencyStore,
      runtimeTokenSecret: options.workspaceBridge?.runtimeTokenSecret,
      runtimeRefreshTokenSecret: options.workspaceBridge?.runtimeRefreshTokenSecret,
      getOwnerWorkspaceId: async (request) => await resolveBridgeWorkspaceId(request),
      browserAuthPolicy: createBrowserBridgeAuthPolicy({
        getPrincipal: (input) => {
          const user = input.request?.user as { id?: string; email?: string | null; name?: string | null } | null | undefined
          return user?.id ? { userId: user.id, email: user.email ?? undefined } : null
        },
        authorizeWorkspace: async ({ principal, workspaceId, definition }) => ({
          allowed: await workspaceStore.isMember(workspaceId, principal.userId),
          capabilities: definition.requiredCapabilities,
        }),
        allowedOrigins: options.corsOrigins,
        requireCsrfHeader: true,
      }),
    })
  }

  return { getBridge, callAsRuntime, rememberSessionOwner, runtimeEnvContribution, registerHttpRoutes }
}
