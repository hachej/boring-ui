/**
 * File HTTP routes at /api/v1/files/*.
 * Python-compatible response shapes for smoke test parity.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { mkdirSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, relative, dirname, basename, isAbsolute } from 'node:path'
import { resolveWorkspacePath } from '../workspace/resolver.js'

function getWorkspaceRoot(app: FastifyInstance, request: FastifyRequest): string {
  const workspaceIdHeader = request.headers['x-workspace-id']
  const workspaceId = Array.isArray(workspaceIdHeader)
    ? workspaceIdHeader[0]
    : workspaceIdHeader
  if (workspaceId) {
    const workspaceRoot = resolveWorkspacePath(app.config.workspaceRoot, String(workspaceId))
    mkdirSync(workspaceRoot, { recursive: true })
    return workspaceRoot
  }
  return app.config.workspaceRoot
}

// Note: workspace directory creation is handled by mkdirSync in getWorkspaceRoot()

function validatePath(workspaceRoot: string, requestedPath: string): string {
  const resolvedRoot = resolve(workspaceRoot)
  const resolved = resolve(workspaceRoot, requestedPath)
  // Must use resolvedRoot + '/' to prevent prefix collision:
  // e.g., /workspace-evil/file would falsely match /workspace without the trailing /
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + '/')) {
    throw Object.assign(new Error('Path traversal detected'), { statusCode: 400 })
  }
  return resolved
}

async function assertRealPathWithinWorkspace(workspaceRoot: string, candidatePath: string): Promise<void> {
  const realRoot = await realpath(resolve(workspaceRoot))
  const realCandidate = await realpath(candidatePath)
  const rel = relative(realRoot, realCandidate)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw Object.assign(new Error('Path traversal detected'), { statusCode: 400 })
  }
}

async function ensureExistingWorkspacePath(workspaceRoot: string, requestedPath: string): Promise<string> {
  const absolutePath = validatePath(workspaceRoot, requestedPath)
  await assertRealPathWithinWorkspace(workspaceRoot, absolutePath)
  return absolutePath
}

async function ensureWritableWorkspacePath(workspaceRoot: string, requestedPath: string): Promise<string> {
  const absolutePath = validatePath(workspaceRoot, requestedPath)
  const absoluteDir = dirname(absolutePath)
  const resolvedRoot = resolve(workspaceRoot)

  let existingAncestor = absoluteDir
  while (existingAncestor !== resolvedRoot) {
    try {
      await stat(existingAncestor)
      break
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error
      existingAncestor = dirname(existingAncestor)
    }
  }

  await assertRealPathWithinWorkspace(workspaceRoot, existingAncestor)
  await mkdir(absoluteDir, { recursive: true })
  await assertRealPathWithinWorkspace(workspaceRoot, absoluteDir)

  try {
    const pathStat = await lstat(absolutePath)
    if (pathStat.isSymbolicLink()) {
      throw Object.assign(new Error('Path traversal detected'), { statusCode: 400 })
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
  }

  return absolutePath
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  const regex = escaped
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${regex}$`, 'i')
}

function sendValidationError(reply: FastifyReply, err: any) {
  const statusCode = err?.statusCode ?? 500
  const message = err?.message || 'Internal server error'
  return reply.code(statusCode).send({
    error: statusCode === 400 ? 'validation' : 'internal_error',
    message,
    detail: message,
  })
}

export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  // GET /files/list?path=.
  app.get('/files/list', async (request, reply) => {
    const root = getWorkspaceRoot(app, request)
    const { path: reqPath = '.' } = request.query as { path?: string }

    try {
      const absPath = await ensureExistingWorkspacePath(root, reqPath)
      const entries = await readdir(absPath, { withFileTypes: true })
      return {
        entries: entries.map((e) => ({
          name: e.name,
          path: relative(root, join(absPath, e.name)),
          is_dir: e.isDirectory(),
        })),
        path: reqPath,
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return reply.code(404).send({ error: 'not_found', message: `Directory not found: ${reqPath}` })
      }
      if (err?.statusCode === 400) {
        return sendValidationError(reply, err)
      }
      throw err
    }
  })

  // GET /files/read?path=...
  app.get('/files/read', async (request, reply) => {
    const root = getWorkspaceRoot(app, request)
    const { path: reqPath } = request.query as { path?: string }
    if (!reqPath) return reply.code(400).send({ error: 'validation', message: 'path is required' })

    try {
      const absPath = await ensureExistingWorkspacePath(root, reqPath)
      const content = await readFile(absPath, 'utf-8')
      return { content, path: reqPath }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return reply.code(404).send({ error: 'not_found', message: `File not found: ${reqPath}` })
      }
      if (err.code === 'EISDIR') {
        return reply.code(400).send({
          error: 'validation',
          message: `Path is a directory: ${reqPath}`,
          detail: `Path is a directory: ${reqPath}`,
        })
      }
      if (err?.statusCode === 400) {
        return sendValidationError(reply, err)
      }
      throw err
    }
  })

  // PUT /files/write?path=...  (body: { content })
  // Python-compat: path in query params, content in body
  app.put('/files/write', async (request, reply) => {
    const root = getWorkspaceRoot(app, request)
    const queryPath = (request.query as any).path as string | undefined
    const body = request.body as { path?: string; content: string }
    // Accept path from query params (Python compat) or body (TS native)
    const filePath = queryPath || body.path
    if (!filePath) {
      return reply.code(400).send({ error: 'validation', message: 'path is required' })
    }
    try {
      const absPath = await ensureWritableWorkspacePath(root, filePath)
      await writeFile(absPath, body.content ?? '', 'utf-8')
      return { success: true, path: filePath }
    } catch (err: any) {
      if (err?.statusCode === 400) {
        return sendValidationError(reply, err)
      }
      throw err
    }
  })

  // DELETE /files/delete?path=...
  app.delete('/files/delete', async (request, reply) => {
    const root = getWorkspaceRoot(app, request)
    const { path: reqPath } = request.query as { path?: string }
    if (!reqPath) return reply.code(400).send({ error: 'validation', message: 'path is required' })

    try {
      const absPath = await ensureExistingWorkspacePath(root, reqPath)
      const pathStat = await lstat(absPath)
      if (pathStat.isDirectory()) {
        await rm(absPath, { recursive: true, force: false })
      } else {
        await unlink(absPath)
      }
      return { success: true, path: reqPath }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return reply.code(404).send({ error: 'not_found', message: `File not found: ${reqPath}` })
      }
      if (err?.statusCode === 400) {
        return sendValidationError(reply, err)
      }
      throw err
    }
  })

  // POST /files/rename
  app.post('/files/rename', async (request, reply) => {
    const root = getWorkspaceRoot(app, request)
    const body = request.body as { old_path?: string; new_path?: string } | null
    if (!body?.old_path || !body?.new_path) {
      return reply.code(400).send({ error: 'validation', message: 'old_path and new_path are required' })
    }

    try {
      const oldAbs = await ensureExistingWorkspacePath(root, body.old_path)
      const newAbs = await ensureWritableWorkspacePath(root, body.new_path)
      try {
        await stat(newAbs)
        return reply.code(409).send({
          error: 'conflict',
          message: `Target exists: ${body.new_path}`,
          detail: `Target exists: ${body.new_path}`,
        })
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err
      }
      await rename(oldAbs, newAbs)
      return { success: true, old_path: body.old_path, new_path: body.new_path }
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return reply.code(404).send({ error: 'not_found', message: `File not found: ${body.old_path}` })
      }
      if (err?.statusCode === 400) {
        return sendValidationError(reply, err)
      }
      throw err
    }
  })

  // POST /files/move
  app.post('/files/move', async (request, reply) => {
    const root = getWorkspaceRoot(app, request)
    const body = request.body as { src_path?: string; dest_dir?: string } | null
    if (!body?.src_path || !body?.dest_dir) {
      return reply.code(400).send({ error: 'validation', message: 'src_path and dest_dir are required' })
    }

    try {
      const srcAbs = await ensureExistingWorkspacePath(root, body.src_path)
      const destDirAbs = validatePath(root, body.dest_dir)
      try {
        await assertRealPathWithinWorkspace(root, destDirAbs)
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          return reply.code(400).send({
            error: 'validation',
            message: `Destination is not a directory: ${body.dest_dir}`,
            detail: `Destination is not a directory: ${body.dest_dir}`,
          })
        }
        throw err
      }
      const destStat = await stat(destDirAbs)
      if (!destStat.isDirectory()) {
        return reply.code(400).send({
          error: 'validation',
          message: `Destination is not a directory: ${body.dest_dir}`,
          detail: `Destination is not a directory: ${body.dest_dir}`,
        })
      }
      const destAbs = validatePath(root, join(body.dest_dir, basename(body.src_path)))
      try {
        await stat(destAbs)
        return reply.code(409).send({
          error: 'conflict',
          message: `Target exists: ${relative(root, destAbs)}`,
          detail: `Target exists: ${relative(root, destAbs)}`,
        })
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err
      }
      await rename(srcAbs, destAbs)
      return { success: true, old_path: body.src_path, dest_path: relative(root, destAbs) }
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return reply.code(404).send({ error: 'not_found', message: `File not found: ${body.src_path}` })
      }
      if (err?.statusCode === 400) {
        return sendValidationError(reply, err)
      }
      throw err
    }
  })

  // GET /files/search?pattern=...&path=.
  app.get('/files/search', async (request, reply) => {
    const root = getWorkspaceRoot(app, request)
    const { pattern: patternParam, q, path: reqPath = '.' } = request.query as { pattern?: string; q?: string; path?: string }
    const pattern = patternParam || q
    if (!pattern) return { results: [], pattern: '', path: reqPath }

    const results: { name: string; path: string; dir: string }[] = []
    const patternMatcher = globToRegExp(pattern)

    // Simple recursive search
    async function walk(dir: string): Promise<void> {
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(fullPath)
          } else if (patternMatcher.test(entry.name)) {
            results.push({
              name: entry.name,
              path: relative(root, fullPath),
              dir: relative(root, dir),
            })
          }
        }
      } catch { /* skip unreadable dirs */ }
    }

    try {
      const absPath = await ensureExistingWorkspacePath(root, reqPath)
      await walk(absPath)
      return { results, pattern, path: reqPath }
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return { results, pattern, path: reqPath }
      }
      if (err?.statusCode === 400) {
        return sendValidationError(reply, err)
      }
      throw err
    }
  })
}
