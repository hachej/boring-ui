import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { DisposableSandboxProviderV1, WorkspaceSandboxPairV1 } from '@hachej/boring-sandbox/shared'
import {
  FACTORY_GIT_TOKEN_ENV_VAR,
  buildFactoryBootstrapScript,
  createExactShaTemplateProvider,
  gitFetchAuthShellSetup,
  resolveFactoryGitToken,
} from '@hachej/boring-factory/server/sandbox'

const execFileAsync = promisify(execFile)
const SECRET_TOKEN = 'ghp_super_secret_do_not_leak_1234567890'

const temporaryRoots: string[] = []
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createGitSourceRootWithRemote(remoteUrl: string): Promise<string> {
  const sourceRoot = await mkdtemp(resolve(tmpdir(), 'factory-git-token-source-'))
  temporaryRoots.push(sourceRoot)
  await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: sourceRoot })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: sourceRoot })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: sourceRoot })
  await writeFile(resolve(sourceRoot, 'tracked.txt'), 'tracked-content')
  await execFileAsync('git', ['add', 'tracked.txt'], { cwd: sourceRoot })
  await execFileAsync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: sourceRoot })
  await execFileAsync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: sourceRoot })
  return sourceRoot
}

describe('resolveFactoryGitToken', () => {
  it('prefers BORING_FACTORY_GIT_TOKEN over the gh CLI fallback', () => {
    const token = resolveFactoryGitToken({ BORING_FACTORY_GIT_TOKEN: ' from-env ' } as NodeJS.ProcessEnv, () => 'from-gh')
    expect(token).toBe('from-env')
  })

  it('falls back to the injected gh-auth-token function when the env var is unset', () => {
    const token = resolveFactoryGitToken({} as NodeJS.ProcessEnv, () => 'from-gh')
    expect(token).toBe('from-gh')
  })

  it('returns undefined (not an error) when neither source is available', () => {
    const token = resolveFactoryGitToken({} as NodeJS.ProcessEnv, () => undefined)
    expect(token).toBeUndefined()
  })
})

describe('git auth header shell fragment', () => {
  it('computes the exact "AUTHORIZATION: basic <base64(x-access-token:token)>" form', async () => {
    const script = [
      '#!/bin/sh',
      'set -e',
      gitFetchAuthShellSetup(),
      'echo "$factory_auth_header"',
    ].join('\n')
    const scriptPath = resolve(await mkdtemp(resolve(tmpdir(), 'factory-git-token-script-')), 'header.sh')
    temporaryRoots.push(resolve(scriptPath, '..'))
    await writeFile(scriptPath, script)
    const { stdout } = await execFileAsync('sh', [scriptPath], {
      env: { ...process.env, [FACTORY_GIT_TOKEN_ENV_VAR]: SECRET_TOKEN },
    })
    const expected = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${SECRET_TOKEN}`).toString('base64')}`
    expect(stdout.trim()).toBe(expected)
  })

  it('falls back to a plain git_fetch function (no header) when the token env var is unset', async () => {
    const script = [
      '#!/bin/sh',
      'set -e',
      gitFetchAuthShellSetup(),
      'type git_fetch >/dev/null 2>&1 && echo has-git-fetch',
      'echo "auth=${factory_auth_header:-none}"',
    ].join('\n')
    const scriptPath = resolve(await mkdtemp(resolve(tmpdir(), 'factory-git-token-script-')), 'header.sh')
    temporaryRoots.push(resolve(scriptPath, '..'))
    await writeFile(scriptPath, script)
    const cleanEnv = { ...process.env }
    delete cleanEnv[FACTORY_GIT_TOKEN_ENV_VAR]
    const { stdout } = await execFileAsync('sh', [scriptPath], { env: cleanEnv })
    expect(stdout).toContain('has-git-fetch')
    expect(stdout).toContain('auth=none')
  })
})

describe('buildFactoryBootstrapScript token wiring', () => {
  it('never embeds a literal token: it only ever references the env var by name', () => {
    const script = buildFactoryBootstrapScript()
    expect(script).toContain(`\${${FACTORY_GIT_TOKEN_ENV_VAR}:-}`)
    expect(script).toContain('git_fetch -q origin "$sha"')
    expect(script).toContain('git_fetch -q --depth 1 origin "$sha"')
    expect(script).not.toContain(SECRET_TOKEN)
  })
})

function fakeInnerProviderCapturingExec(
  execImpl: (cmd: string, opts?: unknown) => Promise<{ stdout: Uint8Array; stderr: Uint8Array; exitCode: number }>,
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

describe('createExactShaTemplateProvider gitToken plumbing', () => {
  it('passes gitToken to the sandbox only as an exec env var, never in the command text, and never logs it', async () => {
    const sourceRoot = await createGitSourceRootWithRemote('https://example.invalid/private/repo.git')
    const scratchRoot = await mkdtemp(resolve(tmpdir(), 'factory-git-token-scratch-'))
    temporaryRoots.push(scratchRoot)

    const observedCalls: { cmd: string; env?: Record<string, string> }[] = []
    const inner = fakeInnerProviderCapturingExec(async (cmd, opts) => {
      observedCalls.push({ cmd, env: (opts as { env?: Record<string, string> } | undefined)?.env })
      return { stdout: new TextEncoder().encode('factory-bootstrap ok'), stderr: new Uint8Array(), exitCode: 0 }
    })

    const provider = createExactShaTemplateProvider({ inner, sourceRoot, scratchRoot, source: 'fetch', gitToken: SECRET_TOKEN })
    const pair = await provider.create({ workspaceRoot: '/unused', sessionId: 'test-session' })
    const result = await pair.sandbox.exec('true')
    expect(result.exitCode).toBe(0)
    await pair.dispose()

    expect(observedCalls.length).toBeGreaterThanOrEqual(1)
    const bootstrapCall = observedCalls[0]!
    // The command text is the fixed guarded-bootstrap script: it must never
    // contain the raw token.
    expect(bootstrapCall.cmd).not.toContain(SECRET_TOKEN)
    // The token reaches the sandbox exclusively via the exec-scoped env.
    expect(bootstrapCall.env?.[FACTORY_GIT_TOKEN_ENV_VAR]).toBe(SECRET_TOKEN)

    // No call anywhere in the captured trace carries the token in its command text.
    for (const call of observedCalls) {
      expect(call.cmd).not.toContain(SECRET_TOKEN)
    }
  })

  it('omits the env var entirely when no gitToken is configured', async () => {
    const sourceRoot = await createGitSourceRootWithRemote('https://example.invalid/public/repo.git')
    const scratchRoot = await mkdtemp(resolve(tmpdir(), 'factory-git-token-scratch-'))
    temporaryRoots.push(scratchRoot)

    const observedCalls: { cmd: string; env?: Record<string, string> }[] = []
    const inner = fakeInnerProviderCapturingExec(async (cmd, opts) => {
      observedCalls.push({ cmd, env: (opts as { env?: Record<string, string> } | undefined)?.env })
      return { stdout: new TextEncoder().encode('factory-bootstrap ok'), stderr: new Uint8Array(), exitCode: 0 }
    })

    const provider = createExactShaTemplateProvider({ inner, sourceRoot, scratchRoot, source: 'fetch' })
    const pair = await provider.create({ workspaceRoot: '/unused', sessionId: 'test-session' })
    await pair.sandbox.exec('true')
    await pair.dispose()

    expect(observedCalls[0]?.env?.[FACTORY_GIT_TOKEN_ENV_VAR]).toBeUndefined()
  })
})
