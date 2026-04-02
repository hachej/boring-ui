/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createJustBashDataProvider } from './justBashDataProvider'

const WORKSPACE_ROOT = '/home/user'

const makeFsState = () => ({
  directories: new Set([WORKSPACE_ROOT]),
  files: new Map(),
})

const listDirNames = (state, dirPath) => {
  const prefix = dirPath === WORKSPACE_ROOT ? `${WORKSPACE_ROOT}/` : `${dirPath}/`
  const names = new Set()

  for (const directory of state.directories) {
    if (!directory.startsWith(prefix) || directory === dirPath) continue
    const remainder = directory.slice(prefix.length)
    if (remainder && !remainder.includes('/')) names.add(remainder)
  }

  for (const filePath of state.files.keys()) {
    if (!filePath.startsWith(prefix)) continue
    const remainder = filePath.slice(prefix.length)
    if (remainder && !remainder.includes('/')) names.add(remainder)
  }

  return [...names]
}

const createFsApi = (state) => ({
  exists: vi.fn(async (path) => state.directories.has(path) || state.files.has(path)),

  mkdir: vi.fn(async (path, options = {}) => {
    const parts = String(path || '').split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current += `/${part}`
      if (options?.recursive || current === path) state.directories.add(current)
    }
  }),

  readdir: vi.fn(async (path) => {
    if (!state.directories.has(path)) throw new Error(`ENOENT: ${path}`)
    return listDirNames(state, path)
  }),

  stat: vi.fn(async (path) => {
    if (state.directories.has(path)) {
      return { isDirectory: true, isFile: false, size: 0, mtime: new Date('2026-03-26T00:00:00Z') }
    }
    if (state.files.has(path)) {
      const content = state.files.get(path)
      return { isDirectory: false, isFile: true, size: content.length, mtime: new Date('2026-03-26T00:00:00Z') }
    }
    throw new Error(`ENOENT: ${path}`)
  }),

  writeFile: vi.fn(async (path, content) => {
    state.files.set(path, String(content))
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : WORKSPACE_ROOT
    state.directories.add(parent || WORKSPACE_ROOT)
  }),

  rm: vi.fn(async (path) => {
    for (const filePath of [...state.files.keys()]) {
      if (filePath === path || filePath.startsWith(`${path}/`)) {
        state.files.delete(filePath)
      }
    }
    for (const dirPath of [...state.directories]) {
      if (dirPath === path || dirPath.startsWith(`${path}/`)) {
        state.directories.delete(dirPath)
      }
    }
    state.directories.add(WORKSPACE_ROOT)
  }),

  mv: vi.fn(async (source, destination) => {
    if (state.files.has(source)) {
      const content = state.files.get(source)
      state.files.delete(source)
      state.files.set(destination, content)
      const parent = destination.includes('/') ? destination.slice(0, destination.lastIndexOf('/')) : WORKSPACE_ROOT
      state.directories.add(parent || WORKSPACE_ROOT)
      return
    }
    if (state.directories.has(source)) {
      state.directories.add(destination)
      for (const dirPath of [...state.directories]) {
        if (dirPath.startsWith(`${source}/`)) {
          state.directories.add(dirPath.replace(source, destination))
        }
      }
      for (const filePath of [...state.files.keys()]) {
        if (filePath.startsWith(`${source}/`)) {
          const content = state.files.get(filePath)
          state.files.delete(filePath)
          state.files.set(filePath.replace(source, destination), content)
        }
      }
      state.directories.delete(source)
      return
    }
    throw new Error(`ENOENT: ${source}`)
  }),
})

const encodeText = (text) => [...new TextEncoder().encode(text)]

let bashExecMock
let fsState

vi.mock('just-bash/browser', () => {
  class Bash {
    constructor() {
      this.fs = createFsApi(fsState)
    }

    async writeFile(path, content) {
      return this.fs.writeFile(path, content)
    }

    async readFile(path) {
      const content = fsState.files.get(path)
      if (content === undefined) throw new Error('missing file')
      return encodeText(content)
    }

    async exec(command, options = {}) {
      return bashExecMock(command, options, fsState)
    }
  }

  return { Bash }
})

describe('createJustBashDataProvider', () => {
  beforeEach(() => {
    fsState = makeFsState()
    bashExecMock = vi.fn(async (_command, options) => {
      return {
        stdout: encodeText('ok\n'),
        stderr: '',
        exitCode: 0,
        env: { PWD: options.cwd || WORKSPACE_ROOT },
      }
    })
  })

  it('maps file operations onto the in-memory just-bash filesystem', async () => {
    const provider = createJustBashDataProvider()

    await provider.files.write('docs/notes.txt', 'alpha\nbeta\n')

    expect(await provider.files.read('docs/notes.txt')).toBe('alpha\nbeta\n')
    expect(await provider.files.list('docs')).toEqual([
      expect.objectContaining({ name: 'notes.txt', path: 'docs/notes.txt', is_dir: false }),
    ])

    await provider.files.rename('docs/notes.txt', 'renamed.txt')
    expect(await provider.files.read('docs/renamed.txt')).toBe('alpha\nbeta\n')

    await provider.files.move('docs/renamed.txt', 'archive')
    expect(await provider.files.read('archive/renamed.txt')).toBe('alpha\nbeta\n')

    const results = await provider.files.search('beta')
    expect(results).toEqual([
      expect.objectContaining({
        path: 'archive/renamed.txt',
        line: 'alpha\nbeta\n'.split('\n')[1],
        line_number: 2,
      }),
    ])

    await provider.files.delete('archive')
    await expect(provider.files.read('archive/renamed.txt')).rejects.toThrow(/missing file/i)
    await expect(provider.files.search('beta')).resolves.toEqual([])
    await expect(provider.files.list('.')).resolves.toEqual([
      expect.objectContaining({ name: 'docs', path: 'docs', is_dir: true }),
    ])
  })

  it('normalizes runCommand output from byte arrays', async () => {
    const provider = createJustBashDataProvider()

    const result = await provider.runCommand('echo ok', { cwd: 'docs' })

    expect(bashExecMock).toHaveBeenCalledWith('echo ok', { cwd: '/home/user/docs', signal: undefined }, fsState)
    expect(result.stdout).toBe('ok\n')
    expect(result.stderr).toBe('')
    expect(result.exitCode).toBe(0)
  })

  it('returns clear backend-specific errors for unsupported shell commands', async () => {
    const provider = createJustBashDataProvider()

    await expect(provider.runCommand('git status')).resolves.toEqual({
      stdout: '',
      stderr: 'Git is unavailable for the justbash backend.\n',
      exitCode: 127,
    })
    await expect(provider.runCommand('npm install')).resolves.toEqual({
      stdout: '',
      stderr: 'Package installation is unavailable for the justbash backend.\n',
      exitCode: 127,
    })
    await expect(provider.runCommand('python -m pip install requests')).resolves.toEqual({
      stdout: '',
      stderr: 'Package installation is unavailable for the justbash backend.\n',
      exitCode: 127,
    })
    expect(bashExecMock).not.toHaveBeenCalled()
  })

  it('reports git as unavailable and rejects git mutations', async () => {
    const provider = createJustBashDataProvider()

    await expect(provider.git.status()).resolves.toEqual({
      available: false,
      is_repo: false,
      files: [],
    })
    await expect(provider.git.commit('test')).rejects.toThrow('Git is unavailable for the justbash backend.')
    await expect(provider.git.branches()).resolves.toEqual({ branches: [], current: null })
  })
})
