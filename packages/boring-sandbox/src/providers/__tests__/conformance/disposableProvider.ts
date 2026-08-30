import { expect } from 'vitest'
import { join } from 'node:path'

import {
  DISPOSABLE_SANDBOX_PROVIDER_PROFILE_V1,
  isDisposableSandboxProviderV1,
  type ExtractedSandboxProviderIdV1,
  type SandboxProviderV1,
  type WorkspaceSandboxPairV1,
} from '../../../shared/providerV1'

/** Shared marker/ownership law used by every disposable provider qualification. */
export function expectDisposableProviderProfile(
  provider: SandboxProviderV1,
  providerId: ExtractedSandboxProviderIdV1,
): void {
  expect(provider.providerId).toBe(providerId)
  expect(isDisposableSandboxProviderV1(provider)).toBe(true)
  if (!isDisposableSandboxProviderV1(provider)) return
  expect(provider.disposableProfile).toMatchObject({
    contractVersion: DISPOSABLE_SANDBOX_PROVIDER_PROFILE_V1,
    resume: false,
    publishedCleanupOwner: 'returned-pair',
    ambiguousCreate: 'correlated-reconciliation',
    providerConfigDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
  })
}

/** Shared publication, provider-close, joined-disposal, and terminal-cleanup laws. */
export async function expectPublishedPairLifecycle(input: {
  provider: SandboxProviderV1
  pair: WorkspaceSandboxPairV1
  assertUsableAfterProviderClose(): Promise<void>
  assertTerminalCleanup(): Promise<void>
}): Promise<void> {
  await input.provider.close?.()
  await input.assertUsableAfterProviderClose()
  await Promise.all([input.pair.dispose(), input.pair.dispose()])
  await input.assertTerminalCleanup()
}

/** The shared seven Workspace plus six Sandbox laws for disposable pairs. */
export async function expectDisposablePairSurfaceLaws(pair: WorkspaceSandboxPairV1): Promise<void> {
  const { workspace, sandbox } = pair
  await workspace.mkdir('src', { recursive: true })
  await workspace.writeFile('src/hello.txt', 'hello world')
  expect(await workspace.readFile('src/hello.txt')).toBe('hello world')
  expect(await workspace.stat('src/hello.txt')).toMatchObject({ kind: 'file', size: 11 })
  await workspace.rename('src/hello.txt', 'src/renamed.txt')
  expect(await workspace.readFile('src/renamed.txt')).toBe('hello world')
  await workspace.mkdir('a/b/c', { recursive: true })
  expect(await workspace.stat('a/b/c')).toMatchObject({ kind: 'dir' })
  await workspace.unlink('src/renamed.txt')
  await expect(workspace.readFile('src/renamed.txt')).rejects.toThrow()
  for (const bad of ['../etc/passwd', '/etc/passwd', `bad\0name`]) {
    await expect(workspace.readFile(bad)).rejects.toThrow()
  }

  expect(new TextDecoder().decode((await sandbox.exec('echo hello')).stdout)).toContain('hello')
  expect((await sandbox.exec('exit 7')).exitCode).toBe(7)
  await workspace.mkdir('nested', { recursive: true })
  await workspace.writeFile('nested/note.txt', 'cwd-ok')
  const cwd = await sandbox.exec('pwd && cat note.txt', { cwd: join(workspace.root, 'nested') })
  expect(new TextDecoder().decode(cwd.stdout)).toContain('cwd-ok')
  expect((await sandbox.exec('node -e "setInterval(() => {}, 1000)"', { timeoutMs: 500 })).exitCode).toBe(124)
  const bounded = await sandbox.exec(`node -e "process.stdout.write('x'.repeat(2_000_000))"`, { maxOutputBytes: 1024 })
  expect(bounded.truncated).toBe(true)
  let heartbeats = 0
  await sandbox.exec('node -e "setTimeout(() => {}, 2100)"', {
    timeoutMs: 5_000,
    onHeartbeat: () => { heartbeats += 1 },
  })
  expect(heartbeats).toBeGreaterThanOrEqual(1)
}

export function expectPersistentProviderDefault(provider: SandboxProviderV1): void {
  expect(isDisposableSandboxProviderV1(provider)).toBe(false)
}
