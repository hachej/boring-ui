import { lstat, mkdir, readdir, readFile, rename, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Workspace } from '../../shared/workspace'
import {
  assertRealPathWithinWorkspace,
  ensureExistingWorkspacePath,
  ensureWritableWorkspacePath,
  validatePath,
} from './paths'

export function createNodeWorkspace(root: string): Workspace {
  return {
    root,
    async readFile(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      return await readFile(absPath, 'utf-8')
    },
    async writeFile(relPath, data) {
      const absPath = await ensureWritableWorkspacePath(root, relPath)
      await writeFile(absPath, data, 'utf-8')
    },
    async unlink(relPath) {
      const absPath = await ensureExistingWorkspacePath(root, relPath)
      const pathStat = await lstat(absPath)
      if (pathStat.isDirectory()) {
        await rmdir(absPath)
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
    },
  }
}
