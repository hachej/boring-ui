import { describe, expect, test, vi } from 'vitest'

import {
  expectDisposablePairSurfaceLaws,
  expectDisposableProviderProfile,
  expectPublishedPairLifecycle,
} from '../../__tests__/conformance/disposableProvider'
import type { BlaxelRemoteSandbox } from '../client'
import { createBlaxelSandboxProvider } from '../createBlaxelSandboxProvider'
import { createMockBlaxelClient } from './mockBlaxelClient'

describe('disposable Blaxel provider', () => {
  test('derives configuration identity from the resolved image and policy', async () => {
    const client = await createMockBlaxelClient()
    const first = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1', image: 'image:v1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    const second = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1', image: 'image:v2',
      volume: { enabled: false, sizeMb: 2048 },
    })
    expect(first.disposableProfile.providerConfigDigest)
      .not.toBe(second.disposableProfile.providerConfigDigest)
  })
  test('creates fresh no-volume pairs and deletes the remote on dispose', async () => {
    const client = await createMockBlaxelClient()
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable',
      client,
      region: 'eu-fra-1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    expectDisposableProviderProfile(provider, 'blaxel')
    const pair = await provider.create({
      workspaceRoot: '/host/lease-a',
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
      requestId: 'request-a',
    })
    const sibling = await provider.create({
      workspaceRoot: '/host/lease-b',
      workspaceId: 'workspace-a',
      sessionId: 'session-b',
      requestId: 'request-b',
    })
    await pair.workspace.writeFile('marker.txt', 'a')
    await sibling.workspace.writeFile('marker.txt', 'b')
    expect(await pair.workspace.readFile('marker.txt')).toBe('a')
    expect(await sibling.workspace.readFile('marker.txt')).toBe('b')
    await expectDisposablePairSurfaceLaws(pair)
    expect(client.sandboxes.size).toBe(2)
    expect(client.volumes.size).toBe(0)
    await Promise.all([pair.dispose(), pair.dispose()])
    expect(client.sandboxes.size).toBe(1)
    expect(await sibling.workspace.readFile('marker.txt')).toBe('b')
    await sibling.dispose()
    expect(client.sandboxes.size).toBe(0)
  })

  test('a duplicate request cannot delete an already-published pair', async () => {
    const client = await createMockBlaxelClient()
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    const context = {
      workspaceRoot: '/host/lease-a', workspaceId: 'workspace-a',
      sessionId: 'session-a', requestId: 'request-a',
    }
    const pair = await provider.create(context)
    await expect(provider.create(context)).rejects.toMatchObject({ code: 'BLAXEL_CONFIG_DRIFT' })
    expect(client.sandboxes.size).toBe(1)
    await expectPublishedPairLifecycle({
      provider,
      pair,
      assertUsableAfterProviderClose: async () => {
        await pair.workspace.writeFile('still-owned.txt', 'yes')
        expect(await pair.workspace.readFile('still-owned.txt')).toBe('yes')
      },
      assertTerminalCleanup: async () => {
        expect(client.sandboxes.size).toBe(0)
      },
    })
  })

  test('publishes cleanup ownership before setup failure is reported through readiness', async () => {
    const client = await createMockBlaxelClient()
    const createFresh = client.createFreshSandbox.bind(client)
    client.createFreshSandbox = async (config) => {
      const remote = await createFresh(config)
      remote.process.exec = async () => ({
        command: 'preflight', exitCode: 1, name: 'failed', pid: 'failed',
        status: 'failed', stderr: 'preflight failed', stdout: '', workingDir: '/workspace',
      })
      return remote
    }
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    const pair = await provider.create({
      workspaceRoot: '/host/lease-readiness', workspaceId: 'workspace-a',
      sessionId: 'session-readiness', requestId: 'request-readiness',
    })
    expect(client.sandboxes.size).toBe(1)
    await expect(pair.checkHealth?.()).rejects.toMatchObject({ code: 'BLAXEL_RUNTIME_UNQUALIFIED' })
    await pair.dispose()
    expect(client.sandboxes.size).toBe(0)
  })

  test('attempts remote deletion even when local pair disposal fails', async () => {
    const client = await createMockBlaxelClient()
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    const pair = await provider.create({
      workspaceRoot: '/host/lease-independent', workspaceId: 'workspace-a',
      sessionId: 'session-independent', requestId: 'request-independent',
    })
    await pair.checkHealth?.()
    const sandbox = pair.sandbox as unknown as { dispose(): Promise<void> }
    const originalDispose = sandbox.dispose.bind(sandbox)
    sandbox.dispose = async () => { throw new Error('local dispose failed') }
    await expect(pair.dispose()).rejects.toThrow('Blaxel sandbox cleanup failed')
    expect(client.sandboxes.size).toBe(0)
    sandbox.dispose = originalDispose
    await expect(pair.dispose()).resolves.toBeUndefined()
  })

  test('retries ambiguous deletion and converges when the remote is already absent', async () => {
    const client = await createMockBlaxelClient()
    const deleteSandbox = client.deleteSandbox.bind(client)
    let failDelete = true
    client.deleteSandbox = async (name) => {
      if (failDelete) {
        failDelete = false
        throw Object.assign(new Error('delete acknowledgement lost'), { status: 503 })
      }
      await deleteSandbox(name)
    }
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    const pair = await provider.create({
      workspaceRoot: '/host/lease-delete-retry', workspaceId: 'workspace-a',
      sessionId: 'session-delete-retry', requestId: 'request-delete-retry',
    })
    await pair.checkHealth?.()
    await expect(pair.dispose()).rejects.toThrow('Blaxel sandbox cleanup failed')
    const [name] = client.sandboxes.keys()
    await deleteSandbox(name!)
    await expect(pair.dispose()).resolves.toBeUndefined()
    expect(client.sandboxes.size).toBe(0)
  })

  test('a definitive create rejection has no reconciliation debt', async () => {
    const client = await createMockBlaxelClient()
    client.createFreshSandbox = async () => { throw Object.assign(new Error('invalid request'), { status: 422 }) }
    client.getSandbox = vi.fn(client.getSandbox.bind(client))
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    await expect(provider.create({
      workspaceRoot: '/host/lease-rejected', workspaceId: 'workspace-a',
      sessionId: 'session-rejected', requestId: 'request-rejected',
    })).rejects.toBeTruthy()
    await expect(provider.close!()).resolves.toBeUndefined()
    expect(client.getSandbox).not.toHaveBeenCalled()
  })

  test.each([408, 409, 429, 503, undefined])(
    'retains ambiguous create debt for status %s',
    async (status) => {
      const client = await createMockBlaxelClient()
      client.createFreshSandbox = async () => {
        throw Object.assign(new Error('create outcome unknown'), status === undefined ? {} : { status })
      }
      const provider = createBlaxelSandboxProvider({
        leaseMode: 'disposable', client, region: 'eu-fra-1',
        volume: { enabled: false, sizeMb: 2048 },
      })
      const failure = await provider.create({
        workspaceRoot: '/host/lease-ambiguous', workspaceId: 'workspace-a',
        sessionId: `session-${status}`, requestId: `request-${status}`,
      }).catch((caught: unknown) => caught) as { sandboxProviderCleanupDebt?: { retry(): Promise<void> } }
      expect(failure.sandboxProviderCleanupDebt?.retry).toBeTypeOf('function')
      await expect(provider.close!()).rejects.toBeTruthy()
    },
  )

  test('a correlation mismatch remains debt and never deletes the wrong remote', async () => {
    const client = await createMockBlaxelClient()
    const createFresh = client.createFreshSandbox.bind(client)
    client.createFreshSandbox = async (config) => {
      const remote = await createFresh(config)
      ;(remote as { externalId?: string }).externalId = 'unrelated'
      return remote
    }
    client.deleteSandbox = vi.fn(client.deleteSandbox.bind(client))
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    await expect(provider.create({
      workspaceRoot: '/host/lease-mismatch', workspaceId: 'workspace-a',
      sessionId: 'session-mismatch', requestId: 'request-mismatch',
    })).rejects.toMatchObject({ code: 'BLAXEL_CONFIG_DRIFT' })
    await expect(provider.close!()).rejects.toBeTruthy()
    expect(client.deleteSandbox).not.toHaveBeenCalled()
  })

  const configurationDrifts: Array<[string, (remote: BlaxelRemoteSandbox) => void]> = [
    ['region', (remote) => { Object.assign(remote.spec, { region: 'us-drift-1' }) }],
    ['image', (remote) => { Object.assign(remote.spec.runtime!, { image: 'image:drift' }) }],
    ['memory', (remote) => { Object.assign(remote.spec.runtime!, { memory: 123 }) }],
    ['ttl', (remote) => { Object.assign(remote.spec.runtime!, { ttl: '3h' }) }],
    ['missing lifecycle', (remote) => { Object.assign(remote.spec, { lifecycle: undefined }) }],
    ['additional lifecycle policy', (remote) => {
      remote.spec.lifecycle!.expirationPolicies!.push({ action: 'delete', type: 'ttl-max-age', value: '4h' })
    }],
    ['lifecycle drift', (remote) => { Object.assign(remote.spec.lifecycle!, { terminatedRetention: '2h' }) }],
    ['volumes', (remote) => { Object.assign(remote.spec, { volumes: [{ name: 'unexpected', mountPath: '/workspace' }] }) }],
  ]
  test.each(configurationDrifts)('rejects and cleans disposable %s drift before publication', async (_field, mutate) => {
    const client = await createMockBlaxelClient()
    const createFresh = client.createFreshSandbox.bind(client)
    client.createFreshSandbox = async (config) => {
      const remote = await createFresh(config)
      mutate(remote)
      return remote
    }
    client.deleteSandbox = vi.fn(client.deleteSandbox.bind(client))
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1', image: 'image:v1', memoryMb: 4096, ttl: '2h',
      lifecycle: {
        expirationPolicies: [{ action: 'delete', type: 'ttl-idle', value: '30m' }],
        terminatedRetention: '1h',
      },
      volume: { enabled: false, sizeMb: 2048 },
    })
    await expect(provider.create({
      workspaceRoot: '/host/lease-drift', workspaceId: 'workspace-a',
      sessionId: 'session-drift', requestId: 'request-drift',
    })).rejects.toMatchObject({ code: 'BLAXEL_CONFIG_DRIFT' })
    expect(client.deleteSandbox).toHaveBeenCalledOnce()
    expect(client.sandboxes.size).toBe(0)
  })

  test('retains config-drift cleanup debt when correlated deletion fails', async () => {
    const client = await createMockBlaxelClient()
    const createFresh = client.createFreshSandbox.bind(client)
    const deleteSandbox = client.deleteSandbox.bind(client)
    client.createFreshSandbox = async (config) => {
      const remote = await createFresh(config)
      Object.assign(remote.spec.runtime!, { image: 'image:drift' })
      return remote
    }
    client.deleteSandbox = vi.fn(async () => { throw new Error('delete unavailable') })
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1', image: 'image:v1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    const failure = await provider.create({
      workspaceRoot: '/host/lease-drift-debt', workspaceId: 'workspace-a',
      sessionId: 'session-drift-debt', requestId: 'request-drift-debt',
    }).catch((error: unknown) => error) as { code?: string; sandboxProviderCleanupDebt?: { retry(): Promise<void> } }
    expect(failure.code).toBe('BLAXEL_CONFIG_DRIFT')
    expect(failure.sandboxProviderCleanupDebt?.retry).toBeTypeOf('function')
    client.deleteSandbox = deleteSandbox
    await expect(failure.sandboxProviderCleanupDebt!.retry()).resolves.toBeUndefined()
    expect(client.sandboxes.size).toBe(0)
  })

  test('reconciles an acknowledged create whose response is lost', async () => {
    const client = await createMockBlaxelClient()
    const createFresh = client.createFreshSandbox.bind(client)
    client.createFreshSandbox = async (config) => {
      await createFresh(config)
      throw Object.assign(new Error('response lost'), { status: 503 })
    }
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    await expect(provider.create({
      workspaceRoot: '/host/lease-a', workspaceId: 'workspace-a',
      sessionId: 'session-a', requestId: 'request-a',
    })).rejects.toBeTruthy()
    expect(client.sandboxes.size).toBe(0)
    await provider.close?.()
    expect(client.sandboxes.size).toBe(0)
  })

  test('retains ambiguous create debt through 404 and deletes a late appearance on close retry', async () => {
    const client = await createMockBlaxelClient()
    const createFresh = client.createFreshSandbox.bind(client)
    let pending: Parameters<typeof createFresh>[0] | undefined
    client.createFreshSandbox = async (config) => {
      pending = config
      throw Object.assign(new Error('create acknowledgement lost'), { status: 503 })
    }
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    await expect(provider.create({
      workspaceRoot: '/host/lease-late', workspaceId: 'workspace-a',
      sessionId: 'session-late', requestId: 'request-late',
    })).rejects.toBeTruthy()
    await expect(provider.close!()).rejects.toBeTruthy()
    await createFresh(pending!)
    await expect(provider.close!()).resolves.toBeUndefined()
    expect(client.sandboxes.size).toBe(0)
  })

  test('provider close drains a concurrent create without publishing or leaking', async () => {
    const client = await createMockBlaxelClient()
    const createFresh = client.createFreshSandbox.bind(client)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    client.createFreshSandbox = async (config) => {
      await gate
      return await createFresh(config)
    }
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1',
      volume: { enabled: false, sizeMb: 2048 },
    })
    const creation = provider.create({
      workspaceRoot: '/host/lease-race', workspaceId: 'workspace-a',
      sessionId: 'session-race', requestId: 'request-race',
    })
    const closing = provider.close!()
    release()
    await expect(creation).rejects.toMatchObject({ code: 'BLAXEL_API_ERROR' })
    await expect(closing).resolves.toBeUndefined()
    expect(client.sandboxes.size).toBe(0)
  })

  test('rejects persistence configuration before API effects', async () => {
    const client = await createMockBlaxelClient()
    const provider = createBlaxelSandboxProvider({
      leaseMode: 'disposable', client, region: 'eu-fra-1',
    })
    await expect(provider.create({
      workspaceRoot: '/host/lease-a', workspaceId: 'workspace-a',
      sessionId: 'session-a', requestId: 'request-a',
    })).rejects.toMatchObject({ code: 'CONFIG_INVALID' })
    expect(client.sandboxes.size).toBe(0)
    expect(client.volumes.size).toBe(0)
  })
})
