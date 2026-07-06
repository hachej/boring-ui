import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Agent, ResolveInputResponse } from '../../../shared/events'
import { ErrorCode } from '../../../shared/error-codes'

const DEFAULT_AGENT_ID = 'default'

const AgentParamsSchema = z.object({
  agentId: z.string().min(1),
})

const SessionParamsSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1).max(128),
})

const ResolveInputResponseSchema: z.ZodType<ResolveInputResponse> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('approval'),
    decision: z.enum(['approve', 'deny']),
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal('input'),
    values: z.record(z.unknown()),
  }),
])

const ResolveInputBodySchema = z.object({
  requestId: z.string().min(1),
  response: ResolveInputResponseSchema,
})

export interface InputRoutesOptions {
  agent?: Agent
  getAgent?: (request: FastifyRequest) => Agent | Promise<Agent>
}

export function inputRoutes(
  app: FastifyInstance,
  opts: InputRoutesOptions,
  done: (err?: Error) => void,
): void {
  app.post('/api/v1/agents/:agentId/sessions/:sessionId/input', async (request, reply) => {
    const params = parseSessionParams(request, reply)
    if (!params) return
    if (!assertDefaultAgent(params.agentId, reply)) return
    const body = parseWithSchema(ResolveInputBodySchema, request.body, reply)
    if (!body) return

    try {
      const agent = await resolveAgent(opts, request)
      const ctx = sessionCtxFromRequest(request)
      await agent.sessions.load(ctx, params.sessionId)
      await agent.resolveInput(params.sessionId, body.requestId, body.response, ctx)
      return reply.code(202).send({ accepted: true })
    } catch (error) {
      return sendRouteError(reply, error, 'input rejected')
    }
  })

  app.get('/api/v1/agents/:agentId/sessions/:sessionId/input', async (request, reply) => {
    const params = parseSessionParams(request, reply)
    if (!params) return
    if (!assertDefaultAgent(params.agentId, reply)) return

    try {
      const agent = await resolveAgent(opts, request)
      const ctx = sessionCtxFromRequest(request)
      await agent.sessions.load(ctx, params.sessionId)
      return reply.send(await agent.sessions.pendingInputs(ctx, { sessionId: params.sessionId }))
    } catch (error) {
      return sendRouteError(reply, error, 'pending input list failed')
    }
  })

  app.get('/api/v1/agents/:agentId/pending-inputs', async (request, reply) => {
    const params = parseAgentParams(request, reply)
    if (!params) return
    if (!assertDefaultAgent(params.agentId, reply)) return

    try {
      const agent = await resolveAgent(opts, request)
      return reply.send(await agent.sessions.pendingInputs(sessionCtxFromRequest(request)))
    } catch (error) {
      return sendRouteError(reply, error, 'pending input list failed')
    }
  })

  done()
}

function parseAgentParams(request: FastifyRequest, reply: FastifyReply): { agentId: string } | undefined {
  return parseWithSchema(AgentParamsSchema, request.params, reply)
}

function parseSessionParams(request: FastifyRequest, reply: FastifyReply): { agentId: string; sessionId: string } | undefined {
  return parseWithSchema(SessionParamsSchema, request.params, reply)
}

function assertDefaultAgent(agentId: string, reply: FastifyReply): boolean {
  if (agentId === DEFAULT_AGENT_ID) return true
  reply.code(404).send({
    error: {
      code: ErrorCode.enum.SESSION_NOT_FOUND,
      message: 'agent not found',
    },
  })
  return false
}

async function resolveAgent(opts: InputRoutesOptions, request: FastifyRequest): Promise<Agent> {
  const agent = opts.getAgent ? await opts.getAgent(request) : opts.agent
  if (!agent) {
    throw Object.assign(new Error('input route requires agent or getAgent'), {
      code: ErrorCode.enum.INTERNAL_ERROR,
      statusCode: 500,
    })
  }
  return agent
}

function sessionCtxFromRequest(request: FastifyRequest): { workspaceId?: string; userId?: string } {
  const userId = (request as { user?: { id?: unknown } }).user?.id
  return {
    workspaceId: request.workspaceContext?.workspaceId,
    userId: typeof userId === 'string' && userId.trim() ? userId.trim() : undefined,
  }
}

function parseWithSchema<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  reply: FastifyReply,
): T | undefined {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const firstIssue = parsed.error.issues[0]
  const field = firstIssue?.path.length ? firstIssue.path.map(String).join('.') : 'request'
  reply.code(400).send({
    error: {
      code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
      message: firstIssue?.message ?? 'invalid request',
      field,
    },
  })
  return undefined
}

function sendRouteError(reply: FastifyReply, err: unknown, fallbackMessage: string): FastifyReply {
  const statusCode = statusCodeFromError(err)
  const parsedCode = ErrorCode.safeParse((err as { code?: unknown })?.code)
  const code = parsedCode.success ? parsedCode.data : ErrorCode.enum.INTERNAL_ERROR
  const message = err instanceof Error ? err.message : fallbackMessage
  return reply.code(statusCode).send({
    error: {
      code,
      message,
      details: (err as { details?: unknown })?.details,
    },
  })
}

function statusCodeFromError(err: unknown): number {
  const statusCode = (err as { statusCode?: unknown })?.statusCode
  if (typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) {
    return statusCode
  }
  const parsedCode = ErrorCode.safeParse((err as { code?: unknown })?.code)
  if (parsedCode.success && parsedCode.data === ErrorCode.enum.SESSION_NOT_FOUND) return 404
  if (parsedCode.success && parsedCode.data === ErrorCode.enum.UNAUTHORIZED) return 403
  return 500
}
