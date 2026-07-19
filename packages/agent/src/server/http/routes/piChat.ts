import { PassThrough } from 'node:stream'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ErrorCode, type ErrorCode as StableErrorCode } from '../../../shared/error-codes'
import type {
  PiChatStreamFrame,
} from '../../../shared/chat'
import {
  FollowUpPayloadSchema,
  InterruptPayloadSchema,
  PiChatSnapshotSchema,
  PromptPayloadSchema,
  QueueClearPayloadSchema,
  StopPayloadSchema,
  NativePromptRequestSchema,
  PromptNewSessionReceiptSchema,
} from '../../../shared/chat'
import { PI_CHAT_CURSOR_AHEAD, PI_CHAT_REPLAY_GAP } from '../../pi-chat/piChatReplayBuffer'
import type { SessionListOptions } from '../../../shared/session'
import {
  AgentEffectAdmissionError,
  type PiChatEventStreamSubscription,
  type PiChatReplayRangeError,
  type PiChatSessionService,
  type PiSessionRequestContext,
} from '../../../core/piChatSessionService'

const DEFAULT_WORKSPACE_ID = 'default'
const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000
const DEFAULT_SESSION_LIST_LIMIT = 50
const MAX_SESSION_LIST_LIMIT = 100
const SAFE_SESSION_LIST_INCLUDE_ID = /^[a-zA-Z0-9_-]{1,128}$/

const SessionParamsSchema = z.object({
  sessionId: z.string().min(1).max(128),
})

const AttachmentParamsSchema = SessionParamsSchema.extend({
  messageId: z.string().min(1).max(512),
  index: z.preprocess((value) => {
    if (typeof value === 'string' && value.length > 0) return Number(value)
    return value
  }, z.number().int().nonnegative()),
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
const RenameSessionBodySchema = z.object({
  title: z.string().min(1).max(200),
}).strict()

const SessionActivityBodySchema = z.object({
  sessionIds: z.array(z.string().min(1).max(128)).min(1).max(50),
}).strict()

export type {
  PiChatEventStreamResult,
  PiChatEventStreamSubscription,
  PiChatEventSubscriber,
  PiChatSessionService,
} from '../../../core/piChatSessionService'

export interface PiChatRoutesOptions {
  service?: PiChatSessionService
  getService?: (request: FastifyRequest) => PiChatSessionService | Promise<PiChatSessionService>
  heartbeatIntervalMs?: number | false
  /** Direct/local-only capability for browser-local chats to create native Pi transcripts. */
  nativeSessionStartEnabled?: boolean
  deferLeaseRelease?: (request: FastifyRequest) => void
  /** Trusted host principal fallback for local/dev requests without request.user. */
  getAuthSubject?: (request: FastifyRequest) => string | undefined
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

  app.post('/api/v1/agent/pi-chat/sessions/activity', async (request, reply) => {
    const body = parseWithSchema(SessionActivityBodySchema, request.body, reply, 'body')
    if (!body) return
    try {
      const service = await resolveService(opts, request)
      if (!service.listSessions) throw unsupportedServiceMethod('list Pi chat session activity')
      const ctx = getRequestContext(request, opts)
      const sessionIds = [...new Set(body.sessionIds)]
      const summaries = await service.listSessions(ctx, { limit: MAX_SESSION_LIST_LIMIT })
      const summariesById = new Map(summaries.map((summary) => [summary.id, summary]))
      const sessions: Array<{
        sessionId: string
        title: string
        updatedAt: string
        status: string
        queuedCount: number
        hasError: boolean
      }> = []
      const omittedSessionIds: string[] = []

      for (const sessionId of sessionIds) {
        try {
          let summary = summariesById.get(sessionId)
          if (!summary) {
            summary = (await service.listSessions(ctx, { limit: 1, includeId: sessionId }))
              .find((candidate) => candidate.id === sessionId)
          }
          if (!summary) {
            omittedSessionIds.push(sessionId)
            continue
          }
          const snapshot = await service.readState(ctx, sessionId)
          sessions.push({
            sessionId,
            title: summary.title,
            updatedAt: summary.updatedAt,
            status: snapshot.status,
            queuedCount: snapshot.queue.followUps.length,
            hasError: snapshot.status === 'error' || Boolean(snapshot.error),
          })
        } catch {
          omittedSessionIds.push(sessionId)
        }
      }

      return reply.send({ sessions, omittedSessionIds })
    } catch (err) {
      return sendRouteError(reply, err, 'list pi chat session activity failed')
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
      return sendRouteError(reply, err, 'create pi chat session failed', true)
    }
  })

  if (opts.nativeSessionStartEnabled) {
    app.post('/api/v1/agent/pi-chat/sessions/native-prompt', async (request, reply) => {
      const body = parseWithSchema(NativePromptRequestSchema, request.body, reply, 'body')
      if (!body) return
      try {
        const service = await resolveService(opts, request)
        if (!service.promptNewSession) throw unsupportedServiceMethod('create native Pi chat session')
        const { nativeSessionStart, ...payload } = body
        const receipt = await service.promptNewSession(getRequestContext(request, opts), payload, nativeSessionStart)
        return reply.code(202).send(PromptNewSessionReceiptSchema.parse(receipt))
      } catch (err) {
        return sendRouteError(reply, err, 'create native pi chat session failed', true)
      }
    })
  }

  app.patch('/api/v1/agent/pi-chat/sessions/:sessionId', async (request, reply) => {
    const params = parseParams(request, reply)
    if (!params) return
    const body = parseWithSchema(RenameSessionBodySchema, request.body, reply, 'body')
    if (!body) return
    try {
      const service = await resolveService(opts, request)
      if (!service.renameSession) throw unsupportedServiceMethod('rename Pi chat session')
      return reply.send(await service.renameSession(getRequestContext(request, opts), params.sessionId, body.title))
    } catch (err) {
      return sendRouteError(reply, err, 'rename pi chat session failed', true)
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
      return sendRouteError(reply, err, 'delete pi chat session failed', true)
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

  app.get('/api/v1/agent/pi-chat/:sessionId/attachments/:messageId/:index', async (request, reply) => {
    const params = parseWithSchema(AttachmentParamsSchema, request.params, reply, 'params')
    if (!params) return

    try {
      const service = await resolveService(opts, request)
      if (!service.readAttachment) throw unsupportedServiceMethod('read Pi chat attachment')
      const attachment = await service.readAttachment(getRequestContext(request, opts), params.sessionId, params.messageId, params.index)
      if (!attachment.mediaType.startsWith('image/')) {
        throw new PiChatRouteError({ statusCode: 404, code: ErrorCode.enum.SESSION_NOT_FOUND, message: 'attachment not found' })
      }
      return reply
        .header('Content-Type', attachment.mediaType)
        .header('Cache-Control', 'private, max-age=300')
        .header('X-Content-Type-Options', 'nosniff')
        .send(Buffer.from(attachment.data))
    } catch (err) {
      return sendRouteError(reply, err, 'read pi chat attachment failed')
    }
  })

  app.get('/api/v1/agent/pi-chat/:sessionId/events', async (request, reply) => {
    const params = parseParams(request, reply)
    if (!params) return
    const query = parseWithSchema<EventsQuery>(EventsQuerySchema, request.query, reply, 'query')
    if (!query) return

    let subscription: PiChatEventStreamSubscription | undefined
    let subscriptionReleased = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const stream = new PassThrough()
    let transportClosed = request.raw.aborted
    const close = () => {
      request.raw.off('aborted', close)
      reply.raw.off('close', close)
      transportClosed = true
      if (heartbeat) {
        clearInterval(heartbeat)
        heartbeat = undefined
      }
      if (subscription && !subscriptionReleased) {
        subscriptionReleased = true
        subscription.unsubscribe()
      }
    }
    const writeFrame = (frame: PiChatStreamFrame) => {
      if (transportClosed) return
      stream.write(`${JSON.stringify(frame)}\n`)
    }
    request.raw.once('aborted', close)
    reply.raw.once('close', close)

    try {
      const service = await resolveService(opts, request)
      if (transportClosed) return reply
      const result = await service.subscribe(getRequestContext(request, opts), params.sessionId, query.cursor, writeFrame)
      if (result.type !== 'ok') {
        if (transportClosed) return reply
        return sendReplayRangeError(reply, result)
      }
      subscription = result
    } catch (err) {
      if (transportClosed) return reply
      return sendRouteError(reply, err, 'open pi chat event stream failed')
    }

    if (transportClosed) {
      close()
      stream.destroy()
      return reply
    }

    const heartbeatIntervalMs = opts.heartbeatIntervalMs === undefined
      ? DEFAULT_HEARTBEAT_INTERVAL_MS
      : opts.heartbeatIntervalMs
    const writeHeartbeat = () => writeFrame({ type: 'heartbeat', now: new Date().toISOString() })
    heartbeat = heartbeatIntervalMs === false
      ? undefined
      : setInterval(writeHeartbeat, heartbeatIntervalMs)
    if (heartbeatIntervalMs !== false) writeHeartbeat()

    stream.on('close', close)
    subscription.closed?.finally(() => {
      if (!transportClosed) stream.end()
    }).catch(() => {
      if (!transportClosed) stream.end()
    })

    if (transportClosed) {
      close()
      stream.destroy()
      return reply
    }

    const streamedReply = reply
      .header('Content-Type', 'application/x-ndjson')
      .header('Cache-Control', 'no-cache, no-transform')
      .header('X-Accel-Buffering', 'no')
      .send(stream)
    opts.deferLeaseRelease?.(request)
    return streamedReply
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
      return sendRouteError(reply, err, 'prompt rejected', true)
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
      return sendRouteError(reply, err, 'follow-up rejected', true)
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
      return sendRouteError(reply, err, 'queue clear rejected', true)
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
      return sendRouteError(reply, err, 'interrupt rejected', true)
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
      return sendRouteError(reply, err, 'stop rejected', true)
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
  const user = (request as FastifyRequest & { user?: { id?: unknown; email?: unknown; emailVerified?: unknown } | null }).user
  const userId = user?.id
  const authSubject = typeof userId === 'string' && userId.length > 0 ? userId : opts.getAuthSubject?.(request)
  const authEmail = user?.email
  return {
    workspaceId: request.workspaceContext?.workspaceId ?? DEFAULT_WORKSPACE_ID,
    storageScope: typeof storageScopeHeader === 'string' && storageScopeHeader.length > 0 ? storageScopeHeader : undefined,
    authSubject: typeof authSubject === 'string' && authSubject.length > 0 ? authSubject : undefined,
    authEmail: typeof authEmail === 'string' && authEmail.length > 0 ? authEmail : undefined,
    authEmailVerified: user?.emailVerified === true,
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

function sendRouteError(
  reply: FastifyReply,
  err: unknown,
  fallbackMessage: string,
  preserveAdmissionError = false,
): FastifyReply {
  const statusCode = statusCodeFromError(err)
  const parsedCode = ErrorCode.safeParse((err as { code?: unknown })?.code)
  const admissionError = preserveAdmissionError && err instanceof AgentEffectAdmissionError
  const rejectedAdmissionError = !preserveAdmissionError && err instanceof AgentEffectAdmissionError
  const code = admissionError
    ? err.code
    : parsedCode.success ? parsedCode.data : ErrorCode.enum.INTERNAL_ERROR
  const message = !rejectedAdmissionError && err instanceof Error ? err.message : fallbackMessage
  return reply.code(statusCode).send({
    error: {
      code,
      message,
      retryable: (err as { retryable?: unknown })?.retryable === true ? true : undefined,
      details: rejectedAdmissionError ? undefined : (err as { details?: unknown })?.details,
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
