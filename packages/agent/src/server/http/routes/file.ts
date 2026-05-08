import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { dirname, extname, relative } from 'node:path/posix'
import type { Workspace } from '../../../shared/workspace'
import {
  ERROR_CODE_INVALID_PATH,
  ERROR_CODE_PATH_REJECTED,
  ERROR_CODE_NOT_FOUND,
  ERROR_CODE_ALREADY_EXISTS,
  ERROR_CODE_CONFLICT,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_VALIDATION_ERROR,
} from '../middleware'

interface PathValidationLike {
  reason?: string
  statusCode?: number
}

const BORING_SETTINGS_PATH = '.boring/settings'
const DEFAULT_MARKDOWN_IMAGE_UPLOAD_DIR = 'assets/images'
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

interface BoringWorkspaceSettings {
  markdown?: {
    imageUploadDir?: string
  }
}

function defaultWorkspaceSettings(): BoringWorkspaceSettings {
  return { markdown: { imageUploadDir: DEFAULT_MARKDOWN_IMAGE_UPLOAD_DIR } }
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

function parseWorkspaceSettings(raw: string): BoringWorkspaceSettings {
  try {
    const parsed = JSON.parse(raw) as BoringWorkspaceSettings
    const dir = parsed?.markdown?.imageUploadDir
    return {
      ...parsed,
      markdown: {
        ...(parsed.markdown ?? {}),
        imageUploadDir: typeof dir === 'string' && dir.trim()
          ? dir.trim()
          : DEFAULT_MARKDOWN_IMAGE_UPLOAD_DIR,
      },
    }
  } catch {
    return defaultWorkspaceSettings()
  }
}

async function readWorkspaceSettings(workspace: Workspace): Promise<BoringWorkspaceSettings> {
  try {
    return parseWorkspaceSettings(await workspace.readFile(BORING_SETTINGS_PATH))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') return defaultWorkspaceSettings()
    throw error
  }
}

function normalizeUploadDir(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const dir = value.trim().replace(/^\.\/+/, '').replace(/\/+/g, '/')
  if (!dir || dir.includes('\0') || dir.startsWith('/') || dir.split('/').includes('..')) return null
  return dir.replace(/\/+$/, '')
}

function extForUpload(filename: string, contentType: string): string {
  const fromName = extname(filename).toLowerCase().replace(/^\./, '')
  if (/^[a-z0-9]{1,12}$/.test(fromName)) return fromName
  if (contentType === 'image/jpeg') return 'jpg'
  if (contentType === 'image/png') return 'png'
  if (contentType === 'image/gif') return 'gif'
  if (contentType === 'image/webp') return 'webp'
  if (contentType === 'image/svg+xml') return 'svg'
  return 'bin'
}

function basenameForUpload(filename: string): string {
  const base = filename.split('/').pop()?.split('\\').pop() ?? 'image'
  const withoutExt = base.replace(/\.[^.]*$/, '')
  const safe = withoutExt
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return safe || 'image'
}

function markdownUrlFor(sourcePath: string | null, assetPath: string): string {
  if (!sourcePath) return assetPath
  const fromDir = dirname(sourcePath.replace(/\\/g, '/'))
  const rel = relative(fromDir === '.' ? '' : fromDir, assetPath)
  return rel && !rel.startsWith('.') ? rel : rel || assetPath
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.avif': return 'image/avif'
    case '.gif': return 'image/gif'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.svg': return 'image/svg+xml'
    case '.webp': return 'image/webp'
    case '.css': return 'text/css; charset=utf-8'
    case '.html':
    case '.htm': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.mjs': return 'text/javascript; charset=utf-8'
    case '.pdf': return 'application/pdf'
    default: return 'application/octet-stream'
  }
}

export function fileRoutes(
  app: FastifyInstance,
  opts: {
    workspace?: Workspace
    getWorkspace?: (request: FastifyRequest) => Workspace | Promise<Workspace>
  },
  done: (err?: Error) => void,
): void {
  async function resolveWorkspace(request: FastifyRequest): Promise<Workspace> {
    if (opts.getWorkspace) return await opts.getWorkspace(request)
    if (opts.workspace) return opts.workspace
    throw new Error('file route requires workspace or getWorkspace')
  }

  app.get('/api/v1/files/raw', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const path = requireStringParam(query.path, 'path', reply)
    if (path === null) return

    try {
      const workspace = await resolveWorkspace(request)
      if (!workspace.readBinaryFile) {
        return reply.code(501).send({
          error: { code: ERROR_CODE_INTERNAL, message: 'workspace does not support binary reads' },
        })
      }
      const stat = await workspace.stat(path)
      if (stat.kind !== 'file') {
        return reply.code(400).send({
          error: { code: ERROR_CODE_VALIDATION_ERROR, message: 'path is not a file', field: 'path' },
        })
      }
      const bytes = await workspace.readBinaryFile(path)
      return reply
        .header('content-type', contentTypeForPath(path))
        .header('content-length', String(bytes.byteLength))
        .header('cache-control', 'no-store')
        .send(Buffer.from(bytes))
    } catch (err) {
      return classifyError(err, reply, 'file')
    }
  })

  app.get('/api/v1/files', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const path = requireStringParam(query.path, 'path', reply)
    if (path === null) return

    try {
      const workspace = await resolveWorkspace(request)
      if (workspace.readFileWithStat) {
        const { content, stat } = await workspace.readFileWithStat(path)
        return { content, mtimeMs: stat.kind === 'file' ? stat.mtimeMs : undefined }
      }
      const content = await workspace.readFile(path)
      const stat = await workspace.stat(path)
      return { content, mtimeMs: stat.kind === 'file' ? stat.mtimeMs : undefined }
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

    // Optimistic concurrency: if the client supplied the mtime they
    // read, verify the file hasn't moved underneath them. Mismatch →
    // 409 with the current mtime so the client can decide whether to
    // reload or force-overwrite.
    const expectedMtimeMs = typeof body.expectedMtimeMs === 'number'
      ? body.expectedMtimeMs
      : null

    try {
      const workspace = await resolveWorkspace(request)
      if (expectedMtimeMs !== null) {
        try {
          const current = await workspace.stat(path)
          if (current.kind === 'file' && current.mtimeMs !== expectedMtimeMs) {
            return reply.code(409).send({
              error: {
                code: ERROR_CODE_CONFLICT,
                message: 'file has been modified since last read',
                currentMtimeMs: current.mtimeMs,
                expectedMtimeMs,
              },
            })
          }
        } catch (statErr) {
          // ENOENT is the common case — file was deleted. Treat as a
          // conflict too: client expected an mtime, we have none.
          const code = (statErr as NodeJS.ErrnoException)?.code
          if (code === 'ENOENT') {
            return reply.code(409).send({
              error: {
                code: ERROR_CODE_CONFLICT,
                message: 'file no longer exists',
                expectedMtimeMs,
              },
            })
          }
          // Any other stat failure: surface through the regular path.
          throw statErr
        }
      }

      if (body.createDirs) {
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : undefined
        if (dir) await workspace.mkdir(dir, { recursive: true })
      }
      const content = body.content
      const stat = workspace.writeFileWithStat
        ? await workspace.writeFileWithStat(path, content)
        : await (async () => {
            await workspace.writeFile(path, content)
            return await workspace.stat(path)
          })()
      return { ok: true, mtimeMs: stat.kind === 'file' ? stat.mtimeMs : undefined }
    } catch (err) {
      return classifyError(err, reply, 'file')
    }
  })

  app.post('/api/v1/files/upload', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const filename = requireStringParam(body?.filename, 'filename', reply)
    if (filename === null) return
    const contentBase64 = requireStringParam(body?.contentBase64, 'contentBase64', reply)
    if (contentBase64 === null) return
    const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : ''
    if (!contentType.startsWith('image/')) {
      return reply.code(400).send({
        error: { code: ERROR_CODE_VALIDATION_ERROR, message: 'contentType must be an image/* MIME type', field: 'contentType' },
      })
    }

    try {
      const workspace = await resolveWorkspace(request)
      const settings = await readWorkspaceSettings(workspace)
      const dir = normalizeUploadDir(body.directory) ?? normalizeUploadDir(settings.markdown?.imageUploadDir) ?? DEFAULT_MARKDOWN_IMAGE_UPLOAD_DIR
      const ext = extForUpload(filename, contentType)
      const base = basenameForUpload(filename)
      const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const path = `${dir}/${base}-${unique}.${ext}`
      const bytes = Buffer.from(contentBase64, 'base64')
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
        return reply.code(400).send({
          error: { code: ERROR_CODE_VALIDATION_ERROR, message: `upload must be 1 byte to ${MAX_UPLOAD_BYTES} bytes`, field: 'contentBase64' },
        })
      }

      await workspace.mkdir(dir, { recursive: true })
      const stat = workspace.writeBinaryFileWithStat
        ? await workspace.writeBinaryFileWithStat(path, bytes)
        : await (async () => {
            if (!workspace.writeBinaryFile) {
              throw new Error('workspace does not support binary uploads')
            }
            await workspace.writeBinaryFile(path, bytes)
            return await workspace.stat(path)
          })()
      const sourcePath = typeof body.sourcePath === 'string' && !body.sourcePath.includes('\0')
        ? body.sourcePath
        : null
      return {
        ok: true,
        path,
        markdownUrl: markdownUrlFor(sourcePath, path),
        mtimeMs: stat.kind === 'file' ? stat.mtimeMs : undefined,
      }
    } catch (err) {
      return classifyError(err, reply, 'upload')
    }
  })

  app.get('/api/v1/workspace-settings', async (request, reply) => {
    try {
      const workspace = await resolveWorkspace(request)
      return { settings: await readWorkspaceSettings(workspace) }
    } catch (err) {
      return classifyError(err, reply, 'settings')
    }
  })

  app.put('/api/v1/workspace-settings', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const incoming = (body?.settings ?? body) as Record<string, unknown>
    const markdown = (incoming.markdown ?? {}) as Record<string, unknown>
    const imageUploadDir = normalizeUploadDir(markdown.imageUploadDir)
    if (!imageUploadDir) {
      return reply.code(400).send({
        error: { code: ERROR_CODE_INVALID_PATH, message: 'markdown.imageUploadDir must be a relative workspace path', field: 'markdown.imageUploadDir' },
      })
    }

    try {
      const workspace = await resolveWorkspace(request)
      const current = await readWorkspaceSettings(workspace)
      const next: BoringWorkspaceSettings = {
        ...current,
        markdown: {
          ...(current.markdown ?? {}),
          imageUploadDir,
        },
      }
      await workspace.mkdir('.boring', { recursive: true })
      await workspace.writeFile(BORING_SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`)
      return { settings: next }
    } catch (err) {
      return classifyError(err, reply, 'settings')
    }
  })

  app.delete('/api/v1/files', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const path = requireStringParam(query.path, 'path', reply)
    if (path === null) return

    try {
      const workspace = await resolveWorkspace(request)
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
      const workspace = await resolveWorkspace(request)
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
      const workspace = await resolveWorkspace(request)
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
      const workspace = await resolveWorkspace(request)
      const stat = await workspace.stat(path)
      return stat
    } catch (err) {
      return classifyError(err, reply, 'path')
    }
  })

  done()
}
