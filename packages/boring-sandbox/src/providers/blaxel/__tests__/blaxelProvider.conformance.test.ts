import { afterEach, describe, expect, test, vi } from 'vitest'

import type { SandboxHandleRecord, SandboxHandleStore } from '@hachej/boring-agent/shared'
import { providerPairConformance } from '../../__tests__/conformance/providerPair'
import { sandboxConformance } from '../../__tests__/conformance/sandbox'
import { workspaceConformance } from '../../__tests__/conformance/workspace'
import { createBlaxelSandboxProvider } from '../createBlaxelSandboxProvider'
import { resolveBlaxelConfig } from '../config'
import { capUtf8Outputs } from '../runtimeHelpers'
import { createMockBlaxelClient } from './mockBlaxelClient'

class MemoryStore implements SandboxHandleStore {
  private readonly records = new Map<string, SandboxHandleRecord>()
  async get(id: string) { return this.records.get(id) ?? null }
  async put(record: SandboxHandleRecord) { this.records.set(record.workspaceId, record) }
  async delete(id: string) { this.records.delete(id) }
  async list() { return [...this.records.values()] }
}

afterEach(() => vi.unstubAllEnvs())

async function harness() {
  const client = await createMockBlaxelClient()
  const provider = createBlaxelSandboxProvider({
    client,
    handleStore: new MemoryStore(),
    region: 'eu-fra-1',
  })
  const context = { workspaceRoot: '/host/ignored', workspaceId: `ws-${Math.random()}`, sessionId: 'session' }
  const pair = await provider.create(context)
  return { client, provider, context, pair }
}

workspaceConformance('blaxel-workspace', async () => {
  const value = await harness()
  return { workspace: value.pair.workspace, cleanup: value.pair.dispose }
})

sandboxConformance('blaxel-sandbox', async () => {
  const value = await harness()
  return { workspace: value.pair.workspace, sandbox: value.pair.sandbox, cleanup: value.pair.dispose }
})

providerPairConformance('blaxel-provider', async () => {
  const client = await createMockBlaxelClient()
  return {
    provider: createBlaxelSandboxProvider({ client, handleStore: new MemoryStore(), region: 'eu-fra-1' }),
    context: { workspaceRoot: '/host/ignored', workspaceId: `ws-${Math.random()}`, sessionId: 'session' },
  }
}, { expectProvisioning: true })

describe('Blaxel adapter policies', () => {
  test('fails with a stable auth error when built-in credentials are missing', async () => {
    vi.stubEnv('BL_WORKSPACE', '')
    vi.stubEnv('BL_API_KEY', '')
    const provider = createBlaxelSandboxProvider({ region: 'eu-fra-1', handleStore: new MemoryStore() })
    await expect(provider.create({ workspaceRoot: '/ignored', workspaceId: 'missing-creds', sessionId: 'test' }))
      .rejects.toMatchObject({ code: 'BLAXEL_AUTH_FAILED' })
  })

  test('requires an explicit EU region', () => {
    expect(() => resolveBlaxelConfig({ region: 'us-pdx-1' }, {})).toThrow(/EU region/)
    expect(resolveBlaxelConfig({ region: 'eu-lon-1' }, {}).region).toBe('eu-lon-1')
  })

  test('caps terminal UTF-8 output locally with stdout-first allocation', () => {
    const result = capUtf8Outputs('éé', 'stderr', 5)
    expect(result.stdout.byteLength).toBe(4)
    expect(result.stderr.byteLength).toBe(1)
    expect(result.truncated).toBe(true)
  })

  test('preserves terminal output exactly and applies one stdout-first byte budget without lossy callbacks', async () => {
    const value = await harness()
    const stdoutChunks: Uint8Array[] = []
    const stderrChunks: Uint8Array[] = []
    const exact = await value.pair.sandbox.exec("printf 'a\\n\\nb'; printf 'éz' >&2", {
      maxOutputBytes: 6,
      onStdout: (chunk) => stdoutChunks.push(chunk),
      onStderr: (chunk) => stderrChunks.push(chunk),
    })
    expect(new TextDecoder().decode(exact.stdout)).toBe('a\n\nb')
    expect(exact.stderr.byteLength).toBe(2)
    expect(exact.truncated).toBe(true)
    expect(stdoutChunks).toEqual([])
    expect(stderrChunks).toEqual([])
    expect(value.client.kills).toEqual([])
    await value.pair.dispose()
  })

  test('passes cwd and environment, kills on timeout, and preserves the exact abort reason', async () => {
    const value = await harness()
    await value.pair.workspace.mkdir('cwd')
    const cwdEnv = await value.pair.sandbox.exec("printf '%s|%s' \"$PWD\" \"$VALUE\"", {
      cwd: '/workspace/cwd',
      env: { VALUE: 'ok' },
    })
    expect(new TextDecoder().decode(cwdEnv.stdout)).toBe('/workspace/cwd|ok')
    await expect(value.pair.sandbox.exec('sleep 5', { timeoutMs: 25 })).resolves.toMatchObject({ exitCode: 124 })
    expect(value.client.kills.length).toBeGreaterThan(0)

    const controller = new AbortController()
    const reason = new Error('exact-abort-reason')
    const running = value.pair.sandbox.exec('sleep 5', { signal: controller.signal })
    controller.abort(reason)
    await expect(running).rejects.toBe(reason)
    await value.pair.dispose()
  })

  test('dispose does not delete durable provider resources', async () => {
    const value = await harness()
    const names = [...value.client.sandboxes.keys()]
    await value.pair.dispose()
    expect([...value.client.sandboxes.keys()]).toEqual(names)
  })
})
