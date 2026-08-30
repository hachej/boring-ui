import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const controls = vi.hoisted(() => ({ disposeFailures: 0 }))

function mockedSandbox(provider: 'direct' | 'bwrap') {
  return {
    id: provider,
    placement: 'server' as const,
    provider,
    capabilities: ['exec'] as const,
    async init() { throw new Error(`${provider} init failed`) },
    async exec() { throw new Error('unreachable') },
    async dispose() {
      if (controls.disposeFailures-- > 0) throw new Error(`${provider} dispose failed`)
    },
  }
}

vi.mock('../direct/createDirectSandbox', () => ({
  createDirectSandbox: () => mockedSandbox('direct'),
}))
vi.mock('../bwrap/createBwrapSandbox', () => ({
  createBwrapSandbox: () => mockedSandbox('bwrap'),
}))

import { createBwrapSandboxProvider } from '../bwrap/createBwrapProvider'
import { createDirectSandboxProvider } from '../direct/createDirectProvider'

const cleanupRoots: string[] = []
beforeEach(() => { controls.disposeFailures = 1 })
afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }) }))
})

test.each(['direct', 'bwrap'] as const)(
  '%s exposes failed unpublished cleanup as retryable provider debt',
  async (providerId) => {
    const parent = await mkdtemp(join(tmpdir(), 'boring-local-debt-'))
    cleanupRoots.push(parent)
    const provider = providerId === 'direct'
      ? createDirectSandboxProvider({ leaseMode: 'disposable' })
      : createBwrapSandboxProvider({ leaseMode: 'disposable' })
    const failure = await provider.create({
      workspaceRoot: join(parent, 'lease-aaaaaaaaaaaaaaaa'),
      sessionId: 'cleanup-debt',
    }).catch((caught: unknown) => caught) as AggregateError & {
      sandboxProviderCleanupDebt: { retry(): Promise<void> }
    }

    expect(failure).toBeInstanceOf(AggregateError)
    expect(failure.errors[0]).toMatchObject({ message: `${providerId} init failed` })
    expect(failure.errors[1]).toBeInstanceOf(AggregateError)
    expect(failure.sandboxProviderCleanupDebt.retry).toBeTypeOf('function')
    await expect(failure.sandboxProviderCleanupDebt.retry()).resolves.toBeUndefined()
    await expect(provider.close!()).resolves.toBeUndefined()
  },
)
