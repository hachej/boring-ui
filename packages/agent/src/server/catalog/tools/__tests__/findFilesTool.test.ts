import { describe, expect, test, vi } from 'vitest'

import type { FileSearch } from '../../../../shared/file-search'
import { createFindFilesTool } from '../findFilesTool'

function runContext(aborted = false) {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return {
    toolCallId: 'tool-call-1',
    abortSignal: controller.signal,
  }
}

function createFileSearch(results: string[] = []): FileSearch {
  return {
    search: vi.fn().mockResolvedValue(results),
  }
}

describe('createFindFilesTool', () => {
  test('returns matching files and details', async () => {
    const fileSearch = createFileSearch(['src/index.ts', 'src/utils.ts'])
    const tool = createFindFilesTool(fileSearch)

    const result = await tool.execute({ glob: '*.ts', limit: 10 }, runContext())

    expect(result.isError).toBeFalsy()
    expect(result.content).toEqual([{ type: 'text', text: 'src/index.ts\nsrc/utils.ts' }])
    expect(result.details).toEqual({
      glob: '*.ts',
      limit: 10,
      count: 2,
      files: ['src/index.ts', 'src/utils.ts'],
    })
    expect(fileSearch.search).toHaveBeenCalledWith('*.ts', 10)
  })

  test('uses default limit when omitted', async () => {
    const fileSearch = createFileSearch([])
    const tool = createFindFilesTool(fileSearch)

    await tool.execute({ glob: '*.md' }, runContext())

    expect(fileSearch.search).toHaveBeenCalledWith('*.md', 200)
  })

  test('clamps limit to 5000', async () => {
    const fileSearch = createFileSearch([])
    const tool = createFindFilesTool(fileSearch)

    await tool.execute({ glob: '*', limit: 999999 }, runContext())

    expect(fileSearch.search).toHaveBeenCalledWith('*', 5000)
  })

  test('returns no files found message when empty result', async () => {
    const fileSearch = createFileSearch([])
    const tool = createFindFilesTool(fileSearch)

    const result = await tool.execute({ glob: '*.none' }, runContext())

    expect(result.isError).toBeFalsy()
    expect(result.content[0]?.text).toBe('no files found')
  })

  test('validates required glob', async () => {
    const fileSearch = createFileSearch([])
    const tool = createFindFilesTool(fileSearch)

    const result = await tool.execute({}, runContext())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('glob is required')
    expect(fileSearch.search).not.toHaveBeenCalled()
  })

  test('rejects null bytes in glob', async () => {
    const fileSearch = createFileSearch([])
    const tool = createFindFilesTool(fileSearch)

    const result = await tool.execute({ glob: 'foo\0bar' }, runContext())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('null bytes')
    expect(fileSearch.search).not.toHaveBeenCalled()
  })

  test('rejects invalid non-numeric limit', async () => {
    const fileSearch = createFileSearch([])
    const tool = createFindFilesTool(fileSearch)

    const result = await tool.execute({ glob: '*.ts', limit: '10' }, runContext())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('limit must be a number')
    expect(fileSearch.search).not.toHaveBeenCalled()
  })

  test('aborts before file search when signal is already aborted', async () => {
    const fileSearch = createFileSearch([])
    const tool = createFindFilesTool(fileSearch)

    const result = await tool.execute({ glob: '*.ts' }, runContext(true))

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('find_files aborted')
    expect(fileSearch.search).not.toHaveBeenCalled()
  })

  test('returns clear failure message when search throws', async () => {
    const fileSearch: FileSearch = {
      search: vi.fn().mockRejectedValue(new Error('timeout')),
    }
    const tool = createFindFilesTool(fileSearch)

    const result = await tool.execute({ glob: '*.ts' }, runContext())

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('find_files failed: timeout')
  })
})
