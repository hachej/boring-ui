import type { FastifyInstance, FastifyReply } from 'fastify'
import { resolveGitFileUrl } from '../../git/gitFileUrl'
import {
  ERROR_CODE_INTERNAL,
  ERROR_CODE_INVALID_PATH,
  ERROR_CODE_VALIDATION_ERROR,
} from '../middleware'

function requirePath(value: unknown, reply: FastifyReply): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    reply.code(400).send({
      error: { code: ERROR_CODE_VALIDATION_ERROR, message: 'path is required', field: 'path' },
    })
    return null
  }
  if (value.includes('\0')) {
    reply.code(400).send({
      error: { code: ERROR_CODE_INVALID_PATH, message: 'null bytes not allowed', field: 'path' },
    })
    return null
  }
  return value
}

export function gitRoutes(app: FastifyInstance): void {
  app.get('/api/v1/git/file-url', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const path = requirePath(query.path, reply)
    if (path === null) return

    const workspaceRoot = (request as { workspaceRoot?: string }).workspaceRoot
    if (!workspaceRoot) {
      return reply.code(500).send({
        error: { code: ERROR_CODE_INTERNAL, message: 'workspace root unavailable' },
      })
    }

    try {
      return await resolveGitFileUrl(workspaceRoot, path)
    } catch (error) {
      request.log.warn({ err: error }, 'failed to build git file url')
      return reply.code(500).send({
        error: { code: ERROR_CODE_INTERNAL, message: 'failed to build git file url' },
      })
    }
  })
}
