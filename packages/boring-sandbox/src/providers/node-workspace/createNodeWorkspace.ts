import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { Workspace, WorkspaceRuntimeContext } from '@hachej/boring-agent/shared'
import {
  assertRealPathWithinWorkspace,
  ensureExistingWorkspacePath,
  ensureWritableWorkspacePath,
  resolveRealWorkspacePath,
  validatePath,
} from './paths'
import { createNodeWatcher, toPosixRel, type NodeWorkspaceWatcher } from './nodeWatcher'

const EPERM_CODE = 'EPERM'
const CONFLICT_CODE = 'workspace_revision_conflict'
const nodeWorkspacePathLocks = new Map<string, Promise<void>>()

export interface CreateNodeWorkspaceOptions {
  runtimeContext?: WorkspaceRuntimeContext
  readonlyPaths?: readonly string[]
}

const nodeWorkspaceHostRoots = new WeakMap<Workspace, string>()
const nodeWorkspaceDisposers = new WeakMap<Workspace, () => void>()

export function getNodeWorkspaceHostRoot(workspace: Workspace): string | undefined {
  return nodeWorkspaceHostRoots.get(workspace)
}

export function disposeNodeWorkspace(workspace: Workspace): void {
  nodeWorkspaceDisposers.get(workspace)?.()
}

export function createNodeWorkspace(root: string, opts: CreateNodeWorkspaceOptions = {}): Workspace {
  const runtimeContext = opts.runtimeContext ?? { runtimeCwd: root }
  const readonlyPaths = (opts.readonlyPaths ?? []).map((path) => path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, ''))
  const assertWritable = async (relPath: string): Promise<void> => {
    const lexical = relPath.replaceAll('\\', '/').replace(/^\.\//, '')
    const canonical = await resolveRealWorkspacePath(root, relPath)
    const blocked = readonlyPaths.find((path) => lexical === path || lexical.startsWith(`${path}/`) || canonical === path || canonical.startsWith(`${path}/`))
    if (blocked) throw Object.assign(new Error(`${blocked} is readonly`), { code: 'readonly', statusCode: 403 })
  }

  // Lazy singleton: a single chokidar instance shared by every caller
  // of `watch()` on this workspace. Codex flagged "one watcher per
  // SSE client" as a fd leak — this avoids it.
  let cachedWatcher: NodeWorkspaceWatcher | null = null
  const withPathLock = async <T>(path: string, fn: () => Promise<T>): Promise<T> => {
    const previous = nodeWorkspacePathLocks.get(path) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolveLock) => { release = resolveLock })
    const queued = previous.then(() => current)
    nodeWorkspacePathLocks.set(path, queued)
    await previous
    try {
      return await fn()
    } finally {
      release()
      if (nodeWorkspacePathLocks.get(path) === queued) nodeWorkspacePathLocks.delete(path)
    }
  }
  const toStat = (fileStat: Awaited<ReturnType<typeof stat>>) => ({
    size: Number(fileStat.size),
    mtimeMs: Number(fileStat.mtimeMs),
    kind: fileStat.isDirectory() ? 'dir' as const : 'file' as const,
  })

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
      await assertWritable(relPath)
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      await withPathLock(absPath, async () => { await writeFile(absPath, data, 'utf-8') })
    },
    async writeBinaryFile(relPath, data) {
      await assertWritable(relPath)
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      await withPathLock(absPath, async () => { await writeFile(absPath, data) })
    },
    async createBinaryFile(relPath, data) {
      await assertWritable(relPath)
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      await withPathLock(absPath, async () => { await writeFile(absPath, data, { flag: 'wx' }) })
    },
    async readFileWithStat(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      return await withPathLock(absPath, async () => {
        const content = await readFile(absPath, 'utf-8')
        const fileStat = await stat(absPath)
        return { content, stat: toStat(fileStat) }
      })
    },
    async writeFileWithStat(relPath, data) {
      await assertWritable(relPath)
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      return await withPathLock(absPath, async () => {
        await writeFile(absPath, data, 'utf-8')
        return toStat(await stat(absPath))
      })
    },
    async replaceFileIfUnchanged(relPath, data, expected) {
      await assertWritable(relPath)
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      return await withPathLock(absPath, async () => {
        const current = await stat(absPath)
        if (current.size !== expected.size || current.mtimeMs !== expected.mtimeMs) {
          throw Object.assign(new Error('file has been modified since last read'), {
            code: CONFLICT_CODE,
            statusCode: 409,
            details: { expected, current: { size: current.size, mtimeMs: current.mtimeMs } },
          })
        }
        const temporary = `${absPath}.${randomUUID()}.tmp`
        let replacementStat
        try {
          await writeFile(temporary, data, 'utf-8')
          replacementStat = await stat(temporary)
          await rename(temporary, absPath)
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => {})
          throw error
        }
        return toStat(replacementStat)
      })
    },
    async writeBinaryFileWithStat(relPath, data) {
      await assertWritable(relPath)
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      return await withPathLock(absPath, async () => {
        await writeFile(absPath, data)
        return toStat(await stat(absPath))
      })
    },
    async unlink(relPath) {
      await assertWritable(relPath)
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      await withPathLock(absPath, async () => {
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
      await assertWritable(relPath)
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
    },
    async rename(fromRelPath, toRelPath) {
      await assertWritable(fromRelPath)
      await assertWritable(toRelPath)
      validatePath(root, toRelPath)
      const fromAbsPath = await ensureExistingWorkspacePath(root, fromRelPath)
      const toAbsPath = await ensureWritableWorkspacePath(root, toRelPath)
      if (fromAbsPath === toAbsPath) {
        await withPathLock(fromAbsPath, async () => { await rename(fromAbsPath, toAbsPath) })
      } else {
        const [first, second] = [fromAbsPath, toAbsPath].sort()
        await withPathLock(first!, async () => {
          await withPathLock(second!, async () => { await rename(fromAbsPath, toAbsPath) })
        })
      }
      // One synthetic rename instead of the unlink/add event storm
      // chokidar would stream for every file under a moved directory.
      // No watcher yet → no subscribers → nothing to announce.
      cachedWatcher?.emitRename(toPosixRel(root, fromAbsPath), toPosixRel(root, toAbsPath))
    },
  }

  nodeWorkspaceHostRoots.set(workspace, root)
  nodeWorkspaceDisposers.set(workspace, () => {
    cachedWatcher?.close()
    cachedWatcher = null
  })
  return workspace
}
