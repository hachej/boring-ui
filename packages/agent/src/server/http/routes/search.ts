import type { FastifyInstance } from 'fastify'
import type { FileSearch } from '../../../shared/file-search'
import { ERROR_CODE_VALIDATION_ERROR, ERROR_CODE_INTERNAL } from '../middleware'

const MAX_GLOB_LENGTH = 256
const DEFAULT_LIMIT = 500
const MAX_LIMIT = 5_000

export interface SearchRouteOptions {
  fileSearch?: FileSearch
  getFileSearch?: (request: import('fastify').FastifyRequest) => FileSearch | Promise<FileSearch>
}

export function searchRoutes(
  app: FastifyInstance,
  opts: SearchRouteOptions,
  done: (err?: Error) => void,
): void {
  async function resolveFileSearch(request: import('fastify').FastifyRequest): Promise<FileSearch> {
    if (opts.getFileSearch) return await opts.getFileSearch(request)
    if (opts.fileSearch) return opts.fileSearch
    throw new Error('search route requires fileSearch or getFileSearch')
  }

  app.get('/api/v1/files/search', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const q = query.q

    if (typeof q !== 'string' || q.length === 0) {
      return reply.code(400).send({
        error: { code: ERROR_CODE_VALIDATION_ERROR, message: 'q is required', field: 'q' },
      })
    }

    if (q.includes('\0')) {
      return reply.code(400).send({
        error: { code: ERROR_CODE_VALIDATION_ERROR, message: 'null bytes not allowed', field: 'q' },
      })
    }

    if (q.length > MAX_GLOB_LENGTH) {
      return reply.code(400).send({
        error: { code: ERROR_CODE_VALIDATION_ERROR, message: `q exceeds ${MAX_GLOB_LENGTH} chars`, field: 'q' },
      })
    }

    const rawLimit = query.limit
    let limit = DEFAULT_LIMIT
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit)
      if (!Number.isFinite(parsed) || parsed < 1) {
        limit = DEFAULT_LIMIT
      } else {
        limit = Math.min(Math.trunc(parsed), MAX_LIMIT)
      }
    }

    try {
      const fileSearch = await resolveFileSearch(request)
      const results = await fileSearch.search(q, limit)
      return reply.send({ results })
    } catch (err) {
      request.log.error({ err }, '[search] error')
      return reply.code(500).send({
        error: { code: ERROR_CODE_INTERNAL, message: 'search failed' },
      })
    }
  })

  done()
}
