import { beforeEach, describe, expect, it, vi } from 'vitest'
import LightningFS from '@isomorphic-git/lightning-fs'
import { createLightningFsProvider } from './lightningFsProvider'
import { createIsomorphicGitProvider } from './isomorphicGitProvider'
import { createPyodidePythonRunner } from './pyodideRunner'
import { createLightningDataProvider } from './lightningDataProvider'

vi.mock('@isomorphic-git/lightning-fs', () => ({
  default: vi.fn((name) => ({ name, promises: { __fsName: name } })),
}))

vi.mock('./lightningFsProvider', () => ({
  createLightningFsProvider: vi.fn((pfs) => ({ kind: 'files', pfs })),
}))

vi.mock('./isomorphicGitProvider', () => ({
  createIsomorphicGitProvider: vi.fn(({ fs, pfs, dir }) => ({ kind: 'git', fs, pfs, dir })),
}))

vi.mock('./pyodideRunner', () => ({
  createPyodidePythonRunner: vi.fn((pfs) => vi.fn(async (code, options) => ({
    kind: 'python',
    pfs,
    code,
    options,
  }))),
}))

describe('createLightningDataProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('composes files/git providers and initializes LightningFS with configured name', () => {
    const provider = createLightningDataProvider({ fsName: 'project-fs', dir: '/repo' })

    expect(LightningFS).toHaveBeenCalledWith('project-fs')
    expect(createLightningFsProvider).toHaveBeenCalledWith({ __fsName: 'project-fs' })
    expect(createIsomorphicGitProvider).toHaveBeenCalledWith({
      fs: expect.objectContaining({ name: 'project-fs' }),
      pfs: { __fsName: 'project-fs' },
      dir: '/repo',
    })
    expect(provider.files).toEqual({ kind: 'files', pfs: { __fsName: 'project-fs' } })
    expect(provider.git).toEqual(expect.objectContaining({ kind: 'git', dir: '/repo' }))
  })

  it('exposes runPython and delegates to Pyodide runner', async () => {
    const provider = createLightningDataProvider({ fsName: 'browser-fs' })
    const result = await provider.runPython('print("ok")', { path: 'scripts/main.py', cwd: 'scripts' })

    expect(createPyodidePythonRunner).toHaveBeenCalledWith({ __fsName: 'browser-fs' })
    expect(result).toEqual({
      kind: 'python',
      pfs: { __fsName: 'browser-fs' },
      code: 'print("ok")',
      options: { path: 'scripts/main.py', cwd: 'scripts' },
    })
  })
})
