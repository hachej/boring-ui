import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { dirname, extname, relative } from 'node:path/posix'
import type { Workspace } from '../../../shared/workspace'
import type { RuntimeFilesystemBinding } from '../../runtime/mode'
import {
  ERROR_CODE_INVALID_PATH,
  ERROR_CODE_PATH_REJECTED,
  ERROR_CODE_NOT_FOUND,
  ERROR_CODE_ALREADY_EXISTS,
  ERROR_CODE_CONFLICT,
  ERROR_CODE_INTERNAL,
  ERROR_CODE_VALIDATION_ERROR,
} from '../middleware'
import { createLogger } from '../../logging'
import {
  FileRecordsValidationError,
  MAX_RECORD_FILE_BYTES,
  buildFileRecordsResult,
  parseFileRecordsRequest,
} from './fileRecords'
import { isReadonlySkillFilePath, readReadonlySkillFile, statReadonlySkillFile } from '../readonlySkillFiles'

const log = createLogger('boring/workspace-settings')

interface PathValidationLike {
  reason?: string
  statusCode?: number
}

const BORING_SETTINGS_PATH = '.boring/settings'
const DEFAULT_MARKDOWN_IMAGE_UPLOAD_DIR = 'assets/images'
const DEFAULT_FILE_UPLOAD_DIR = 'assets/uploads'
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const USER_FILESYSTEM_ID = 'user'
export const ERROR_CODE_NOT_FOUND_OR_DENIED = 'not_found_or_denied'
export const ERROR_CODE_READONLY = 'readonly'

const IMAGE_UPLOAD_EXTENSIONS = new Set(['avif', 'gif', 'jpg', 'jpeg', 'png', 'webp'])
const SAFE_UNKNOWN_FILE_EXTENSIONS = new Set(['csv', 'doc', 'docx', 'json', 'md', 'pdf', 'ppt', 'pptx', 'rtf', 'txt', 'xls', 'xlsx', 'zip'])
const MIME_UPLOAD_EXTENSIONS: Record<string, string[]> = {
  'application/json': ['json'],
  'application/msword': ['doc'],
  'application/pdf': ['pdf'],
  'application/rtf': ['rtf'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/zip': ['zip'],
  'image/avif': ['avif'],
  'image/gif': ['gif'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/svg+xml': ['bin'],
  'image/webp': ['webp'],
  'text/csv': ['csv'],
  'text/markdown': ['md'],
  'text/plain': ['txt'],
}

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

  if (code === 'EPERM' || message.toLowerCase().includes('traversal') || message.includes('EPERM')) {
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

  const statusCode = (err as { statusCode?: unknown })?.statusCode
  const stableCode = (err as { code?: unknown })?.code
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) {
    return reply.code(statusCode).send({
      error: {
        code: typeof stableCode === 'string' ? stableCode : ERROR_CODE_INTERNAL,
        message,
        details: (err as { details?: unknown })?.details,
      },
    })
  }

  return reply.code(500).send({
    error: { code: ERROR_CODE_INTERNAL, message },
  })
}

function requestedFilesystem(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : USER_FILESYSTEM_ID
}

function sendNotFoundOrDenied(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({
    error: { code: ERROR_CODE_NOT_FOUND_OR_DENIED, message: 'not found or denied' },
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
  } catch (err) {
    // A corrupted .boring/settings would otherwise silently reset to
    // defaults on the next PUT — any other settings present in the file
    // (future fields, user overrides) get clobbered. Surface to logs so
    // someone notices before a recovery overwrite happens. Behavior
    // intentionally still returns defaults: PUT is the recovery path,
    // and failing GET would block the editor from booting.
    log.warn('failed to parse .boring/settings — falling back to defaults', {
      error: err instanceof Error ? err.message : String(err),
    })
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
  const safeFromName = /^[a-z0-9]{1,12}$/.test(fromName) ? fromName : ''
  const allowed = MIME_UPLOAD_EXTENSIONS[contentType]
  if (allowed) return safeFromName && allowed.includes(safeFromName) ? safeFromName : allowed[0] ?? 'bin'
  if (contentType.startsWith('image/')) return safeFromName && IMAGE_UPLOAD_EXTENSIONS.has(safeFromName) ? safeFromName : 'bin'
  if (contentType === 'application/octet-stream' && safeFromName && SAFE_UNKNOWN_FILE_EXTENSIONS.has(safeFromName)) return safeFromName
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
    case '.txt': return 'text/plain; charset=utf-8'
    case '.md': return 'text/markdown; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.csv': return 'text/csv; charset=utf-8'
    case '.pdf': return 'application/pdf'
    case '.doc': return 'application/msword'
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.xls': return 'application/vnd.ms-excel'
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case '.ppt': return 'application/vnd.ms-powerpoint'
    case '.pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case '.rtf': return 'application/rtf'
    case '.zip': return 'application/zip'
    default: return 'application/octet-stream'
  }
}


function sendValidationError(reply: FastifyReply, message: string, field?: string): FastifyReply {
  return reply.code(400).send({
    error: { code: ERROR_CODE_VALIDATION_ERROR, message, ...(field ? { field } : {}) },
  })
}

function sendFilesystemBindingMutationDenied(
  reply: FastifyReply,
  filesystem: string,
  access: RuntimeFilesystemBinding['access'],
): FastifyReply {
  return reply.code(403).send({
    error: { code: ERROR_CODE_READONLY, message: `${filesystem} binding is ${access}` },
  })
}

export function fileRoutes(
  app: FastifyInstance,
  opts: {
    workspace?: Workspace
    getWorkspace?: (request: FastifyRequest) => Workspace | Promise<Workspace>
    filesystemBindings?: RuntimeFilesystemBinding[]
    getFilesystemBindings?: (request: FastifyRequest) => RuntimeFilesystemBinding[] | undefined | Promise<RuntimeFilesystemBinding[] | undefined>
  },
  done: (err?: Error) => void,
): void {
  async function resolveWorkspace(request: FastifyRequest): Promise<Workspace> {
    if (opts.getWorkspace) return await opts.getWorkspace(request)
    if (opts.workspace) return opts.workspace
    throw new Error('file route requires workspace or getWorkspace')
  }

  async function resolveFilesystemBindings(request: FastifyRequest): Promise<RuntimeFilesystemBinding[]> {
    if (opts.getFilesystemBindings) return await opts.getFilesystemBindings(request) ?? []
    if (opts.filesystemBindings) return opts.filesystemBindings
    return []
  }

  async function resolveFilesystemBinding(request: FastifyRequest, filesystem: string): Promise<RuntimeFilesystemBinding | undefined> {
    return (await resolveFilesystemBindings(request)).find((binding) => binding.filesystem === filesystem)
  }

  async function rejectUnsupportedFilesystemMutation(request: FastifyRequest, reply: FastifyReply, filesystem: string): Promise<FastifyReply> {
    const binding = await resolveFilesystemBinding(request, filesystem)
    if (!binding) return sendNotFoundOrDenied(reply)
    if (binding.access === 'readonly') return sendFilesystemBindingMutationDenied(reply, filesystem, binding.access)
    return reply.code(501).send({
      error: { code: ERROR_CODE_INTERNAL, message: `${filesystem} binding access is not supported by this route` },
    })
  }

  app.get('/api/v1/files/raw', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const path = requireStringParam(query.path, 'path', reply)
    if (path === null) return
    const filesystem = requestedFilesystem(query.filesystem)

    if (filesystem !== USER_FILESYSTEM_ID) {
      try {
        const binding = await resolveFilesystemBinding(request, filesystem)
        if (!binding || binding.access !== 'readonly') return sendNotFoundOrDenied(reply)
        const result = await binding.operations.read({ filesystem, path })
        const bytes = Buffer.from(result.content, 'utf8')
        return reply
          .header('content-type', contentTypeForPath(path))
          .header('content-length', String(bytes.byteLength))
          .header('cache-control', 'no-store')
          .header('x-content-type-options', 'nosniff')
          .send(bytes)
      } catch {
        return sendNotFoundOrDenied(reply)
      }
    }

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
        .header('x-content-type-options', 'nosniff')
        .send(Buffer.from(bytes))
    } catch (err) {
      return classifyError(err, reply, 'file')
    }
  })

  app.get('/api/v1/files/records', async (request, reply) => {
    try {
      const parsed = parseFileRecordsRequest(request.query as Record<string, unknown>)
      const workspace = await resolveWorkspace(request)
      const stat = await workspace.stat(parsed.path)
      if (stat.kind !== 'file') {
        return sendValidationError(reply, 'path is not a file', 'path')
      }
      if (stat.size > MAX_RECORD_FILE_BYTES) {
        return sendValidationError(reply, 'records file is too large', 'path')
      }
      const content = await workspace.readFile(parsed.path)
      if (Buffer.byteLength(content, 'utf8') > MAX_RECORD_FILE_BYTES) {
        return sendValidationError(reply, 'records file is too large', 'path')
      }
      return buildFileRecordsResult({
        path: parsed.path,
        content,
        mtimeMs: stat.mtimeMs,
        offset: parsed.offset,
        limit: parsed.limit,
        q: parsed.q,
      })
    } catch (err) {
      if (err instanceof FileRecordsValidationError) {
        return sendValidationError(reply, err.message, err.field)
      }
      return classifyError(err, reply, 'file')
    }
  })

  app.get('/api/v1/files', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const path = requireStringParam(query.path, 'path', reply)
    if (path === null) return
    const filesystem = requestedFilesystem(query.filesystem)

    if (filesystem !== USER_FILESYSTEM_ID) {
      try {
        const binding = await resolveFilesystemBinding(request, filesystem)
        if (!binding || binding.access !== 'readonly') return sendNotFoundOrDenied(reply)
        const result = await binding.operations.read({ filesystem, path })
        return { content: result.content }
      } catch {
        return sendNotFoundOrDenied(reply)
      }
    }

    try {
      if (isReadonlySkillFilePath(path)) {
        const { content, stat } = await readReadonlySkillFile(path)
        if (stat.kind !== 'file') {
          return reply.code(400).send({
            error: { code: ERROR_CODE_VALIDATION_ERROR, message: 'path is not a file', field: 'path' },
          })
        }
        return { content, mtimeMs: stat.mtimeMs }
      }
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
    const filesystem = requestedFilesystem(body.filesystem)
    if (filesystem !== USER_FILESYSTEM_ID) return await rejectUnsupportedFilesystemMutation(request, reply, filesystem)

    const expectedMtimeMs = typeof body.expectedMtimeMs === 'number'
      ? body.expectedMtimeMs
      : null
    const shouldReturnMtimeMs = body.returnMtimeMs !== false || expectedMtimeMs !== null

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
      if (!shouldReturnMtimeMs) {
        await workspace.writeFile(path, content)
        return { ok: true }
      }
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
    const contentType = typeof body.contentType === 'string' && body.contentType.trim()
      ? body.contentType.trim().toLowerCase()
      : 'application/octet-stream'

    try {
      const workspace = await resolveWorkspace(request)
      const settings = await readWorkspaceSettings(workspace)
      const isImage = contentType.startsWith('image/')
      const dir = isImage
        ? normalizeUploadDir(body.directory) ?? normalizeUploadDir(settings.markdown?.imageUploadDir) ?? DEFAULT_MARKDOWN_IMAGE_UPLOAD_DIR
        : DEFAULT_FILE_UPLOAD_DIR
      const ext = extForUpload(filename, contentType)
      const base = basenameForUpload(filename)
      const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const path = `${dir}/${base}-${unique}.${ext}`
      // Check base64 length before allocating — base64 is ~4/3 the size of raw bytes.
      const estimatedBytes = Math.ceil(contentBase64.length * 0.75)
      if (estimatedBytes === 0 || estimatedBytes > MAX_UPLOAD_BYTES) {
        return reply.code(400).send({
          error: { code: ERROR_CODE_VALIDATION_ERROR, message: `upload must be 1 byte to ${MAX_UPLOAD_BYTES} bytes`, field: 'contentBase64' },
        })
      }
      const bytes = Buffer.from(contentBase64, 'base64')

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
      // Cap sourcePath length — it only narrows the relative URL the client
      // sees and shouldn't be more than a few hundred chars. Without a cap,
      // a malicious or malformed client could push a multi-megabyte string
      // through the upload route and back into every markdown image link.
      const MAX_SOURCE_PATH = 1024
      const rawSourcePath = body.sourcePath
      const sourcePath =
        typeof rawSourcePath === 'string' &&
        rawSourcePath.length > 0 &&
        rawSourcePath.length <= MAX_SOURCE_PATH &&
        !rawSourcePath.includes('\0')
          ? rawSourcePath
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
    const filesystem = requestedFilesystem(query.filesystem)
    if (filesystem !== USER_FILESYSTEM_ID) return await rejectUnsupportedFilesystemMutation(request, reply, filesystem)

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
    const filesystem = requestedFilesystem(body.filesystem)
    if (filesystem !== USER_FILESYSTEM_ID) return await rejectUnsupportedFilesystemMutation(request, reply, filesystem)

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
    const filesystem = requestedFilesystem(body.filesystem)
    if (filesystem !== USER_FILESYSTEM_ID) return await rejectUnsupportedFilesystemMutation(request, reply, filesystem)

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
    const filesystem = requestedFilesystem(query.filesystem)

    if (filesystem !== USER_FILESYSTEM_ID) {
      try {
        const binding = await resolveFilesystemBinding(request, filesystem)
        if (!binding || binding.access !== 'readonly') return sendNotFoundOrDenied(reply)
        const result = await binding.operations.stat({ filesystem, path })
        return result.isDirectory ? { kind: 'dir' as const } : { kind: 'file' as const, size: 0 }
      } catch {
        return sendNotFoundOrDenied(reply)
      }
    }

    try {
      if (isReadonlySkillFilePath(path)) {
        return await statReadonlySkillFile(path)
      }
      const workspace = await resolveWorkspace(request)
      const stat = await workspace.stat(path)
      return stat
    } catch (err) {
      return classifyError(err, reply, 'path')
    }
  })

  done()
}
