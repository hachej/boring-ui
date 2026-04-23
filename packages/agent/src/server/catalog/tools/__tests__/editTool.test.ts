import { describe, expect, test } from 'vitest'

import type { Workspace } from '../../../../shared/workspace'
import { createEditTool } from '../editTool'

interface MockWorkspace extends Workspace {
  files: Map<string, string>
  writes: string[]
}

function createWorkspace(initial: Record<string, string>): MockWorkspace {
  const files = new Map(Object.entries(initial))
  const workspace: MockWorkspace = {
    root: '/repo',
    files,
    writes: [],
    async readFile(relPath) {
      if (relPath.split('/').includes('..')) {
        throw new Error('Path traversal rejected')
      }
      const content = files.get(relPath)
      if (content === undefined) {
        const error = new Error(`ENOENT: ${relPath}`) as Error & { code: string }
        error.code = 'ENOENT'
        throw error
      }
      return content
    },
    async writeFile(relPath, data) {
      if (relPath.split('/').includes('..')) {
        throw new Error('Path traversal rejected')
      }
      if (!files.has(relPath)) {
        const error = new Error(`ENOENT: ${relPath}`) as Error & { code: string }
        error.code = 'ENOENT'
        throw error
      }
      files.set(relPath, data)
      workspace.writes.push(relPath)
    },
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

describe('createEditTool', () => {
  test('unique match replace succeeds', async () => {
    const workspace = createWorkspace({ 'src/app.ts': 'const value = "old";' })
    const tool = createEditTool(workspace)

    const result = await tool.execute(
      {
        path: 'src/app.ts',
        oldString: '"old"',
        newString: '"new"',
      },
      runContext(),
    )

    expect(result.isError).toBeFalsy()
    expect(result.details).toMatchObject({
      path: 'src/app.ts',
      replacements: 1,
      bytesWritten: 20,
      fileChanges: [
        {
          op: 'edit',
          path: 'src/app.ts',
          size: 20,
        },
      ],
    })
    expect(typeof (result.details as any).fileChanges[0].timestamp).toBe('string')
    expect(workspace.files.get('src/app.ts')).toBe('const value = "new";')
    expect(workspace.writes).toEqual(['src/app.ts'])
  })

  test('ambiguous match rejects without replaceAll', async () => {
    const workspace = createWorkspace({ 'src/app.ts': 'foo = x + x;' })
    const tool = createEditTool(workspace)

    const result = await tool.execute(
      {
        path: 'src/app.ts',
        oldString: 'x',
        newString: 'y',
      },
      runContext(),
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('ambiguous match')
    expect(workspace.files.get('src/app.ts')).toBe('foo = x + x;')
    expect(workspace.writes).toEqual([])
  })

  test('replaceAll succeeds when oldString appears multiple times', async () => {
    const workspace = createWorkspace({ 'src/app.ts': 'x + x + x' })
    const tool = createEditTool(workspace)

    const result = await tool.execute(
      {
        path: 'src/app.ts',
        oldString: 'x',
        newString: 'y',
        replaceAll: true,
      },
      runContext(),
    )

    expect(result.isError).toBeFalsy()
    expect(result.details).toMatchObject({
      path: 'src/app.ts',
      replacements: 3,
      bytesWritten: 9,
      fileChanges: [
        {
          op: 'edit',
          path: 'src/app.ts',
          size: 9,
        },
      ],
    })
    expect(typeof (result.details as any).fileChanges[0].timestamp).toBe('string')
    expect(workspace.files.get('src/app.ts')).toBe('y + y + y')
    expect(workspace.writes).toEqual(['src/app.ts'])
  })

  test('no-match rejects with a clear error', async () => {
    const workspace = createWorkspace({ 'src/app.ts': 'const v = 1;' })
    const tool = createEditTool(workspace)

    const result = await tool.execute(
      {
        path: 'src/app.ts',
        oldString: 'missing',
        newString: 'replacement',
      },
      runContext(),
    )

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('oldString not found')
    expect(workspace.writes).toEqual([])
  })
})
