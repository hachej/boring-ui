import { describe, it, expect, vi } from 'vitest'
import {
  createPiDefaultTools,
  createPiFilesystemTools,
  createPiNativeTools,
  createPiNativeUiTools,
  mergePiTools,
} from './defaultTools'
import { PI_LIST_TABS_BRIDGE, PI_OPEN_FILE_BRIDGE } from './uiBridge'

const getTool = (tools, name) => tools.find((tool) => tool.name === name)

const getText = (result) => (
  result?.content?.find((item) => item?.type === 'text')?.text || ''
)

const createMemoryProvider = () => {
  const files = new Map()
  return {
    files: {
      list: vi.fn(async () => []),
      read: vi.fn(async (path) => (files.has(path) ? files.get(path) : '')),
      write: vi.fn(async (path, content) => {
        files.set(path, content)
      }),
      delete: vi.fn(async (path) => {
        files.delete(path)
      }),
      rename: vi.fn(async (oldPath, newName) => {
        const value = files.get(oldPath) || ''
        const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
        const newPath = parent ? `${parent}/${newName}` : newName
        files.delete(oldPath)
        files.set(newPath, value)
      }),
      move: vi.fn(async (srcPath, destDir) => {
        const value = files.get(srcPath) || ''
        const name = srcPath.split('/').pop()
        const next = destDir === '.' ? name : `${destDir}/${name}`
        files.delete(srcPath)
        files.set(next, value)
      }),
      search: vi.fn(async () => []),
    },
    git: {
      status: vi.fn(async () => ({ available: true, files: [] })),
      diff: vi.fn(async () => ''),
      show: vi.fn(async () => ''),
    },
  }
}

describe('createPiDefaultTools', () => {
  it('preserves markdown content on write/read roundtrip', async () => {
    const provider = createMemoryProvider()
    const queryClient = { invalidateQueries: vi.fn(async () => undefined) }
    const tools = createPiDefaultTools(provider, queryClient)

    const writeFile = getTool(tools, 'write_file')
    const readFile = getTool(tools, 'read_file')
    const markdown = '# Title\r\n\r\n- first\r\n- second\r\n'

    await writeFile.execute('1', { path: 'notes.md', content: markdown })
    const result = await readFile.execute('2', { path: 'notes.md' })

    expect(getText(result)).toBe(markdown)
    expect(provider.files.write).toHaveBeenCalledWith('notes.md', markdown)
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
  })

  it('delegates file rename with normalized params', async () => {
    const provider = createMemoryProvider()
    const queryClient = { invalidateQueries: vi.fn(async () => undefined) }
    const tools = createPiDefaultTools(provider, queryClient)
    const renameFile = getTool(tools, 'rename_file')

    await renameFile.execute('1', {
      old_path: '/docs/old.md',
      new_name: 'new.md',
    })

    expect(provider.files.rename).toHaveBeenCalledWith('docs/old.md', 'new.md')
  })

  it('adds python_exec when backend exposes runPython', async () => {
    const provider = createMemoryProvider()
    provider.runPython = vi.fn(async () => ({ stdout: 'ok', stderr: '' }))
    const queryClient = { invalidateQueries: vi.fn(async () => undefined) }
    const tools = createPiDefaultTools(provider, queryClient)
    const runPython = getTool(tools, 'python_exec')

    expect(runPython).toBeTruthy()
    const result = await runPython.execute('1', { code: 'print("ok")' })

    expect(provider.runPython).toHaveBeenCalledWith('print("ok")')
    expect(getText(result)).toBe('ok')
    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2)
  })

  it('returns UI tools when provider has no files interface', () => {
    const tools = createPiDefaultTools({}, { invalidateQueries: vi.fn() })
    const names = tools.map((tool) => tool.name).sort()
    expect(names).toEqual(['list_tabs', 'open_file'])
  })

  it('open_file uses UI bridge and normalizes leading slash', async () => {
    const provider = createMemoryProvider()
    const queryClient = { invalidateQueries: vi.fn(async () => undefined) }
    const tools = createPiDefaultTools(provider, queryClient)
    const openFile = getTool(tools, 'open_file')
    const openSpy = vi.fn(() => true)
    window[PI_OPEN_FILE_BRIDGE] = openSpy

    const result = await openFile.execute('1', { path: '/docs/guide.md' })

    expect(openSpy).toHaveBeenCalledWith('docs/guide.md')
    expect(getText(result)).toBe('Opening docs/guide.md in editor')

    delete window[PI_OPEN_FILE_BRIDGE]
  })

  it('list_tabs uses UI bridge and marks active file', async () => {
    const provider = createMemoryProvider()
    const queryClient = { invalidateQueries: vi.fn(async () => undefined) }
    const tools = createPiDefaultTools(provider, queryClient)
    const listTabs = getTool(tools, 'list_tabs')
    window[PI_LIST_TABS_BRIDGE] = vi.fn(() => ({
      activeFile: 'docs/guide.md',
      tabs: ['docs/guide.md', 'README.md'],
    }))

    const result = await listTabs.execute('1', {})
    const text = getText(result)

    expect(text).toContain('* docs/guide.md')
    expect(text).toContain('  README.md')
    expect(result.details.active_file).toBe('docs/guide.md')
    expect(result.details.tabs).toEqual([
      { path: 'docs/guide.md', active: true },
      { path: 'README.md', active: false },
    ])

    delete window[PI_LIST_TABS_BRIDGE]
  })

  it('keeps UI tools even when filesystem provider is missing', () => {
    const tools = createPiDefaultTools({}, { invalidateQueries: vi.fn() })
    const names = tools.map((tool) => tool.name)
    expect(names).toContain('open_file')
    expect(names).toContain('list_tabs')
  })
})

describe('mergePiTools', () => {
  it('prefers configured tools when names overlap', () => {
    const merged = mergePiTools(
      [{ name: 'read_file', marker: 'default' }, { name: 'write_file', marker: 'default' }],
      [{ name: 'write_file', marker: 'configured' }, { name: 'custom_tool', marker: 'configured' }],
    )

    expect(merged).toHaveLength(3)
    expect(merged.find((tool) => tool.name === 'write_file')?.marker).toBe('configured')
    expect(merged.find((tool) => tool.name === 'custom_tool')?.marker).toBe('configured')
  })
})

describe('tool split helpers', () => {
  it('exposes UI-only tools via createPiNativeUiTools', () => {
    const tools = createPiNativeUiTools()
    const names = tools.map((tool) => tool.name).sort()
    expect(names).toEqual(['list_tabs', 'open_file'])
  })

  it('returns only backend tools in createPiFilesystemTools', () => {
    const provider = createMemoryProvider()
    const tools = createPiFilesystemTools(provider, { invalidateQueries: vi.fn(async () => undefined) })
    const names = tools.map((tool) => tool.name)
    expect(names).not.toContain('open_file')
    expect(names).not.toContain('list_tabs')
    expect(names).toContain('read_file')
  })

  it('compose helper matches default helper', () => {
    const provider = createMemoryProvider()
    const queryClient = { invalidateQueries: vi.fn(async () => undefined) }
    const viaDefault = createPiDefaultTools(provider, queryClient).map((tool) => tool.name)
    const viaNative = createPiNativeTools(provider, queryClient).map((tool) => tool.name)
    expect(viaNative).toEqual(viaDefault)
  })
})
