import { describe, expect, test } from 'vitest'

import type { Workspace } from '../../../../shared/workspace'
import { createWriteTool } from '../writeTool'

function parentDir(path: string): string | null {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join('/')
}

interface MockWorkspace extends Workspace {
  files: Map<string, string>
  dirs: Set<string>
  operations: string[]
}

function enoent(path: string): Error & { code: 'ENOENT' } {
  const error = new Error(`ENOENT: ${path}`) as Error & { code: 'ENOENT' }
  error.code = 'ENOENT'
  return error
}

function createWorkspace(initial: Record<string, string> = {}): MockWorkspace {
  const files = new Map(Object.entries(initial))
  const dirs = new Set<string>(['.'])
  for (const filePath of files.keys()) {
    let current = parentDir(filePath)
    while (current) {
      dirs.add(current)
      current = parentDir(current)
    }
  }

  function assertSafe(relPath: string): void {
    if (relPath.split('/').includes('..')) {
      throw new Error('Path traversal rejected')
    }
  }

  const workspace: MockWorkspace = {
    root: '/repo',
    files,
    dirs,
    operations: [],
    async readFile(relPath) {
      assertSafe(relPath)
      const value = files.get(relPath)
      if (value === undefined) throw enoent(relPath)
      return value
    },
    async writeFile(relPath, data) {
      assertSafe(relPath)
      const parent = parentDir(relPath)
      if (parent && !dirs.has(parent)) throw enoent(parent)
      files.set(relPath, data)
      workspace.operations.push(`writeFile:${relPath}`)
    },
    async unlink(relPath) {
      assertSafe(relPath)
      workspace.operations.push(`unlink:${relPath}`)
      if (!files.delete(relPath)) throw enoent(relPath)
    },
    async readdir(relPath) {
      assertSafe(relPath)
      void relPath
      return []
    },
    async stat(relPath) {
      assertSafe(relPath)
      if (dirs.has(relPath)) {
        return { size: 0, mtimeMs: Date.now(), kind: 'dir' as const }
      }
      if (files.has(relPath)) {
        return { size: files.get(relPath)!.length, mtimeMs: Date.now(), kind: 'file' as const }
      }
      throw enoent(relPath)
    },
    async mkdir(relPath, opts) {
      assertSafe(relPath)
      if (!opts?.recursive) {
        const parent = parentDir(relPath)
        if (parent && !dirs.has(parent)) throw enoent(parent)
      } else {
        const parts = relPath.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current = current ? `${current}/${part}` : part
          dirs.add(current)
        }
      }
      dirs.add(relPath)
      workspace.operations.push(`mkdir:${relPath}`)
    },
    async rename(fromRelPath, toRelPath) {
      assertSafe(fromRelPath)
      assertSafe(toRelPath)
      const value = files.get(fromRelPath)
      if (value === undefined) throw enoent(fromRelPath)
      const parent = parentDir(toRelPath)
      if (parent && !dirs.has(parent)) throw enoent(parent)
      files.delete(fromRelPath)
      files.set(toRelPath, value)
      workspace.operations.push(`rename:${fromRelPath}->${toRelPath}`)
    },
  }

  return workspace
}

function runContext(aborted = false) {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return {
    toolCallId: 'tool-call-1',
    abortSignal: controller.signal,
  }
}

function getTmpPath(operations: string[]): string {
  const writeToTmp = operations.find((op) => op.startsWith('writeFile:') && op.includes('.tmp-'))
  if (!writeToTmp) {
    throw new Error('tmp write operation not found')
  }
  return writeToTmp.replace('writeFile:', '')
}

describe('createWriteTool', () => {
  test('creates a new file and reports bytes written', async () => {
    const workspace = createWorkspace()
    const tool = createWriteTool(workspace)

    const result = await tool.execute(
      { path: 'notes.txt', content: 'hello world' },
      runContext(),
    )

    expect(result.isError).toBeFalsy()
    expect(result.details).toEqual({
      path: 'notes.txt',
      bytesWritten: 11,
    })
    expect(workspace.files.get('notes.txt')).toBe('hello world')
  })

  test('overwrites existing file content', async () => {
    const workspace = createWorkspace({ 'src/a.txt': 'before' })
    const tool = createWriteTool(workspace)

    const result = await tool.execute(
      { path: 'src/a.txt', content: 'after' },
      runContext(),
    )

    expect(result.isError).toBeFalsy()
    expect(workspace.files.get('src/a.txt')).toBe('after')
  })

  test('createDirs=true creates missing parent directories', async () => {
    const workspace = createWorkspace()
    const tool = createWriteTool(workspace)

    const result = await tool.execute(
      {
        path: 'deep/nested/file.txt',
        content: 'payload',
        createDirs: true,
      },
      runContext(),
    )

    expect(result.isError).toBeFalsy()
    expect(workspace.dirs.has('deep')).toBe(true)
    expect(workspace.dirs.has('deep/nested')).toBe(true)
    expect(workspace.files.get('deep/nested/file.txt')).toBe('payload')
  })

  test('createDirs=false rejects when parent directory is missing', async () => {
    const workspace = createWorkspace()
    const tool = createWriteTool(workspace)

    const result = await tool.execute(
      {
        path: 'deep/nested/file.txt',
        content: 'payload',
        createDirs: false,
      },
      runContext(),
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('parent directory does not exist')
    expect(workspace.files.has('deep/nested/file.txt')).toBe(false)
  })

  test('path traversal is rejected at workspace layer', async () => {
    const workspace = createWorkspace()
    const tool = createWriteTool(workspace)

    const result = await tool.execute(
      { path: '../secrets.txt', content: 'x' },
      runContext(),
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Path traversal rejected')
  })

  test('writes atomically via tmp path + rename', async () => {
    const workspace = createWorkspace({ 'src/a.txt': 'before' })
    const tool = createWriteTool(workspace)

    const result = await tool.execute(
      { path: 'src/a.txt', content: 'after' },
      runContext(),
    )

    expect(result.isError).toBeFalsy()
    const tmpPath = getTmpPath(workspace.operations)
    const renameOp = workspace.operations.find((op) =>
      op.startsWith(`rename:${tmpPath}->src/a.txt`),
    )
    expect(renameOp).toBeDefined()
    expect(workspace.operations).not.toContain('writeFile:src/a.txt')
    expect(workspace.operations).not.toContain(`unlink:${tmpPath}`)
  })

  test('tmp file is cleaned up when rename fails', async () => {
    const workspace = createWorkspace({ 'src/a.txt': 'before' })
    workspace.rename = async (fromRelPath, toRelPath) => {
      workspace.operations.push(`rename:${fromRelPath}->${toRelPath}`)
      throw new Error('rename failed')
    }
    const tool = createWriteTool(workspace)

    const result = await tool.execute(
      { path: 'src/a.txt', content: 'after' },
      runContext(),
    )

    expect(result.isError).toBe(true)
    const tmpPath = getTmpPath(workspace.operations)
    expect(workspace.operations).toContain(`unlink:${tmpPath}`)
  })

  test('aborting after tmp write returns error and cleans tmp file', async () => {
    const workspace = createWorkspace()
    const controller = new AbortController()
    const originalWriteFile = workspace.writeFile.bind(workspace)
    workspace.writeFile = async (relPath, data) => {
      await originalWriteFile(relPath, data)
      controller.abort()
    }
    const tool = createWriteTool(workspace)

    const result = await tool.execute(
      { path: 'src/a.txt', content: 'payload', createDirs: true },
      {
        toolCallId: 'tool-call-1',
        abortSignal: controller.signal,
      },
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('write aborted')
    const tmpPath = getTmpPath(workspace.operations)
    expect(workspace.operations).toContain(`unlink:${tmpPath}`)
  })
})
