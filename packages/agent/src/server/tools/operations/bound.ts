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

function toPosixPath(path: string): string {
  return path.split('\\').join('/')
}

function globToRegExp(pattern: string): RegExp {
  let source = '^'
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]
    const next = pattern[index + 1]
    const following = pattern[index + 2]

    if (char === '*' && next === '*' && following === '/') {
      source += '(?:.*/)?'
      index += 2
      continue
    }
    if (char === '*' && next === '*') {
      source += '.*'
      index += 1
      continue
    }
    if (char === '*') {
      source += '[^/]*'
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    if ('\\^$+?.()|{}[]'.includes(char)) {
      source += `\\${char}`
      continue
    }
    source += char
  }
  source += '$'
  return new RegExp(source)
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

  const find: FindOperations = {
    async exists(absolutePath: string): Promise<boolean> {
      try {
        await assertWithinWorkspace(workspaceRoot, absolutePath)
        await stat(absolutePath)
        return true
      } catch {
        return false
      }
    },
    async glob(pattern: string, cwd: string, options: { ignore: string[]; limit: number }): Promise<string[]> {
      await assertWithinWorkspace(workspaceRoot, cwd)
      const rootStat = await stat(cwd)
      const matcher = globToRegExp(toPosixPath(pattern))
      const matchFullPath = pattern.includes('/')
      const ignoreMatchers = options.ignore.map((ignore) => globToRegExp(toPosixPath(ignore)))
      const results: string[] = []

      const shouldIgnore = (relativePath: string): boolean => {
        const posix = toPosixPath(relativePath)
        return ignoreMatchers.some((matcher) => matcher.test(posix) || matcher.test(`${posix}/`))
      }

      const matches = (relativePath: string): boolean => {
        const posix = toPosixPath(relativePath)
        const candidate = matchFullPath ? posix : posix.split('/').at(-1) ?? posix
        return matcher.test(candidate)
      }

      const visit = async (dir: string): Promise<void> => {
        if (results.length >= options.limit) return

        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (entry.name === '.git' || entry.name === 'node_modules') continue

          const absolutePath = resolve(dir, entry.name)
          await assertWithinWorkspace(workspaceRoot, absolutePath)
          const relativePath = relative(cwd, absolutePath)
          if (shouldIgnore(relativePath)) continue

          if (matches(relativePath)) {
            results.push(absolutePath)
            if (results.length >= options.limit) return
          }

          if (entry.isDirectory()) {
            await visit(absolutePath)
          }
        }
      }

      if (!rootStat.isDirectory()) {
        return matches(cwd) ? [cwd] : []
      }

      await visit(cwd)
      return results
    },
  }

  const grep: GrepOperations = {
    async isDirectory(absolutePath: string): Promise<boolean> {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      return (await stat(absolutePath)).isDirectory()
    },
    async readFile(absolutePath: string): Promise<string> {
      await assertWithinWorkspace(workspaceRoot, absolutePath)
      return await readFile(absolutePath, 'utf-8')
    },
  }

  return { read, write, edit, find, grep, ls }
}
