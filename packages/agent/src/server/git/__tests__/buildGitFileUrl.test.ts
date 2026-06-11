import { describe, expect, it } from 'vitest'
import { buildGitFileUrl } from '../buildGitFileUrl'

describe('buildGitFileUrl', () => {
  it('builds a GitHub blob URL from SSH remotes', () => {
    expect(
      buildGitFileUrl({
        remoteUrl: 'git@github.com:owner/repo.git',
        repoRelativePath: 'src/main.ts',
        branch: 'main',
      }),
    ).toBe('https://github.com/owner/repo/blob/main/src/main.ts')
  })

  it('builds a GitHub blob URL from HTTPS remotes without .git', () => {
    expect(
      buildGitFileUrl({
        remoteUrl: 'https://github.com/owner/repo',
        repoRelativePath: 'docs/Guide Name.md',
        branch: 'feature/test',
      }),
    ).toBe('https://github.com/owner/repo/blob/feature%2Ftest/docs/Guide%20Name.md')
  })

  it('strips credentials from credentialed GitHub HTTPS remotes', () => {
    expect(
      buildGitFileUrl({
        remoteUrl: 'https://x-access-token:TOKEN@github.com/owner/repo.git',
        repoRelativePath: 'src/main.ts',
        branch: 'main',
      }),
    ).toBe('https://github.com/owner/repo/blob/main/src/main.ts')
  })

  it('falls back to commit sha when branch is unavailable', () => {
    expect(
      buildGitFileUrl({
        remoteUrl: 'https://github.com/owner/repo.git',
        repoRelativePath: 'src/main.ts',
        commitSha: 'abc123',
      }),
    ).toBe('https://github.com/owner/repo/blob/abc123/src/main.ts')
  })

  it('returns null for unsupported remotes', () => {
    expect(
      buildGitFileUrl({
        remoteUrl: 'git@gitlab.com:owner/repo.git',
        repoRelativePath: 'src/main.ts',
        branch: 'main',
      }),
    ).toBeNull()
  })
})
