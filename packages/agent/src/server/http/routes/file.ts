import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Workspace } from '../../../shared/workspace'
import {
  ERROR_CODE_INVALID_PATH,
  ERROR_CODE_PATH_REJECTED,
  ERROR_CODE_NOT_FOUND,
  ERROR_CODE_ALREADY_EXISTS,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_VALIDATION_ERROR,
} from '../middleware'

interface PathValidationLike {
  reason?: string
  statusCode?: number
}

function isPathValidationError(err: unknown): err is Error & PathValidationLike {
  return (
    err instanceof Error &&
    typeof (err as PathValidationLike).reason === 'string'
  )
}

function classifyError(
  err: unknown,
  reply: FastifyReply,
  subject: string,
): FastifyReply {
  if (isPathValidationError(err)) {
    return reply.code(403).send({
      error: { code: ERROR_CODE_PATH_REJECTED, message: 'path traversal rejected' },
    })
  }

  const message = err instanceof Error ? err.message : 'unknown error'
  const code = (err as NodeJS.ErrnoException)?.code

  if (code === 'EPERM' || message.includes('traversal') || message.includes('EPERM')) {
    return reply.code(403).send({
      error: { code: ERROR_CODE_PATH_REJECTED, message: 'path traversal rejected' },
    })
  }

  if (code === 'ENOENT' || message.includes('ENOENT')) {
    return reply.code(404).send({
      error: { code: ERROR_CODE_NOT_FOUND, message: `${subject} not found` },
    })
  }

  if (code === 'EEXIST' || message.includes('EEXIST')) {
    return reply.code(409).send({
      error: { code: ERROR_CODE_ALREADY_EXISTS, message: `${subject} already exists` },
    })
  }

  return reply.code(500).send({
    error: { code: ERROR_CODE_INTERNAL, message },
  })
}

function requireStringParam(
  value: unknown,
  field: string,
  reply: FastifyReply,
): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    reply.code(400).send({
      error: { code: ERROR_CODE_VALIDATION_ERROR, message: `${field} is required`, field },
    })
    return null
  }
  if (value.includes('\0')) {
    reply.code(400).send({
      error: { code: ERROR_CODE_INVALID_PATH, message: 'null bytes not allowed', field },
    })
    return null
  }
  return value
}

export function fileRoutes(
  app: FastifyInstance,
  opts: { workspace: Workspace },
  done: (err?: Error) => void,
): void {
  const { workspace } = opts

  app.get('/api/v1/files', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const path = requireStringParam(query.path, 'path', reply)
    if (path === null) return

    try {
      const content = await workspace.readFile(path)
      return { content }
    } catch (err) {
      return classifyError(err, reply, 'file')
    }
  })

  app.post('/api/v1/files', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const path = requireStringParam(body?.path, 'path', reply)
    if (path === null) return

    if (typeof body.content !== 'string') {
      return reply.code(400).send({
        error: { code: ERROR_CODE_VALIDATION_ERROR, message: 'content is required', field: 'content' },
      })
    }

    try {
      if (body.createDirs) {
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : undefined
        if (dir) await workspace.mkdir(dir, { recursive: true })
      }
      await workspace.writeFile(path, body.content)
      return { ok: true }
    } catch (err) {
      return classifyError(err, reply, 'file')
    }
  })

  app.delete('/api/v1/files', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const path = requireStringParam(query.path, 'path', reply)
    if (path === null) return

    try {
      await workspace.unlink(path)
      return { ok: true }
    } catch (err) {
      return classifyError(err, reply, 'file')
    }
  })

  app.post('/api/v1/files/move', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const from = requireStringParam(body?.from, 'from', reply)
    if (from === null) return
    const to = requireStringParam(body?.to, 'to', reply)
    if (to === null) return

    try {
      await workspace.rename(from, to)
      return { ok: true }
    } catch (err) {
      return classifyError(err, reply, 'file')
    }
  })

  app.post('/api/v1/dirs', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const path = requireStringParam(body?.path, 'path', reply)
    if (path === null) return

    const recursive = body.recursive === true

    try {
      await workspace.mkdir(path, { recursive })
      return { ok: true }
    } catch (err) {
      return classifyError(err, reply, 'directory')
    }
  })

  app.get('/api/v1/stat', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const path = requireStringParam(query.path, 'path', reply)
    if (path === null) return

    try {
      const stat = await workspace.stat(path)
      return stat
    } catch (err) {
      return classifyError(err, reply, 'path')
    }
  })

  done()
}
