import { PassThrough } from 'node:stream'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ErrorCode, type ErrorCode as StableErrorCode } from '../../../shared/error-codes'
import type {
  CommandReceipt,
  FollowUpPayload,
  FollowUpReceipt,
  InterruptPayload,
  PiChatEvent,
  PiChatSnapshot,
  PiChatStreamFrame,
  PromptPayload,
  PromptReceipt,
  QueueClearPayload,
  QueueClearReceipt,
  StopPayload,
  StopReceipt,
} from '../../../shared/chat'
import {
  FollowUpPayloadSchema,
  InterruptPayloadSchema,
  PiChatSnapshotSchema,
  PromptPayloadSchema,
  QueueClearPayloadSchema,
  StopPayloadSchema,
} from '../../../shared/chat'
import type { PiChatReplayRangeError } from '../../pi-chat/piChatReplayBuffer'
import { PI_CHAT_CURSOR_AHEAD, PI_CHAT_REPLAY_GAP } from '../../pi-chat/piChatReplayBuffer'
import type { PiSessionCreateInit, PiSessionRequestContext } from '../../pi-chat/piSessionIdentity'
import type { SessionListOptions, SessionSummary } from '../../../shared/session'

const DEFAULT_WORKSPACE_ID = 'default'
const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000
const DEFAULT_SESSION_LIST_LIMIT = 50
const MAX_SESSION_LIST_LIMIT = 100
const SAFE_SESSION_LIST_INCLUDE_ID = /^[a-zA-Z0-9_-]{1,128}$/

const SessionParamsSchema = z.object({
  sessionId: z.string().min(1).max(128),
})

const CursorValueSchema: z.ZodType<number, z.ZodTypeDef, unknown> = z.preprocess((value) => {
  if (value === undefined) return 0
  if (typeof value === 'string' && value.length > 0) return Number(value)
  return value
}, z.number().int().nonnegative())

interface EventsQuery {
  cursor: number
}

const EventsQuerySchema: z.ZodType<EventsQuery, z.ZodTypeDef, unknown> = z.object({
  cursor: CursorValueSchema,
})

const EmptyBodySchema = z.preprocess((value) => value ?? {}, z.object({}).strict())
const CreateSessionBodySchema = z.preprocess((value) => value ?? {}, z.object({
  title: z.string().min(1).max(200).optional(),
}).strict())

export interface PiChatEventStreamSubscription {
  type: 'ok'
  unsubscribe: () => void
  /** Optional test/service completion hook. Real live streams normally omit it. */
  closed?: Promise<void>
}

export type PiChatEventStreamResult = PiChatEventStreamSubscription | PiChatReplayRangeError

export type PiChatEventSubscriber = (event: PiChatEvent) => void

export interface PiChatSessionService {
  listSessions?(ctx: PiSessionRequestContext, options?: SessionListOptions): Promise<SessionSummary[]>
  createSession?(ctx: PiSessionRequestContext, init?: PiSessionCreateInit): Promise<SessionSummary>
  deleteSession?(ctx: PiSessionRequestContext, sessionId: string): Promise<void>
  readState(ctx: PiSessionRequestContext, sessionId: string): Promise<PiChatSnapshot>
  subscribe(ctx: PiSessionRequestContext, sessionId: string, cursor: number, subscriber: PiChatEventSubscriber): Promise<PiChatEventStreamResult>
  prompt(ctx: PiSessionRequestContext, sessionId: string, payload: PromptPayload): Promise<PromptReceipt>
  followUp(ctx: PiSessionRequestContext, sessionId: string, payload: FollowUpPayload): Promise<FollowUpReceipt>
  clearQueue(ctx: PiSessionRequestContext, sessionId: string, payload: QueueClearPayload): Promise<QueueClearReceipt>
  interrupt(ctx: PiSessionRequestContext, sessionId: string, payload: InterruptPayload): Promise<CommandReceipt>
  stop(ctx: PiSessionRequestContext, sessionId: string, payload: StopPayload): Promise<StopReceipt>
}

export interface PiChatRoutesOptions {
  service?: PiChatSessionService
  getService?: (request: FastifyRequest) => PiChatSessionService | Promise<PiChatSessionService>
  heartbeatIntervalMs?: number | false
  /** Set false for pure/headless surfaces that must not persist workspaceId. */
  defaultWorkspaceId?: string | false
}

export interface PiChatRouteErrorOptions {
  statusCode: number
  code: StableErrorCode
  message: string
  retryable?: boolean
  details?: unknown
}

export class PiChatRouteError extends Error {
  readonly statusCode: number
  readonly code: StableErrorCode
  readonly retryable?: boolean
  readonly details?: unknown

  constructor(options: PiChatRouteErrorOptions) {
    super(options.message)
    this.name = 'PiChatRouteError'
    this.statusCode = options.statusCode
    this.code = options.code
    this.retryable = options.retryable
    this.details = options.details
  }
}

export function piChatBusyError(message = 'session is busy'): PiChatRouteError {
  return new PiChatRouteError({
    statusCode: 409,
    code: ErrorCode.enum.SESSION_LOCKED,
    message,
    retryable: true,
  })
}

export function piChatRoutes(
  app: FastifyInstance,
  opts: PiChatRoutesOptions,
  done: (err?: Error) => void,
): void {
  app.get('/api/v1/agent/pi-chat/sessions', async (request, reply) => {
    try {
      const service = await resolveService(opts, request)
      if (!service.listSessions) throw unsupportedServiceMethod('list Pi chat sessions')
      return reply.send(await service.listSessions(getRequestContext(request, opts), sessionListOptions(request)))
    } catch (err) {
      return sendRouteError(reply, err, 'list pi chat sessions failed')
    }
  })

  app.post('/api/v1/agent/pi-chat/sessions', async (request, reply) => {
    const body = parseWithSchema(CreateSessionBodySchema, request.body, reply, 'body')
    if (!body) return
    try {
      const service = await resolveService(opts, request)
      if (!service.createSession) throw unsupportedServiceMethod('create Pi chat session')
      return reply.code(201).send(await service.createSession(getRequestContext(request, opts), body))
    } catch (err) {
      return sendRouteError(reply, err, 'create pi chat session failed')
    }
  })

  app.delete('/api/v1/agent/pi-chat/sessions/:sessionId', async (request, reply) => {
    const params = parseParams(request, reply)
    if (!params) return
    try {
      const service = await resolveService(opts, request)
      if (!service.deleteSession) throw unsupportedServiceMethod('delete Pi chat session')
      await service.deleteSession(getRequestContext(request, opts), params.sessionId)
      return reply.code(204).send()
    } catch (err) {
      return sendRouteError(reply, err, 'delete pi chat session failed')
    }
  })

  app.get('/api/v1/agent/pi-chat/:sessionId/state', async (request, reply) => {
    const params = parseParams(request, reply)
    if (!params) return

    try {
      const service = await resolveService(opts, request)
      const snapshot = await service.readState(getRequestContext(request, opts), params.sessionId)
      return reply.send(PiChatSnapshotSchema.parse(snapshot))
    } catch (err) {
      return sendRouteError(reply, err, 'read pi chat state failed')
    }
  })

  app.get('/api/v1/agent/pi-chat/:sessionId/events', async (request, reply) => {
    const params = parseParams(request, reply)
    if (!params) return
    const query = parseWithSchema<EventsQuery>(EventsQuerySchema, request.query, reply, 'query')
    if (!query) return

    let subscription: PiChatEventStreamSubscription | undefined
    const stream = new PassThrough()
    let closed = false
    const writeFrame = (frame: PiChatStreamFrame) => {
      if (closed) return
      stream.write(`${JSON.stringify(frame)}\n`)
    }

    try {
      const service = await resolveService(opts, request)
      const result = await service.subscribe(getRequestContext(request, opts), params.sessionId, query.cursor, writeFrame)
      if (result.type !== 'ok') {
        return sendReplayRangeError(reply, result)
      }
      subscription = result
    } catch (err) {
      return sendRouteError(reply, err, 'open pi chat event stream failed')
    }

    const heartbeatIntervalMs = opts.heartbeatIntervalMs === undefined
      ? DEFAULT_HEARTBEAT_INTERVAL_MS
      : opts.heartbeatIntervalMs
    const writeHeartbeat = () => writeFrame({ type: 'heartbeat', now: new Date().toISOString() })
    const heartbeat = heartbeatIntervalMs === false
      ? undefined
      : setInterval(writeHeartbeat, heartbeatIntervalMs)
    if (heartbeatIntervalMs !== false) writeHeartbeat()

    const close = () => {
      if (closed) return
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      subscription?.unsubscribe()
    }

    stream.on('close', close)
    reply.raw.on('close', close)
    subscription.closed?.finally(() => {
      if (!closed) stream.end()
    }).catch(() => {
      if (!closed) stream.end()
    })

    return reply
      .header('Content-Type', 'application/x-ndjson')
      .header('Cache-Control', 'no-cache, no-transform')
      .header('X-Accel-Buffering', 'no')
      .send(stream)
  })

  app.post('/api/v1/agent/pi-chat/:sessionId/prompt', async (request, reply) => {
    const params = parseParams(request, reply)
    if (!params) return
    const body = parseWithSchema(PromptPayloadSchema, request.body, reply, 'body')
    if (!body) return
    try {
      const service = await resolveService(opts, request)
      const receipt = await service.prompt(getRequestContext(request, opts), params.sessionId, body)
      return reply.code(202).send(receipt)
    } catch (err) {
      return sendRouteError(reply, err, 'prompt rejected')
    }
  })

  app.post('/api/v1/agent/pi-chat/:sessionId/followup', async (request, reply) => {
    const params = parseParams(request, reply)
    if (!params) return
    const body = parseWithSchema(FollowUpPayloadSchema, request.body, reply, 'body')
    if (!body) return
    try {
      const service = await resolveService(opts, request)
      const receipt = await service.followUp(getRequestContext(request, opts), params.sessionId, body)
      return reply.code(202).send(receipt)
    } catch (err) {
      return sendRouteError(reply, err, 'follow-up rejected')
    }
  })

  app.post('/api/v1/agent/pi-chat/:sessionId/queue/clear', async (request, reply) => {
    const params = parseParams(request, reply)
    if (!params) return
    const body = parseWithSchema(QueueClearPayloadSchema, request.body, reply, 'body')
    if (!body) return
    try {
      const service = await resolveService(opts, request)
      const receipt = await service.clearQueue(getRequestContext(request, opts), params.sessionId, body)
      return reply.code(202).send(receipt)
    } catch (err) {
      return sendRouteError(reply, err, 'queue clear rejected')
    }
  })

  app.post('/api/v1/agent/pi-chat/:sessionId/interrupt', async (request, reply) => {
    const params = parseParams(request, reply)
    if (!params) return
    const body = parseWithSchema(EmptyBodySchema.pipe(InterruptPayloadSchema), request.body, reply, 'body')
    if (!body) return
    try {
      const service = await resolveService(opts, request)
      const receipt = await service.interrupt(getRequestContext(request, opts), params.sessionId, body)
      return reply.code(202).send(receipt)
    } catch (err) {
      return sendRouteError(reply, err, 'interrupt rejected')
    }
  })

  app.post('/api/v1/agent/pi-chat/:sessionId/stop', async (request, reply) => {
    const params = parseParams(request, reply)
    if (!params) return
    const body = parseWithSchema(EmptyBodySchema.pipe(StopPayloadSchema), request.body, reply, 'body')
    if (!body) return
    try {
      const service = await resolveService(opts, request)
      const receipt = await service.stop(getRequestContext(request, opts), params.sessionId, body)
      return reply.code(202).send(receipt)
    } catch (err) {
      return sendRouteError(reply, err, 'stop rejected')
    }
  })

  done()
}

function parseParams(request: FastifyRequest, reply: FastifyReply): { sessionId: string } | undefined {
  return parseWithSchema(SessionParamsSchema, request.params, reply, 'params')
}

function sessionListOptions(request: FastifyRequest): SessionListOptions {
  const query = request.query as Record<string, unknown>
  return {
    limit: boundedInteger(query.limit, DEFAULT_SESSION_LIST_LIMIT, 1, MAX_SESSION_LIST_LIMIT),
    offset: boundedInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    includeId: optionalSessionId(query.activeSessionId),
  }
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function optionalSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_SESSION_LIST_INCLUDE_ID.test(value) ? value : undefined
}

function parseWithSchema<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, reply: FastifyReply, scope: 'body' | 'params' | 'query'): T | undefined {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const firstIssue = parsed.error.issues[0]
  const path = firstIssue?.path.length ? `${scope}.${firstIssue.path.map(String).join('.')}` : scope
  reply.code(400).send({
    error: {
      code: ErrorCode.enum.BRIDGE_COMMAND_INVALID,
      message: firstIssue?.message ?? 'invalid request',
      retryable: false,
      field: path,
    },
  })
  return undefined
}

function unsupportedServiceMethod(action: string): PiChatRouteError {
  return new PiChatRouteError({
    statusCode: 501,
    code: ErrorCode.enum.INTERNAL_ERROR,
    message: `pi chat service does not support ${action}`,
  })
}

async function resolveService(opts: PiChatRoutesOptions, request: FastifyRequest): Promise<PiChatSessionService> {
  const service = opts.getService ? await opts.getService(request) : opts.service
  if (!service) {
    throw new PiChatRouteError({
      statusCode: 500,
      code: ErrorCode.enum.INTERNAL_ERROR,
      message: 'pi chat route requires service or getService',
    })
  }
  return service
}

function getRequestContext(request: FastifyRequest, opts: PiChatRoutesOptions): PiSessionRequestContext {
  const storageScopeHeader = request.headers['x-boring-storage-scope']
  const authSubject = (request as FastifyRequest & { user?: { id?: unknown } | null }).user?.id
  const workspaceId = opts.defaultWorkspaceId === false
    ? undefined
    : request.workspaceContext?.workspaceId ?? opts.defaultWorkspaceId ?? DEFAULT_WORKSPACE_ID
  return {
    workspaceId,
    storageScope: typeof storageScopeHeader === 'string' && storageScopeHeader.length > 0 ? storageScopeHeader : undefined,
    authSubject: typeof authSubject === 'string' && authSubject.length > 0 ? authSubject : undefined,
    requestId: request.id,
  }
}

function sendReplayRangeError(reply: FastifyReply, error: PiChatReplayRangeError): FastifyReply {
  const reason = error.type === PI_CHAT_REPLAY_GAP ? PI_CHAT_REPLAY_GAP : PI_CHAT_CURSOR_AHEAD
  return reply.code(409).send({
    error: {
      code: ErrorCode.enum.CURSOR_OUT_OF_RANGE,
      message: reason,
      retryable: true,
      details: {
        reason,
        latestSeq: error.latestSeq,
        minReplaySeq: error.minReplaySeq,
      },
    },
  })
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
  if (parsedCode.success && parsedCode.data === ErrorCode.enum.PAYMENT_REQUIRED) return 402
  return 500
}
