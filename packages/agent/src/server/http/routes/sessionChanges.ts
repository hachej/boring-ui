import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  InMemorySessionChangesTracker,
  type SessionChangesTracker,
  type SessionChangesScope,
} from '../sessionChangesTracker'
import { ERROR_CODE_VALIDATION_ERROR } from '../middleware'

export interface SessionChangesRouteOptions {
  tracker?: SessionChangesTracker
  path?: string
  sessionIdParam?: string
  authorizeRequest?: (request: FastifyRequest) => void | Promise<void>
  resolveScope?: (request: FastifyRequest, sessionId: string) => SessionChangesScope | Promise<SessionChangesScope>
}

function requireSessionId(value: unknown, reply: FastifyReply): string | null {
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

export function sessionChangesRoutes(
  app: FastifyInstance,
  opts: SessionChangesRouteOptions,
  done: (err?: Error) => void,
): void {
  const tracker = opts.tracker ?? new InMemorySessionChangesTracker()

  app.get(opts.path ?? '/api/v1/agent/sessions/:id/changes', async (request, reply) => {
    await opts.authorizeRequest?.(request)
    const params = request.params as Record<string, unknown>
    const sessionId = requireSessionId(params[opts.sessionIdParam ?? 'id'], reply)
    if (sessionId === null) return

    return {
      files: tracker.list(opts.resolveScope ? await opts.resolveScope(request, sessionId) : sessionId),
    }
  })

  done()
}
