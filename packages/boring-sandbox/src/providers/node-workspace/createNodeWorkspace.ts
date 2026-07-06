import { lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { Workspace, WorkspaceRuntimeContext } from '@hachej/boring-agent/shared'

import {
  assertRealPathWithinWorkspace,
  ensureExistingWorkspacePath,
  ensureWritableWorkspacePath,
  validatePath,
} from './paths'
import { createNodeWatcher, toPosixRel, type NodeWorkspaceWatcher } from './nodeWatcher'

const EPERM_CODE = 'EPERM'

export interface CreateNodeWorkspaceOptions {
  runtimeContext?: WorkspaceRuntimeContext
}

const nodeWorkspaceHostRoots = new WeakMap<Workspace, string>()

export function getNodeWorkspaceHostRoot(workspace: Workspace): string | undefined {
  return nodeWorkspaceHostRoots.get(workspace)
}

export function createNodeWorkspace(root: string, opts: CreateNodeWorkspaceOptions = {}): Workspace {
  const runtimeContext = opts.runtimeContext ?? { runtimeCwd: root }

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
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      await writeFile(absPath, data, 'utf-8')
    },
    async writeBinaryFile(relPath, data) {
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      await writeFile(absPath, data)
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
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      await writeFile(absPath, data, 'utf-8')
      const fileStat = await stat(absPath)
      return {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        kind: fileStat.isDirectory() ? 'dir' : 'file',
      }
    },
    async writeBinaryFileWithStat(relPath, data) {
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      await writeFile(absPath, data)
      const fileStat = await stat(absPath)
      return {
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        kind: fileStat.isDirectory() ? 'dir' : 'file',
      }
    },
    async unlink(relPath) {
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
      validatePath(root, toRelPath)
      const fromAbsPath = await ensureExistingWorkspacePath(root, fromRelPath)
      const toAbsPath = await ensureWritableWorkspacePath(root, toRelPath)
      await rename(fromAbsPath, toAbsPath)
      // One synthetic rename instead of the unlink/add event storm
      // chokidar would stream for every file under a moved directory.
      // No watcher yet → no subscribers → nothing to announce.
      cachedWatcher?.emitRename(toPosixRel(root, fromAbsPath), toPosixRel(root, toAbsPath))
    },
  }

  nodeWorkspaceHostRoots.set(workspace, root)
  return workspace
}
