import { constants } from 'node:fs'
import { access, lstat, mkdir, readFile, readdir, readlink, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type { RuntimeFilesystemBinding } from '../../runtime/types'
import type {
  EditOperations,
  FindOperations,
  GrepOperations,
  LsOperations,
  ReadOperations,
  WriteOperations,
} from '@mariozechner/pi-coding-agent'

export interface BoundFs {
  read: ReadOperations
  write: WriteOperations
  edit: EditOperations
  find: FindOperations
  grep: GrepOperations
  ls: LsOperations
}

export interface BoundFsOptions {
  /** Agent-visible root that pi tools may pass back as absolute paths. */
  runtimeRoot?: string
  /** Optional primary binding used only for mutation authorization/execution. */
  primaryBinding?: RuntimeFilesystemBinding
}

function toPosixPath(value: string): string {
  return value.split('\\').join('/')
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globToRegex(pattern: string): RegExp {
  const normalized = toPosixPath(pattern)
  let source = '^'

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i]
    const next = normalized[i + 1]

    if (char === '*') {
      if (next === '*') {
        const after = normalized[i + 2]
        if (after === '/') {
          source += '(?:.*/)?'
          i += 2
        } else {
          source += '.*'
          i += 1
        }
      } else {
        source += '[^/]*'
      }
      continue
    }

    if (char === '?') {
      source += '[^/]'
      continue
    }

    source += escapeRegex(char)
  }

  source += '$'
  return new RegExp(source)
}

function matchesGlob(relativePath: string, pattern: string): boolean {
  const normalizedRel = toPosixPath(relativePath)
  const normalizedPattern = toPosixPath(pattern)
  const target = normalizedPattern.includes('/')
    ? normalizedRel
    : normalizedRel.split('/').at(-1) ?? normalizedRel

  return globToRegex(normalizedPattern).test(target)
}

function shouldSkipDir(relativePath: string, ignore: string[]): boolean {
  const normalizedRel = toPosixPath(relativePath)
  const basename = normalizedRel.split('/').at(-1) ?? normalizedRel
  if (basename === '.git' || basename === 'node_modules') return true

  return ignore.some((pattern) => {
    return (
      matchesGlob(normalizedRel, pattern) ||
      matchesGlob(`${normalizedRel}/`, pattern)
    )
  })
}

async function walkMatches(
  root: string,
  current: string,
  pattern: string,
  ignore: string[],
  limit: number,
  out: string[],
): Promise<void> {
  if (out.length >= limit) return

  const entries = await readdir(current, { withFileTypes: true })
  for (const entry of entries) {
    if (out.length >= limit) return

    const absolutePath = resolve(current, entry.name)
    const relativePath = toPosixPath(relative(root, absolutePath))

    if (entry.isDirectory() && shouldSkipDir(relativePath, ignore)) continue

    if (matchesGlob(relativePath, pattern)) {
      out.push(absolutePath)
    }

    if (entry.isDirectory()) {
      await walkMatches(root, absolutePath, pattern, ignore, limit, out)
    }
  }
}

async function findNearestExistingAncestor(absPath: string): Promise<string> {
  let current = absPath
  for (;;) {
    try {
      await stat(current)
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return current
      current = parent
    }
  }
}

async function assertWithinWorkspace(workspaceRoot: string, absPath: string): Promise<void> {
  const realRoot = await realpath(resolve(workspaceRoot))

  try {
    const s = await lstat(absPath)
    if (s.isSymbolicLink()) {
      const target = await readlink(absPath)
      const resolvedTarget = resolve(dirname(absPath), target)
      const nearestAncestor = await findNearestExistingAncestor(resolvedTarget)
      const realAncestor = await realpath(nearestAncestor)
      const rel = relative(realRoot, realAncestor)
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`path "${absPath}" is outside workspace`)
      }
      return
    }
  } catch (err: unknown) {
    if ((err as { message?: string }).message?.includes('is outside workspace')) {
      throw err
    }
    const code = (err as { code?: string }).code
    if (code !== 'ENOENT') throw err
  }

  let realCandidate: string
  try {
    realCandidate = await realpath(absPath)
  } catch (err: unknown) {
    const code = (err as { code?: string }).code
    if (code === 'ENOENT') {
      const nearestAncestor = await findNearestExistingAncestor(dirname(absPath))
      const realAncestor = await realpath(nearestAncestor)
      const rel = relative(realRoot, realAncestor)
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`path "${absPath}" is outside workspace`)
      }
      return
    }
    throw err
  }
  const rel = relative(realRoot, realCandidate)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path "${absPath}" is outside workspace`)
  }
}

export function boundFs(workspaceRoot: string, opts: BoundFsOptions = {}): BoundFs {
  const runtimeRoot = opts.runtimeRoot ? opts.runtimeRoot.replace(/\/+$/, '') || '/' : undefined
  const shouldMapRuntimeRoot = Boolean(runtimeRoot && runtimeRoot !== workspaceRoot)

  const toStoragePath = (absolutePath: string): string => {
    if (!shouldMapRuntimeRoot || !runtimeRoot) return absolutePath
    const normalized = toPosixPath(absolutePath)
    if (normalized === runtimeRoot) return workspaceRoot
    if (normalized.startsWith(`${runtimeRoot}/`)) {
      return join(workspaceRoot, ...normalized.slice(runtimeRoot.length + 1).split('/'))
    }
    return absolutePath
  }

  const toRuntimePath = (absolutePath: string): string => {
    if (!shouldMapRuntimeRoot || !runtimeRoot) return absolutePath
    const rel = relative(workspaceRoot, absolutePath)
    if (rel === '') return runtimeRoot
    if (rel.startsWith('..') || isAbsolute(rel)) return absolutePath
    return `${runtimeRoot}/${toPosixPath(rel)}`
  }
  const binding = opts.primaryBinding

  async function bindingPath(absolutePath: string): Promise<string> {
    const normalized = toPosixPath(absolutePath)
    if (runtimeRoot && normalized === runtimeRoot) return '.'
    if (runtimeRoot && normalized.startsWith(`${runtimeRoot}/`)) return normalized.slice(runtimeRoot.length + 1)
    const storagePath = toStoragePath(absolutePath)
    const rel = toPosixPath(relative(workspaceRoot, storagePath))
    return rel || '.'
  }

  async function requireCapability(path: string, capability: 'write' | 'create-child'): Promise<void> {
    if (!binding) return
    const decision = await binding.operations.resolveAccess?.({ filesystem: binding.filesystem, path })
    const allowed = decision
      ? decision.capabilities[capability] === true
      : binding.access === 'readwrite'
    if (!allowed) binding.operations.rejectMutation(capability, { filesystem: binding.filesystem, path })
  }

  async function ensureBindingDirectory(absolutePath: string): Promise<void> {
    if (!binding) return
    const path = await bindingPath(absolutePath)
    try {
      const statResult = await binding.operations.stat({ filesystem: binding.filesystem, path })
      if (statResult.isDirectory) return
      throw Object.assign(new Error('path already exists and is not a directory'), { code: 'EEXIST' })
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
    }
    await requireCapability(path, 'create-child')
    if (!binding.operations.mkdir) binding.operations.rejectMutation('create-child', { filesystem: binding.filesystem, path })
    await binding.operations.mkdir?.({ filesystem: binding.filesystem, path, recursive: true })
  }

  const read: ReadOperations = {
    async readFile(absolutePath: string): Promise<Buffer> {
      const storagePath = toStoragePath(absolutePath)
      await assertWithinWorkspace(workspaceRoot, storagePath)
      return await readFile(storagePath)
    },
    async access(absolutePath: string): Promise<void> {
      const storagePath = toStoragePath(absolutePath)
      await assertWithinWorkspace(workspaceRoot, storagePath)
      await access(storagePath, constants.R_OK)
    },
  }

  const write: WriteOperations = {
    async writeFile(absolutePath: string, content: string): Promise<void> {
      const storagePath = toStoragePath(absolutePath)
      await assertWithinWorkspace(workspaceRoot, storagePath)
      if (binding) {
        const path = await bindingPath(absolutePath)
        await requireCapability(path, 'write')
        if (!binding.operations.write) binding.operations.rejectMutation('write', { filesystem: binding.filesystem, path })
        await binding.operations.write?.({ filesystem: binding.filesystem, path, content })
        return
      }
      await mkdir(dirname(storagePath), { recursive: true })
      await writeFile(storagePath, content)
    },
    async mkdir(dir: string): Promise<void> {
      const storagePath = toStoragePath(dir)
      await assertWithinWorkspace(workspaceRoot, storagePath)
      if (binding) {
        await ensureBindingDirectory(dir)
        return
      }
      await mkdir(storagePath, { recursive: true })
    },
  }

  const edit: EditOperations = {
    async readFile(absolutePath: string): Promise<Buffer> {
      const storagePath = toStoragePath(absolutePath)
      await assertWithinWorkspace(workspaceRoot, storagePath)
      return await readFile(storagePath)
    },
    async writeFile(absolutePath: string, content: string): Promise<void> {
      const storagePath = toStoragePath(absolutePath)
      await assertWithinWorkspace(workspaceRoot, storagePath)
      if (binding) {
        const path = await bindingPath(absolutePath)
        await requireCapability(path, 'write')
        if (!binding.operations.write) binding.operations.rejectMutation('write', { filesystem: binding.filesystem, path })
        await binding.operations.write?.({ filesystem: binding.filesystem, path, content })
        return
      }
      await writeFile(storagePath, content)
    },
    async access(absolutePath: string): Promise<void> {
      const storagePath = toStoragePath(absolutePath)
      await assertWithinWorkspace(workspaceRoot, storagePath)
      await access(storagePath, constants.R_OK | constants.W_OK)
    },
  }

  const find: FindOperations = {
    async exists(absolutePath: string): Promise<boolean> {
      const storagePath = toStoragePath(absolutePath)
      await assertWithinWorkspace(workspaceRoot, storagePath)
      try {
        await stat(storagePath)
        return true
      } catch (err: unknown) {
        if ((err as { code?: string }).code === 'ENOENT') return false
        throw err
      }
    },
    async glob(pattern: string, cwd: string, options: { ignore: string[]; limit: number }): Promise<string[]> {
      const storageCwd = toStoragePath(cwd)
      await assertWithinWorkspace(workspaceRoot, storageCwd)
      const matches: string[] = []
      await walkMatches(storageCwd, storageCwd, pattern, options.ignore, options.limit, matches)
      return matches.map(toRuntimePath)
    },
  }

  const grep: GrepOperations = {
    async isDirectory(absolutePath: string): Promise<boolean> {
      const storagePath = toStoragePath(absolutePath)
      await assertWithinWorkspace(workspaceRoot, storagePath)
      return (await stat(storagePath)).isDirectory()
    },
    async readFile(absolutePath: string): Promise<string> {
      const storagePath = toStoragePath(absolutePath)
      await assertWithinWorkspace(workspaceRoot, storagePath)
      return await readFile(storagePath, 'utf8')
    },
  }

  const ls: LsOperations = {
    async exists(absolutePath: string): Promise<boolean> {
      const storagePath = toStoragePath(absolutePath)
      try {
        await assertWithinWorkspace(workspaceRoot, storagePath)
        await stat(storagePath)
        return true
      } catch {
        return false
      }
    },
    async stat(absolutePath: string) {
      const storagePath = toStoragePath(absolutePath)
      await assertWithinWorkspace(workspaceRoot, storagePath)
      return await stat(storagePath)
    },
    async readdir(absolutePath: string): Promise<string[]> {
      const storagePath = toStoragePath(absolutePath)
      await assertWithinWorkspace(workspaceRoot, storagePath)
      return await readdir(storagePath)
    },
  }

  return { read, write, edit, find, grep, ls }
}
