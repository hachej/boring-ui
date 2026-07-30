import type { FastifyInstance } from 'fastify'
import type { FileSearch } from '@hachej/boring-agent/shared'
import type { RuntimeFilesystemBinding } from '../../agent/runtime/types'
import { ERROR_CODE_VALIDATION_ERROR, ERROR_CODE_INTERNAL } from './errorCodes'

const MAX_GLOB_LENGTH = 256
const DEFAULT_LIMIT = 500
const MAX_LIMIT = 5_000

export interface FileSearchResource {
  filesystem: string
  path: string
}

export interface SearchRouteOptions {
  fileSearch?: FileSearch
  getFileSearch?: (request: import('fastify').FastifyRequest) => FileSearch | Promise<FileSearch>
  filesystemBindings?: RuntimeFilesystemBinding[]
  getFilesystemBindings?: (request: import('fastify').FastifyRequest) => RuntimeFilesystemBinding[] | undefined | Promise<RuntimeFilesystemBinding[] | undefined>
}

function interleaveResults(groups: readonly FileSearchResource[][], limit: number): FileSearchResource[] {
  const results: FileSearchResource[] = []
  for (let index = 0; results.length < limit; index += 1) {
    let found = false
    for (const group of groups) {
      const result = group[index]
      if (!result) continue
      results.push(result)
      found = true
      if (results.length === limit) break
    }
    if (!found) break
  }
  return results
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

  async function resolveFilesystemBindings(request: import('fastify').FastifyRequest): Promise<RuntimeFilesystemBinding[]> {
    if (opts.getFilesystemBindings) return await opts.getFilesystemBindings(request) ?? []
    return opts.filesystemBindings ?? []
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
      const [fileSearch, bindings] = await Promise.all([
        resolveFileSearch(request),
        resolveFilesystemBindings(request),
      ])
      const userResults = (await fileSearch.search(q, limit)).map((path) => ({
        filesystem: 'user',
        path,
      }))
      const bindingResults = await Promise.all(bindings
        .filter((binding) => binding.filesystem !== 'user')
        .map(async (binding): Promise<FileSearchResource[]> => {
          try {
            const found = await binding.operations.find(
              { filesystem: binding.filesystem, path: '/' },
              q,
              { limit },
            )
            return found.paths.map((path) => ({ filesystem: binding.filesystem, path }))
          } catch {
            // A request-scoped binding may deny all or part of its projection.
            // Treat it as invisible instead of exposing authorization details.
            return []
          }
        }))
      return reply.send({
        // Preserve the original primary-workspace response for callers that
        // still consume bare paths. Multi-root consumers use `resources`.
        results: userResults.map((result) => result.path),
        resources: interleaveResults([userResults, ...bindingResults], limit),
      })
    } catch (err) {
      const statusCode = (err as { statusCode?: unknown })?.statusCode
      const stableCode = (err as { code?: unknown })?.code
      if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) {
        const message = err instanceof Error ? err.message : 'search failed'
        return reply.code(statusCode).send({
          error: {
            code: typeof stableCode === 'string' ? stableCode : ERROR_CODE_INTERNAL,
            message,
            details: (err as { details?: unknown })?.details,
          },
        })
      }
      request.log.error({ err }, '[search] error')
      return reply.code(500).send({
        error: { code: ERROR_CODE_INTERNAL, message: 'search failed' },
      })
    }
  })

  done()
}
