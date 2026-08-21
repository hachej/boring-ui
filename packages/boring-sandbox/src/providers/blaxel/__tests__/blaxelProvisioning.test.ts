import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SandboxHandleRecord, SandboxHandleStore } from '@hachej/boring-agent/shared'
import { describe, expect, test } from 'vitest'

import { createBlaxelSandboxProvider } from '../createBlaxelSandboxProvider'
import { fingerprintBlaxelHostTree } from '../provisioningAdapter'
import { createMockBlaxelClient } from './mockBlaxelClient'

class MemoryStore implements SandboxHandleStore {
  private readonly records = new Map<string, SandboxHandleRecord>()
  async get(id: string) { return this.records.get(id) ?? null }
  async put(record: SandboxHandleRecord) { this.records.set(record.workspaceId, record) }
  async delete(id: string) { this.records.delete(id) }
  async list() { return [...this.records.values()] }
}

async function template(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'boring-blaxel-template-'))
  await mkdir(join(root, 'nested'))
  await writeFile(join(root, 'nested', 'hello.txt'), 'hello')
  await writeFile(join(root, 'root.txt'), 'root')
  return root
}

describe('Blaxel provisioning', () => {
  test('fingerprints content rather than the host path and rejects symlinks', async () => {
    const root = await template()
    const first = await fingerprintBlaxelHostTree(root)
    await writeFile(join(root, 'nested', 'hello.txt'), 'changed')
    expect(await fingerprintBlaxelHostTree(root)).not.toBe(first)
    await symlink('/etc/passwd', join(root, 'escape'))
    await expect(fingerprintBlaxelHostTree(root)).rejects.toMatchObject({ code: 'RUNTIME_PROVISIONING_FAILED' })
  })

  test('stages the first seed, writes the marker last, and never reseeds a matching durable workspace', async () => {
    const client = await createMockBlaxelClient()
    const store = new MemoryStore()
    const provider = createBlaxelSandboxProvider({ client, handleStore: store, region: 'eu-fra-1' })
    const templatePath = await template()
    const context = { workspaceRoot: '/ignored', workspaceId: 'seeded', sessionId: 'test', templatePath }
    const first = await provider.create(context)
    expect(await first.workspace.readFile('nested/hello.txt')).toBe('hello')
    expect(JSON.parse(await first.workspace.readFile('.boring/provisioning/template.json'))).toMatchObject({ schemaVersion: 1 })
    await first.workspace.writeFile('nested/hello.txt', 'user edit')
    await first.dispose()

    const resumed = await provider.create(context)
    expect(await resumed.workspace.readFile('nested/hello.txt')).toBe('user edit')
    await resumed.dispose()
  })

  test('cleans only owned interrupted staging and fails closed on content drift', async () => {
    const client = await createMockBlaxelClient()
    const store = new MemoryStore()
    const provider = createBlaxelSandboxProvider({ client, handleStore: store, region: 'eu-fra-1' })
    const context = { workspaceRoot: '/ignored', workspaceId: 'interrupted', sessionId: 'test' }
    const empty = await provider.create(context)
    await empty.workspace.mkdir('.boring/provisioning/staging-old', { recursive: true })
    await empty.workspace.writeFile('.boring/provisioning/staging-old/partial', 'partial')
    await empty.dispose()

    const templatePath = await template()
    const seeded = await provider.create({ ...context, templatePath })
    expect(await seeded.workspace.readFile('nested/hello.txt')).toBe('hello')
    await seeded.dispose()

    await writeFile(join(templatePath, 'nested', 'hello.txt'), 'new template')
    await expect(provider.create({ ...context, templatePath })).rejects.toMatchObject({ code: 'BLAXEL_CONFIG_DRIFT' })
  })

  test('resumes an owned transaction after interruption during top-level publication', async () => {
    const client = await createMockBlaxelClient()
    const provider = createBlaxelSandboxProvider({ client, handleStore: new MemoryStore(), region: 'eu-fra-1' })
    const templatePath = await template()
    const context = { workspaceRoot: '/ignored', workspaceId: 'mid-publish', sessionId: 'test', templatePath }
    client.failGuestStagingMoveOn = 2
    await expect(provider.create(context)).rejects.toThrow(/injected staging move failure/)

    const resumed = await provider.create(context)
    expect(await resumed.workspace.readFile('nested/hello.txt')).toBe('hello')
    expect(await resumed.workspace.readFile('root.txt')).toBe('root')
    expect(JSON.parse(await resumed.workspace.readFile('.boring/provisioning/template.json'))).toMatchObject({ schemaVersion: 1 })
    await resumed.dispose()
  })

  test('converges concurrent first seeds across provider instances', async () => {
    const client = await createMockBlaxelClient()
    const store = new MemoryStore()
    const provider = createBlaxelSandboxProvider({ client, handleStore: store, region: 'eu-fra-1' })
    const secondProvider = createBlaxelSandboxProvider({ client, handleStore: store, region: 'eu-fra-1' })
    const templatePath = await template()
    const context = { workspaceRoot: '/ignored', workspaceId: 'concurrent-seed', sessionId: 'test', templatePath }
    const [first, second] = await Promise.all([provider.create(context), secondProvider.create(context)])
    expect(await first.workspace.readFile('root.txt')).toBe('root')
    expect(await second.workspace.readFile('nested/hello.txt')).toBe('hello')
    await first.dispose()
    await second.dispose()
  })

  test('rejects a tampered transaction whose staging path is not a canonical owned child', async () => {
    const client = await createMockBlaxelClient()
    const provider = createBlaxelSandboxProvider({ client, handleStore: new MemoryStore(), region: 'eu-fra-1' })
    const context = { workspaceRoot: '/ignored', workspaceId: 'tampered-transaction', sessionId: 'test' }
    const templatePath = await template()
    const empty = await provider.create(context)
    await empty.workspace.mkdir('.boring/provisioning', { recursive: true })
    await empty.workspace.writeFile('.boring/provisioning/seed-transaction.json', JSON.stringify({
      schemaVersion: 1,
      fingerprint: await fingerprintBlaxelHostTree(templatePath),
      staging: '.boring/provisioning/staging-x/../../cache',
      entries: ['safe'],
    }))
    await empty.dispose()
    await expect(provider.create({ ...context, templatePath })).rejects.toMatchObject({ code: 'BLAXEL_CONFIG_DRIFT' })
  })

  test('cleans an adapter-owned temporary transaction left before atomic publication', async () => {
    const client = await createMockBlaxelClient()
    const provider = createBlaxelSandboxProvider({ client, handleStore: new MemoryStore(), region: 'eu-fra-1' })
    const context = { workspaceRoot: '/ignored', workspaceId: 'transaction-temp', sessionId: 'test' }
    const empty = await provider.create(context)
    await empty.workspace.mkdir('.boring/provisioning', { recursive: true })
    await empty.workspace.writeFile('.boring/provisioning/.seed-transaction-deadbeef.tmp', 'partial')
    await empty.dispose()
    const seeded = await provider.create({ ...context, templatePath: await template() })
    expect(await seeded.workspace.readFile('root.txt')).toBe('root')
    await seeded.dispose()
  })

  test('takes over an expired durable lock and resumes its pending transaction', async () => {
    const client = await createMockBlaxelClient()
    const provider = createBlaxelSandboxProvider({ client, handleStore: new MemoryStore(), region: 'eu-fra-1' })
    const templatePath = await template()
    const fingerprint = await fingerprintBlaxelHostTree(templatePath)
    const context = { workspaceRoot: '/ignored', workspaceId: 'stale-lock-transaction', sessionId: 'test' }
    const empty = await provider.create(context)
    const staging = `.boring/provisioning/staging-${fingerprint.slice(0, 16)}-00000000-0000-4000-8000-000000000001`
    await empty.workspace.mkdir(`${staging}/nested`, { recursive: true })
    await empty.workspace.writeFile(`${staging}/nested/hello.txt`, 'hello')
    await empty.workspace.writeFile(`${staging}/root.txt`, 'root')
    await empty.workspace.writeFile('.boring/provisioning/seed-transaction.json', JSON.stringify({
      schemaVersion: 1, fingerprint, staging, entries: ['nested', 'root.txt'],
    }))
    await empty.workspace.mkdir('.boring/provisioning/seed.lock')
    await empty.workspace.writeFile('.boring/provisioning/seed.lock/lease', '00000000-0000-4000-8000-000000000002\n0\n')
    await empty.dispose()

    const resumed = await provider.create({ ...context, templatePath })
    expect(await resumed.workspace.readFile('nested/hello.txt')).toBe('hello')
    expect(await resumed.workspace.readFile('root.txt')).toBe('root')
    await resumed.dispose()
  })

  test('recovers a leftover expired lock even when the durable marker is already valid', async () => {
    const client = await createMockBlaxelClient()
    const provider = createBlaxelSandboxProvider({ client, handleStore: new MemoryStore(), region: 'eu-fra-1' })
    const templatePath = await template()
    const context = { workspaceRoot: '/ignored', workspaceId: 'stale-lock-marker', sessionId: 'test', templatePath }
    const first = await provider.create(context)
    await first.workspace.mkdir('.boring/provisioning/seed.lock')
    await first.workspace.writeFile('.boring/provisioning/seed.lock/lease', '00000000-0000-4000-8000-000000000003\n0\n')
    await first.dispose()
    const resumed = await provider.create(context)
    expect(await resumed.workspace.readFile('root.txt')).toBe('root')
    await resumed.dispose()
  })

  test('separates provisioning command arguments, reports nonzero exit, and makes rm idempotent', async () => {
    const client = await createMockBlaxelClient()
    const provider = createBlaxelSandboxProvider({ client, handleStore: new MemoryStore(), region: 'eu-fra-1' })
    const pair = await provider.create({ workspaceRoot: '/ignored', workspaceId: 'provisioning-exec', sessionId: 'test' })
    await expect(pair.provisioning?.exec('sh', ['-c', 'exit 7'])).rejects.toMatchObject({ code: 'RUNTIME_PROVISIONING_FAILED' })
    await expect(pair.provisioning?.workspaceFs.rm('missing')).resolves.toBeUndefined()
    await pair.dispose()
  })
})
