import Fastify from 'fastify'
import type { Workspace } from '@hachej/boring-agent/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __gitTestUtils,
  isWorkspaceRelativeGitPath,
  resolveGitFileUrl,
} from '../git/gitFileUrl'
import { gitRoutes } from './git'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('gitRoutes', () => {
  it('rejects traversal before resolving a workspace', async () => {
    const getWorkspace = vi.fn(async () => ({} as Workspace))
    const app = Fastify()
    await app.register(gitRoutes, { getWorkspace })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/git/file-url?path=../../foreign/repo/file.ts',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: { code: 'invalid_path', message: 'path must stay within the workspace', field: 'path' },
    })
    expect(getWorkspace).not.toHaveBeenCalled()
    await app.close()
  })

  it('rejects named filesystems instead of using their path in the primary Git workspace', async () => {
    const getWorkspace = vi.fn(async () => ({} as Workspace))
    const app = Fastify()
    await app.register(gitRoutes, { getWorkspace })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/git/file-url?filesystem=company_context&path=/policy.md',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: {
        code: 'validation_error',
        message: 'Git file URLs are only available for the primary user filesystem',
        field: 'filesystem',
      },
    })
    expect(getWorkspace).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('GET /api/v1/git/branch', () => {
  it('reports the branch for a workspace with a host root', async () => {
    vi.spyOn(__gitTestUtils, 'runGit').mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return '/repo'
      if (args[0] === 'symbolic-ref') return 'main'
      throw new Error(`unexpected git ${args.join(' ')}`)
    })
    const app = Fastify()
    await app.register(gitRoutes, {
      getWorkspace: async () => ({} as Workspace),
      getWorkspaceHostRoot: () => '/repo',
    })

    const response = await app.inject({ method: 'GET', url: '/api/v1/git/branch' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ enabled: true, branch: 'main' })
    await app.close()
  })

  it('disables without invoking git when the runtime has no host root', async () => {
    const runGit = vi.spyOn(__gitTestUtils, 'runGit')
    const app = Fastify()
    await app.register(gitRoutes, { getWorkspace: async () => ({} as Workspace) })

    const response = await app.inject({ method: 'GET', url: '/api/v1/git/branch' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      enabled: false,
      reason: 'Git branch is unavailable for this runtime.',
    })
    expect(runGit).not.toHaveBeenCalled()
    await app.close()
  })
})

describe('resolveGitFileUrl path containment', () => {
  it('rejects traversal without invoking Git', async () => {
    const runGit = vi.spyOn(__gitTestUtils, 'runGit')

    expect(isWorkspaceRelativeGitPath('../../foreign/repo/file.ts')).toBe(false)
    expect(isWorkspaceRelativeGitPath('/absolute/file.ts')).toBe(false)
    expect(isWorkspaceRelativeGitPath('src/file.ts')).toBe(true)
    await expect(resolveGitFileUrl('/workspace', '../../foreign/repo/file.ts')).resolves.toEqual({
      enabled: false,
      reason: 'File path must stay within the workspace.',
    })
    expect(runGit).not.toHaveBeenCalled()
  })
})
