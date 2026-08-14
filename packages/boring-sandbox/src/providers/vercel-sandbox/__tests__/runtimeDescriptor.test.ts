import { expect, test, vi } from 'vitest'

import type { SandboxHandleStore } from '@hachej/boring-agent/shared'

import type { SandboxProviderV1 } from '../../../shared/providerV1'
import { createVercelSandboxRuntimeDescriptor } from '../runtimeDescriptor'
import { createVercelSandboxProvider } from '../createVercelSandboxProvider'

vi.mock('../createVercelSandboxProvider', () => ({
  createVercelSandboxProvider: vi.fn(() => ({
    contractVersion: 'boring-sandbox.provider.v1',
    providerId: 'vercel-sandbox',
  } satisfies Partial<SandboxProviderV1>)),
}))

function createStore(): SandboxHandleStore {
  return {
    async get() { return null },
    async put() {},
    async delete() {},
    async list() { return [] },
  }
}

test('closes typed provider configuration into the descriptor', async () => {
  const getEnvVar = vi.fn(() => undefined)
  const descriptor = createVercelSandboxRuntimeDescriptor({ getEnvVar })

  await descriptor.createPairFactory({})

  expect(createVercelSandboxProvider).toHaveBeenCalledWith({ getEnvVar })
})

test('host handle ownership overrides configured store and orphan policy', async () => {
  const configuredStore = createStore()
  const hostStore = createStore()
  const descriptor = createVercelSandboxRuntimeDescriptor({
    store: configuredStore,
    orphanGuardMaxIdleMs: 123,
  })

  await descriptor.createPairFactory({ sandboxHandleStore: hostStore })

  expect(createVercelSandboxProvider).toHaveBeenCalledWith({
    store: hostStore,
    orphanGuardMaxIdleMs: null,
  })
})
