import { lstat, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import type { Stat, Workspace } from '../../shared/workspace'

const EPERM_CODE = 'EPERM'

function validate(root: string, relPath: string): string {
  if (relPath.includes('\0') || isAbsolute(relPath) || relPath.split(/[\\/]/).some((part) => part === '..')) {
    throw Object.assign(new Error('invalid workspace path'), { statusCode: 400, reason: 'path-escape' })
  }
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(root, relPath)
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`)) {
    throw Object.assign(new Error('path escapes workspace root'), { statusCode: 400, reason: 'path-escape' })
  }
  return resolvedPath
}

function toStat(fileStat: Stats): Stat {
  return {
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    kind: fileStat.isDirectory() ? 'dir' : 'file',
  }
}

export function createTestNodeWorkspace(root: string): Workspace {
  return {
    root,
    runtimeContext: { runtimeCwd: root },
    fsCapability: 'strong',
    async readFile(relPath) {
      return await readFile(validate(root, relPath), 'utf8')
    },
    async readBinaryFile(relPath) {
      return new Uint8Array(await readFile(validate(root, relPath)))
    },
    async writeFile(relPath, data) {
      await writeFile(validate(root, relPath), data, 'utf8')
    },
    async writeBinaryFile(relPath, data) {
      await writeFile(validate(root, relPath), data)
    },
    async readFileWithStat(relPath) {
      const absPath = validate(root, relPath)
      const [content, fileStat] = await Promise.all([readFile(absPath, 'utf8'), stat(absPath)])
      return { content, stat: toStat(fileStat) }
    },
    async writeFileWithStat(relPath, data) {
      const absPath = validate(root, relPath)
      await writeFile(absPath, data, 'utf8')
      return toStat(await stat(absPath))
    },
    async writeBinaryFileWithStat(relPath, data) {
      const absPath = validate(root, relPath)
      await writeFile(absPath, data)
      return toStat(await stat(absPath))
    },
    async unlink(relPath) {
      const absPath = validate(root, relPath)
      if (absPath === resolve(root)) {
        throw Object.assign(new Error('cannot remove workspace root'), { code: EPERM_CODE })
      }
      const fileStat = await lstat(absPath)
      if (fileStat.isDirectory()) {
        await rm(absPath, { recursive: true })
        return
      }
      await unlink(absPath)
    },
    async readdir(relPath) {
      const entries = await readdir(validate(root, relPath), { withFileTypes: true })
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'dir' as const : 'file' as const,
      }))
    },
    async stat(relPath) {
      return toStat(await stat(validate(root, relPath)))
    },
    async mkdir(relPath, opts) {
      await mkdir(validate(root, relPath), { recursive: opts?.recursive ?? false })
    },
    async rename(fromRelPath, toRelPath) {
      const toPath = validate(root, toRelPath)
      await mkdir(dirname(toPath), { recursive: true })
      await rename(validate(root, fromRelPath), toPath)
    },
  }
}
