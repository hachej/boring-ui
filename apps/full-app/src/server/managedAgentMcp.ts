import { AsyncLocalStorage } from 'node:async_hooks'

import type { FastifyReply, FastifyRequest } from 'fastify'
import {
  MANAGED_AGENT_MCP_ORIGIN_SURFACE,
  ManagedAgentMcpError,
  createManagedAgentMcpDelegateController,
  createManagedAgentMcpHttpHandler,
  type ManagedAgentBoundRunnerWorkspace,
  type ManagedAgentDelegateRunner,
  type WorkspaceAgentDispatcherResolver,
} from '@hachej/boring-agent/server'
import { ErrorCode } from '@hachej/boring-agent/shared'
import type { CoreWorkspaceAgentServer } from '@hachej/boring-core/app/server'
import { DEFAULT_WORKSPACE_TYPE_ID, isWorkspaceTypeId } from '@hachej/boring-core/shared'

import {
  createHostedBearerAuthenticator,
  createLocalTrustedAuthenticator,
  isMcpIngressAuthMode,
  type McpIngressAuthMode,
  type McpIngressAuthenticator,
} from './mcpIngressAuth'

export const FULL_APP_MANAGED_AGENT_MCP_PATH = '/mcp/managed-agent'

export interface FullAppManagedAgentMcpConfig {
  enabled: boolean
  authMode: McpIngressAuthMode
  bearerToken?: string
  localToken?: string
  workspaceId?: string
  userId?: string
  /** Expected persisted workspace type revalidated on every request. */
  workspaceTypeId: string
  redactionCanaries: readonly string[]
}

export interface RegisterFullAppManagedAgentMcpRoutesOptions {
  env?: NodeJS.ProcessEnv
  dispatcherResolver?: WorkspaceAgentDispatcherResolver
}

export function readFullAppManagedAgentMcpConfig(
  env: NodeJS.ProcessEnv = process.env,
): FullAppManagedAgentMcpConfig {
  const enabled = env.BORING_MANAGED_AGENT_MCP_ENABLED === '1'
  const authMode = resolveAuthMode(env.BORING_MANAGED_AGENT_MCP_AUTH_MODE)
  const bearerToken = trimOptional(env.BORING_MANAGED_AGENT_MCP_BEARER_TOKEN)
  const localToken = trimOptional(env.BORING_MANAGED_AGENT_MCP_LOCAL_TOKEN)
  const workspaceId = trimOptional(env.BORING_MANAGED_AGENT_MCP_WORKSPACE_ID)
  const userId = trimOptional(env.BORING_MANAGED_AGENT_MCP_USER_ID)
  const workspaceTypeId = resolveExpectedWorkspaceTypeId(
    env.BORING_MANAGED_AGENT_MCP_WORKSPACE_TYPE_ID,
  )
  if (enabled) {
    // The credential value required depends on the deployment auth mode:
    // hosted needs a bearer, local-trusted needs a loopback local token.
    const credentialRequirement: [string, string | undefined] = authMode === 'local-trusted'
      ? ['BORING_MANAGED_AGENT_MCP_LOCAL_TOKEN', localToken]
      : ['BORING_MANAGED_AGENT_MCP_BEARER_TOKEN', bearerToken]
    const missing = [
      credentialRequirement,
      ['BORING_MANAGED_AGENT_MCP_WORKSPACE_ID', workspaceId],
      ['BORING_MANAGED_AGENT_MCP_USER_ID', userId],
    ].filter(([, value]) => !value).map(([name]) => name)
    if (missing.length > 0) {
      throw new ManagedAgentMcpError(
        ErrorCode.enum.CONFIG_INVALID,
        `managed-agent MCP config missing required values: ${missing.join(', ')}`,
      )
    }
  }
  return {
    enabled,
    authMode,
    ...(bearerToken ? { bearerToken } : {}),
    ...(localToken ? { localToken } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(userId ? { userId } : {}),
    workspaceTypeId,
    redactionCanaries: [
      bearerToken,
      localToken,
      trimOptional(env.BORING_AGENT_WORKSPACE_ROOT),
      trimOptional(env.BORING_AGENT_SESSION_ROOT),
      process.cwd(),
    ].filter((value): value is string => Boolean(value)),
  }
}

function resolveAuthMode(raw: string | undefined): McpIngressAuthMode {
  const value = trimOptional(raw)
  if (value === undefined) return 'hosted'
  if (!isMcpIngressAuthMode(value)) {
    throw new ManagedAgentMcpError(
      ErrorCode.enum.CONFIG_INVALID,
      'BORING_MANAGED_AGENT_MCP_AUTH_MODE must be "hosted" or "local-trusted"',
    )
  }
  return value
}

function resolveExpectedWorkspaceTypeId(raw: string | undefined): string {
  const value = trimOptional(raw)
  if (value === undefined) return DEFAULT_WORKSPACE_TYPE_ID
  if (!isWorkspaceTypeId(value)) {
    throw new ManagedAgentMcpError(
      ErrorCode.enum.CONFIG_INVALID,
      'BORING_MANAGED_AGENT_MCP_WORKSPACE_TYPE_ID is not a valid workspace type id',
    )
  }
  return value
}

export function registerFullAppManagedAgentMcpRoutes(
  app: CoreWorkspaceAgentServer,
  options: RegisterFullAppManagedAgentMcpRoutesOptions = {},
): void {
  const config = readFullAppManagedAgentMcpConfig(options.env)
  if (!config.enabled) return
  const dispatcherResolver = options.dispatcherResolver
  if (!dispatcherResolver?.resolveWithWorkspace) {
    throw new ManagedAgentMcpError(
      ErrorCode.enum.CONFIG_INVALID,
      'managed-agent MCP requires a workspace agent dispatcher binding resolver',
    )
  }
  const workspaceId = config.workspaceId!
  const userId = config.userId!
  const expectedWorkspaceTypeId = config.workspaceTypeId
  const authenticator = createConfiguredAuthenticator(config)
  const requestStorage = new AsyncLocalStorage<FastifyRequest>()

  const controller = createManagedAgentMcpDelegateController({
    redactionCanaries: config.redactionCanaries,
    resolveSessionCtx: () => ({ workspaceId, userId }),
    resolveRunnerWorkspace: async ({ ctx, actor }): Promise<ManagedAgentBoundRunnerWorkspace> => {
      if (ctx.workspaceId !== workspaceId || ctx.userId !== userId) {
        throw new ManagedAgentMcpError(ErrorCode.enum.UNAUTHORIZED, 'managed-agent MCP target is not authorized')
      }
      await authorizeConfiguredTarget(app, workspaceId, userId, expectedWorkspaceTypeId)
      const request = requestStorage.getStore()
      const binding = await dispatcherResolver.resolveWithWorkspace!(
        { workspaceId, userId },
        request ? { request } : undefined,
      )
      return {
        workspace: binding.workspace,
        runner: createDispatcherDelegateRunner(binding.dispatcher, actor),
      }
    },
  })
  const handler = createManagedAgentMcpHttpHandler({
    controller,
    name: 'boring-full-app-managed-agent',
    version: '0.0.0',
  })

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: FULL_APP_MANAGED_AGENT_MCP_PATH,
    handler: async (request, reply) => {
      const outcome = authenticator.authenticate(request)
      if (!outcome.ok) {
        return reply.code(401).send({
          error: {
            code: ErrorCode.enum.UNAUTHORIZED,
            message: 'unauthorized',
          },
        })
      }
      await requestStorage.run(request, async () => {
        await handleStreamableHttpRequest(handler, request, reply)
      })
    },
  })
}

/**
 * Builds the two-tier {@link McpIngressAuthenticator} for the configured
 * deployment mode. The bound principal/workspace is the SAME configured target
 * the route revalidates on every request; authentication proves the caller, not
 * membership.
 */
function createConfiguredAuthenticator(
  config: FullAppManagedAgentMcpConfig,
): McpIngressAuthenticator {
  const binding = { principalUserId: config.userId!, workspaceId: config.workspaceId! }
  if (config.authMode === 'local-trusted') {
    return createLocalTrustedAuthenticator({ localToken: config.localToken!, binding })
  }
  return createHostedBearerAuthenticator({ bearerToken: config.bearerToken!, binding })
}

async function authorizeConfiguredTarget(
  app: CoreWorkspaceAgentServer,
  workspaceId: string,
  userId: string,
  expectedWorkspaceTypeId: string,
): Promise<void> {
  const workspace = await app.workspaceStore.get(workspaceId)
  if (!workspace || workspace.appId !== app.config.appId || workspace.deletedAt) {
    throw new ManagedAgentMcpError(ErrorCode.enum.UNAUTHORIZED, 'managed-agent MCP target is not authorized')
  }
  // Persisted workspace type is a trusted, server-derived identity (Step 1A).
  // Revalidate it on every request so a retyped or wrong-type workspace is
  // denied before any dispatcher/model work. Legacy rows without a persisted
  // type fall back to the default type, matching Core's own default.
  const persistedWorkspaceTypeId = workspace.workspaceTypeId ?? DEFAULT_WORKSPACE_TYPE_ID
  if (persistedWorkspaceTypeId !== expectedWorkspaceTypeId) {
    throw new ManagedAgentMcpError(ErrorCode.enum.UNAUTHORIZED, 'managed-agent MCP target is not authorized')
  }
  if (!await app.workspaceStore.isMember(workspaceId, userId)) {
    throw new ManagedAgentMcpError(ErrorCode.enum.UNAUTHORIZED, 'managed-agent MCP target is not authorized')
  }
}

function createDispatcherDelegateRunner(
  dispatcher: Awaited<ReturnType<WorkspaceAgentDispatcherResolver['resolve']>>,
  actor: { id?: string; name?: string },
): ManagedAgentDelegateRunner {
  return {
    run(input) {
      return dispatcher.send({
        content: input.brief,
        actor,
        originSurface: MANAGED_AGENT_MCP_ORIGIN_SURFACE,
      })
    },
    async stop(sessionId) {
      await dispatcher.stop(sessionId)
    },
  }
}

async function handleStreamableHttpRequest(
  handler: ReturnType<typeof createManagedAgentMcpHttpHandler>,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  reply.hijack()
  try {
    await handler(request.raw, reply.raw, request.body)
  } catch (error) {
    if (!reply.raw.headersSent) {
      reply.raw.statusCode = 500
      reply.raw.setHeader('content-type', 'application/json; charset=utf-8')
      reply.raw.end(JSON.stringify({
        error: {
          code: ErrorCode.enum.INTERNAL_ERROR,
          message: 'managed-agent MCP request failed',
        },
      }))
    } else {
      request.log.warn({ code: ErrorCode.enum.INTERNAL_ERROR }, 'managed-agent MCP stream failed')
      reply.raw.end()
    }
  }
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}
