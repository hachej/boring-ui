import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  AgentGatewayError,
  AgentGatewayErrorCode,
  type AgentGateway,
  type AgentSessionConnection,
  type AgentSessionRef,
  type IdempotentAgentControl,
  type IdempotentAgentSend,
  type IdempotentQueueClear,
} from '../../shared/index'
import type { PiChatSessionService } from '../../core/piChatSessionService'
import { piChatRoutes } from '../http/routes/piChat'
import type { AgentHostHandle, AgentHostHttpProjectionOptions } from './types'

const ADDRESSED_HEARTBEAT_INTERVAL_MS = 25_000
const SAFE_AGENT_TYPE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

interface ProjectionInput {
  readonly host: AgentHostHandle
  readonly gateway: AgentGateway
  readonly options: AgentHostHttpProjectionOptions
  readonly resolveLegacyPiChatService: (request: FastifyRequest) => Promise<PiChatSessionService>
}

const NonEmptyString = z.string().min(1)
const RequestIdSchema = NonEmptyString.max(256)
const AgentTypeIdSchema = z.string().regex(SAFE_AGENT_TYPE_ID)
const SessionIdSchema = NonEmptyString.max(128)
const EmptyObjectSchema = z.object({}).strict()
const OptionalEmptyBodySchema = z.preprocess((value) => value === undefined ? {} : value, EmptyObjectSchema)
const EmptyQuerySchema = z.object({}).strict()
const AgentParamsSchema = z.object({ agentTypeId: AgentTypeIdSchema }).strict()
const SessionParamsSchema = AgentParamsSchema.extend({ sessionId: SessionIdSchema }).strict()
const ListSessionsQuerySchema = z.object({
  cursor: NonEmptyString.max(8_192).optional(),
  limit: z.preprocess(
    (value) => typeof value === 'string' && value.length > 0 ? Number(value) : value,
    z.number().int().min(1).max(100).optional(),
  ),
}).strict()
const EventsQuerySchema = z.object({
  cursor: z.preprocess(
    (value) => typeof value === 'string' && value.length > 0 ? Number(value) : value,
    z.number().int().nonnegative().optional(),
  ),
}).strict()
const CreateSessionBodySchema = z.preprocess((value) => value === undefined ? {} : value, z.object({
  requestId: RequestIdSchema.optional(),
  title: NonEmptyString.max(200).optional(),
}).strict())
const RenameSessionBodySchema = z.object({
  requestId: RequestIdSchema,
  title: NonEmptyString.max(200),
}).strict()
const DeleteSessionQuerySchema = z.object({ requestId: RequestIdSchema.optional() }).strict()
const ChatModelSelectionSchema = z.object({
  provider: NonEmptyString,
  id: NonEmptyString,
}).strict()
const ChatAttachmentPayloadSchema = z.object({
  filename: z.string().optional(),
  mediaType: z.string().optional(),
  url: NonEmptyString,
  path: z.string().optional(),
}).strict()
const PromptBodySchema = z.object({
  requestId: RequestIdSchema,
  clientNonce: NonEmptyString.max(128),
  content: NonEmptyString.max(1_000_000),
  displayContent: NonEmptyString.max(1_000_000).optional(),
  model: ChatModelSelectionSchema.optional(),
  thinkingLevel: z.enum(['off', 'low', 'medium', 'high']).optional(),
  attachments: z.array(ChatAttachmentPayloadSchema).max(20).optional(),
}).strict()
const FollowUpBodySchema = z.object({
  requestId: RequestIdSchema,
  clientNonce: NonEmptyString.max(128),
  content: NonEmptyString.max(1_000_000),
  displayContent: NonEmptyString.max(1_000_000).optional(),
  clientSeq: z.number().int().nonnegative(),
}).strict()
const ControlBodySchema = z.preprocess((value) => value === undefined ? {} : value, z.object({
  requestId: RequestIdSchema.optional(),
}).strict())
const QueueClearBodySchema = z.preprocess((value) => value === undefined ? {} : value, z.object({
  requestId: RequestIdSchema.optional(),
  clientNonce: NonEmptyString.max(128).optional(),
  clientSeq: z.number().int().nonnegative().optional(),
}).strict())

type RequestScope = 'body' | 'params' | 'query'

function sendValidationError(
  reply: FastifyReply,
  scope: RequestScope,
  issue?: z.ZodIssue,
): FastifyReply {
  const field = issue?.path.length
    ? `${scope}.${issue.path.map(String).join('.')}`
    : scope
  return reply.code(400).send({
    error: {
      code: AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE,
      message: issue?.message ?? 'invalid request',
      details: { field },
    },
  })
}

function parseWithSchema<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  reply: FastifyReply,
  scope: RequestScope,
): T | undefined {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  sendValidationError(reply, scope, parsed.error.issues[0])
  return undefined
}

function statusForGatewayError(code: string): number {
  if (code === AgentGatewayErrorCode.AGENT_SCOPE_DENIED) return 403
  if (code === AgentGatewayErrorCode.AGENT_SESSION_NOT_FOUND || code === AgentGatewayErrorCode.AGENT_TYPE_UNKNOWN) return 404
  if (
    code === AgentGatewayErrorCode.AGENT_REQUEST_CONFLICT
    || code === AgentGatewayErrorCode.AGENT_REQUEST_OUTCOME_UNKNOWN
    || code === AgentGatewayErrorCode.AGENT_COMMAND_INVALID_STATE
    || code === AgentGatewayErrorCode.AGENT_SESSION_RUNTIME_SCOPE_MISMATCH
    || code.includes('CURSOR')
    || code.includes('REPLAY')
  ) return 409
  if (
    code === AgentGatewayErrorCode.AGENT_GATEWAY_CLOSED
    || code === AgentGatewayErrorCode.AGENT_SHARED_ENVIRONMENT_UNAVAILABLE
  ) return 503
  return 400
}

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof AgentGatewayError) {
    return reply.code(statusForGatewayError(error.code)).send({ error: error.toJSON() })
  }
  throw error
}

async function withConnection<T>(
  input: ProjectionInput,
  request: FastifyRequest,
  ref: AgentSessionRef,
  action: (connection: AgentSessionConnection) => Promise<T>,
): Promise<T> {
  const scope = await input.options.authorizeRequest(request)
  const connection = await input.gateway.connectSession({ scope, ref })
  try {
    return await action(connection)
  } finally {
    await connection.close()
  }
}

function registerAddressedRoutes(app: Parameters<FastifyPluginAsync>[0], input: ProjectionInput): void {
  app.get('/api/v1/agents', async (request, reply) => {
    const query = parseWithSchema(EmptyQuerySchema, request.query, reply, 'query')
    if (!query) return
    try {
      return await input.gateway.listAgents({ scope: await input.options.authorizeRequest(request) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/v1/agents/:agentTypeId/sessions', async (request, reply) => {
    const params = parseWithSchema(AgentParamsSchema, request.params, reply, 'params')
    if (!params) return
    const query = parseWithSchema(ListSessionsQuerySchema, request.query, reply, 'query')
    if (!query) return
    try {
      return await input.gateway.listSessions({
        scope: await input.options.authorizeRequest(request),
        agentTypeId: params.agentTypeId,
        cursor: query.cursor,
        limit: query.limit,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/v1/agents/:agentTypeId/sessions', async (request, reply) => {
    const params = parseWithSchema(AgentParamsSchema, request.params, reply, 'params')
    if (!params) return
    const body = parseWithSchema(CreateSessionBodySchema, request.body, reply, 'body')
    if (!body) return
    try {
      const ref = await input.gateway.createSession({
        scope: await input.options.authorizeRequest(request),
        agentTypeId: params.agentTypeId,
        requestId: body.requestId ?? randomUUID(),
        title: body.title,
      })
      return reply.code(201).send(ref)
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/v1/agents/:agentTypeId/sessions/:sessionId/state', async (request, reply) => {
    const params = parseWithSchema(SessionParamsSchema, request.params, reply, 'params')
    if (!params) return
    const query = parseWithSchema(EmptyQuerySchema, request.query, reply, 'query')
    if (!query) return
    try {
      return await input.gateway.readSessionState({
        scope: await input.options.authorizeRequest(request),
        ref: params,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/v1/agents/:agentTypeId/sessions/:sessionId/events', async (request, reply) => {
    const params = parseWithSchema(SessionParamsSchema, request.params, reply, 'params')
    if (!params) return
    const query = parseWithSchema(EventsQuerySchema, request.query, reply, 'query')
    if (!query) return

    let connection: AgentSessionConnection | undefined
    try {
      connection = await input.gateway.connectSession({
        scope: await input.options.authorizeRequest(request),
        ref: params,
        cursor: query.cursor,
      })
      const activeConnection = connection
      const stream = new PassThrough()
      let heartbeat: ReturnType<typeof setInterval> | undefined
      let closed = request.raw.aborted
      const writeFrame = (frame: unknown) => {
        if (!closed) stream.write(`${JSON.stringify(frame)}\n`)
      }
      const close = () => {
        if (closed) return
        closed = true
        request.raw.off('aborted', close)
        reply.raw.off('close', close)
        if (heartbeat) {
          clearInterval(heartbeat)
          heartbeat = undefined
        }
        void activeConnection.close().catch(() => {})
      }
      request.raw.once('aborted', close)
      reply.raw.once('close', close)
      const writeHeartbeat = () => writeFrame({ type: 'heartbeat', now: new Date().toISOString() })
      heartbeat = setInterval(writeHeartbeat, ADDRESSED_HEARTBEAT_INTERVAL_MS)
      heartbeat.unref()
      writeHeartbeat()
      void (async () => {
        try {
          for await (const event of activeConnection.events) writeFrame(event)
        } finally {
          if (!closed) stream.end()
          close()
        }
      })().catch((error) => {
        if (!closed) stream.destroy(error instanceof Error ? error : new Error(String(error)))
        close()
      })
      return reply
        .header('Content-Type', 'application/x-ndjson')
        .header('Cache-Control', 'no-cache, no-transform')
        .header('X-Accel-Buffering', 'no')
        .send(stream)
    } catch (error) {
      await connection?.close().catch(() => {})
      return sendError(reply, error)
    }
  })

  app.post('/api/v1/agents/:agentTypeId/sessions/:sessionId/rename', async (request, reply) => {
    const params = parseWithSchema(SessionParamsSchema, request.params, reply, 'params')
    if (!params) return
    const body = parseWithSchema(RenameSessionBodySchema, request.body, reply, 'body')
    if (!body) return
    try {
      return await input.gateway.renameSession({
        scope: await input.options.authorizeRequest(request),
        ref: params,
        requestId: body.requestId,
        title: body.title,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/v1/agents/:agentTypeId/sessions/:sessionId', async (request, reply) => {
    const params = parseWithSchema(SessionParamsSchema, request.params, reply, 'params')
    if (!params) return
    const query = parseWithSchema(DeleteSessionQuerySchema, request.query, reply, 'query')
    if (!query) return
    const body = parseWithSchema(OptionalEmptyBodySchema, request.body, reply, 'body')
    if (!body) return
    try {
      await input.gateway.deleteSession({
        scope: await input.options.authorizeRequest(request),
        ref: params,
        requestId: query.requestId ?? randomUUID(),
      })
      return reply.code(204).send()
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/v1/agents/:agentTypeId/sessions/:sessionId/prompt', async (request, reply) => {
    const params = parseWithSchema(SessionParamsSchema, request.params, reply, 'params')
    if (!params) return
    const body = parseWithSchema(PromptBodySchema, request.body, reply, 'body')
    if (!body) return
    try {
      const command: IdempotentAgentSend = { kind: 'prompt', ...body }
      return reply.code(202).send(await withConnection(input, request, params, (connection) => connection.send(command)))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/v1/agents/:agentTypeId/sessions/:sessionId/followup', async (request, reply) => {
    const params = parseWithSchema(SessionParamsSchema, request.params, reply, 'params')
    if (!params) return
    const body = parseWithSchema(FollowUpBodySchema, request.body, reply, 'body')
    if (!body) return
    try {
      const command: IdempotentAgentSend = { kind: 'followup', ...body }
      return reply.code(202).send(await withConnection(input, request, params, (connection) => connection.send(command)))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/v1/agents/:agentTypeId/sessions/:sessionId/interrupt', async (request, reply) => {
    const params = parseWithSchema(SessionParamsSchema, request.params, reply, 'params')
    if (!params) return
    const body = parseWithSchema(ControlBodySchema, request.body, reply, 'body')
    if (!body) return
    try {
      const control: IdempotentAgentControl = { requestId: body.requestId ?? randomUUID() }
      return reply.code(202).send(await withConnection(input, request, params, (connection) => connection.interrupt(control)))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/v1/agents/:agentTypeId/sessions/:sessionId/stop', async (request, reply) => {
    const params = parseWithSchema(SessionParamsSchema, request.params, reply, 'params')
    if (!params) return
    const body = parseWithSchema(ControlBodySchema, request.body, reply, 'body')
    if (!body) return
    try {
      const control: IdempotentAgentControl = { requestId: body.requestId ?? randomUUID() }
      return reply.code(202).send(await withConnection(input, request, params, (connection) => connection.stop(control)))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  const clearQueue = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = parseWithSchema(SessionParamsSchema, request.params, reply, 'params')
    if (!params) return
    const body = parseWithSchema(QueueClearBodySchema, request.body, reply, 'body')
    if (!body) return
    try {
      const control: IdempotentQueueClear = {
        requestId: body.requestId ?? randomUUID(),
        clientNonce: body.clientNonce,
        clientSeq: body.clientSeq,
      }
      return reply.code(202).send(await withConnection(input, request, params, (connection) => connection.clearQueue(control)))
    } catch (error) {
      return sendError(reply, error)
    }
  }
  app.post('/api/v1/agents/:agentTypeId/sessions/:sessionId/queue/clear', clearQueue)
  // Preserve the addressed command spelling previously handled by the generic
  // command route while keeping its body on the same closed parser.
  app.post('/api/v1/agents/:agentTypeId/sessions/:sessionId/queue-clear', clearQueue)
}

/** Awaited Fastify projection for the addressed Gateway surface. */
export function createAgentHostRoutes(input: ProjectionInput): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preClose', async () => {
      await input.host.drain()
    })
    app.addHook('onClose', async () => {
      await input.host.close()
    })
    app.setErrorHandler((error, _request, reply) => {
      if ((error as { code?: unknown }).code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
        sendValidationError(reply, 'body')
        return
      }
      reply.send(error)
    })

    registerAddressedRoutes(app, input)
    if (input.options.legacyPiChatAliases) {
      await app.register(piChatRoutes, {
        getService: input.resolveLegacyPiChatService,
      })
    }
  }
}
