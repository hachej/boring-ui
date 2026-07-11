import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
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

export const FULL_APP_MANAGED_AGENT_MCP_PATH = '/mcp/managed-agent'

const BEARER_PREFIX = 'Bearer '

export interface FullAppManagedAgentMcpConfig {
  enabled: boolean
  bearerToken?: string
  workspaceId?: string
  userId?: string
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
  const bearerToken = trimOptional(env.BORING_MANAGED_AGENT_MCP_BEARER_TOKEN)
  const workspaceId = trimOptional(env.BORING_MANAGED_AGENT_MCP_WORKSPACE_ID)
  const userId = trimOptional(env.BORING_MANAGED_AGENT_MCP_USER_ID)
  if (enabled) {
    const missing = [
      ['BORING_MANAGED_AGENT_MCP_BEARER_TOKEN', bearerToken],
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
    ...(bearerToken ? { bearerToken } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(userId ? { userId } : {}),
    redactionCanaries: [
      bearerToken,
      trimOptional(env.BORING_AGENT_WORKSPACE_ROOT),
      trimOptional(env.BORING_AGENT_SESSION_ROOT),
      process.cwd(),
    ].filter((value): value is string => Boolean(value)),
  }
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
  const bearerToken = config.bearerToken!
  const workspaceId = config.workspaceId!
  const userId = config.userId!
  const requestStorage = new AsyncLocalStorage<FastifyRequest>()

  const controller = createManagedAgentMcpDelegateController({
    redactionCanaries: config.redactionCanaries,
    resolveSessionCtx: () => ({ workspaceId, userId }),
    resolveWorkspace: () => {
      throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'managed-agent MCP workspace binding is unavailable')
    },
    resolveRunnerWorkspace: async ({ ctx, actor }): Promise<ManagedAgentBoundRunnerWorkspace> => {
      if (ctx.workspaceId !== workspaceId || ctx.userId !== userId) {
        throw new ManagedAgentMcpError(ErrorCode.enum.UNAUTHORIZED, 'managed-agent MCP target is not authorized')
      }
      await authorizeConfiguredTarget(app, workspaceId, userId)
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
    redactionCanaries: config.redactionCanaries,
    resolveSessionCtx: () => ({ workspaceId, userId }),
    resolveWorkspace: () => {
      throw new ManagedAgentMcpError(ErrorCode.enum.CONFIG_INVALID, 'managed-agent MCP workspace binding is unavailable')
    },
  })

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: FULL_APP_MANAGED_AGENT_MCP_PATH,
    handler: async (request, reply) => {
      if (!constantTimeBearerMatches(request, bearerToken)) {
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

async function authorizeConfiguredTarget(
  app: CoreWorkspaceAgentServer,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const workspace = await app.workspaceStore.get(workspaceId)
  if (!workspace || workspace.appId !== app.config.appId || workspace.deletedAt) {
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

function constantTimeBearerMatches(request: FastifyRequest, expectedToken: string): boolean {
  const provided = bearerTokenFromRequest(request.raw)
  if (!provided) return false
  const expected = Buffer.from(expectedToken)
  const actual = Buffer.from(provided)
  if (expected.byteLength !== actual.byteLength) {
    timingSafeEqual(expected, expected)
    return false
  }
  return timingSafeEqual(expected, actual)
}

function bearerTokenFromRequest(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization
  if (typeof authorization !== 'string') return undefined
  if (!authorization.startsWith(BEARER_PREFIX)) return undefined
  const token = authorization.slice(BEARER_PREFIX.length).trim()
  return token || undefined
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}
