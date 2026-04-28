import { constants } from 'node:fs'
import { access, lstat, mkdir, readFile, readdir, readlink, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import type {
  EditOperations,
  LsOperations,
  ReadOperations,
  WriteOperations,
} from '@mariozechner/pi-coding-agent'

export interface BoundFs {
  read: ReadOperations
  write: WriteOperations
  edit: EditOperations
  ls: LsOperations
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

  return { read, write, edit, ls }
}
