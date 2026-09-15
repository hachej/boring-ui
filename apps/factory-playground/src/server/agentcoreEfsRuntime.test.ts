import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FencedSandboxHandleStore, SandboxHandleFence, SandboxHandleKey, SandboxHandleLease } from '@hachej/boring-core/server'
import type { AgentCoreRuntimeClient } from './agentcoreEfsRuntime'
import { createAgentCoreRemoteEfsRuntimeMode } from './agentcoreEfsRuntime'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
class Store implements FencedSandboxHandleStore {
  handle: Uint8Array | null = null
  owner: string | null = null
  generation = 0
  token = ''
  creating = false
  claims = 0
  key?: SandboxHandleKey
  async claim(input: { key: SandboxHandleKey; leaseOwner: string }) {
    this.claims++
    if (this.owner) return null
    if (this.creating) return { status: 'create-ambiguous' as const, key: input.key, generation: this.generation, idempotencyKey: 'create-1', startedAt: new Date(0).toISOString() }
    this.owner = input.leaseOwner; this.key = input.key; this.generation++; this.token = `t${this.generation}`
    return { status: 'claimed' as const, key: input.key, generation: this.generation, leaseOwner: input.leaseOwner, leaseToken: this.token, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), handle: this.handle, handleVersion: this.handle ? 1 : null, cleanup: null } satisfies SandboxHandleLease
  }
  async beginCreate() { this.creating = true; return { status: 'started' as const, idempotencyKey: 'create-1', startedAt: new Date(0).toISOString() } }
  async renew() { return true }
  async update(fence: SandboxHandleFence, handle: Uint8Array) { if (fence.leaseToken !== this.token) return false; this.handle = handle; this.creating = false; return true }
  async release(fence: SandboxHandleFence) { if (fence.leaseToken !== this.token) return false; this.owner = null; return true }
  async delete(fence: SandboxHandleFence) { if (fence.leaseToken !== this.token) return false; this.handle = null; this.creating = false; this.owner = null; return true }
}

function client(hostRoot: string, reportedRoot?: string) {
  let creates = 0; let resumes = 0; let deletes = 0; let aborted = false
  const value: AgentCoreRuntimeClient = {
    async createSession({ runtimeCwd }) { creates++; return { handle: encoder.encode('session-1'), runtimeCwd: reportedRoot ?? runtimeCwd } },
    async resumeSession() { resumes++; return { runtimeCwd: reportedRoot ?? '/runtime/tenant/ws' } },
    async exec({ command, cwd, options }): Promise<import('@hachej/boring-agent/shared').ExecResult> {
      if (command === 'wait') return await new Promise<never>((_, reject) => options?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true }))
      const relative = command.replace(/^cat /, '')
      const content = await readFile(join(hostRoot, relative), 'utf8')
      return { exitCode: 0, stdout: encoder.encode(content), stderr: encoder.encode(''), truncated: false, durationMs: 1 }
    },
    async deleteSession() { deletes++ },
  }
  return { value, stats: () => ({ creates, resumes, deletes, aborted }) }
}

async function fixture(workspace = 'ws') {
  const root = await mkdtemp(join(tmpdir(), 'agentcore-efs-'))
  const hostRoot = join(root, 'tenant', workspace)
  await mkdir(hostRoot, { recursive: true })
  const store = new Store(); const remote = client(hostRoot)
  const adapter = createAgentCoreRemoteEfsRuntimeMode({ hostScope: 'app', tenantId: 'tenant', accessPointRoot: root, runtimeRoot: '/runtime', handleStore: store, agentCore: remote.value, leaseOwner: 'host-1' })
  return { root, hostRoot, store, remote, adapter, context: { workspaceId: workspace, workspaceRoot: hostRoot, sessionId: 's' } }
}

describe('application-owned AgentCore shared-EFS mode', () => {
  it('sees the same file through local Workspace and fake remote exec, then resumes after restart', async () => {
    const f = await fixture(); await writeFile(join(f.hostRoot, 'proof'), 'same-digest')
    const first = await f.adapter.create(f.context)
    expect(first.workspace.root).toBe('/runtime/tenant/ws')
    expect(await first.workspace.readFile('proof')).toBe('same-digest')
    expect(decoder.decode((await first.sandbox.exec('cat proof')).stdout)).toBe('same-digest')
    await first.disposeRuntime?.()
    const second = await f.adapter.create(f.context)
    expect(f.remote.stats()).toMatchObject({ creates: 1, resumes: 1 })
    await second.disposeRuntime?.(); await rm(f.root, { recursive: true })
  })

  it('fails closed and cleans up a created session on path mismatch', async () => {
    const f = await fixture(); const wrong = client(f.hostRoot, '/wrong')
    const adapter = createAgentCoreRemoteEfsRuntimeMode({ hostScope: 'app', tenantId: 'tenant', accessPointRoot: f.root, runtimeRoot: '/runtime', handleStore: f.store, agentCore: wrong.value, leaseOwner: 'host-1' })
    await expect(adapter.create(f.context)).rejects.toThrow('does not match')
    expect(wrong.stats().deletes).toBe(1); expect(f.store.handle).toBeNull()
    await rm(f.root, { recursive: true })
  })

  it('isolates provider/mode/workspace keys and rejects concurrent ownership', async () => {
    const f = await fixture(); const first = await f.adapter.create(f.context)
    await expect(f.adapter.create(f.context)).rejects.toThrow('owned by another runtime')
    expect(f.store.key).toEqual({ hostScope: 'app', workspaceId: 'ws', provider: 'aws-agentcore', mode: 'factory:agentcore-remote-efs' })
    const isolated = createAgentCoreRemoteEfsRuntimeMode({ hostScope: 'app', tenantId: 'tenant', accessPointRoot: f.root, runtimeRoot: '/runtime', handleStore: f.store, agentCore: f.remote.value, leaseOwner: 'x' })
    await expect(isolated.create({ ...f.context, workspaceId: 'other', workspaceRoot: join(f.root, 'tenant', 'other') })).rejects.toThrow('owned by another runtime')
    await first.disposeRuntime?.(); await rm(f.root, { recursive: true })
  })

  it('aborts in-flight remote execution when the atomic pair is disposed', async () => {
    const f = await fixture(); const pair = await f.adapter.create(f.context)
    const pending = pair.sandbox.exec('wait'); await pair.disposeRuntime?.()
    await expect(pending).rejects.toThrow('aborted'); expect(f.remote.stats().aborted).toBe(true)
    await rm(f.root, { recursive: true })
  })
})
