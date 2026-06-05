import type { FastifyInstance, FastifyReply } from 'fastify'
import { dirname, relative } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildGitFileUrl } from '../../../../../workspace/src/plugins/filesystemPlugin/front/data/gitUrl'
import {
  ERROR_CODE_INTERNAL,
  ERROR_CODE_INVALID_PATH,
  ERROR_CODE_VALIDATION_ERROR,
} from '../middleware'

const execFileAsync = promisify(execFile)

export const __gitTestUtils = {
  runGit: async (args: string[], cwd: string): Promise<string> => {
    const { stdout } = await execFileAsync('git', args, { cwd })
    return stdout.trim()
  },
}

interface GitFileUrlResponse {
  enabled: boolean
  reason?: string
  url?: string
}

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

function disabled(reason: string): GitFileUrlResponse {
  return { enabled: false, reason }
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
      const absolutePath = dirname(`${workspaceRoot}/${path}`) === workspaceRoot
        ? `${workspaceRoot}/${path}`
        : `${workspaceRoot}/${path}`
      let repoRoot: string
      try {
        repoRoot = await __gitTestUtils.runGit(['rev-parse', '--show-toplevel'], dirname(absolutePath))
      } catch {
        return disabled('Workspace is not inside a Git repository.')
      }

      let remoteUrl = ''
      try {
        remoteUrl = await __gitTestUtils.runGit(['remote', 'get-url', 'origin'], repoRoot)
      } catch {
        return disabled('Git remote “origin” is not configured.')
      }

      if (!remoteUrl) return disabled('Git remote “origin” is empty.')

      let branch: string | null = null
      try {
        branch = await __gitTestUtils.runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], repoRoot)
      } catch {
        branch = null
      }

      let commitSha: string | null = null
      if (!branch) {
        try {
          commitSha = await __gitTestUtils.runGit(['rev-parse', 'HEAD'], repoRoot)
        } catch {
          commitSha = null
        }
      }

      const repoRelativePath = relative(repoRoot, absolutePath).replace(/\\/g, '/')
      const url = buildGitFileUrl({ remoteUrl, repoRelativePath, branch, commitSha })
      if (!url) {
        return disabled('Only GitHub SSH/HTTPS remotes are supported right now.')
      }

      return { enabled: true, url } satisfies GitFileUrlResponse
    } catch (error) {
      request.log.warn({ err: error }, 'failed to build git file url')
      return reply.code(500).send({
        error: { code: ERROR_CODE_INTERNAL, message: 'failed to build git file url' },
      })
    }
  })

}
