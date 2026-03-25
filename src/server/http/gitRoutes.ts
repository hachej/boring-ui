/**
 * Git HTTP routes at /api/v1/git/* — 16 endpoints.
 * Uses simple-git via GitServiceImpl. Python-compatible response shapes.
 */
import type { FastifyInstance, FastifyReply } from 'fastify'
import { createGitServiceImpl } from '../services/gitImpl.js'

export async function registerGitRoutes(app: FastifyInstance): Promise<void> {
  const gitService = createGitServiceImpl(app.config.workspaceRoot)

  // --- Read operations ---

  // GET /git/status
  app.get('/git/status', async () => gitService.getStatus())

  // GET /git/diff?path=...
  app.get('/git/diff', async (request) => {
    const { path } = request.query as { path?: string }
    return gitService.getDiff(path)
  })

  // GET /git/show?path=...
  app.get('/git/show', async (request, reply) => {
    const { path } = request.query as { path?: string }
    if (!path) return reply.code(400).send({ error: 'validation', message: 'path is required' })
    return gitService.getShow(path)
  })

  // GET /git/branch
  app.get('/git/branch', async () => gitService.currentBranch())

  // GET /git/branches
  app.get('/git/branches', async () => gitService.listBranches())

  // GET /git/remotes
  app.get('/git/remotes', async () => gitService.listRemotes())

  // --- Write operations ---

  // POST /git/init
  app.post('/git/init', async () => gitService.initRepo())

  // POST /git/add
  app.post('/git/add', async (request) => {
    const body = request.body as { paths?: string[] } | null
    return gitService.addFiles(body?.paths)
  })

  // POST /git/commit
  app.post('/git/commit', async (request, reply) => {
    const body = request.body as {
      message: string
      author_name?: string
      author_email?: string
    } | null

    if (!body?.message?.trim()) {
      return reply.code(400).send({ error: 'validation', message: 'commit message is required' })
    }

    try {
      return await gitService.commit(body.message, body.author_name, body.author_email)
    } catch (err: any) {
      return reply.code(500).send({ error: 'git_error', message: err.message })
    }
  })

  // POST /git/push
  app.post('/git/push', async (request, reply) => {
    const body = request.body as { remote?: string; branch?: string } | null
    try {
      return await gitService.push(body?.remote, body?.branch)
    } catch (err: any) {
      const statusCode = err.message?.includes('Authentication') ? 401 : 500
      return reply.code(statusCode).send({ error: 'git_error', message: err.message })
    }
  })

  // POST /git/pull
  app.post('/git/pull', async (request, reply) => {
    const body = request.body as { remote?: string; branch?: string } | null
    try {
      return await gitService.pull(body?.remote, body?.branch)
    } catch (err: any) {
      const statusCode = err.message?.includes('Authentication') ? 401 : 500
      return reply.code(statusCode).send({ error: 'git_error', message: err.message })
    }
  })

  // POST /git/clone
  app.post('/git/clone', async (request, reply) => {
    const body = request.body as { url: string; branch?: string } | null
    if (!body?.url) {
      return reply.code(400).send({ error: 'validation', message: 'url is required' })
    }
    try {
      return await gitService.cloneRepo(body.url, body.branch)
    } catch (err: any) {
      return reply.code(500).send({ error: 'git_error', message: err.message })
    }
  })

  // POST /git/branch/create
  app.post('/git/branch/create', async (request, reply) => {
    const body = request.body as { name: string; checkout?: boolean } | null
    if (!body?.name?.trim()) {
      return reply.code(400).send({ error: 'validation', message: 'branch name is required' })
    }
    try {
      return await gitService.createBranch(body.name, body.checkout ?? true)
    } catch (err: any) {
      return reply.code(500).send({ error: 'git_error', message: err.message })
    }
  })

  // POST /git/checkout
  app.post('/git/checkout', async (request, reply) => {
    const body = request.body as { name: string } | null
    if (!body?.name?.trim()) {
      return reply.code(400).send({ error: 'validation', message: 'branch name is required' })
    }
    try {
      return await gitService.checkoutBranch(body.name)
    } catch (err: any) {
      return reply.code(500).send({ error: 'git_error', message: err.message })
    }
  })

  // POST /git/merge
  app.post('/git/merge', async (request, reply) => {
    const body = request.body as { source: string; message?: string } | null
    if (!body?.source?.trim()) {
      return reply.code(400).send({ error: 'validation', message: 'source branch is required' })
    }
    try {
      return await gitService.mergeBranch(body.source, body.message)
    } catch (err: any) {
      const statusCode = err.message?.includes('CONFLICTS') ? 409 : 500
      return reply.code(statusCode).send({ error: 'git_error', message: err.message })
    }
  })

  // POST /git/remote/add
  app.post('/git/remote/add', async (request, reply) => {
    const body = request.body as { name: string; url: string } | null
    if (!body?.name?.trim() || !body?.url?.trim()) {
      return reply.code(400).send({ error: 'validation', message: 'name and url are required' })
    }
    try {
      return await gitService.addRemote(body.name, body.url)
    } catch (err: any) {
      return reply.code(500).send({ error: 'git_error', message: err.message })
    }
  })
}
