import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RuntimeFilesystemBinding } from '../../agent/runtime/types'
import { ERROR_CODE_INTERNAL } from './errorCodes'

const USER_FILESYSTEM_ID = 'user'
const MAX_FILESYSTEM_LENGTH = 128
const MAX_LABEL_LENGTH = 128
const MAX_ROOT_LENGTH = 512
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export interface FilesystemCatalogCapabilities {
  read: boolean
  list: boolean
  search: boolean
  write: boolean
  delete: boolean
  move: boolean
  mkdir: boolean
}

export type LogicalFilesystemRoot = '.' | `/${string}`

export interface FilesystemCatalogEntry {
  filesystem: string
  label: string
  rootDir: LogicalFilesystemRoot
  access: 'readonly' | 'readwrite'
  capabilities: FilesystemCatalogCapabilities
}

export interface FilesystemCatalogResponse {
  filesystems: FilesystemCatalogEntry[]
}

export interface FilesystemsRouteOptions {
  filesystemBindings?: RuntimeFilesystemBinding[]
  getFilesystemBindings?: (
    request: FastifyRequest,
  ) => RuntimeFilesystemBinding[] | undefined | Promise<RuntimeFilesystemBinding[] | undefined>
}

const PRIMARY_FILESYSTEM: FilesystemCatalogEntry = {
  filesystem: USER_FILESYSTEM_ID,
  label: 'Workspace',
  rootDir: '.',
  access: 'readwrite',
  capabilities: {
    read: true,
    list: true,
    search: true,
    write: true,
    delete: true,
    move: true,
    mkdir: true,
  },
}

function validFilesystem(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_FILESYSTEM_LENGTH
    && value.trim() === value
    && !CONTROL_CHARACTERS.test(value)
}

function safeText(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value.trim() === value
    && !CONTROL_CHARACTERS.test(value)
    ? value
    : fallback
}

function safeLogicalRoot(value: unknown): LogicalFilesystemRoot {
  if (value === '.') return '.'
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ROOT_LENGTH) return '/'
  if (!value.startsWith('/') || value.includes('\\') || CONTROL_CHARACTERS.test(value)) return '/'
  if (value === '/') return '/'
  if (value.endsWith('/') || value.includes('//')) return '/'
  const segments = value.slice(1).split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return '/'
  return value as LogicalFilesystemRoot
}

function capabilitiesFor(binding: RuntimeFilesystemBinding): FilesystemCatalogCapabilities {
  const operations = binding.operations as Partial<RuntimeFilesystemBinding['operations']>
  const mutable = binding.access === 'readwrite'
  return {
    read: typeof operations.read === 'function',
    list: typeof operations.list === 'function' && typeof operations.stat === 'function',
    search: typeof operations.find === 'function',
    write: mutable && typeof operations.write === 'function',
    delete: mutable && typeof operations.delete === 'function',
    move: mutable && typeof operations.move === 'function',
    mkdir: mutable && typeof operations.mkdir === 'function',
  }
}

function catalogEntry(binding: RuntimeFilesystemBinding): FilesystemCatalogEntry | undefined {
  if (!validFilesystem(binding.filesystem) || binding.filesystem === USER_FILESYSTEM_ID) return undefined
  const metadata = binding.catalog
  return {
    filesystem: binding.filesystem,
    label: safeText(metadata?.label, binding.filesystem, MAX_LABEL_LENGTH),
    rootDir: safeLogicalRoot(metadata?.rootDir),
    access: binding.access === 'readwrite' ? 'readwrite' : 'readonly',
    capabilities: capabilitiesFor(binding),
  }
}

export function filesystemsRoutes(
  app: FastifyInstance,
  opts: FilesystemsRouteOptions,
  done: (err?: Error) => void,
): void {
  app.get('/api/v1/filesystems', async (request, reply) => {
    try {
      const bindings = opts.getFilesystemBindings
        ? await opts.getFilesystemBindings(request) ?? []
        : opts.filesystemBindings ?? []
      const seen = new Set<string>([USER_FILESYSTEM_ID])
      const filesystems: FilesystemCatalogEntry[] = [{ ...PRIMARY_FILESYSTEM }]
      for (const binding of bindings) {
        if (seen.has(binding.filesystem)) continue
        const entry = catalogEntry(binding)
        if (!entry) continue
        seen.add(entry.filesystem)
        filesystems.push(entry)
      }
      return reply.send({ filesystems } satisfies FilesystemCatalogResponse)
    } catch {
      request.log.error('[filesystems] binding resolution failed')
      return reply.code(500).send({
        error: { code: ERROR_CODE_INTERNAL, message: 'filesystem catalog failed' },
      })
    }
  })

  done()
}
