import { lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type {
  RuntimeFilesystemCapability,
  Workspace,
  WorkspaceRuntimeContext,
} from '@hachej/boring-agent/shared'
import type { ReadonlyWorkspacePolicyV1 } from '../../shared/providerV1'
import {
  assertRealPathWithinWorkspace,
  ensureExistingWorkspacePath,
  ensureWritableWorkspacePath,
  validatePath,
} from './paths'
import { createNodeWatcher, toPosixRel, type NodeWorkspaceWatcher } from './nodeWatcher'
import {
  acquireNodeWorkspaceMutationGuard,
  type NodeWorkspaceMutationGuard,
} from './readonlyMutationGuard'

const EPERM_CODE = 'EPERM'

export interface CreateNodeWorkspaceOptions {
  runtimeContext?: WorkspaceRuntimeContext
  readonlyWorkspacePolicy?: ReadonlyWorkspacePolicyV1
}

const nodeWorkspaceHostRoots = new WeakMap<Workspace, string>()
const nodeWorkspaceDisposers = new WeakMap<Workspace, () => void>()
const nodeWorkspaceReady = new WeakMap<Workspace, Promise<NodeWorkspaceMutationGuard>>()

export function getNodeWorkspaceHostRoot(workspace: Workspace): string | undefined {
  return nodeWorkspaceHostRoots.get(workspace)
}

export function disposeNodeWorkspace(workspace: Workspace): void {
  nodeWorkspaceDisposers.get(workspace)?.()
}

export async function whenNodeWorkspaceReady(workspace: Workspace): Promise<void> {
  await nodeWorkspaceReady.get(workspace)
}

export async function getNodeWorkspaceReadonlyPolicy(
  workspace: Workspace,
): Promise<ReadonlyWorkspacePolicyV1 | undefined> {
  return (await nodeWorkspaceReady.get(workspace))?.policy
}

export function createNodeWorkspace(root: string, opts: CreateNodeWorkspaceOptions = {}): Workspace {
  const runtimeContext = opts.runtimeContext ?? { runtimeCwd: root }

  const mutationGuard = acquireNodeWorkspaceMutationGuard(root, opts.readonlyWorkspacePolicy)
  // Read-only use or an abandoned invalid workspace must not create an
  // unhandled rejected promise; mutators/whenReady still observe the error.
  void mutationGuard.catch(() => {})
  const mutate = async <T>(
    operation: RuntimeFilesystemCapability,
    paths: readonly string[],
    effect: () => Promise<T>,
  ): Promise<T> => {
    const guard = await mutationGuard
    return await guard.runExclusive(async () => {
      await guard.assertAllowed(operation, paths)
      return await effect()
    })
  }

  // Lazy singleton: a single chokidar instance shared by every caller
  // of `watch()` on this workspace. Codex flagged "one watcher per
  // SSE client" as a fd leak — this avoids it.
  let cachedWatcher: NodeWorkspaceWatcher | null = null

  const workspace: Workspace = {
    root: runtimeContext.runtimeCwd,
    runtimeContext,
    fsCapability: 'strong',
    watch() {
      if (!cachedWatcher) cachedWatcher = createNodeWatcher(root)
      return cachedWatcher
    },
    async readFile(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      return await readFile(absPath, 'utf-8')
    },
    async readBinaryFile(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      return new Uint8Array(await readFile(absPath))
    },
    async writeFile(relPath, data) {
      await mutate('write', [relPath], async () => {
        const absPath = await ensureWritableWorkspacePath(root, relPath)
        await writeFile(absPath, data, 'utf-8')
      })
    },
    async writeBinaryFile(relPath, data) {
      await mutate('write', [relPath], async () => {
        const absPath = await ensureWritableWorkspacePath(root, relPath)
        await writeFile(absPath, data)
      })
    },
    async readFileWithStat(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      const [content, fileStat] = await Promise.all([
        readFile(absPath, 'utf-8'),
        stat(absPath),
      ])
      return {
        content,
        stat: {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          kind: fileStat.isDirectory() ? 'dir' : 'file',
        },
      }
    },
    async writeFileWithStat(relPath, data) {
      return await mutate('write', [relPath], async () => {
        const absPath = await ensureWritableWorkspacePath(root, relPath)
        await writeFile(absPath, data, 'utf-8')
        const fileStat = await stat(absPath)
        return {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          kind: fileStat.isDirectory() ? 'dir' as const : 'file' as const,
        }
      })
    },
    async writeBinaryFileWithStat(relPath, data) {
      return await mutate('write', [relPath], async () => {
        const absPath = await ensureWritableWorkspacePath(root, relPath)
        await writeFile(absPath, data)
        const fileStat = await stat(absPath)
        return {
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          kind: fileStat.isDirectory() ? 'dir' as const : 'file' as const,
        }
      })
    },
    async unlink(relPath) {
      await mutate('delete', [relPath], async () => {
        const absPath = await ensureExistingWorkspacePath(root, relPath)
        if (absPath === resolve(root)) {
          throw Object.assign(new Error('cannot remove workspace root'), { code: EPERM_CODE })
        }
        const pathStat = await lstat(absPath)
        if (pathStat.isDirectory()) {
          await rm(absPath, { recursive: true, force: false })
          return
        }
        await unlink(absPath)
      })
    },
    async readdir(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      const entries = await readdir(absPath, { withFileTypes: true })
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'dir' : 'file',
      }))
    },
    async stat(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      const fileStat = await stat(absPath)
      return {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        kind: fileStat.isDirectory() ? 'dir' : 'file',
      }
    },
    async mkdir(relPath, opts) {
      await mutate('create-child', [relPath], async () => {
        const absPath = validatePath(root, relPath)
        let existingAncestor = absPath
        while (true) {
          try {
            await stat(existingAncestor)
            break
          } catch (error: unknown) {
            const code = (error as { code?: string }).code
            if (code !== 'ENOENT') throw error
            const parent = dirname(existingAncestor)
            if (parent === existingAncestor) throw error
            existingAncestor = parent
          }
        }
        await assertRealPathWithinWorkspace(root, existingAncestor)
        await mkdir(absPath, { recursive: opts?.recursive ?? false })
      })
    },
    async rename(fromRelPath, toRelPath) {
      const guard = await mutationGuard
      await guard.runExclusive(async () => {
        await guard.assertAllowed('move-from', [fromRelPath])
        await guard.assertAllowed('create-child', [toRelPath])
        validatePath(root, toRelPath)
        const fromAbsPath = await ensureExistingWorkspacePath(root, fromRelPath)
        const toAbsPath = await ensureWritableWorkspacePath(root, toRelPath)
        await rename(fromAbsPath, toAbsPath)
        // One synthetic rename instead of the unlink/add event storm
        // chokidar would stream for every file under a moved directory.
        // No watcher yet → no subscribers → nothing to announce.
        cachedWatcher?.emitRename(toPosixRel(root, fromAbsPath), toPosixRel(root, toAbsPath))
      })
    },
  }

  nodeWorkspaceHostRoots.set(workspace, root)
  nodeWorkspaceReady.set(workspace, mutationGuard)
  nodeWorkspaceDisposers.set(workspace, () => {
    cachedWatcher?.close()
    cachedWatcher = null
    void mutationGuard.then((guard) => guard.release(), () => undefined)
  })
  return workspace
}
