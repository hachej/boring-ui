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

test('keeps model-visible workspace paths rooted at the provider workspace', () => {
  const descriptor = createVercelSandboxRuntimeDescriptor()
  const filesystem = descriptor.adapter.filesystem

  expect(filesystem.kind).toBe('remote-workspace')
  if (filesystem.kind !== 'remote-workspace') throw new Error('expected remote workspace filesystem')
  expect(filesystem.pathOptions?.toRemotePath?.('/workspace/src/index.ts'))
    .toBe('/workspace/src/index.ts')
  expect(filesystem.pathOptions?.toRuntimePath?.('/workspace/src/index.ts'))
    .toBe('/workspace/src/index.ts')
  expect(filesystem.pathOptions?.toRemotePath?.('/vercel/sandbox/src/index.ts'))
    .toBe('/workspace/src/index.ts')
  expect(filesystem.pathOptions?.toRuntimePath?.('/vercel/sandbox/src/index.ts'))
    .toBe('/workspace/src/index.ts')
  expect(filesystem.pathOptions?.sanitizeErrorText?.('failed at /vercel/sandbox/src/index.ts'))
    .toBe('failed at /workspace/src/index.ts')
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
