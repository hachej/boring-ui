import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, chmod, lstat, mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { DisposableSandboxProviderV1, SandboxProviderCreateContextV1, WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import { buildFactoryBootstrapScript, createExactShaTemplateProvider } from './remoteSnapshotProvider'

const execFileAsync = promisify(execFile)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })))
})

async function createGitSourceRoot(): Promise<string> {
  const sourceRoot = await mkdtemp(resolve(tmpdir(), 'factory-exact-sha-source-'))
  temporaryRoots.push(sourceRoot)
  await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: sourceRoot })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: sourceRoot })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: sourceRoot })
  await writeFile(resolve(sourceRoot, 'tracked.txt'), 'tracked-content')
  await execFileAsync('git', ['add', 'tracked.txt'], { cwd: sourceRoot })
  await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: sourceRoot })
  return sourceRoot
}

async function createGitSourceRootWithRemote(remoteUrl: string): Promise<string> {
  const sourceRoot = await createGitSourceRoot()
  await execFileAsync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: sourceRoot })
  return sourceRoot
}

interface FakeExecResult {
  stdout: Uint8Array
  stderr: Uint8Array
  exitCode: number
  durationMs: number
  truncated: boolean
}

function fakeExecResult(exitCode: number, stdout = '', stderr = ''): FakeExecResult {
  return {
    stdout: new TextEncoder().encode(stdout),
    stderr: new TextEncoder().encode(stderr),
    exitCode,
    durationMs: 1,
    truncated: false,
  }
}

function fakeInnerProviderWithSandboxExec(
  execImpl: (cmd: string) => Promise<FakeExecResult>,
): DisposableSandboxProviderV1 {
  const sandbox = {
    id: 'fake-sandbox',
    placement: 'remote',
    provider: 'fake',
    capabilities: ['exec'],
    runtimeContext: { runtimeCwd: '/workspace' },
    exec: execImpl,
  } as unknown as WorkspaceSandboxPairV1['sandbox']
  const pair: WorkspaceSandboxPairV1 = {
    workspace: {} as WorkspaceSandboxPairV1['workspace'],
    sandbox,
    async dispose() {},
  }
  return {
    contractVersion: 'boring-sandbox-provider.v1' as never,
    providerId: 'direct',
    capabilities: {} as never,
    resolveRuntimeRoot: (context) => context.workspaceRoot,
    async create() {
      return pair
    },
    disposableProfile: {
      contractVersion: 'boring-sandbox.disposable-provider.v1',
      resume: false,
      publishedCleanupOwner: 'returned-pair',
      ambiguousCreate: 'correlated-reconciliation',
      providerConfigDigest: `sha256:${'0'.repeat(64)}`,
    },
  }
}

function fakeInnerProvider(
  onCreate: (context: SandboxProviderCreateContextV1) => void | Promise<void>,
): DisposableSandboxProviderV1 {
  const pair: WorkspaceSandboxPairV1 = {
    workspace: {} as WorkspaceSandboxPairV1['workspace'],
    sandbox: {} as WorkspaceSandboxPairV1['sandbox'],
    async dispose() {},
  }
  return {
    contractVersion: 'boring-sandbox-provider.v1' as never,
    providerId: 'direct',
    capabilities: {} as never,
    resolveRuntimeRoot: (context) => context.workspaceRoot,
    async create(context) {
      await onCreate(context)
      return pair
    },
    disposableProfile: {
      contractVersion: 'boring-sandbox.disposable-provider.v1',
      resume: false,
      publishedCleanupOwner: 'returned-pair',
      ambiguousCreate: 'correlated-reconciliation',
      providerConfigDigest: `sha256:${'0'.repeat(64)}`,
    },
  }
}

describe('createExactShaTemplateProvider', () => {
  it('exports the exact committed HEAD with a .factory-sha file and cleans up the export dir', async () => {
    const sourceRoot = await createGitSourceRoot()
    const expectedSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot })).stdout.trim()
    const scratchRoot = await mkdtemp(resolve(tmpdir(), 'factory-exact-sha-scratch-'))
    temporaryRoots.push(scratchRoot)

    let capturedTemplatePath: string | undefined
    let observedSha: string | undefined
    let observedTracked: string | undefined
    const inner = fakeInnerProvider(async (context) => {
      capturedTemplatePath = context.templatePath!
      // Read the export contents while it still exists: the wrapper removes
      // it once inner.create settles, so assertions must happen in here.
      observedSha = (await readFile(resolve(capturedTemplatePath, '.factory-sha'), 'utf8')).trim()
      observedTracked = await readFile(resolve(capturedTemplatePath, 'tracked.txt'), 'utf8')
    })
    const provider = createExactShaTemplateProvider({ inner, sourceRoot, scratchRoot })

    const pair = await provider.create({ workspaceRoot: '/unused', sessionId: 'test-session' })

    expect(capturedTemplatePath).toBeDefined()
    expect(observedSha).toBe(expectedSha)
    expect(observedTracked).toBe('tracked-content')

    await pair.dispose()

    // The export directory is removed once the pair is disposed.
    await expect(access(capturedTemplatePath!)).rejects.toThrow()
  })

  it('keeps the export directory alive after create() resolves, for a background reader, until dispose', async () => {
    // Regression test: createVercelSandboxProvider's disposable lifecycle
    // defers template packaging/seeding to a background promise that is only
    // awaited by the pair's first checkHealth()/exec call, which can run
    // after create() has already returned. Deleting the export directory as
    // soon as create() resolves breaks that deferred read (observed live as
    // an ENOENT during template seeding); the export must survive until the
    // pair is disposed.
    const sourceRoot = await createGitSourceRoot()
    const scratchRoot = await mkdtemp(resolve(tmpdir(), 'factory-exact-sha-scratch-'))
    temporaryRoots.push(scratchRoot)

    let capturedTemplatePath: string | undefined
    const inner = fakeInnerProvider((context) => {
      capturedTemplatePath = context.templatePath!
    })
    const provider = createExactShaTemplateProvider({ inner, sourceRoot, scratchRoot })

    const pair = await provider.create({ workspaceRoot: '/unused', sessionId: 'test-session' })

    // A background reader accessing templatePath after create() resolved
    // (simulating checkHealth()'s deferred seeding) must still find it.
    const deferredSha = (await readFile(resolve(capturedTemplatePath!, '.factory-sha'), 'utf8')).trim()
    expect(deferredSha).toHaveLength(40)

    await pair.dispose()
    await expect(access(capturedTemplatePath!)).rejects.toThrow()
  })

  it('cleans up the export directory even when inner.create rejects', async () => {
    const sourceRoot = await createGitSourceRoot()
    const scratchRoot = await mkdtemp(resolve(tmpdir(), 'factory-exact-sha-scratch-'))
    temporaryRoots.push(scratchRoot)

    let capturedTemplatePath: string | undefined
    const inner: DisposableSandboxProviderV1 = {
      contractVersion: 'boring-sandbox-provider.v1' as never,
      providerId: 'direct',
      capabilities: {} as never,
      resolveRuntimeRoot: (context) => context.workspaceRoot,
      async create(context) {
        capturedTemplatePath = context.templatePath
        throw new Error('inner create failed')
      },
      disposableProfile: {
        contractVersion: 'boring-sandbox.disposable-provider.v1',
        resume: false,
        publishedCleanupOwner: 'returned-pair',
        ambiguousCreate: 'correlated-reconciliation',
        providerConfigDigest: `sha256:${'0'.repeat(64)}`,
      },
    }
    const provider = createExactShaTemplateProvider({ inner, sourceRoot, scratchRoot })

    await expect(
      provider.create({ workspaceRoot: '/unused', sessionId: 'test-session' }),
    ).rejects.toThrow('inner create failed')

    expect(capturedTemplatePath).toBeDefined()
    await expect(access(capturedTemplatePath!)).rejects.toThrow()
  })

  it('derives providerConfigDigest from the inner digest and sourceRoot', async () => {
    const sourceRoot = await createGitSourceRoot()
    const scratchRoot = await mkdtemp(resolve(tmpdir(), 'factory-exact-sha-scratch-'))
    temporaryRoots.push(scratchRoot)
    const inner = fakeInnerProvider(() => {})
    const provider = createExactShaTemplateProvider({ inner, sourceRoot, scratchRoot })
    expect(provider.disposableProfile.providerConfigDigest).not.toBe(inner.disposableProfile.providerConfigDigest)
    expect(provider.disposableProfile.providerConfigDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
  })
})


describe('createExactShaTemplateProvider fetch mode', () => {
  it('exports exactly the four marker/bootstrap files with the right SHA and a normalized https remote', async () => {
    const sourceRoot = await createGitSourceRootWithRemote('git@github.com:hachej/boring-ui.git')
    const expectedSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot })).stdout.trim()
    const scratchRoot = await mkdtemp(resolve(tmpdir(), 'factory-exact-sha-fetch-scratch-'))
    temporaryRoots.push(scratchRoot)

    let capturedTemplatePath: string | undefined
    let entries: string[] = []
    let observedSha: string | undefined
    let observedRemote: string | undefined
    let observedBranch: string | undefined
    let observedBootstrapScript: string | undefined
    const inner = fakeInnerProvider(async (context) => {
      capturedTemplatePath = context.templatePath!
      entries = (await readdir(capturedTemplatePath)).sort()
      observedSha = (await readFile(resolve(capturedTemplatePath, '.factory-sha'), 'utf8')).trim()
      observedRemote = (await readFile(resolve(capturedTemplatePath, '.factory-remote'), 'utf8')).trim()
      observedBranch = (await readFile(resolve(capturedTemplatePath, '.factory-branch'), 'utf8')).trim()
      observedBootstrapScript = await readFile(resolve(capturedTemplatePath, 'factory-bootstrap.sh'), 'utf8')
    })
    const provider = createExactShaTemplateProvider({ inner, sourceRoot, scratchRoot, source: 'fetch' })

    const pair = await provider.create({ workspaceRoot: '/unused', sessionId: 'test-session' })

    expect(entries).toEqual(['.factory-branch', '.factory-remote', '.factory-sha', 'factory-bootstrap.sh'])
    expect(observedSha).toBe(expectedSha)
    expect(observedRemote).toBe('https://github.com/hachej/boring-ui.git')
    expect(observedBranch).toBe('main')
    expect(observedBootstrapScript).toContain('git fetch -q --depth 1 origin "$sha"')
    expect(observedBootstrapScript).toContain('test "$(git rev-parse HEAD)" = "$sha"')

    await pair.dispose()
    await expect(access(capturedTemplatePath!)).rejects.toThrow()
  })

  it('defaults to fetch mode when sourceRoot has a resolvable origin remote', async () => {
    const sourceRoot = await createGitSourceRootWithRemote('git@github.com:hachej/boring-ui.git')
    const scratchRoot = await mkdtemp(resolve(tmpdir(), 'factory-exact-sha-fetch-scratch-'))
    temporaryRoots.push(scratchRoot)
    let entries: string[] = []
    const inner = fakeInnerProvider(async (context) => {
      entries = (await readdir(context.templatePath!)).sort()
    })
    const provider = createExactShaTemplateProvider({ inner, sourceRoot, scratchRoot })
    const pair = await provider.create({ workspaceRoot: '/unused', sessionId: 'test-session' })
    expect(entries).toEqual(['.factory-branch', '.factory-remote', '.factory-sha', 'factory-bootstrap.sh'])
    await pair.dispose()
  })

  it('defaults to archive mode when sourceRoot has no origin remote', async () => {
    const sourceRoot = await createGitSourceRoot()
    const scratchRoot = await mkdtemp(resolve(tmpdir(), 'factory-exact-sha-fetch-scratch-'))
    temporaryRoots.push(scratchRoot)
    let entries: string[] = []
    const inner = fakeInnerProvider(async (context) => {
      entries = (await readdir(context.templatePath!)).sort()
    })
    const provider = createExactShaTemplateProvider({ inner, sourceRoot, scratchRoot })
    const pair = await provider.create({ workspaceRoot: '/unused', sessionId: 'test-session' })
    expect(entries).toContain('tracked.txt')
    expect(entries).not.toContain('factory-bootstrap.sh')
    await pair.dispose()
  })

  it("runs factory-bootstrap.sh exactly once on the first exec, then passes the caller's command through", async () => {
    const sourceRoot = await createGitSourceRootWithRemote('git@github.com:hachej/boring-ui.git')
    const scratchRoot = await mkdtemp(resolve(tmpdir(), 'factory-exact-sha-fetch-scratch-'))
    temporaryRoots.push(scratchRoot)

    const calls: string[] = []
    const inner = fakeInnerProviderWithSandboxExec(async (cmd) => {
      calls.push(cmd)
      if (cmd.includes('factory-bootstrap.sh')) return fakeExecResult(0, 'factory-bootstrap ok\n')
      return fakeExecResult(0, `ran:${cmd}`)
    })
    const provider = createExactShaTemplateProvider({ inner, sourceRoot, scratchRoot, source: 'fetch' })
    const pair = await provider.create({ workspaceRoot: '/unused', sessionId: 'test-session' })

    const first = await pair.sandbox.exec('caller-cmd-1')
    const second = await pair.sandbox.exec('caller-cmd-2')

    const bootstrapCalls = calls.filter((cmd) => cmd.includes('factory-bootstrap.sh'))
    expect(bootstrapCalls).toHaveLength(1)
    expect(calls).toEqual([bootstrapCalls[0], 'caller-cmd-1', 'caller-cmd-2'])
    expect(Buffer.from(first.stdout).toString('utf8')).toBe('ran:caller-cmd-1')
    expect(Buffer.from(second.stdout).toString('utf8')).toBe('ran:caller-cmd-2')
    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)

    await pair.dispose()
  })

  it('returns a clear failure and never runs the caller command when bootstrap fails', async () => {
    const sourceRoot = await createGitSourceRootWithRemote('git@github.com:hachej/boring-ui.git')
    const expectedSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot })).stdout.trim()
    const scratchRoot = await mkdtemp(resolve(tmpdir(), 'factory-exact-sha-fetch-scratch-'))
    temporaryRoots.push(scratchRoot)

    const calls: string[] = []
    const inner = fakeInnerProviderWithSandboxExec(async (cmd) => {
      calls.push(cmd)
      if (cmd.includes('factory-bootstrap.sh')) {
        return fakeExecResult(1, '', 'fatal: could not read from remote repository')
      }
      return fakeExecResult(0, 'should-never-run')
    })
    const provider = createExactShaTemplateProvider({ inner, sourceRoot, scratchRoot, source: 'fetch' })
    const pair = await provider.create({ workspaceRoot: '/unused', sessionId: 'test-session' })

    const result = await pair.sandbox.exec('caller-cmd')

    expect(result.exitCode).not.toBe(0)
    expect(Buffer.from(result.stderr).toString('utf8')).toContain(
      `factory-bootstrap failed: push the epic branch so ${expectedSha} is reachable on origin`,
    )
    expect(calls).toHaveLength(1)

    await pair.dispose()
  })
})

describe('buildFactoryBootstrapScript: warm-vs-cold selection', () => {
  function sha256Hex(content: string): string {
    return createHash('sha256').update(content).digest('hex')
  }

  async function makeFakePnpmBin(logPath: string): Promise<string> {
    const binDir = await mkdtemp(resolve(tmpdir(), 'factory-bootstrap-fakebin-'))
    temporaryRoots.push(binDir)
    const script = [
      '#!/bin/sh',
      `echo "$@" >> "${logPath}"`,
      'exit 0',
    ].join('\n') + '\n'
    const pnpmPath = resolve(binDir, 'pnpm')
    await writeFile(pnpmPath, script)
    await chmod(pnpmPath, 0o755)
    return binDir
  }

  async function runBootstrap(
    cwd: string,
    warmRoot: string,
    fakeBinDir: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const script = buildFactoryBootstrapScript(warmRoot, resolve(cwd, 'workspace-link'))
    return await execFileAsync('sh', ['-c', script], {
      cwd,
      env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` },
    })
  }

  async function makeOriginWithTwoCommits(
    lockfileChanges: boolean,
  ): Promise<{ originPath: string; baseSha: string; headSha: string; baseLockfileContent: string }> {
    const originPath = await mkdtemp(resolve(tmpdir(), 'factory-bootstrap-origin-'))
    temporaryRoots.push(originPath)
    await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: originPath })
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: originPath })
    await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: originPath })
    const baseLockfileContent = 'lockfile-v1\n'
    await writeFile(resolve(originPath, 'pnpm-lock.yaml'), baseLockfileContent)
    await writeFile(resolve(originPath, 'tracked.txt'), 'v1')
    await execFileAsync('git', ['add', '.'], { cwd: originPath })
    await execFileAsync('git', ['commit', '--quiet', '-m', 'base'], { cwd: originPath })
    const baseSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: originPath })).stdout.trim()

    if (lockfileChanges) {
      await writeFile(resolve(originPath, 'pnpm-lock.yaml'), 'lockfile-v2\n')
    }
    await writeFile(resolve(originPath, 'tracked.txt'), 'v2')
    await execFileAsync('git', ['add', '.'], { cwd: originPath })
    await execFileAsync('git', ['commit', '--quiet', '-m', 'next'], { cwd: originPath })
    const headSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: originPath })).stdout.trim()

    return { originPath, baseSha, headSha, baseLockfileContent }
  }

  async function makeWarmRoot(
    originPath: string,
    baseSha: string,
    lockfileSha256: string,
  ): Promise<string> {
    const warmRoot = await mkdtemp(resolve(tmpdir(), 'factory-bootstrap-warmroot-'))
    temporaryRoots.push(warmRoot)
    await execFileAsync('git', ['clone', '--quiet', originPath, warmRoot])
    await execFileAsync('git', ['checkout', '--quiet', '--detach', baseSha], { cwd: warmRoot })
    const manifest = {
      baseSha,
      lockfileSha256: `sha256:${lockfileSha256}`,
      pnpmVersion: '10.33.2',
      builtAt: new Date().toISOString(),
      buildCommand: 'pnpm run build:packages',
      repoRoot: warmRoot,
    }
    await writeFile(resolve(warmRoot, '.factory-snapshot.json'), JSON.stringify(manifest, null, 2))
    return warmRoot
  }

  async function makeSandboxCwd(headSha: string, remote: string): Promise<string> {
    const cwd = await mkdtemp(resolve(tmpdir(), 'factory-bootstrap-cwd-'))
    temporaryRoots.push(cwd)
    await writeFile(resolve(cwd, '.factory-sha'), headSha)
    await writeFile(resolve(cwd, '.factory-remote'), remote)
    return cwd
  }

  it('takes the warm path, installs when the lockfile hash moved, and symlinks the workspace root to the warm repo', async () => {
    const { originPath, baseSha, headSha, baseLockfileContent } = await makeOriginWithTwoCommits(true)
    const warmRoot = await makeWarmRoot(originPath, baseSha, sha256Hex(baseLockfileContent))
    const cwd = await makeSandboxCwd(headSha, originPath)
    const logPath = resolve(cwd, 'pnpm-calls.log')
    const fakeBinDir = await makeFakePnpmBin(logPath)

    const { stdout } = await runBootstrap(cwd, warmRoot, fakeBinDir)

    expect(stdout).toContain(`factory-bootstrap ok ${headSha} (warm)`)
    expect(stdout).toContain('factory-bootstrap-phase fetch')
    expect(stdout).toContain('factory-bootstrap-phase install ')
    expect(stdout).not.toContain('factory-bootstrap-phase install-skipped')
    expect(stdout).toContain('factory-bootstrap-phase build')

    const pnpmLog = await readFile(logPath, 'utf8')
    expect(pnpmLog).toContain('install --frozen-lockfile --offline')
    expect(pnpmLog).toContain(`--filter ...[${baseSha}] --filter !. --workspace-concurrency=1 build`)

    const linkTarget = resolve(cwd, 'workspace-link')
    expect(await readlink(linkTarget)).toBe(warmRoot)
    const headInWarmRoot = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: warmRoot })).stdout.trim()
    expect(headInWarmRoot).toBe(headSha)
  })

  it('skips install on the warm path when the lockfile hash is unchanged', async () => {
    const { originPath, baseSha, headSha, baseLockfileContent } = await makeOriginWithTwoCommits(false)
    const warmRoot = await makeWarmRoot(originPath, baseSha, sha256Hex(baseLockfileContent))
    const cwd = await makeSandboxCwd(headSha, originPath)
    const logPath = resolve(cwd, 'pnpm-calls.log')
    const fakeBinDir = await makeFakePnpmBin(logPath)

    const { stdout } = await runBootstrap(cwd, warmRoot, fakeBinDir)

    expect(stdout).toContain(`factory-bootstrap ok ${headSha} (warm)`)
    expect(stdout).toContain('factory-bootstrap-phase install-skipped')

    const pnpmLog = await readFile(logPath, 'utf8').catch(() => '')
    expect(pnpmLog).not.toContain('--frozen-lockfile --offline')
    expect(pnpmLog).toContain('build')
  })

  it('falls back to the cold path when no .factory-snapshot.json marker exists at the warm root', async () => {
    const { originPath, headSha } = await makeOriginWithTwoCommits(false)
    const warmRootWithoutMarker = await mkdtemp(resolve(tmpdir(), 'factory-bootstrap-no-warm-'))
    temporaryRoots.push(warmRootWithoutMarker)
    const cwd = await makeSandboxCwd(headSha, originPath)
    const logPath = resolve(cwd, 'pnpm-calls.log')
    const fakeBinDir = await makeFakePnpmBin(logPath)

    const { stdout } = await runBootstrap(cwd, warmRootWithoutMarker, fakeBinDir)

    expect(stdout).toContain(`factory-bootstrap ok ${headSha}`)
    expect(stdout).not.toContain('(warm)')
    expect(stdout).not.toContain('factory-bootstrap-phase install')
    expect(stdout).not.toContain('factory-bootstrap-phase build')

    // Cold path never touches pnpm, and never creates the workspace symlink.
    const pnpmLog = await readFile(logPath, 'utf8').catch(() => '')
    expect(pnpmLog).toBe('')
    await expect(lstat(resolve(cwd, 'workspace-link'))).rejects.toThrow()

    const headInCwd = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim()
    expect(headInCwd).toBe(headSha)
  })
})
