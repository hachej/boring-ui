import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { RuntimeFilesystemBinding } from '../../agent/runtime/types'
import type { Workspace, Entry } from '@hachej/boring-agent/shared'
import { isIgnoredDirName } from './ignore'
import {
  ERROR_CODE_INVALID_PATH,
  ERROR_CODE_PATH_REJECTED,
  ERROR_CODE_NOT_FOUND,
  ERROR_CODE_INTERNAL,
} from './errorCodes'
import { ERROR_CODE_NOT_FOUND_OR_DENIED } from './file'
import { accessProjection, resolveBindingAccess } from './bindingAccess'

const MAX_DEPTH = 10
const MAX_ENTRIES = 5000

interface TreeEntry {
  name: string
  kind: 'file' | 'dir'
  path: string
  access?: 'readonly' | 'readwrite'
  capabilities?: Awaited<ReturnType<typeof resolveBindingAccess>>['capabilities']
}

interface TreeQuerystring {
  path?: string
  recursive?: string
  filesystem?: string
}

function normalizePath(raw: string | undefined): string {
  const p = (raw ?? '').trim() || '.'
  if (p.includes('\0')) throw new PathError('null bytes not allowed')
  return p
}

class PathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathError'
  }
}

function joinPath(base: string, name: string): string {
  if (base === '.') return name
  return `${base}/${name}`
}

function requestedFilesystem(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : 'user'
}

function sendNotFoundOrDenied(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({
    error: { code: ERROR_CODE_NOT_FOUND_OR_DENIED, message: 'not found or denied' },
  })
}

async function listTree(
  workspace: Workspace,
  dir: string,
  recursive: boolean,
): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = []

  const initialEntries = await workspace.readdir(dir)

  const queue: Array<{ parentDir: string; items: Entry[]; depth: number }> = [
    { parentDir: dir, items: initialEntries, depth: 0 },
  ]

  while (queue.length > 0) {
    if (entries.length >= MAX_ENTRIES) break

    const batch = queue.shift()!
    for (const e of batch.items) {
      if (entries.length >= MAX_ENTRIES) break

      const entryPath = joinPath(batch.parentDir, e.name)
      entries.push({ name: e.name, kind: e.kind, path: entryPath })

      // The directory is always listed as an entry above; we only avoid
      // *descending* into heavy/ignored dirs (node_modules, .worktrees, .git,
      // dist, ...). On repos with many worktrees an unfiltered recursive walk
      // takes seconds and exhausts MAX_ENTRIES on junk before reaching real
      // source. Non-recursive listings are unaffected — the entry set for any
      // single directory is identical to before. Users can still expand an
      // ignored dir on demand via a non-recursive request for its path.
      if (
        recursive &&
        e.kind === 'dir' &&
        batch.depth < MAX_DEPTH &&
        !isIgnoredDirName(e.name)
      ) {
        try {
          const subEntries = await workspace.readdir(entryPath)
          queue.push({ parentDir: entryPath, items: subEntries, depth: batch.depth + 1 })
        } catch {
          // skip unreadable subdirectories
        }
      }
    }
  }

  return entries
}

async function listBoundTree(
  binding: RuntimeFilesystemBinding,
  dir: string,
  recursive: boolean,
): Promise<TreeEntry[]> {
  const root = dir === '.' ? '/' : dir
  const displayParentDir = dir === '.' || dir === '/' ? '.' : dir.replace(/\/+$/, '')
  const entries: TreeEntry[] = []
  const rootEntries = await binding.operations.list({ filesystem: binding.filesystem, path: root })
  const queue: Array<{ parentDir: string; items: string[]; depth: number }> = [
    { parentDir: displayParentDir || '.', items: rootEntries.entries, depth: 0 },
  ]

  while (queue.length > 0) {
    if (entries.length >= MAX_ENTRIES) break
    const batch = queue.shift()!
    for (const name of batch.items) {
      if (entries.length >= MAX_ENTRIES) break
      const entryPath = joinPath(batch.parentDir, name)
      const stat = await binding.operations.stat({ filesystem: binding.filesystem, path: entryPath })
      const kind = stat.isDirectory ? 'dir' : 'file'
      entries.push({ name, kind, path: entryPath })
      if (recursive && kind === 'dir' && batch.depth < MAX_DEPTH && !isIgnoredDirName(name)) {
        try {
          const childEntries = await binding.operations.list({ filesystem: binding.filesystem, path: entryPath })
          queue.push({ parentDir: entryPath, items: childEntries.entries, depth: batch.depth + 1 })
        } catch {
          // skip unreadable subdirectories
        }
      }
    }
  }

  return entries
}

export function treeRoutes(
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
    throw new Error('workspace route requires workspace or getWorkspace')
  }

  async function resolveFilesystemBinding(request: FastifyRequest, filesystem: string): Promise<RuntimeFilesystemBinding | undefined> {
    const bindings = opts.getFilesystemBindings
      ? await opts.getFilesystemBindings(request) ?? []
      : opts.filesystemBindings ?? []
    const matches = bindings.filter((binding) => binding.filesystem === filesystem)
    if (matches.length > 1) throw new Error(`duplicate filesystem binding: ${filesystem}`)
    return matches[0]
  }

  async function projectEntries(binding: RuntimeFilesystemBinding, entries: TreeEntry[]): Promise<TreeEntry[]> {
    return await Promise.all(entries.map(async (entry) => ({
      ...entry,
      ...accessProjection(await resolveBindingAccess(binding, entry.path)),
    })))
  }

  function classifyTreeError(err: unknown, reply: FastifyReply, dir: string): FastifyReply {
    const message = err instanceof Error ? err.message : 'readdir failed'
    const code = (err as NodeJS.ErrnoException)?.code

    if (code === 'EPERM' || message.includes('traversal') || message.includes('EPERM')) {
      return reply.code(403).send({ error: { code: ERROR_CODE_PATH_REJECTED, message: 'path traversal rejected' } })
    }
    if (code === 'ENOENT' || message.includes('ENOENT')) {
      return reply.code(404).send({ error: { code: ERROR_CODE_NOT_FOUND, message: `directory not found: ${dir}` } })
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
    return reply.code(500).send({ error: { code: ERROR_CODE_INTERNAL, message } })
  }

  app.get(
    '/api/v1/tree',
    async (
      request: FastifyRequest<{ Querystring: TreeQuerystring }>,
      reply: FastifyReply,
    ) => {
      let dir: string
      try {
        dir = normalizePath(request.query.path)
      } catch (err) {
        if (err instanceof PathError) {
          return reply.code(400).send({
            error: { code: ERROR_CODE_INVALID_PATH, message: err.message },
          })
        }
        throw err
      }

      const recursive = request.query.recursive === 'true'
      const filesystem = requestedFilesystem(request.query.filesystem)

      const binding = await resolveFilesystemBinding(request, filesystem)
      if (binding && filesystem !== 'user') {
        try {
          const entries = await listBoundTree(binding, dir, recursive)
          return {
            entries: await projectEntries(binding, entries),
            ...accessProjection(await resolveBindingAccess(binding, dir)),
          }
        } catch {
          return sendNotFoundOrDenied(reply)
        }
      }
      if (filesystem !== 'user') return sendNotFoundOrDenied(reply)

      try {
        const workspace = await resolveWorkspace(request)
        const entries = await listTree(workspace, dir, recursive)
        return {
          entries: binding ? await projectEntries(binding, entries) : entries,
          ...(binding ? accessProjection(await resolveBindingAccess(binding, dir)) : { access: 'readwrite' as const }),
        }
      } catch (err) {
        return classifyTreeError(err, reply, dir)
      }
    },
  )

  done()
}
