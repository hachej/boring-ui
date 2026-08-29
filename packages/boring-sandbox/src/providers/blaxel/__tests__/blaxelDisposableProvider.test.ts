import { describe, expect, test } from 'vitest'

import { expectDisposableProviderProfile } from '../../__tests__/conformance/disposableProvider'
import { createBlaxelSandboxProvider } from '../createBlaxelSandboxProvider'
import { createMockBlaxelClient } from './mockBlaxelClient'

describe('disposable Blaxel provider', () => {
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
    expect(client.sandboxes.size).toBe(2)
    expect(client.volumes.size).toBe(0)
    await Promise.all([pair.dispose(), pair.dispose()])
    expect(client.sandboxes.size).toBe(1)
    expect(await sibling.workspace.readFile('marker.txt')).toBe('b')
    await sibling.dispose()
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
    expect(client.sandboxes.size).toBe(1)
    await provider.close?.()
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
