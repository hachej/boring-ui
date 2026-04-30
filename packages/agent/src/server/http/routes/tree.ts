import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { Workspace, Entry } from '../../../shared/workspace'
import {
  ERROR_CODE_INVALID_PATH,
  ERROR_CODE_PATH_REJECTED,
  ERROR_CODE_NOT_FOUND,
  ERROR_CODE_INTERNAL,
} from '../middleware'

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

      if (recursive && e.kind === 'dir' && batch.depth < MAX_DEPTH) {
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

export function treeRoutes(
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
    throw new Error('workspace route requires workspace or getWorkspace')
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
