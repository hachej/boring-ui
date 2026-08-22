import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveGitBranch } from './gitBranch'
import { __gitTestUtils } from './gitFileUrl'

afterEach(() => {
  vi.restoreAllMocks()
})

function stubGit(handler: (args: string[], cwd: string) => Promise<string>) {
  return vi.spyOn(__gitTestUtils, 'runGit').mockImplementation(handler)
}

describe('resolveGitBranch', () => {
  it('returns the checked-out branch for a Git-backed workspace', async () => {
    const runGit = stubGit(async (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return '/repo'
      if (args[0] === 'symbolic-ref') return 'feat/git-branch'
      throw new Error(`unexpected git ${args.join(' ')}`)
    })

    await expect(resolveGitBranch('/repo/packages/app')).resolves.toEqual({
      enabled: true,
      branch: 'feat/git-branch',
    })
    // Branch lookup must stay to two cheap plumbing calls — no log/status walk.
    expect(runGit).toHaveBeenCalledTimes(2)
  })

  it('reports the short sha when HEAD is detached', async () => {
    stubGit(async (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return '/repo'
      if (args[0] === 'symbolic-ref') throw new Error('not a symbolic ref')
      if (args[0] === 'rev-parse' && args[1] === '--short') return 'a1b2c3d'
      throw new Error(`unexpected git ${args.join(' ')}`)
    })

    await expect(resolveGitBranch('/repo')).resolves.toEqual({
      enabled: true,
      branch: 'a1b2c3d',
      detached: true,
    })
  })

  it('disables for a workspace that is not a Git repository', async () => {
    const runGit = stubGit(async () => {
      throw new Error('not a git repository')
    })

    await expect(resolveGitBranch('/plain/folder')).resolves.toEqual({
      enabled: false,
      reason: 'Workspace is not inside a Git repository.',
    })
    // Bails on the first failure instead of probing further.
    expect(runGit).toHaveBeenCalledTimes(1)
  })

  it('disables for a repository with no commits yet', async () => {
    stubGit(async (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return '/fresh'
      throw new Error('unborn branch')
    })

    await expect(resolveGitBranch('/fresh')).resolves.toEqual({
      enabled: false,
      reason: 'Git HEAD is not resolvable yet.',
    })
  })
})
