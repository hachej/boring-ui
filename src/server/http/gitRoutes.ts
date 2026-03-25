/**
 * Git HTTP routes at /api/v1/git/*.
 * Uses simple-git for operations. Python-compatible response shapes.
 */
import type { FastifyInstance } from 'fastify'
import simpleGit from 'simple-git'

function getGit(app: FastifyInstance) {
  return simpleGit(app.config.workspaceRoot)
}

export async function registerGitRoutes(app: FastifyInstance): Promise<void> {
  // GET /git/status
  app.get('/git/status', async () => {
    const git = getGit(app)
    try {
      const status = await git.status()
      return {
        is_repo: true,
        available: true,
        files: [
          ...status.modified.map((p) => ({ path: p, status: 'modified' })),
          ...status.not_added.map((p) => ({ path: p, status: 'untracked' })),
          ...status.staged.map((p) => ({ path: p, status: 'staged' })),
          ...status.deleted.map((p) => ({ path: p, status: 'deleted' })),
          ...status.renamed.map((r) => ({ path: r.to, status: 'renamed' })),
        ],
      }
    } catch {
      return { is_repo: false, available: false, files: [] }
    }
  })

  // GET /git/diff?path=...
  app.get('/git/diff', async (request) => {
    const { path: reqPath = '' } = request.query as { path?: string }
    const git = getGit(app)
    try {
      const diff = reqPath ? await git.diff([reqPath]) : await git.diff()
      return { diff, path: reqPath }
    } catch (err: any) {
      return { diff: '', path: reqPath, error: err.message }
    }
  })

  // GET /git/show?path=...
  app.get('/git/show', async (request, reply) => {
    const { path: reqPath } = request.query as { path?: string }
    if (!reqPath) return reply.code(400).send({ error: 'validation', message: 'path is required' })

    const git = getGit(app)
    try {
      const content = await git.show([`HEAD:${reqPath}`])
      return { content, path: reqPath }
    } catch (err: any) {
      return { content: null, path: reqPath, error: err.message }
    }
  })

  // GET /git/branch
  app.get('/git/branch', async () => {
    const git = getGit(app)
    try {
      const branch = await git.branchLocal()
      return { branch: branch.current }
    } catch {
      return { branch: null }
    }
  })

  // GET /git/branches
  app.get('/git/branches', async () => {
    const git = getGit(app)
    try {
      const branches = await git.branchLocal()
      return {
        branches: branches.all,
        current: branches.current || null,
      }
    } catch {
      return { branches: [], current: null }
    }
  })
}
