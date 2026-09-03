import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { DisposableSandboxProviderV1, SandboxProviderCreateContextV1, WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import { createExactShaTemplateProvider } from './remoteSnapshotProvider'

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
