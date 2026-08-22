import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RuntimeFilesystemBinding } from '../../agent/runtime/types'
import { ERROR_CODE_INTERNAL } from './errorCodes'
import {
  CATALOG_STRING_MAX_LENGTH,
  isValidCatalogString,
  type FilesystemCatalogCapabilities,
  type FilesystemCatalogEntry,
  type FilesystemCatalogResponse,
} from '../../shared/catalog'

export type {
  FilesystemCatalogCapabilities,
  FilesystemCatalogEntry,
  FilesystemCatalogResponse,
  LogicalFilesystemRoot,
} from '../../shared/catalog'

const USER_FILESYSTEM_ID = 'user'

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
    upload: true,
    delete: true,
    move: true,
    mkdir: true,
    // The primary `user` fs carries the implicit exec grant for compat
    // (gh-1123); per-agent grant wiring lands in the exec-grants slice.
    execute: true,
  },
}

function validFilesystem(value: unknown): value is string {
  return isValidCatalogString(value, CATALOG_STRING_MAX_LENGTH)
}

function capabilitiesFor(binding: RuntimeFilesystemBinding): FilesystemCatalogCapabilities {
  const operations = binding.operations as Partial<RuntimeFilesystemBinding['operations']>
  const mutable = binding.access === 'readwrite'
  return {
    read: typeof operations.read === 'function',
    list: typeof operations.list === 'function' && typeof operations.stat === 'function',
    search: typeof operations.find === 'function',
    write: mutable && typeof operations.write === 'function',
    upload: mutable
      && binding.filesystem === USER_FILESYSTEM_ID
      && typeof operations.createBinary === 'function'
      && typeof operations.writeBinary === 'function',
    delete: mutable && typeof operations.delete === 'function',
    move: mutable && typeof operations.move === 'function',
    mkdir: mutable && typeof operations.mkdir === 'function',
    // Non-primary filesystems have no exec until an explicit
    // `environment.bash.execute` grant resolves one (gh-1123, default deny).
    execute: false,
  }
}

function catalogEntry(binding: RuntimeFilesystemBinding): FilesystemCatalogEntry | undefined {
  if (!validFilesystem(binding.filesystem) || binding.filesystem === USER_FILESYSTEM_ID) return undefined
  return {
    filesystem: binding.filesystem,
    label: binding.filesystem,
    rootDir: '/',
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
      const primaryBinding = bindings.find((binding) => binding.filesystem === USER_FILESYSTEM_ID)
      const filesystems: FilesystemCatalogEntry[] = [{
        ...PRIMARY_FILESYSTEM,
        ...(primaryBinding ? { capabilities: capabilitiesFor(primaryBinding) } : {}),
      }]
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
