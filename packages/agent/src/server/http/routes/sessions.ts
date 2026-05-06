import { randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type {
  SessionStore,
  SessionCtx,
  SessionSummary,
  SessionDetail,
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

  async list(ctx: SessionCtx): Promise<SessionSummary[]> {
    return Array.from(this.sessions.values())
      .filter((session) => session.workspaceId === ctx.workspaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toSummary)
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
      return await store.list(getSessionCtx(request))
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
