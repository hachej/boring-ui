import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Agent, AgentSendInput } from '../../../shared/events'
import { ErrorCode } from '../../../shared/error-codes'

const DEFAULT_AGENT_ID = 'default'
const MAX_PROMPT_MESSAGE_LENGTH = 1_000_000
const MAX_PROMPT_ATTACHMENTS = 20

const AgentParamsSchema = z.object({
  agentId: z.string().min(1),
})

const SessionParamsSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1).max(128),
})

const AgentMessagePartSchema = z.object({
  type: z.string().min(1),
  text: z.string().max(MAX_PROMPT_MESSAGE_LENGTH).optional(),
}).catchall(z.unknown())

const AgentMessageContentSchema = z.union([
  z.string().min(1).max(MAX_PROMPT_MESSAGE_LENGTH),
  z.array(AgentMessagePartSchema).min(1).refine(
    (parts) => parts.some((part) => typeof part.text === 'string' && part.text.length > 0),
    { message: 'content must include text' },
  ),
])

const MessageAttachmentSchema = z.object({
  filename: z.string().min(1).optional(),
  mediaType: z.string().min(1).optional(),
  url: z.string().min(1),
}).passthrough()

const AgentActorSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
}).passthrough()

const AgentModelSchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
})

const StartBodySchema = z.preprocess((value) => value ?? {}, z.object({
  content: AgentMessageContentSchema.optional(),
  message: z.string().min(1).max(MAX_PROMPT_MESSAGE_LENGTH).optional(),
  attachments: z.array(MessageAttachmentSchema).max(MAX_PROMPT_ATTACHMENTS).optional(),
  actor: AgentActorSchema.optional(),
  originSurface: z.string().min(1).optional(),
  thinkingLevel: z.enum(['off', 'low', 'medium', 'high']).optional(),
  model: AgentModelSchema.optional(),
}).passthrough().superRefine((body, ctx) => {
  if (body.content === undefined && body.message === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'message or content is required',
      path: ['message'],
    })
  }
}))

const EmptyBodySchema = z.preprocess((value) => value ?? {}, z.object({}).passthrough())

export interface AgentSessionsRoutesOptions {
  agent?: Agent
  getAgent?: (request: FastifyRequest) => Agent | Promise<Agent>
}

export function agentSessionsRoutes(
  app: FastifyInstance,
  opts: AgentSessionsRoutesOptions,
  done: (err?: Error) => void,
): void {
  app.post('/api/v1/agents/:agentId/sessions', async (request, reply) => {
    const params = parseAgentParams(request, reply)
    if (!params) return
    if (!assertDefaultAgent(params.agentId, reply)) return
    const body = parseWithSchema(StartBodySchema, request.body, reply, 'body')
    if (!body) return

    try {
      const agent = await resolveAgent(opts, request)
      const input = toAgentSendInput(body, request)
      return reply.code(201).send(await agent.start(input))
    } catch (error) {
      return sendRouteError(reply, error, 'create agent session failed')
    }
  })

  app.post('/api/v1/agents/:agentId/sessions/:sessionId/prompt', async (request, reply) => {
    const params = parseSessionParams(request, reply)
    if (!params) return
    if (!assertDefaultAgent(params.agentId, reply)) return
    const body = parseWithSchema(StartBodySchema, request.body, reply, 'body')
    if (!body) return

    try {
      const agent = await resolveAgent(opts, request)
      const input = { ...toAgentSendInput(body, request), sessionId: params.sessionId }
      return reply.code(202).send(await agent.start(input))
    } catch (error) {
      return sendRouteError(reply, error, 'prompt rejected')
    }
  })

  app.post('/api/v1/agents/:agentId/sessions/:sessionId/interrupt', async (request, reply) => {
    const params = parseSessionParams(request, reply)
    if (!params) return
    if (!assertDefaultAgent(params.agentId, reply)) return
    const body = parseWithSchema(EmptyBodySchema, request.body, reply, 'body')
    if (!body) return

    try {
      const agent = await resolveAgent(opts, request)
      return reply.code(202).send(await agent.interrupt(params.sessionId, sessionCtxFromRequest(request)))
    } catch (error) {
      return sendRouteError(reply, error, 'interrupt rejected')
    }
  })

  app.post('/api/v1/agents/:agentId/sessions/:sessionId/stop', async (request, reply) => {
    const params = parseSessionParams(request, reply)
    if (!params) return
    if (!assertDefaultAgent(params.agentId, reply)) return
    const body = parseWithSchema(EmptyBodySchema, request.body, reply, 'body')
    if (!body) return

    try {
      const agent = await resolveAgent(opts, request)
      return reply.code(202).send(await agent.stop(params.sessionId, sessionCtxFromRequest(request)))
    } catch (error) {
      return sendRouteError(reply, error, 'stop rejected')
    }
  })

  done()
}

function toAgentSendInput(body: z.infer<typeof StartBodySchema>, request: FastifyRequest): AgentSendInput {
  return {
    ...(body.content !== undefined ? { content: body.content } : {}),
    ...(body.message !== undefined ? { message: body.message } : {}),
    ...(body.attachments !== undefined ? { attachments: body.attachments } : {}),
    ...(body.actor !== undefined ? { actor: body.actor } : {}),
    ...(body.originSurface !== undefined ? { originSurface: body.originSurface } : {}),
    ...(body.thinkingLevel !== undefined ? { thinkingLevel: body.thinkingLevel } : {}),
    ...(body.model !== undefined ? { model: body.model } : {}),
    ctx: sessionCtxFromRequest(request),
  }
}

function parseAgentParams(request: FastifyRequest, reply: FastifyReply): { agentId: string } | undefined {
  return parseWithSchema(AgentParamsSchema, request.params, reply, 'params')
}

function parseSessionParams(request: FastifyRequest, reply: FastifyReply): { agentId: string; sessionId: string } | undefined {
  return parseWithSchema(SessionParamsSchema, request.params, reply, 'params')
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

async function resolveAgent(opts: AgentSessionsRoutesOptions, request: FastifyRequest): Promise<Agent> {
  const agent = opts.getAgent ? await opts.getAgent(request) : opts.agent
  if (!agent) {
    throw Object.assign(new Error('agent session route requires agent or getAgent'), {
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
  scope: 'body' | 'params',
): T | undefined {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const firstIssue = parsed.error.issues[0]
  const path = firstIssue?.path.length ? `${scope}.${firstIssue.path.map(String).join('.')}` : scope
  reply.code(400).send({
    error: {
      code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
      message: firstIssue?.message ?? 'invalid request',
      field: path,
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
      retryable: (err as { retryable?: unknown })?.retryable === true ? true : undefined,
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
  if (parsedCode.success && parsedCode.data === ErrorCode.enum.PAYMENT_REQUIRED) return 402
  return 500
}
