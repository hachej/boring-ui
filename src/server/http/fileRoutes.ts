/**
 * File HTTP routes at /api/v1/files/*.
 * Python-compatible response shapes for smoke test parity.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { readdir, readFile, writeFile, unlink, rename, stat } from 'node:fs/promises'
import { join, resolve, relative, dirname, basename } from 'node:path'
import { existsSync } from 'node:fs'

function getWorkspaceRoot(app: FastifyInstance): string {
  return app.config.workspaceRoot
}

function validatePath(workspaceRoot: string, requestedPath: string): string {
  const resolved = resolve(workspaceRoot, requestedPath)
  if (!resolved.startsWith(resolve(workspaceRoot))) {
    throw Object.assign(new Error('Path traversal detected'), { statusCode: 400 })
  }
  return resolved
}

export async function registerFileRoutes(app: FastifyInstance): Promise<void> {
  // GET /files/list?path=.
  app.get('/files/list', async (request, reply) => {
    const root = getWorkspaceRoot(app)
    const { path: reqPath = '.' } = request.query as { path?: string }
    const absPath = validatePath(root, reqPath)

    try {
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
      throw err
    }
  })

  // GET /files/read?path=...
  app.get('/files/read', async (request, reply) => {
    const root = getWorkspaceRoot(app)
    const { path: reqPath } = request.query as { path?: string }
    if (!reqPath) return reply.code(400).send({ error: 'validation', message: 'path is required' })

    const absPath = validatePath(root, reqPath)

    try {
      const content = await readFile(absPath, 'utf-8')
      return { content, path: reqPath }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return reply.code(404).send({ error: 'not_found', message: `File not found: ${reqPath}` })
      }
      throw err
    }
  })

  // PUT /files/write
  app.put('/files/write', async (request) => {
    const root = getWorkspaceRoot(app)
    const body = request.body as { path: string; content: string }
    const absPath = validatePath(root, body.path)

    await writeFile(absPath, body.content, 'utf-8')
    return { success: true, path: body.path }
  })

  // DELETE /files/delete?path=...
  app.delete('/files/delete', async (request, reply) => {
    const root = getWorkspaceRoot(app)
    const { path: reqPath } = request.query as { path?: string }
    if (!reqPath) return reply.code(400).send({ error: 'validation', message: 'path is required' })

    const absPath = validatePath(root, reqPath)

    try {
      await unlink(absPath)
      return { success: true, path: reqPath }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return reply.code(404).send({ error: 'not_found', message: `File not found: ${reqPath}` })
      }
      throw err
    }
  })

  // POST /files/rename
  app.post('/files/rename', async (request) => {
    const root = getWorkspaceRoot(app)
    const body = request.body as { old_path: string; new_path: string }
    const oldAbs = validatePath(root, body.old_path)
    const newAbs = validatePath(root, body.new_path)

    await rename(oldAbs, newAbs)
    return { success: true, old_path: body.old_path, new_path: body.new_path }
  })

  // POST /files/move
  app.post('/files/move', async (request) => {
    const root = getWorkspaceRoot(app)
    const body = request.body as { src_path: string; dest_dir: string }
    const srcAbs = validatePath(root, body.src_path)
    const destAbs = validatePath(root, join(body.dest_dir, basename(body.src_path)))

    await rename(srcAbs, destAbs)
    return { success: true, old_path: body.src_path, dest_path: relative(root, destAbs) }
  })

  // GET /files/search?pattern=...&path=.
  app.get('/files/search', async (request) => {
    const root = getWorkspaceRoot(app)
    const { pattern, path: reqPath = '.' } = request.query as { pattern?: string; path?: string }
    if (!pattern) return { results: [], pattern: '', path: reqPath }

    const absPath = validatePath(root, reqPath)
    const results: { name: string; path: string; dir: string }[] = []

    // Simple recursive search
    async function walk(dir: string): Promise<void> {
      try {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue
          const fullPath = join(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(fullPath)
          } else if (entry.name.includes(pattern!)) {
            results.push({
              name: entry.name,
              path: relative(root, fullPath),
              dir: relative(root, dir),
            })
          }
        }
      } catch { /* skip unreadable dirs */ }
    }

    await walk(absPath)
    return { results, pattern, path: reqPath }
  })
}
