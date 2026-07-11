import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { RuntimeFilesystemBinding } from '../../runtime/mode'
import type { Workspace, Entry } from '../../../shared/workspace'
import { isIgnoredDirName } from '@hachej/boring-sandbox/providers/node-workspace'
import {
  ERROR_CODE_INVALID_PATH,
  ERROR_CODE_PATH_REJECTED,
  ERROR_CODE_NOT_FOUND,
  ERROR_CODE_INTERNAL,
} from '../middleware'
import { ERROR_CODE_NOT_FOUND_OR_DENIED } from './file'

const MAX_DEPTH = 10
const MAX_ENTRIES = 5000

interface TreeEntry {
  name: string
  kind: 'file' | 'dir'
  path: string
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
    return bindings.find((binding) => binding.filesystem === filesystem)
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

      if (filesystem !== 'user') {
        try {
          const binding = await resolveFilesystemBinding(request, filesystem)
          if (!binding) return sendNotFoundOrDenied(reply)
          return { entries: await listBoundTree(binding, dir, recursive) }
        } catch {
          return sendNotFoundOrDenied(reply)
        }
      }

      try {

        const workspace = await resolveWorkspace(request)
        const entries = await listTree(workspace, dir, recursive)
        return { entries }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'readdir failed'
        const code = (err as NodeJS.ErrnoException)?.code

        if (code === 'EPERM' || message.includes('traversal') || message.includes('EPERM')) {
          return reply.code(403).send({
            error: { code: ERROR_CODE_PATH_REJECTED, message: 'path traversal rejected' },
          })
        }

        if (code === 'ENOENT' || message.includes('ENOENT')) {
          return reply.code(404).send({
            error: { code: ERROR_CODE_NOT_FOUND, message: `directory not found: ${dir}` },
          })
        }

        const statusCode = (err as { statusCode?: unknown })?.statusCode
        const stableCode = (err as { code?: unknown })?.code
        if (
          typeof statusCode === 'number' &&
          statusCode >= 400 &&
          statusCode < 600
        ) {
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
    },
  )

  done()
}
