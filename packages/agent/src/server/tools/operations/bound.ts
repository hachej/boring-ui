import { constants } from 'node:fs'
import { access, lstat, mkdir, readFile, readdir, readlink, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

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

export function boundFs(workspaceRoot: string): BoundFs {
  const read: ReadOperations = {
    async readFile(absolutePath: string): Promise<Buffer> {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      return await readFile(absolutePath)
    },
    async access(absolutePath: string): Promise<void> {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      await access(absolutePath, constants.R_OK)
    },
  }

  const write: WriteOperations = {
    async writeFile(absolutePath: string, content: string): Promise<void> {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      await mkdir(dirname(absolutePath), { recursive: true })
      await writeFile(absolutePath, content)
    },
    async mkdir(dir: string): Promise<void> {
      await assertWithinWorkspace(workspaceRoot, dir)
      await mkdir(dir, { recursive: true })
    },
  }

  const edit: EditOperations = {
    async readFile(absolutePath: string): Promise<Buffer> {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      return await readFile(absolutePath)
    },
    async writeFile(absolutePath: string, content: string): Promise<void> {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      await writeFile(absolutePath, content)
    },
    async access(absolutePath: string): Promise<void> {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      await access(absolutePath, constants.R_OK | constants.W_OK)
    },
  }

  const find: FindOperations = {
    async exists(absolutePath: string): Promise<boolean> {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      try {
        await stat(absolutePath)
        return true
      } catch (err: unknown) {
        if ((err as { code?: string }).code === 'ENOENT') return false
        throw err
      }
    },
    async glob(pattern: string, cwd: string, options: { ignore: string[]; limit: number }): Promise<string[]> {
      await assertWithinWorkspace(workspaceRoot, cwd)
      const matches: string[] = []
      await walkMatches(cwd, cwd, pattern, options.ignore, options.limit, matches)
      return matches
    },
  }

  const grep: GrepOperations = {
    async isDirectory(absolutePath: string): Promise<boolean> {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      return (await stat(absolutePath)).isDirectory()
    },
    async readFile(absolutePath: string): Promise<string> {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      return await readFile(absolutePath, 'utf8')
    },
  }

  const ls: LsOperations = {
    async exists(absolutePath: string): Promise<boolean> {
      try {
        await assertWithinWorkspace(workspaceRoot, absolutePath)
        await stat(absolutePath)
        return true
      } catch {
        return false
      }
    },
    async stat(absolutePath: string) {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      return await stat(absolutePath)
    },
    async readdir(absolutePath: string): Promise<string[]> {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      return await readdir(absolutePath)
    },
  }

  return { read, write, edit, find, grep, ls }
}
