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
import { createLogger } from '../../logging'

const log = createLogger('boring/workspace-settings')

interface PathValidationLike {
  reason?: string
  statusCode?: number
}

const BORING_SETTINGS_PATH = '.boring/settings'
const DEFAULT_MARKDOWN_IMAGE_UPLOAD_DIR = 'assets/images'
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_RECORD_FILE_BYTES = 2 * 1024 * 1024
const MAX_RECORD_ROWS_SCANNED = 10_000
const MAX_RECORD_ROWS_RETURNED = 100
const DEFAULT_RECORD_ROWS_RETURNED = 50
const MAX_RECORD_OUTPUT_BYTES = 512 * 1024
const MAX_RECORD_QUERY_LENGTH = 256
const MAX_RECORD_COLUMNS = 100
const MAX_RECORD_COLUMN_SAMPLE_ROWS = 100

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

type FileRecordsFormat = 'json-array' | 'ndjson' | 'csv'

type FileRecord = Record<string, unknown>

interface FileRecordsRequest {
  path: string
  offset: number
  limit: number
  q: string | null
}

interface FileRecordsResult {
  source: { kind: 'file'; path: string; format: FileRecordsFormat }
  path: string
  format: FileRecordsFormat
  columns: { name: string; type: string }[]
  rows: FileRecord[]
  total: number
  hasMore: boolean
  offset: number
  limit: number
  mtimeMs?: number
}

function sendValidationError(reply: FastifyReply, message: string, field?: string): FastifyReply {
  return reply.code(400).send({
    error: { code: ERROR_CODE_VALIDATION_ERROR, message, ...(field ? { field } : {}) },
  })
}

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

function parseNonNegativeInteger(value: unknown, field: string, fallback: number, reply: FastifyReply, max = MAX_RECORD_ROWS_SCANNED): number | null {
  const raw = firstQueryValue(value)
  if (raw === undefined) return fallback
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d+$/.test(text)) {
    sendValidationError(reply, `${field} must be a non-negative integer`, field)
    return null
  }
  const parsed = Number(text)
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    sendValidationError(reply, `${field} is too large`, field)
    return null
  }
  return parsed
}

function parseLimit(value: unknown, reply: FastifyReply): number | null {
  const raw = firstQueryValue(value)
  if (raw === undefined) return DEFAULT_RECORD_ROWS_RETURNED
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (!/^\d+$/.test(text) || Number(text) < 1) {
    sendValidationError(reply, 'limit must be a positive integer', 'limit')
    return null
  }
  return Math.min(Number(text), MAX_RECORD_ROWS_RETURNED)
}

function parseFileRecordsRequest(query: Record<string, unknown>, reply: FastifyReply): FileRecordsRequest | null {
  const path = requireStringParam(firstQueryValue(query.path), 'path', reply)
  if (path === null) return null
  const recordSet = firstQueryValue(query.recordSet)
  if (recordSet !== undefined && String(recordSet).trim() !== '') {
    sendValidationError(reply, 'recordSet is not supported for file records in v1', 'recordSet')
    return null
  }
  const offset = parseNonNegativeInteger(query.offset, 'offset', 0, reply)
  if (offset === null) return null
  const limit = parseLimit(query.limit, reply)
  if (limit === null) return null
  const rawQ = firstQueryValue(query.q)
  const q = typeof rawQ === 'string' ? rawQ.trim() : rawQ === undefined ? '' : String(rawQ).trim()
  if (q.length > MAX_RECORD_QUERY_LENGTH) {
    sendValidationError(reply, 'q is too long', 'q')
    return null
  }
  return { path, offset, limit, q: q ? q.toLowerCase() : null }
}

function detectRecordsFormat(path: string, content: string): FileRecordsFormat | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.ndjson' || ext === '.jsonl') return 'ndjson'
  if (ext === '.csv') return 'csv'
  if (ext === '.json') return 'json-array'
  const trimmed = content.trimStart()
  if (trimmed.startsWith('[')) return 'json-array'
  if (trimmed.startsWith('{')) return 'ndjson'
  return null
}

function normalizeRecord(row: unknown): FileRecord {
  if (row && typeof row === 'object' && !Array.isArray(row)) return row as FileRecord
  return { value: row }
}

function scalarMatches(value: unknown, q: string): boolean {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return false
  return String(value).toLowerCase().includes(q)
}

function recordMatches(record: FileRecord, q: string | null): boolean {
  if (!q) return true
  return Object.values(record).some((value) => scalarMatches(value, q))
}

function inferValueType(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function inferColumns(rows: FileRecord[]): { name: string; type: string }[] {
  const typesByName = new Map<string, Set<string>>()
  for (const row of rows.slice(0, MAX_RECORD_COLUMN_SAMPLE_ROWS)) {
    for (const [name, value] of Object.entries(row)) {
      if (!typesByName.has(name)) {
        if (typesByName.size >= MAX_RECORD_COLUMNS) continue
        typesByName.set(name, new Set())
      }
      typesByName.get(name)?.add(inferValueType(value))
    }
  }
  return [...typesByName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, types]) => ({ name, type: types.size === 1 ? [...types][0] ?? 'unknown' : 'mixed' }))
}

function parseJsonArrayRecords(content: string): FileRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('malformed JSON records file')
  }
  if (!Array.isArray(parsed)) throw new Error('JSON records file must contain an array')
  if (parsed.length > MAX_RECORD_ROWS_SCANNED) throw new Error('record scan limit exceeded')
  return parsed.map(normalizeRecord)
}

function parseNdjsonRecords(content: string): FileRecord[] {
  const rows: FileRecord[] = []
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue
    if (rows.length >= MAX_RECORD_ROWS_SCANNED) throw new Error('record scan limit exceeded')
    try {
      rows.push(normalizeRecord(JSON.parse(line)))
    } catch {
      throw new Error('malformed NDJSON records file')
    }
  }
  return rows
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i]
    if (char === '"') {
      if (quoted && content[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        quoted = !quoted
      }
      continue
    }
    if (char === ',' && !quoted) {
      row.push(current)
      current = ''
      continue
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && content[i + 1] === '\n') i += 1
      row.push(current)
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      current = ''
      continue
    }
    current += char
  }
  if (quoted) throw new Error('malformed CSV records file')
  row.push(current)
  if (row.some((value) => value.length > 0)) rows.push(row)
  return rows
}

function parseCsvRecords(content: string): FileRecord[] {
  const parsedRows = parseCsvRows(content)
  if (parsedRows.length === 0) return []
  const headers = (parsedRows[0] ?? []).map((header) => header.trim())
  if (headers.some((header) => !header)) throw new Error('CSV records file must have a non-empty header row')
  const rows: FileRecord[] = []
  for (const values of parsedRows.slice(1)) {
    if (rows.length >= MAX_RECORD_ROWS_SCANNED) throw new Error('record scan limit exceeded')
    const row: FileRecord = {}
    for (const [index, header] of headers.entries()) row[header] = values[index] ?? ''
    rows.push(row)
  }
  return rows
}

function buildFileRecordsResult(args: {
  path: string
  content: string
  mtimeMs?: number
  offset: number
  limit: number
  q: string | null
}): FileRecordsResult {
  const format = detectRecordsFormat(args.path, args.content)
  if (!format) throw new Error('unsupported records file format')
  const allRows = format === 'json-array'
    ? parseJsonArrayRecords(args.content)
    : format === 'ndjson'
      ? parseNdjsonRecords(args.content)
      : parseCsvRecords(args.content)
  const matching = allRows.filter((row) => recordMatches(row, args.q))
  const rows = matching.slice(args.offset, args.offset + args.limit)
  const result: FileRecordsResult = {
    source: { kind: 'file', path: args.path, format },
    path: args.path,
    format,
    columns: inferColumns(matching),
    rows,
    total: matching.length,
    hasMore: args.offset + rows.length < matching.length,
    offset: args.offset,
    limit: args.limit,
    mtimeMs: args.mtimeMs,
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_RECORD_OUTPUT_BYTES) {
    throw new Error('record output limit exceeded')
  }
  return result
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

  app.get('/api/v1/files/records', async (request, reply) => {
    const parsed = parseFileRecordsRequest(request.query as Record<string, unknown>, reply)
    if (parsed === null) return

    try {
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
      const message = err instanceof Error ? err.message : String(err)
      if (
        message.includes('records file')
        || message.includes('record scan')
        || message.includes('record output')
        || message.includes('malformed')
        || message.includes('unsupported records')
        || message.includes('CSV records')
        || message.includes('JSON records')
      ) {
        return sendValidationError(reply, message)
      }
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
