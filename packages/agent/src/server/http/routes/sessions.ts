import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type {
  SessionStore,
  SessionCtx,
  SessionSummary,
  SessionDetail,
  SessionListOptions,
} from '../../../shared/session'
import type { UIMessage } from '../../../shared/message'
import {
  createBodyValidator,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_NOT_FOUND,
  ERROR_CODE_VALIDATION_ERROR,
} from '../middleware'

const DEFAULT_SESSION_TITLE = 'New session'
const DEFAULT_WORKSPACE_ID = 'default'
const DEFAULT_SESSION_LIST_LIMIT = 50
const MAX_SESSION_LIST_LIMIT = 100

const createSessionBodySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
  })
  .optional()

type CreateSessionBody = z.infer<typeof createSessionBodySchema>

interface InMemorySession {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  workspaceId: string
  messages: UIMessage[]
}

class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`)
    this.name = 'SessionNotFoundError'
  }
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, InMemorySession>()

  async list(ctx: SessionCtx, options?: SessionListOptions): Promise<SessionSummary[]> {
    const offset = options?.offset ?? 0
    const limit = options?.limit
    const summaries = Array.from(this.sessions.values())
      .filter((session) => session.workspaceId === ctx.workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toSummary)
    return limit === undefined ? summaries.slice(offset) : summaries.slice(offset, offset + limit)
  }

  async create(
    ctx: SessionCtx,
    init?: { title?: string },
  ): Promise<SessionSummary> {
    const now = new Date().toISOString()
    const session: InMemorySession = {
      id: randomUUID(),
      title: init?.title ?? DEFAULT_SESSION_TITLE,
      createdAt: now,
      updatedAt: now,
      workspaceId: ctx.workspaceId,
      messages: [],
    }

    this.sessions.set(session.id, session)
    return toSummary(session)
  }

  async load(ctx: SessionCtx, sessionId: string): Promise<SessionDetail> {
    const session = this.sessions.get(sessionId)
    if (!session || session.workspaceId !== ctx.workspaceId) {
      throw new SessionNotFoundError(sessionId)
    }

    return {
      ...toSummary(session),
      messages: session.messages,
    }
  }

  async delete(ctx: SessionCtx, sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session && session.workspaceId === ctx.workspaceId) {
      this.sessions.delete(sessionId)
    }
  }

  async saveMessages(ctx: SessionCtx, sessionId: string, messages: UIMessage[]): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session && session.workspaceId === ctx.workspaceId) {
      session.messages = messages
      session.updatedAt = new Date().toISOString()
    }
  }
}

export interface SessionRoutesOptions {
  sessionStore?: SessionStore
  getSessionStore?: (request: FastifyRequest) => SessionStore | Promise<SessionStore>
}

function toSummary(session: InMemorySession): SessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    turnCount: session.messages.filter((message) => message.role === 'user').length,
  }
}

function sessionListOptions(request: FastifyRequest): SessionListOptions {
  const query = request.query as Record<string, unknown>
  return {
    limit: boundedInteger(query.limit, DEFAULT_SESSION_LIST_LIMIT, 1, MAX_SESSION_LIST_LIMIT),
    offset: boundedInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
  }
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function getSessionCtx(request: FastifyRequest): SessionCtx {
  const workspaceContext = (
    request as FastifyRequest & {
      workspaceContext?: { workspaceId: string; authenticated: boolean }
    }
  ).workspaceContext

  return {
    workspaceId: workspaceContext?.workspaceId ?? DEFAULT_WORKSPACE_ID,
  }
}

function requireSessionId(
  value: unknown,
  reply: FastifyReply,
): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    reply.code(400).send({
      error: {
        code: ERROR_CODE_VALIDATION_ERROR,
        message: 'id is required',
        field: 'id',
      },
    })
    return null
  }
  return value
}

function isNotFoundError(err: unknown): boolean {
  return (
    err instanceof SessionNotFoundError ||
    (err instanceof Error && /not found/i.test(err.message))
  )
}

function classifySessionError(err: unknown, reply: FastifyReply): FastifyReply {
  const statusCode = (err as { statusCode?: unknown })?.statusCode
  const stableCode = (err as { code?: unknown })?.code
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) {
    const message = err instanceof Error ? err.message : 'session route failed'
    return reply.code(statusCode).send({
      error: {
        code: typeof stableCode === 'string' ? stableCode : ERROR_CODE_INTERNAL,
        message,
        details: (err as { details?: unknown })?.details,
      },
    })
  }

  if (isNotFoundError(err)) {
    return reply.code(404).send({
      error: {
        code: ERROR_CODE_NOT_FOUND,
        message: 'session not found',
      },
    })
  }

  const message = err instanceof Error ? err.message : 'internal error'
  return reply.code(500).send({
    error: {
      code: ERROR_CODE_INTERNAL,
      message,
    },
  })
}

function stableStringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function partText(part: unknown): string {
  const value = part as Record<string, unknown>
  if (typeof value.text === 'string') return value.text
  if (typeof value.delta === 'string') return value.delta
  if (typeof value.content === 'string') return value.content
  return ''
}

function toolName(part: Record<string, unknown>): string {
  if (typeof part.toolName === 'string') return part.toolName
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    return part.type.slice('tool-'.length)
  }
  return 'tool'
}

function formatToolPart(part: Record<string, unknown>): string {
  const name = toolName(part)
  const lines = [`[tool:${name}]`]
  if ('input' in part) {
    lines.push('input:', stableStringify(part.input))
  }
  if ('output' in part) {
    lines.push('output:', stableStringify(part.output))
  }
  if (typeof part.errorText === 'string' && part.errorText.length > 0) {
    lines.push('error:', part.errorText)
  }
  return lines.join('\n')
}

function formatMessageForTranscript(message: UIMessage, index: number): string {
  const msg = message as UIMessage & { parts?: unknown[]; content?: unknown }
  const role = String(msg.role ?? 'unknown').toUpperCase()
  const parts = Array.isArray(msg.parts) ? msg.parts : []
  const lines: string[] = [`## ${index + 1}. ${role}`]

  if (typeof msg.content === 'string' && msg.content.trim()) {
    lines.push(msg.content.trim())
  }

  for (const part of parts) {
    const record = part as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type : ''
    if (type === 'text') {
      const text = partText(record).trim()
      if (text) lines.push(text)
      continue
    }
    if (type === 'reasoning') {
      const text = partText(record).trim()
      if (text) lines.push(`[reasoning]\n${text}`)
      continue
    }
    if (type.startsWith('tool-')) {
      lines.push(formatToolPart(record))
      continue
    }
    const text = partText(record).trim()
    if (text) lines.push(`[${type || 'part'}]\n${text}`)
  }

  if (lines.length === 1) lines.push('(no visible content)')
  return lines.join('\n\n')
}

function formatSessionTranscript(session: SessionDetail): string {
  const header = [
    `# Agent session transcript: ${session.title}`,
    '',
    `- Session: ${session.id}`,
    `- Created: ${session.createdAt}`,
    `- Updated: ${session.updatedAt}`,
    `- User turns: ${session.turnCount}`,
  ]
  const body = session.messages.map(formatMessageForTranscript)
  return [...header, '', ...body].join('\n')
}

export function sessionRoutes(
  app: FastifyInstance,
  opts: SessionRoutesOptions,
  done: (err?: Error) => void,
): void {
  const sessionStore = opts.sessionStore ?? new InMemorySessionStore()
  const validateCreateBody = createBodyValidator(createSessionBodySchema)

  async function resolveSessionStore(request: FastifyRequest): Promise<SessionStore> {
    if (opts.getSessionStore) return await opts.getSessionStore(request)
    return sessionStore
  }

  app.get('/api/v1/agent/sessions', async (request, reply) => {
    try {
      const store = await resolveSessionStore(request)
      return await store.list(getSessionCtx(request), sessionListOptions(request))
    } catch (err) {
      return classifySessionError(err, reply)
    }
  })

  app.post(
    '/api/v1/agent/sessions',
    { preHandler: validateCreateBody },
    async (request, reply) => {
      const body = request.body as CreateSessionBody
      try {
        const store = await resolveSessionStore(request)
        return await store.create(getSessionCtx(request), {
          title: body?.title,
        })
      } catch (err) {
        return classifySessionError(err, reply)
      }
    },
  )

  app.get('/api/v1/agent/sessions/:id', async (request, reply) => {
    const params = request.params as Record<string, unknown>
    const sessionId = requireSessionId(params.id, reply)
    if (sessionId === null) return

    try {
      const store = await resolveSessionStore(request)
      return await store.load(getSessionCtx(request), sessionId)
    } catch (err) {
      return classifySessionError(err, reply)
    }
  })

  app.get('/api/v1/agent/sessions/:id/transcript', async (request, reply) => {
    const params = request.params as Record<string, unknown>
    const sessionId = requireSessionId(params.id, reply)
    if (sessionId === null) return

    const query = request.query as Record<string, unknown>
    const format = query.format === 'json' ? 'json' : 'markdown'

    try {
      const store = await resolveSessionStore(request)
      const session = await store.load(getSessionCtx(request), sessionId)
      const transcript = formatSessionTranscript(session)

      if (format === 'json') {
        return {
          session: {
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            turnCount: session.turnCount,
          },
          transcript,
          messages: session.messages,
        }
      }

      return reply
        .header('Content-Type', 'text/markdown; charset=utf-8')
        .send(transcript)
    } catch (err) {
      return classifySessionError(err, reply)
    }
  })

  app.delete('/api/v1/agent/sessions/:id', async (request, reply) => {
    const params = request.params as Record<string, unknown>
    const sessionId = requireSessionId(params.id, reply)
    if (sessionId === null) return

    const sessionCtx = getSessionCtx(request)

    try {
      const store = await resolveSessionStore(request)
      await store.load(sessionCtx, sessionId)
      await store.delete(sessionCtx, sessionId)
      return reply.code(204).send()
    } catch (err) {
      return classifySessionError(err, reply)
    }
  })

  done()
}
