import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type {
  SessionStore,
  SessionCtx,
  SessionSummary,
  SessionDetail,
} from '../../../shared/session'

const DEFAULT_WORKSPACE_ID = 'default'

export interface SessionRoutesOptions {
  sessionStore: SessionStore
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

export function sessionRoutes(
  app: FastifyInstance,
  opts: SessionRoutesOptions,
  done: (err?: Error) => void,
): void {
  const { sessionStore } = opts

  app.get('/api/v1/agent/sessions', async (request, reply) => {
    return await sessionStore.list(getSessionCtx(request))
  })

  app.post(
    '/api/v1/agent/sessions',
    async (request, reply) => {
      return await sessionStore.create(getSessionCtx(request))
    },
  )

  app.get('/api/v1/agent/sessions/:id', async (request, reply) => {
    const params = request.params as Record<string, unknown>
    const sessionId = requireSessionId(params.id, reply)
    if (sessionId === null) return

    return await sessionStore.load(getSessionCtx(request), sessionId)
  })

  app.delete('/api/v1/agent/sessions/:id', async (request, reply) => {
    const params = request.params as Record<string, unknown>
    const sessionId = requireSessionId(params.id, reply)
    if (sessionId === null) return

    const sessionCtx = getSessionCtx(request)
    await sessionStore.load(sessionCtx, sessionId)
    await sessionStore.delete(sessionCtx, sessionId)
    return reply.code(204).send()
  })

  done()
}
