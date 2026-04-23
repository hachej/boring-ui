import type { Entry, Stat, Workspace } from '../../shared/workspace'

const ENOENT = 'ENOENT'
const EEXIST = 'EEXIST'
const EISDIR = 'EISDIR'
const ENOTDIR = 'ENOTDIR'
const ENOTEMPTY = 'ENOTEMPTY'
const EPERM = 'EPERM'

function createFsError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

function normalizePath(relPath: string): string {
  if (typeof relPath !== 'string') {
    throw new Error('path must be a string')
  }
  if (relPath.includes('\0')) {
    throw new Error('path must not contain null bytes')
  }

  const normalized = relPath.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('absolute paths are not allowed')
  }

  const parts = normalized.split('/').filter((part) => part.length > 0 && part !== '.')
  if (parts.some((part) => part === '..')) {
    throw new Error('path traversal rejected')
  }

  return parts.length === 0 ? '.' : parts.join('/')
}

function dirname(path: string): string {
  if (path === '.') return '.'
  const index = path.lastIndexOf('/')
  return index === -1 ? '.' : path.slice(0, index)
}

function basename(path: string): string {
  if (path === '.') return '.'
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

export interface MockWorkspace extends Workspace {
  readonly files: Map<string, string>
  readonly dirs: Set<string>
  readonly operations: string[]
}

export function mockWorkspace(initialFiles: Record<string, string> = {}): MockWorkspace {
  const files = new Map<string, string>()
  const dirs = new Set<string>(['.'])
  const mtimes = new Map<string, number>([['.', Date.now()]])
  const operations: string[] = []

  function touch(path: string): void {
    mtimes.set(path, Date.now())
  }

  function ensureParentExists(path: string): void {
    const parent = dirname(path)
    if (!dirs.has(parent)) {
      throw createFsError(ENOENT, `ENOENT: ${parent}`)
    }
  }

  for (const [path, contents] of Object.entries(initialFiles)) {
    const normalized = normalizePath(path)
    let current = dirname(normalized)
    const missing: string[] = []
    while (current !== '.' && !dirs.has(current)) {
      missing.push(current)
      current = dirname(current)
    }
    for (const dir of missing.reverse()) {
      dirs.add(dir)
      touch(dir)
    }
    files.set(normalized, contents)
    touch(normalized)
  }

  const workspace: MockWorkspace = {
    root: '/mock-workspace',
    files,
    dirs,
    operations,
    async readFile(relPath) {
      const path = normalizePath(relPath)
      if (dirs.has(path)) {
        throw createFsError(EISDIR, `EISDIR: ${path}`)
      }
      const data = files.get(path)
      if (data === undefined) {
        throw createFsError(ENOENT, `ENOENT: ${path}`)
      }
      operations.push(`readFile:${path}`)
      return data
    },
    async writeFile(relPath, data) {
      const path = normalizePath(relPath)
      if (dirs.has(path)) {
        throw createFsError(EISDIR, `EISDIR: ${path}`)
      }
      ensureParentExists(path)
      files.set(path, data)
      touch(path)
      operations.push(`writeFile:${path}`)
    },
    async unlink(relPath) {
      const path = normalizePath(relPath)
      if (files.delete(path)) {
        operations.push(`unlink:file:${path}`)
        return
      }
      if (!dirs.has(path)) {
        throw createFsError(ENOENT, `ENOENT: ${path}`)
      }
      if (path === '.') {
        throw createFsError(EPERM, 'EPERM: cannot remove workspace root')
      }
      const hasChildren = [...dirs].some((entry) => entry !== path && entry.startsWith(`${path}/`))
        || [...files.keys()].some((entry) => entry.startsWith(`${path}/`))
      if (hasChildren) {
        throw createFsError(ENOTEMPTY, `ENOTEMPTY: ${path}`)
      }
      dirs.delete(path)
      operations.push(`unlink:dir:${path}`)
    },
    async readdir(relPath) {
      const path = normalizePath(relPath)
      if (files.has(path)) {
        throw createFsError(ENOTDIR, `ENOTDIR: ${path}`)
      }
      if (!dirs.has(path)) {
        throw createFsError(ENOENT, `ENOENT: ${path}`)
      }

      const entries = new Map<string, Entry['kind']>()

      for (const dir of dirs) {
        if (dir !== '.' && dirname(dir) === path) {
          entries.set(basename(dir), 'dir')
        }
      }
      for (const filePath of files.keys()) {
        if (dirname(filePath) === path) {
          entries.set(basename(filePath), 'file')
        }
      }

      return [...entries.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, kind]) => ({ name, kind }))
    },
    async stat(relPath) {
      const path = normalizePath(relPath)
      if (dirs.has(path)) {
        return {
          size: 0,
          mtimeMs: mtimes.get(path) ?? Date.now(),
          kind: 'dir',
        } satisfies Stat
      }
      const file = files.get(path)
      if (file !== undefined) {
        return {
          size: Buffer.byteLength(file, 'utf8'),
          mtimeMs: mtimes.get(path) ?? Date.now(),
          kind: 'file',
        } satisfies Stat
      }
      throw createFsError(ENOENT, `ENOENT: ${path}`)
    },
    async mkdir(relPath, opts) {
      const path = normalizePath(relPath)
      if (files.has(path)) {
        throw createFsError(EEXIST, `EEXIST: ${path}`)
      }
      if (dirs.has(path)) {
        if (opts?.recursive) return
        throw createFsError(EEXIST, `EEXIST: ${path}`)
      }

      if (opts?.recursive) {
        const parts = path.split('/')
        let current = '.'
        for (const part of parts) {
          current = current === '.' ? part : `${current}/${part}`
          if (files.has(current)) {
            throw createFsError(EEXIST, `EEXIST: ${current}`)
          }
          dirs.add(current)
          touch(current)
        }
      } else {
        ensureParentExists(path)
        dirs.add(path)
        touch(path)
      }
      operations.push(`mkdir:${path}`)
    },
    async rename(fromRelPath, toRelPath) {
      const fromPath = normalizePath(fromRelPath)
      const toPath = normalizePath(toRelPath)
      if (fromPath === toPath) return
      ensureParentExists(toPath)

      const file = files.get(fromPath)
      if (file !== undefined) {
        if (dirs.has(toPath)) {
          throw createFsError(EISDIR, `EISDIR: ${toPath}`)
        }
        files.delete(fromPath)
        files.set(toPath, file)
        touch(toPath)
        operations.push(`rename:file:${fromPath}->${toPath}`)
        return
      }

      if (!dirs.has(fromPath)) {
        throw createFsError(ENOENT, `ENOENT: ${fromPath}`)
      }
      if (toPath.startsWith(`${fromPath}/`)) {
        throw createFsError(EPERM, `EPERM: ${fromPath} -> ${toPath}`)
      }
      if (fromPath === '.') {
        throw createFsError(EPERM, 'EPERM: cannot rename workspace root')
      }
      if (dirs.has(toPath) || files.has(toPath)) {
        throw createFsError(EEXIST, `EEXIST: ${toPath}`)
      }

      const movedDirs = [...dirs].filter((path) => path === fromPath || path.startsWith(`${fromPath}/`))
      const movedFiles = [...files.entries()].filter(([path]) => path.startsWith(`${fromPath}/`))
      for (const path of movedDirs) {
        dirs.delete(path)
      }
      for (const [path] of movedFiles) {
        files.delete(path)
      }
      for (const path of movedDirs) {
        const suffix = path.slice(fromPath.length)
        const nextPath = `${toPath}${suffix}`
        dirs.add(nextPath)
        touch(nextPath)
      }
      for (const [path, content] of movedFiles) {
        const suffix = path.slice(fromPath.length)
        files.set(`${toPath}${suffix}`, content)
      }
      operations.push(`rename:dir:${fromPath}->${toPath}`)
    },
  }

  return workspace
}
