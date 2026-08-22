import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { ENVIRONMENT_MOUNTS_FLAG } from '../../../shared/mounts'
import { SandboxProviderError } from '../../../shared/providerV1'
import { createDirectSandboxProvider } from '../createDirectProvider'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'boring-direct-mounts-'))
  vi.stubEnv(ENVIRONMENT_MOUNTS_FLAG, '1')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

test('direct provider rejects non-empty mount lists with a stable code (fail closed)', async () => {
  const provider = createDirectSandboxProvider()
  expect(provider.capabilities.mounts).toBe(false)

  try {
    await provider.create({
      workspaceRoot: join(root, 'ws'),
      sessionId: 'session-1',
      mounts: [{ sourceRoot: root, logicalPath: '/mnt/fixture', access: 'ro' }],
    })
    expect.unreachable('expected SANDBOX_PROVIDER_MOUNTS_UNSUPPORTED')
  } catch (error) {
    expect(error).toBeInstanceOf(SandboxProviderError)
    expect((error as SandboxProviderError).code).toBe('SANDBOX_PROVIDER_MOUNTS_UNSUPPORTED')
  }
})

test('direct provider still creates with an empty or flag-off mount context', async () => {
  const provider = createDirectSandboxProvider()

  const pair = await provider.create({
    workspaceRoot: join(root, 'ws-empty'),
    sessionId: 'session-2',
    mounts: [],
  })
  await pair.dispose()

  vi.stubEnv(ENVIRONMENT_MOUNTS_FLAG, '')
  const flagOffPair = await provider.create({
    workspaceRoot: join(root, 'ws-flag-off'),
    sessionId: 'session-3',
    mounts: [{ sourceRoot: root, logicalPath: '/mnt/fixture', access: 'ro' }],
  })
  await flagOffPair.dispose()
})
