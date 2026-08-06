import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Workspace } from '@hachej/boring-agent/shared'
import { isWorkspaceRelativeGitPath, resolveGitFileUrl } from '../git/gitFileUrl'
import {
  ERROR_CODE_INTERNAL,
  ERROR_CODE_INVALID_PATH,
  ERROR_CODE_VALIDATION_ERROR,
} from './errorCodes'

export interface GitRouteOptions {
  workspace?: Workspace
  // Resolve the workspace per-request. Called lazily inside the handler so
  // unrelated routes don't pay the cost of provisioning the runtime binding.
  getWorkspace?: (request: FastifyRequest) => Workspace | Promise<Workspace>
  getWorkspaceHostRoot?: (workspace: Workspace) => string | undefined
}

const USER_FILESYSTEM_ID = 'user'

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
  if (!isWorkspaceRelativeGitPath(value)) {
    reply.code(400).send({
      error: { code: ERROR_CODE_INVALID_PATH, message: 'path must stay within the workspace', field: 'path' },
    })
    return null
  }
  return value
}

function requirePrimaryFilesystem(value: unknown, reply: FastifyReply): boolean {
  if (value === undefined || value === null || value === '' || value === USER_FILESYSTEM_ID) return true
  reply.code(400).send({
    error: {
      code: ERROR_CODE_VALIDATION_ERROR,
      message: 'Git file URLs are only available for the primary user filesystem',
      field: 'filesystem',
    },
  })
  return false
}

export function gitRoutes(
  app: FastifyInstance,
  opts: GitRouteOptions,
  done: (err?: Error) => void,
): void {
  async function resolveWorkspaceRoot(request: FastifyRequest): Promise<string | undefined> {
    const workspace = opts.getWorkspace
      ? await opts.getWorkspace(request)
      : opts.workspace
    return workspace === undefined ? undefined : opts.getWorkspaceHostRoot?.(workspace)
  }

  app.get('/api/v1/git/file-url', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    if (!requirePrimaryFilesystem(query.filesystem, reply)) return
    const path = requirePath(query.path, reply)
    if (path === null) return

    const workspaceRoot = await resolveWorkspaceRoot(request)
    if (!workspaceRoot) {
      return {
        enabled: false,
        reason: 'Git file URLs are unavailable for this runtime.',
      }
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

  done()
}
