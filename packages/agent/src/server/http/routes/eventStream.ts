import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Agent } from '../../../shared/events'
import { sessionStreamPath } from '../../../shared/events'
import { ErrorCode } from '../../../shared/error-codes'
import type { EventStreamStore } from '../../events/eventStreamStore'
import { handleStreamHead, handleStreamRead } from '../../events/handleStreamRoutes'

const DEFAULT_AGENT_ID = 'default'

const StreamParamsSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1).max(128),
})

export interface EventStreamRoutesOptions {
  eventStore?: EventStreamStore
  getEventStore?: (request: FastifyRequest) => EventStreamStore | Promise<EventStreamStore>
}

export type AuthorizedEventStreamRoutesOptions = EventStreamRoutesOptions & (
  | { agent: Agent; getAgent?: never }
  | { agent?: never; getAgent: (request: FastifyRequest) => Agent | Promise<Agent> }
)

export function eventStreamRoutes(
  app: FastifyInstance,
  opts: AuthorizedEventStreamRoutesOptions,
  done: (err?: Error) => void,
): void {
  app.route({
    method: 'GET',
    url: '/api/v1/agents/:agentId/sessions/:sessionId/events/stream',
    exposeHeadRoute: false,
    handler: async (request, reply) => {
      return handleEventStreamRequest('GET', opts, request, reply)
    },
  })

  app.head('/api/v1/agents/:agentId/sessions/:sessionId/events/stream', async (request, reply) => {
    return handleEventStreamRequest('HEAD', opts, request, reply)
  })

  done()
}

async function handleEventStreamRequest(
  method: 'GET' | 'HEAD',
  opts: AuthorizedEventStreamRoutesOptions,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  const params = parseParams(request, reply)
  if (!params) return
  if (!assertDefaultAgent(params.agentId, reply)) return

  try {
    await authorizeSession(opts, request, params.sessionId)
    const store = await resolveEventStore(opts, request)
    const streamPath = sessionStreamPath(params.sessionId)
    const abortController = new AbortController()
    const abort = () => abortController.abort()
    reply.raw.once('close', abort)
    request.raw.once('aborted', abort)
    const webRequest = fastifyToWebRequest(request, abortController.signal)
    const webResponse = method === 'HEAD'
      ? await handleStreamHead(store, streamPath)
      : await handleStreamRead(store, streamPath, webRequest)
    return webResponseToFastify(webResponse, reply)
  } catch (error) {
    return sendRouteError(reply, error, 'event stream request failed')
  }
}

export function fastifyToWebRequest(request: FastifyRequest, signal?: AbortSignal): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
      continue
    }
    headers.set(key, String(value))
  }

  const rawUrl = request.raw.url ?? request.url
  const hostHeader = request.headers.host
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader
  const url = rawUrl.startsWith('http')
    ? rawUrl
    : `${request.protocol}://${host ?? 'localhost'}${rawUrl}`

  return new Request(url, {
    method: request.method,
    headers,
    signal,
  })
}

export async function webResponseToFastify(response: Response, reply: FastifyReply): Promise<FastifyReply> {
  reply.code(response.status)
  response.headers.forEach((value, key) => {
    reply.header(key, value)
  })
  reply.header('X-Accel-Buffering', 'no')

  if (response.body === null || response.status === 204 || response.status === 304) {
    return reply.send()
  }

  return reply.send(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>))
}

function parseParams(request: FastifyRequest, reply: FastifyReply): { agentId: string; sessionId: string } | undefined {
  const parsed = StreamParamsSchema.safeParse(request.params)
  if (parsed.success) return parsed.data
  reply.code(404).send({
    error: {
      code: ErrorCode.enum.SESSION_NOT_FOUND,
      message: 'event stream route not found',
    },
  })
  return undefined
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

async function authorizeSession(
  opts: AuthorizedEventStreamRoutesOptions,
  request: FastifyRequest,
  sessionId: string,
): Promise<void> {
  const agent = opts.getAgent ? await opts.getAgent(request) : opts.agent
  if (!agent) {
    throw Object.assign(new Error('event stream route requires agent or getAgent'), {
      code: ErrorCode.enum.INTERNAL_ERROR,
      statusCode: 500,
    })
  }
  await agent.sessions.load(sessionCtxFromRequest(request), sessionId)
}

async function resolveEventStore(opts: EventStreamRoutesOptions, request: FastifyRequest): Promise<EventStreamStore> {
  const store = opts.getEventStore ? await opts.getEventStore(request) : opts.eventStore
  if (!store) {
    throw Object.assign(new Error('event stream route requires eventStore or getEventStore'), {
      code: ErrorCode.enum.INTERNAL_ERROR,
      statusCode: 500,
    })
  }
  return store
}

function sessionCtxFromRequest(request: FastifyRequest): { workspaceId?: string; userId?: string } {
  const userId = (request as { user?: { id?: unknown } }).user?.id
  return {
    workspaceId: request.workspaceContext?.workspaceId,
    userId: typeof userId === 'string' && userId.trim() ? userId.trim() : undefined,
  }
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
