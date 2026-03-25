import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import { createGitServiceImpl } from '../services/gitImpl.js'

const TEST_WORKSPACE = join(tmpdir(), `git-test-${Date.now()}`)
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
}

beforeAll(() => {
  mkdirSync(TEST_WORKSPACE, { recursive: true })
})

afterAll(() => {
  rmSync(TEST_WORKSPACE, { recursive: true, force: true })
})

describe('GitServiceImpl', () => {
  describe('isGitRepo', () => {
    it('returns false for non-git directory', async () => {
      const svc = createGitServiceImpl(TEST_WORKSPACE)
      expect(await svc.isGitRepo()).toBe(false)
    })
  })

  describe('initRepo', () => {
    it('initializes a git repo', async () => {
      const svc = createGitServiceImpl(TEST_WORKSPACE)
      const result = await svc.initRepo()
      expect(result.initialized).toBe(true)
    })

    it('is now a git repo', async () => {
      const svc = createGitServiceImpl(TEST_WORKSPACE)
      expect(await svc.isGitRepo()).toBe(true)
    })
  })

  describe('after init', () => {
    let svc: ReturnType<typeof createGitServiceImpl>

    beforeAll(() => {
      svc = createGitServiceImpl(TEST_WORKSPACE)
      // Create a file and initial commit
      writeFileSync(join(TEST_WORKSPACE, 'test.txt'), 'Hello')
      execSync('git add -A && git commit -m "initial"', {
        cwd: TEST_WORKSPACE,
        env: GIT_ENV,
        stdio: 'ignore',
      })
    })

    it('getStatus returns empty files after commit', async () => {
      const status = await svc.getStatus()
      expect(status.is_repo).toBe(true)
      expect(status.available).toBe(true)
    })

    it('currentBranch returns the branch name', async () => {
      const result = await svc.currentBranch()
      expect(result.branch).toBeTruthy()
    })

    it('listBranches returns at least one branch', async () => {
      const result = await svc.listBranches()
      expect(result.branches.length).toBeGreaterThan(0)
      expect(result.current).toBeTruthy()
    })

    it('getDiff returns diff string', async () => {
      writeFileSync(join(TEST_WORKSPACE, 'test.txt'), 'Modified')
      const result = await svc.getDiff()
      expect(result.diff).toContain('Modified')
    })

    it('addFiles stages changes', async () => {
      const result = await svc.addFiles(['test.txt'])
      expect(result.staged).toBe(true)
    })

    it('commit creates a commit', async () => {
      const result = await svc.commit('test commit')
      expect(result.oid).toBeTruthy()
    })

    it('getShow retrieves file from HEAD', async () => {
      const result = await svc.getShow('test.txt')
      expect(result.content).toBe('Modified')
      expect(result.path).toBe('test.txt')
    })

    it('createBranch creates and checks out', async () => {
      const result = await svc.createBranch('feature-test')
      expect(result.created).toBe(true)
      expect(result.branch).toBe('feature-test')
      expect(result.checked_out).toBe(true)

      const current = await svc.currentBranch()
      expect(current.branch).toBe('feature-test')
    })

    it('checkoutBranch switches branches', async () => {
      // Go back to the original branch
      const branches = await svc.listBranches()
      const mainBranch = branches.branches.find((b) => b !== 'feature-test')!
      const result = await svc.checkoutBranch(mainBranch)
      expect(result.checked_out).toBe(true)
    })

    it('listRemotes returns empty for local repo', async () => {
      const result = await svc.listRemotes()
      expect(result.remotes).toEqual([])
    })
  })

  describe('security validations', () => {
    it('rejects remote names with flag injection', async () => {
      const svc = createGitServiceImpl(TEST_WORKSPACE)
      await expect(svc.addRemote('--evil', 'https://example.com/repo.git')).rejects.toThrow(
        /invalid remote name/i,
      )
    })

    it('rejects clone URLs with file:// scheme', async () => {
      const svc = createGitServiceImpl(TEST_WORKSPACE)
      await expect(svc.cloneRepo('file:///etc/passwd')).rejects.toThrow(
        /unsupported url scheme/i,
      )
    })

    it('rejects clone URLs with ssh:// scheme', async () => {
      const svc = createGitServiceImpl(TEST_WORKSPACE)
      await expect(svc.cloneRepo('ssh://attacker.com/repo')).rejects.toThrow(
        /unsupported url scheme/i,
      )
    })

    it('allows https:// URLs', async () => {
      const svc = createGitServiceImpl(TEST_WORKSPACE)
      // This will fail to connect but should not throw validation error
      await expect(svc.addRemote('test-remote', 'https://github.com/test/repo.git')).resolves.toEqual(
        { added: true },
      )
    })
  })
})
