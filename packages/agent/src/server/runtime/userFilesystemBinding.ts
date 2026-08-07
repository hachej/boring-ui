import {
  ReadonlyFilesystemMutationError,
  type RuntimeFilesystemCapability,
  type Workspace,
} from '../../shared/workspace'
import { ERROR_CODE_CONFLICT } from '../http/middleware'
import type { RuntimeFilesystemBinding } from './mode'
import {
  resolveRuntimeReadonlyFilesystemAccess,
  type RuntimeReadonlyFilesystemPolicy,
} from './readonlyFilesystemPolicy'

const USER_FILESYSTEM_ID = 'user'

function workspacePath(workspace: Workspace, input: string): string {
  const normalized = input.replace(/\\/g, '/')
  const root = workspace.root.replace(/\\/g, '/').replace(/\/$/, '')
  if (normalized === root || normalized === '/') return '.'
  if (root && normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1)
  return normalized.replace(/^\.\//, '')
}

function conflict(currentMtimeMs: number | undefined, expectedMtimeMs: number): Error {
  return Object.assign(new Error('file has been modified since last read'), {
    code: ERROR_CODE_CONFLICT,
    statusCode: 409,
    details: { currentMtimeMs, expectedMtimeMs },
  })
}

/** Primary-user Operations adapter shared by HTTP and Pi filesystem tools. */
export function createUserFilesystemBinding(
  workspace: Workspace,
  policy: RuntimeReadonlyFilesystemPolicy,
  resolvePolicyPath: (path: string) => Promise<string>,
): RuntimeFilesystemBinding {
  const resolveAccess = async (path: string) => resolveRuntimeReadonlyFilesystemAccess(policy, {
    filesystem: USER_FILESYSTEM_ID,
    normalizedPath: await resolvePolicyPath(workspacePath(workspace, path)),
  })
  const requireCapability = async (path: string, capability: RuntimeFilesystemCapability): Promise<void> => {
    if (!(await resolveAccess(path)).capabilities[capability]) {
      throw new ReadonlyFilesystemMutationError(USER_FILESYSTEM_ID, capability)
    }
  }

  return {
    filesystem: USER_FILESYSTEM_ID,
    access: 'readwrite',
    operations: {
      async read({ path }) {
        const target = workspacePath(workspace, path)
        if (workspace.readFileWithStat) {
          const result = await workspace.readFileWithStat(target)
          return { content: result.content, mtimeMs: result.stat.kind === 'file' ? result.stat.mtimeMs : undefined }
        }
        const [content, stat] = await Promise.all([workspace.readFile(target), workspace.stat(target)])
        return { content, mtimeMs: stat.kind === 'file' ? stat.mtimeMs : undefined }
      },
      async list({ path }) {
        return { entries: (await workspace.readdir(workspacePath(workspace, path))).map((entry) => entry.name) }
      },
      async find() {
        throw new Error('user filesystem discovery uses the canonical search adapter')
      },
      async grep() {
        throw new Error('user filesystem search uses the canonical search adapter')
      },
      async stat({ path }) {
        return { isDirectory: (await workspace.stat(workspacePath(workspace, path))).kind === 'dir' }
      },
      async write({ path, content, expectedMtimeMs }) {
        await requireCapability(path, 'write')
        const target = workspacePath(workspace, path)
        if (expectedMtimeMs !== undefined) {
          let currentMtimeMs: number | undefined
          try {
            const current = await workspace.stat(target)
            currentMtimeMs = current.kind === 'file' ? current.mtimeMs : undefined
          } catch (error: unknown) {
            if ((error as { code?: string }).code !== 'ENOENT') throw error
            throw Object.assign(new Error('file no longer exists'), {
              code: ERROR_CODE_CONFLICT,
              statusCode: 409,
              details: { expectedMtimeMs },
            })
          }
          if (currentMtimeMs !== expectedMtimeMs) throw conflict(currentMtimeMs, expectedMtimeMs)
        }
        if (workspace.writeFileWithStat) {
          const stat = await workspace.writeFileWithStat(target, content)
          return { mtimeMs: stat.kind === 'file' ? stat.mtimeMs : undefined }
        }
        await workspace.writeFile(target, content)
        const stat = await workspace.stat(target)
        return { mtimeMs: stat.kind === 'file' ? stat.mtimeMs : undefined }
      },
      async writeBinary({ path, content }) {
        await requireCapability(path, 'write')
        const target = workspacePath(workspace, path)
        if (workspace.writeBinaryFileWithStat) {
          const stat = await workspace.writeBinaryFileWithStat(target, content)
          return { mtimeMs: stat.kind === 'file' ? stat.mtimeMs : undefined }
        }
        if (!workspace.writeBinaryFile) throw Object.assign(new Error('workspace does not support binary writes'), { statusCode: 501 })
        await workspace.writeBinaryFile(target, content)
        const stat = await workspace.stat(target)
        return { mtimeMs: stat.kind === 'file' ? stat.mtimeMs : undefined }
      },
      async delete({ path }) {
        await requireCapability(path, 'delete')
        await workspace.unlink(workspacePath(workspace, path))
        return {}
      },
      async move({ from, to }) {
        await requireCapability(from, 'move-from')
        await requireCapability(to, 'write')
        await workspace.rename(workspacePath(workspace, from), workspacePath(workspace, to))
        return {}
      },
      async mkdir({ path, recursive }) {
        await requireCapability(path, 'create-child')
        await workspace.mkdir(workspacePath(workspace, path), { recursive })
        return {}
      },
      async resolveAccess({ path }) {
        return await resolveAccess(path)
      },
      rejectMutation(operation) {
        const capability: RuntimeFilesystemCapability = operation === 'delete'
          || operation === 'move-from'
          || operation === 'create-child'
          ? operation
          : 'write'
        throw new ReadonlyFilesystemMutationError(USER_FILESYSTEM_ID, capability)
      },
    },
  }
}
