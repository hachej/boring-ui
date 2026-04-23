import { describe, expect, test } from 'vitest'

import { createReadTool } from '../readTool'
import type { Workspace } from '../../../../shared/workspace'

function createWorkspace(files: Record<string, string>): Workspace {
  return {
    root: '/repo',
    async readFile(relPath: string) {
      if (relPath.includes('..')) {
        throw new Error('Path traversal rejected')
      }
      const value = files[relPath]
      if (value === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${relPath}'`)
      }
      return value
    },
    async writeFile() {},
    async unlink() {},
    async readdir() {
      return []
    },
    async stat() {
      return { size: 0, mtimeMs: Date.now(), kind: 'file' as const }
    },
    async mkdir() {},
    async rename() {},
  }
}

function makeRunContext(aborted = false) {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return {
    abortSignal: controller.signal,
    toolCallId: 'tool-call-1',
  }
}

describe('createReadTool', () => {
  test('full read returns full content + line metadata', async () => {
    const workspace = createWorkspace({
      'src/app.ts': 'line1\nline2\nline3',
    })
    const tool = createReadTool(workspace)

    const result = await tool.execute({ path: 'src/app.ts' }, makeRunContext())
    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([{ type: 'text', text: 'line1\nline2\nline3' }])
    expect(result.details).toEqual({
      content: 'line1\nline2\nline3',
      totalLines: 3,
      linesReturned: 3,
    })
  })

  test('slice read uses 1-indexed lineOffset + lineCount', async () => {
    const workspace = createWorkspace({
      'src/app.ts': 'alpha\nbeta\ngamma\ndelta',
    })
    const tool = createReadTool(workspace)

    const result = await tool.execute(
      { path: 'src/app.ts', lineOffset: 2, lineCount: 2 },
      makeRunContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([{ type: 'text', text: 'beta\ngamma' }])
    expect(result.details).toEqual({
      content: 'beta\ngamma',
      totalLines: 4,
      linesReturned: 2,
    })
  })

  test('full read handles trailing newline without phantom line count', async () => {
    const workspace = createWorkspace({
      'src/app.ts': 'line1\nline2\n',
    })
    const tool = createReadTool(workspace)

    const result = await tool.execute({ path: 'src/app.ts' }, makeRunContext())
    expect(result.isError).toBeFalsy()
    expect(result.details).toEqual({
      content: 'line1\nline2',
      totalLines: 2,
      linesReturned: 2,
    })
  })

  test('lineOffset beyond EOF returns empty slice', async () => {
    const workspace = createWorkspace({
      'src/app.ts': 'line1\nline2',
    })
    const tool = createReadTool(workspace)

    const result = await tool.execute(
      { path: 'src/app.ts', lineOffset: 9, lineCount: 2 },
      makeRunContext(),
    )
    expect(result.isError).toBeFalsy()
    expect(result.details).toEqual({
      content: '',
      totalLines: 2,
      linesReturned: 0,
    })
  })

  test('invalid lineOffset returns a clear error', async () => {
    const workspace = createWorkspace({
      'src/app.ts': 'line1\nline2',
    })
    const tool = createReadTool(workspace)

    const result = await tool.execute(
      { path: 'src/app.ts', lineOffset: 0 },
      makeRunContext(),
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('lineOffset must be a positive integer')
  })

  test('missing file rejects with a clear error message', async () => {
    const workspace = createWorkspace({})
    const tool = createReadTool(workspace)

    const result = await tool.execute({ path: 'missing.txt' }, makeRunContext())
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('file not found')
  })

  test('workspace path-validation errors bubble through clearly', async () => {
    const workspace = createWorkspace({})
    const tool = createReadTool(workspace)

    const result = await tool.execute(
      { path: '../secrets.txt' },
      makeRunContext(),
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Path traversal rejected')
  })

  test('aborted signal short-circuits before workspace read', async () => {
    const workspace = createWorkspace({
      'src/app.ts': 'line1',
    })
    const tool = createReadTool(workspace)

    const result = await tool.execute(
      { path: 'src/app.ts' },
      makeRunContext(true),
    )
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('read aborted')
  })
})
