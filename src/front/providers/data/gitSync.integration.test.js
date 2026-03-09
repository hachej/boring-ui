/**
 * Integration tests for the full git sync flow using isomorphic-git + git-http-mock-server.
 *
 * Tests the real isomorphic-git provider against a local HTTP git server.
 * Covers: init → write → add → commit → push → clone into second FS → verify.
 *
 * Uses fake-indexeddb to polyfill IndexedDB for LightningFS in Node.
 * Starts the mock server in-process for reliability.
 *
 * @vitest-environment node
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import LightningFS from '@isomorphic-git/lightning-fs'
import http from 'isomorphic-git/http/node'
import git from 'isomorphic-git'
import { createIsomorphicGitProvider } from './isomorphicGitProvider'
import { createLightningFsProvider } from './lightningFsProvider'
import { createAutoSyncEngine } from './autoSync'

const require_ = createRequire(import.meta.url)

const MOCK_SERVER_PORT = 8174
const MOCK_SERVER_URL = `http://localhost:${MOCK_SERVER_PORT}`

let fixturesDir
let mockServer

/**
 * Create a bare git repo in fixtures dir.
 */
const createBareRepo = (name) => {
  const repoPath = join(fixturesDir, `${name}.git`)
  execSync(`git init --bare "${repoPath}"`, { stdio: 'pipe' })
  execSync(`git config receive.denyCurrentBranch ignore`, { cwd: repoPath, stdio: 'pipe' })
  return repoPath
}

/**
 * Create a LightningFS + isomorphic-git provider pair.
 */
const createTestProvider = (name) => {
  const fs = new LightningFS(name)
  const pfs = fs.promises
  const dir = '/'
  return {
    files: createLightningFsProvider(pfs),
    git: createIsomorphicGitProvider({ fs, pfs, dir }),
    fs,
    pfs,
    dir,
  }
}

describe('git sync integration', { timeout: 30_000 }, () => {
  beforeAll(async () => {
    // Create temp fixtures directory with bare repos
    fixturesDir = mkdtempSync(join(tmpdir(), 'git-sync-test-'))
    createBareRepo('workspace-1')
    createBareRepo('workspace-2')

    // Start git-http-mock-server in-process
    // Set env so middleware resolves the right root
    process.env.GIT_HTTP_MOCK_SERVER_ROOT = fixturesDir
    const factory = require_('git-http-mock-server/middleware')
    const cors = require_('git-http-mock-server/cors')
    const config = { root: fixturesDir, glob: '*', route: '/' }
    mockServer = createServer(cors(factory(config)))

    await new Promise((resolve, reject) => {
      mockServer.listen(MOCK_SERVER_PORT, () => resolve())
      mockServer.on('error', reject)
    })
  }, 15_000)

  afterAll(async () => {
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve))
      mockServer = null
    }
    if (fixturesDir) {
      rmSync(fixturesDir, { recursive: true, force: true })
    }
  })

  describe('full push cycle', () => {
    it('init → write → add → commit → push to mock server', async () => {
      const provider = createTestProvider('push-test-fs')
      const { git: gitProvider, files } = provider

      await gitProvider.init()

      await files.write('README.md', '# Test Project\n')
      await files.write('src/main.js', 'console.log("hello")\n')

      await gitProvider.add(['README.md', 'src/main.js'])

      const { oid } = await gitProvider.commit('initial commit', {
        author: { name: 'Test', email: 'test@test.com' },
      })
      expect(oid).toBeTruthy()

      await gitProvider.addRemote('origin', `${MOCK_SERVER_URL}/workspace-1.git`)
      await git.push({ fs: provider.fs, http, dir: '/', remote: 'origin' })

      const status = await gitProvider.status()
      expect(status.is_repo).toBe(true)
      const dirty = status.files.filter((f) => f.status !== null)
      expect(dirty.length).toBe(0)
    })
  })

  describe('clone and verify', () => {
    it('can clone from mock server into a fresh FS', async () => {
      // git-http-mock-server uses copy-on-write, so pushes from LightningFS
      // don't persist on disk for subsequent clones. Seed the bare repo
      // with a real commit using native git instead.
      const tmpWork = mkdtempSync(join(tmpdir(), 'git-push-seed-'))
      execSync(`git clone "${join(fixturesDir, 'workspace-2.git')}" work`, { cwd: tmpWork, stdio: 'pipe' })
      const workDir = join(tmpWork, 'work')
      execSync('git config user.email "seed@test.com"', { cwd: workDir, stdio: 'pipe' })
      execSync('git config user.name "Seed"', { cwd: workDir, stdio: 'pipe' })
      execSync('echo "hello from pusher" > data.txt', { cwd: workDir, stdio: 'pipe' })
      execSync('git add data.txt', { cwd: workDir, stdio: 'pipe' })
      execSync('git commit -m "seed data"', { cwd: workDir, stdio: 'pipe' })
      execSync('git push', { cwd: workDir, stdio: 'pipe' })
      rmSync(tmpWork, { recursive: true, force: true })

      // Now clone into a LightningFS via the mock server
      const cloner = createTestProvider('clone-receiver-fs')
      await git.clone({
        fs: cloner.fs,
        http,
        dir: '/',
        url: `${MOCK_SERVER_URL}/workspace-2.git`,
        singleBranch: true,
        depth: 1,
      })

      const content = await cloner.files.read('data.txt')
      // Native echo adds a trailing newline
      expect(content.trim()).toBe('hello from pusher')
    })
  })

  describe('auto-sync engine with mock server', () => {
    it('auto-commits dirty files on cycle', async () => {
      const provider = createTestProvider('autosync-test-fs')

      await provider.git.init()
      await provider.files.write('.gitkeep', '')
      await provider.git.add(['.gitkeep'])
      await provider.git.commit('init', {
        author: { name: 'Bot', email: 'bot@test.com' },
      })

      await provider.files.write('auto.txt', 'auto content')

      const engine = createAutoSyncEngine(provider.git, {
        intervalMs: 60000,
        author: { name: 'Bot', email: 'bot@test.com' },
        pushEnabled: false,
      })

      engine.start()
      await new Promise((r) => setTimeout(r, 1500))

      const status = await provider.git.status()
      const dirty = status.files.filter((f) => f.status && f.status !== null)
      expect(dirty).toEqual([])

      engine.stop()
    })
  })

  describe('remotes', () => {
    it('listRemotes returns configured remotes', async () => {
      const provider = createTestProvider('remotes-test-fs')
      await provider.git.init()

      const before = await provider.git.listRemotes()
      expect(before).toEqual([])

      await provider.git.addRemote('origin', `${MOCK_SERVER_URL}/workspace-1.git`)
      const after = await provider.git.listRemotes()
      expect(after).toEqual([{ remote: 'origin', url: `${MOCK_SERVER_URL}/workspace-1.git` }])
    })

    it('addRemote replaces existing remote', async () => {
      const provider = createTestProvider('remote-replace-fs')
      await provider.git.init()
      await provider.git.addRemote('origin', 'https://old.com/repo.git')
      await provider.git.addRemote('origin', 'https://new.com/repo.git')

      const remotes = await provider.git.listRemotes()
      expect(remotes).toEqual([{ remote: 'origin', url: 'https://new.com/repo.git' }])
    })
  })
})
