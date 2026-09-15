import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PostgresFencedSandboxHandleStore,
  createDatabase,
  createSandboxHandleCipher,
  runMigrations,
} from '@hachej/boring-core/server/db'
import type {
  FencedSandboxHandleStore,
  SandboxCleanupOutcome,
  SandboxHandleFence,
  SandboxHandleKey,
  SandboxHandleLease,
} from '@hachej/boring-core/server'
import { providerPairConformance } from '@hachej/boring-sandbox/test/provider-pair-conformance'
import type { AgentCoreDeleteResult, AgentCoreRuntimeClient } from './agentcoreEfsRuntime'
import {
  createAgentCoreRemoteEfsProvider,
  createAgentCoreRemoteEfsRuntimeMode,
  createEcsLocalEfsProvider,
  createEcsLocalEfsRuntimeMode,
} from './agentcoreEfsRuntime'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const roots: string[] = []
const keyOf = (key: SandboxHandleKey) => JSON.stringify([key.hostScope, key.workspaceId, key.provider, key.mode])

interface Row {
  key: SandboxHandleKey
  handle: Uint8Array | null
  owner: string | null
  generation: number
  token: string
  expiresAt: number
  creating: boolean
  handleState: 'pending-validation' | 'published' | null
  cleanup: SandboxCleanupOutcome | null
}

class Store implements FencedSandboxHandleStore {
  readonly rows = new Map<string, Row>()
  claims = 0
  renewCalls = 0
  concurrentRenews = 0
  maxConcurrentRenews = 0
  releases = 0
  failUpdate = false
  failReleaseOnce = false
  renewResult = true
  renewGate?: Promise<void>

  row(key: SandboxHandleKey): Row {
    const id = keyOf(key)
    let row = this.rows.get(id)
    if (!row) {
      row = { key, handle: null, owner: null, generation: 0, token: '', expiresAt: 0, creating: false, handleState: null, cleanup: null }
      this.rows.set(id, row)
    }
    return row
  }

  async claim(input: { key: SandboxHandleKey; leaseOwner: string; leaseForMs: number }) {
    this.claims++
    const row = this.row(input.key)
    if (row.owner && row.expiresAt > Date.now()) return null
    if (row.creating) {
      return { status: 'create-ambiguous' as const, key: input.key, generation: row.generation, idempotencyKey: 'create-1', startedAt: new Date(0).toISOString() }
    }
    row.owner = input.leaseOwner
    row.generation++
    row.token = `t${row.generation}`
    row.expiresAt = Date.now() + input.leaseForMs
    return {
      status: 'claimed' as const,
      key: input.key,
      generation: row.generation,
      leaseOwner: input.leaseOwner,
      leaseToken: row.token,
      leaseExpiresAt: new Date(row.expiresAt).toISOString(),
      handle: row.handle,
      handleVersion: row.handle ? 1 : null,
      handleState: row.handleState,
      cleanup: row.cleanup,
    } satisfies SandboxHandleLease
  }

  async beginCreate(fence: SandboxHandleFence) {
    const row = this.row(fence.key)
    if (row.token !== fence.leaseToken) return null
    row.creating = true
    return { status: 'started' as const, idempotencyKey: 'create-1', startedAt: new Date(0).toISOString() }
  }

  async renew(fence: SandboxHandleFence, leaseForMs: number) {
    this.renewCalls++
    this.concurrentRenews++
    this.maxConcurrentRenews = Math.max(this.maxConcurrentRenews, this.concurrentRenews)
    try {
      await this.renewGate
      const current = this.row(fence.key)
      if (!this.renewResult && current.token === fence.leaseToken) current.token = 'lost-fence'
      if (current.token !== fence.leaseToken || !this.renewResult || current.expiresAt <= Date.now()) return null
      current.expiresAt = Date.now() + leaseForMs
      return new Date(current.expiresAt).toISOString()
    } finally {
      this.concurrentRenews--
    }
  }

  async update(fence: SandboxHandleFence, handle: Uint8Array) {
    const row = this.row(fence.key)
    if (this.failUpdate || row.token !== fence.leaseToken) return false
    row.handle = handle
    row.handleState = 'pending-validation'
    row.creating = false
    return true
  }

  async publish(fence: SandboxHandleFence) {
    const row = this.row(fence.key)
    if (row.token !== fence.leaseToken || row.expiresAt <= Date.now() || row.handleState !== 'pending-validation') return false
    row.handleState = 'published'
    return true
  }

  async release(fence: SandboxHandleFence) {
    this.releases++
    if (this.failReleaseOnce) {
      this.failReleaseOnce = false
      throw new Error('release failed')
    }
    const row = this.row(fence.key)
    if (row.token !== fence.leaseToken || row.expiresAt <= Date.now()) return false
    row.owner = null
    return true
  }

  async delete(fence: SandboxHandleFence, cleanup: SandboxCleanupOutcome) {
    const row = this.row(fence.key)
    if (row.token !== fence.leaseToken || row.expiresAt <= Date.now()) return false
    row.cleanup = cleanup
    if (cleanup.outcome !== 'succeeded') return false
    row.handle = null
    row.handleState = null
    row.creating = false
    row.owner = null
    return true
  }
}

function client(hostRoots: Map<string, string>, options: {
  reportedRoot?: string
  deleteResult?: AgentCoreDeleteResult
  deleteError?: Error
} = {}) {
  let creates = 0
  let resumes = 0
  let deletes = 0
  let execs = 0
  let aborted = false
  const handles = new Map<string, string>()
  const value: AgentCoreRuntimeClient = {
    async createSession({ runtimeCwd, signal }) {
      if (signal.aborted) throw signal.reason
      creates++
      const handle = encoder.encode(`session-${creates}`)
      handles.set(decoder.decode(handle), runtimeCwd)
      return { handle, runtimeCwd: options.reportedRoot ?? runtimeCwd }
    },
    async resumeSession({ handle, signal }) {
      if (signal.aborted) throw signal.reason
      resumes++
      return { runtimeCwd: options.reportedRoot ?? handles.get(decoder.decode(handle)) ?? '/runtime/tenant/ws' }
    },
    async exec({ command, cwd, options: execOptions }) {
      execs++
      if (execOptions?.signal?.aborted) throw execOptions.signal.reason
      if (command === 'wait') {
        return await new Promise<never>((_, reject) => execOptions?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(execOptions.signal?.reason ?? new Error('aborted'))
        }, { once: true }))
      }
      const root = [...hostRoots.entries()].find(([runtimeRoot]) => cwd === runtimeRoot || cwd.startsWith(`${runtimeRoot}/`))?.[1]
      if (!root) throw new Error(`no host root for ${cwd}`)
      const relative = command.replace(/^sha256sum /, '').replace(/^cat /, '')
      const content = await readFile(join(root, relative))
      const stdout = command.startsWith('sha256sum ')
        ? encoder.encode(`${createHash('sha256').update(content).digest('hex')}  ${relative}\n`)
        : content
      return { exitCode: 0, stdout, stderr: encoder.encode(''), truncated: false, durationMs: 1 }
    },
    async deleteSession() {
      deletes++
      if (options.deleteError) throw options.deleteError
      return options.deleteResult
    },
  }
  return { value, stats: () => ({ creates, resumes, deletes, execs, aborted }) }
}

async function fixture(workspace = 'ws', overrides: {
  runtimeRoot?: string
  store?: Store
  remote?: ReturnType<typeof client>
  leaseForMs?: number
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'agentcore-efs-'))
  roots.push(root)
  const hostRoot = join(root, 'tenant', workspace)
  await mkdir(hostRoot, { recursive: true })
  const runtimeRoot = `${overrides.runtimeRoot ?? '/runtime'}/tenant/${workspace}`
  const store = overrides.store ?? new Store()
  const remote = overrides.remote ?? client(new Map([[runtimeRoot, hostRoot]]))
  const adapter = createAgentCoreRemoteEfsRuntimeMode({
    hostScope: 'app', tenantId: 'tenant', accessPointRoot: root,
    runtimeRoot: overrides.runtimeRoot ?? '/runtime', handleStore: store,
    agentCore: remote.value, leaseOwner: 'host-1', leaseForMs: overrides.leaseForMs,
  })
  return { root, hostRoot, runtimeRoot, store, remote, adapter, context: { workspaceId: workspace, workspaceRoot: hostRoot, sessionId: 's' } }
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

providerPairConformance('factory:ecs-local-efs wrapper', async () => {
  const f = await fixture()
  return {
    provider: createEcsLocalEfsProvider({
      hostScope: 'app', tenantId: 'tenant', accessPointRoot: f.root, runtimeRoot: '/runtime',
    }),
    context: f.context,
  }
})

providerPairConformance('factory:agentcore-remote-efs wrapper', async () => {
  const f = await fixture()
  return {
    provider: createAgentCoreRemoteEfsProvider({
      hostScope: 'app', tenantId: 'tenant', accessPointRoot: f.root, runtimeRoot: '/runtime',
      handleStore: f.store, agentCore: f.remote.value, leaseOwner: 'host-1',
    }),
    context: f.context,
  }
})

describe('application-owned shared-EFS runtime modes', () => {
  it('has local and remote conformance over one EFS namespace with a shared SHA-256', async () => {
    const f = await fixture()
    const bytes = randomBytes(64)
    await writeFile(join(f.hostRoot, 'proof'), bytes)
    const expected = createHash('sha256').update(bytes).digest('hex')

    const local = createEcsLocalEfsRuntimeMode({
      hostScope: 'app', tenantId: 'tenant', accessPointRoot: f.root, runtimeRoot: '/runtime',
    })
    const localPair = await local.create(f.context)
    expect(createHash('sha256').update(await localPair.workspace.readBinaryFile!('proof')).digest('hex')).toBe(expected)
    expect(decoder.decode((await localPair.sandbox.exec('sha256sum proof')).stdout)).toContain(expected)
    await localPair.disposeRuntime?.()

    const remotePair = await f.adapter.create(f.context)
    expect(remotePair.workspace.root).toBe(f.runtimeRoot)
    expect(createHash('sha256').update(await remotePair.workspace.readBinaryFile!('proof')).digest('hex')).toBe(expected)
    expect(decoder.decode((await remotePair.sandbox.exec('sha256sum proof')).stdout)).toContain(expected)
    await remotePair.disposeRuntime?.()
    expect(f.remote.stats().deletes).toBe(0)
    await expect(lstat(f.hostRoot)).resolves.toBeDefined()
  })

  it.each(['/runtime/', '/runtime//root', '/runtime/./root', '/runtime/../runtime'])('rejects noncanonical remote root %s before acquisition', async (runtimeRoot) => {
    const f = await fixture('ws', { runtimeRoot })
    await expect(f.adapter.create(f.context)).rejects.toThrow(/canonical POSIX/)
    expect(f.store.claims).toBe(0)
  })

  it.each([
    '/runtime/tenant/ws/../other',
    '/runtime/tenant/ws//nested',
    '/runtime/tenant/ws/./nested',
    '/runtime/tenant/other',
    'relative',
  ])('rejects noncanonical or escaping exec cwd %s without calling the client', async (cwd) => {
    const f = await fixture()
    const pair = await f.adapter.create(f.context)
    await expect(pair.sandbox.exec('cat proof', { cwd })).rejects.toThrow(/canonical POSIX|escaped/)
    expect(f.remote.stats().execs).toBe(0)
    await pair.disposeRuntime?.()
  })

  it('rejects an already-aborted exec before calling the client', async () => {
    const f = await fixture()
    const pair = await f.adapter.create(f.context)
    const controller = new AbortController()
    controller.abort(new Error('caller aborted'))
    await expect(pair.sandbox.exec('cat proof', { signal: controller.signal })).rejects.toThrow('caller aborted')
    expect(f.remote.stats().execs).toBe(0)
    await pair.disposeRuntime?.()
  })

  it('preflights every EFS namespace component and rejects symlinks before remote acquisition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentcore-efs-link-'))
    roots.push(root)
    const target = join(root, 'target')
    await mkdir(join(target, 'ws'), { recursive: true })
    await symlink(target, join(root, 'tenant'))
    const store = new Store()
    const remote = client(new Map())
    const adapter = createAgentCoreRemoteEfsRuntimeMode({
      hostScope: 'app', tenantId: 'tenant', accessPointRoot: root, runtimeRoot: '/runtime',
      handleStore: store, agentCore: remote.value, leaseOwner: 'host-1',
    })
    await expect(adapter.create({ workspaceId: 'ws', workspaceRoot: join(root, 'tenant', 'ws'), sessionId: 's' }))
      .rejects.toThrow(/symlink/)
    expect(store.claims).toBe(0)
  })

  it('resumes after reconstructed adapter/client state and renews the fence before publishing', async () => {
    const f = await fixture()
    const first = await f.adapter.create(f.context)
    await first.disposeRuntime?.()
    let releaseRenew!: () => void
    f.store.renewGate = new Promise<void>((resolve) => { releaseRenew = resolve })
    const restartedClient = client(new Map([[f.runtimeRoot, f.hostRoot]]))
    // A reconstructed authenticated client can resume the opaque durable handle.
    restartedClient.value.resumeSession = f.remote.value.resumeSession
    const restarted = createAgentCoreRemoteEfsRuntimeMode({
      hostScope: 'app', tenantId: 'tenant', accessPointRoot: f.root, runtimeRoot: '/runtime',
      handleStore: f.store, agentCore: restartedClient.value, leaseOwner: 'host-2',
    })
    const creating = restarted.create(f.context)
    await vi.waitFor(() => expect(f.store.renewCalls).toBeGreaterThan(0))
    let published = false
    void creating.then(() => { published = true })
    await Promise.resolve()
    expect(published).toBe(false)
    releaseRenew()
    const second = await creating
    await second.disposeRuntime?.()
  })

  it('uses a serialized renewal loop and fence loss aborts and blocks execution', async () => {
    const f = await fixture('ws', { leaseForMs: 30 })
    const pair = await f.adapter.create(f.context)
    f.store.renewResult = false
    await vi.waitFor(() => expect(f.store.renewCalls).toBeGreaterThan(1))
    await expect(pair.sandbox.exec('cat proof')).rejects.toThrow(/fence was lost/)
    expect(f.remote.stats().execs).toBe(0)
    expect(f.store.maxConcurrentRenews).toBe(1)
    await expect(pair.disposeRuntime?.()).rejects.toThrow(/fence/)
  })

  it('hard-stops at the confirmed deadline while a serialized renewal is stalled', async () => {
    const f = await fixture('ws', { leaseForMs: 60 })
    const pair = await f.adapter.create(f.context)
    let releaseRenew!: () => void
    f.store.renewGate = new Promise<void>((resolve) => { releaseRenew = resolve })

    const execution = pair.sandbox.exec('cat proof')
    await vi.waitFor(() => expect(f.store.concurrentRenews).toBe(1))
    await expect(execution).rejects.toThrow(/fence was lost/)
    expect(f.remote.stats().execs).toBe(0)

    releaseRenew()
    await expect(pair.disposeRuntime?.()).rejects.toThrow(/fence/)
  })

  it('drains an in-flight execution before release and refuses calls once disposal starts', async () => {
    const f = await fixture()
    const pair = await f.adapter.create(f.context)
    const pending = pair.sandbox.exec('wait')
    await vi.waitFor(() => expect(f.remote.stats().execs).toBe(1))
    const disposing = pair.disposeRuntime!()
    await expect(pair.sandbox.exec('cat proof')).rejects.toThrow(/not active|disposing/)
    await expect(pending).rejects.toThrow()
    await disposing
    expect(f.remote.stats().aborted).toBe(true)
    expect(f.store.releases).toBe(1)
  })

  it('shares concurrent disposal and leaves a failed disposal retryable', async () => {
    const store = new Store()
    store.failReleaseOnce = true
    const f = await fixture('ws', { store })
    const pair = await f.adapter.create(f.context)
    const first = pair.disposeRuntime!()
    const concurrent = pair.disposeRuntime!()
    await expect(first).rejects.toThrow('release failed')
    await expect(concurrent).rejects.toThrow('release failed')
    expect(store.releases).toBe(1)
    await expect(pair.disposeRuntime!()).resolves.toBeUndefined()
    expect(store.releases).toBe(2)
  })

  it('never resumes pending state and an expired slow delete cannot delete a successor-published session', async () => {
    const store = new Store()
    const root = await mkdtemp(join(tmpdir(), 'agentcore-delete-race-'))
    roots.push(root)
    const hostRoot = join(root, 'tenant', 'ws')
    await mkdir(hostRoot, { recursive: true })
    const sessions = new Map<string, string>()
    const deletedHandles: string[] = []
    let creates = 0
    let resumes = 0
    let deletes = 0
    let releaseFirstDelete!: () => void
    const firstDeleteGate = new Promise<void>((resolve) => { releaseFirstDelete = resolve })
    const remote: AgentCoreRuntimeClient = {
      async createSession({ runtimeCwd }) {
        creates++
        const id = `delete-race-session-${creates}`
        sessions.set(id, runtimeCwd)
        return {
          handle: encoder.encode(id),
          runtimeCwd: creates === 1 ? `${runtimeCwd}/invalid` : runtimeCwd,
        }
      },
      async resumeSession() {
        resumes++
        throw new Error('pending handles must never be resumed')
      },
      async exec({ handle }) {
        if (!sessions.has(decoder.decode(handle))) throw new Error('session was deleted')
        return { exitCode: 0, stdout: encoder.encode('ok'), stderr: encoder.encode(''), truncated: false, durationMs: 1 }
      },
      async deleteSession({ handle }) {
        deletes++
        const id = decoder.decode(handle)
        if (deletes === 1) await firstDeleteGate
        sessions.delete(id)
        deletedHandles.push(id)
      },
    }
    const options = {
      hostScope: 'app', tenantId: 'tenant', accessPointRoot: root, runtimeRoot: '/runtime',
      handleStore: store, agentCore: remote, leaseForMs: 90,
    }
    const context = { workspaceId: 'ws', workspaceRoot: hostRoot, sessionId: 's' }
    const predecessor = createAgentCoreRemoteEfsRuntimeMode({ ...options, leaseOwner: 'predecessor' })
    await expect(predecessor.create(context)).rejects.toThrow(/cleanup ambiguous/)

    const successor = createAgentCoreRemoteEfsRuntimeMode({ ...options, leaseOwner: 'successor' })
    await expect(successor.create(context)).rejects.toThrow(/pending session was resolved/)
    const published = await successor.create(context)
    expect({ creates, resumes, deletes }).toEqual({ creates: 2, resumes: 0, deletes: 2 })

    releaseFirstDelete()
    await vi.waitFor(() => expect(deletedHandles).toContain('delete-race-session-1'))
    await expect(published.sandbox.exec('still-alive')).resolves.toMatchObject({ exitCode: 0 })
    expect(sessions.has('delete-race-session-2')).toBe(true)
    await published.disposeRuntime?.()
  })

  it.each([
    [{ outcome: 'failed', detail: 'provider rejected delete' } satisfies AgentCoreDeleteResult, 'failed'],
    [{ outcome: 'ambiguous', detail: 'provider timed out' } satisfies AgentCoreDeleteResult, 'ambiguous'],
  ] as const)('records %s unpublished-session cleanup as durable retryable debt', async (deleteResult, outcome) => {
    const f = await fixture()
    const failing = client(new Map([[f.runtimeRoot, f.hostRoot]]), { reportedRoot: '/wrong', deleteResult })
    const adapter = createAgentCoreRemoteEfsRuntimeMode({
      hostScope: 'app', tenantId: 'tenant', accessPointRoot: f.root, runtimeRoot: '/runtime',
      handleStore: f.store, agentCore: failing.value, leaseOwner: 'host-1',
    })
    await expect(adapter.create(f.context)).rejects.toThrow(/cleanup/)
    const row = [...f.store.rows.values()][0]!
    expect(row.cleanup?.outcome).toBe(outcome)
    expect(row.handle).not.toBeNull()
    expect(row.owner).toBeNull()
  })

  it('retries durable cleanup debt without resuming it as a normal session', async () => {
    const f = await fixture()
    const failing = client(new Map([[f.runtimeRoot, f.hostRoot]]), {
      reportedRoot: '/wrong',
      deleteResult: { outcome: 'failed', detail: 'retry me' },
    })
    const firstAdapter = createAgentCoreRemoteEfsRuntimeMode({
      hostScope: 'app', tenantId: 'tenant', accessPointRoot: f.root, runtimeRoot: '/runtime',
      handleStore: f.store, agentCore: failing.value, leaseOwner: 'host-1',
    })
    await expect(firstAdapter.create(f.context)).rejects.toThrow(/cleanup failed/)

    const retrying = client(new Map([[f.runtimeRoot, f.hostRoot]]))
    const retryAdapter = createAgentCoreRemoteEfsRuntimeMode({
      hostScope: 'app', tenantId: 'tenant', accessPointRoot: f.root, runtimeRoot: '/runtime',
      handleStore: f.store, agentCore: retrying.value, leaseOwner: 'host-2',
    })
    await expect(retryAdapter.create(f.context)).rejects.toThrow(/cleanup debt was resolved/)
    expect(retrying.stats()).toMatchObject({ deletes: 1, resumes: 0, creates: 0 })
    const recreated = await retryAdapter.create(f.context)
    expect(retrying.stats().creates).toBe(1)
    await recreated.disposeRuntime?.()
  })

  it('centrally deletes and tombstones a newly created session after path failure', async () => {
    const f = await fixture()
    const wrong = client(new Map([[f.runtimeRoot, f.hostRoot]]), { reportedRoot: `${f.runtimeRoot}/wrong` })
    const adapter = createAgentCoreRemoteEfsRuntimeMode({
      hostScope: 'app', tenantId: 'tenant', accessPointRoot: f.root, runtimeRoot: '/runtime',
      handleStore: f.store, agentCore: wrong.value, leaseOwner: 'host-1',
    })
    await expect(adapter.create(f.context)).rejects.toThrow('does not match')
    expect(wrong.stats().deletes).toBe(1)
    const row = [...f.store.rows.values()][0]!
    expect(row.cleanup?.outcome).toBe('succeeded')
    expect(row.handle).toBeNull()
  })

  it('does not delete a persisted normal session when resumed metadata is invalid', async () => {
    const f = await fixture()
    const first = await f.adapter.create(f.context)
    await first.disposeRuntime?.()
    const wrong = client(new Map([[f.runtimeRoot, f.hostRoot]]), { reportedRoot: `${f.runtimeRoot}/wrong` })
    const adapter = createAgentCoreRemoteEfsRuntimeMode({
      hostScope: 'app', tenantId: 'tenant', accessPointRoot: f.root, runtimeRoot: '/runtime',
      handleStore: f.store, agentCore: wrong.value, leaseOwner: 'host-2',
    })
    await expect(adapter.create(f.context)).rejects.toThrow(/does not match/)
    expect(wrong.stats().deletes).toBe(0)
    expect([...f.store.rows.values()][0]!.handle).not.toBeNull()
  })

  it('does not delete without a durable pending handle when persistence loses its fence', async () => {
    const store = new Store()
    store.failUpdate = true
    const f = await fixture('ws', { store })
    await expect(f.adapter.create(f.context)).rejects.toThrow(/fence/)
    expect(f.remote.stats().deletes).toBe(0)
    expect([...store.rows.values()][0]!.creating).toBe(true)
  })

  it('reconstructs the real Postgres store, adapter, and client across a host restart', async () => {
    const databaseUrl = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
    await runMigrations({ databaseUrl } as never)
    const root = await mkdtemp(join(tmpdir(), 'agentcore-postgres-efs-'))
    roots.push(root)
    const hostRoot = join(root, 'tenant', 'postgres-ws')
    await mkdir(hostRoot, { recursive: true })
    const hostScope = `agentcore-adapter-${process.pid}-${crypto.randomUUID()}`
    const cipher = createSandboxHandleCipher(randomBytes(32))
    const sessions = new Map<string, string>()
    const stats = { creates: 0, resumes: 0 }
    const newClient = (): AgentCoreRuntimeClient => ({
      async createSession({ runtimeCwd }) {
        stats.creates++
        const handle = encoder.encode(`postgres-session-${stats.creates}`)
        sessions.set(decoder.decode(handle), runtimeCwd)
        return { handle, runtimeCwd }
      },
      async resumeSession({ handle }) {
        stats.resumes++
        return { runtimeCwd: sessions.get(decoder.decode(handle))! }
      },
      async exec() {
        return { exitCode: 0, stdout: encoder.encode(''), stderr: encoder.encode(''), truncated: false, durationMs: 1 }
      },
      async deleteSession() {},
    })
    const context = { workspaceId: 'postgres-ws', workspaceRoot: hostRoot, sessionId: 'session' }
    const connectionA = createDatabase({ databaseUrl } as never)
    try {
      const adapterA = createAgentCoreRemoteEfsRuntimeMode({
        hostScope, tenantId: 'tenant', accessPointRoot: root, runtimeRoot: '/runtime',
        handleStore: new PostgresFencedSandboxHandleStore(connectionA.db, cipher),
        agentCore: newClient(), leaseOwner: 'process-a',
      })
      const first = await adapterA.create(context)
      await first.disposeRuntime?.()
    } finally {
      await connectionA.sql.end()
    }

    const connectionB = createDatabase({ databaseUrl } as never)
    try {
      const adapterB = createAgentCoreRemoteEfsRuntimeMode({
        hostScope, tenantId: 'tenant', accessPointRoot: root, runtimeRoot: '/runtime',
        handleStore: new PostgresFencedSandboxHandleStore(connectionB.db, cipher),
        agentCore: newClient(), leaseOwner: 'process-b',
      })
      const resumed = await adapterB.create(context)
      expect(stats).toEqual({ creates: 1, resumes: 1 })
      await resumed.disposeRuntime?.()
    } finally {
      await connectionB.sql`DELETE FROM fenced_sandbox_handles WHERE host_scope = ${hostScope}`
      await connectionB.sql.end()
    }
  })

  it('blocks a stale exec after a delayed renewal and real Postgres takeover', async () => {
    const databaseUrl = process.env.DATABASE_URL ?? 'postgres://ubuntu:test@localhost/boring_ui_test'
    await runMigrations({ databaseUrl } as never)
    const root = await mkdtemp(join(tmpdir(), 'agentcore-postgres-takeover-'))
    roots.push(root)
    const hostRoot = join(root, 'tenant', 'takeover-ws')
    await mkdir(hostRoot, { recursive: true })
    const hostScope = `agentcore-takeover-${process.pid}-${crypto.randomUUID()}`
    const cipher = createSandboxHandleCipher(randomBytes(32))
    const connectionA = createDatabase({ databaseUrl } as never)
    const connectionB = createDatabase({ databaseUrl } as never)
    let delayRenewal = false
    let releaseRenewal!: () => void
    const renewalGate = new Promise<void>((resolve) => { releaseRenewal = resolve })
    let staleExecs = 0
    const sessions = new Map<string, string>()
    const runtimeRoot = '/runtime/tenant/takeover-ws'
    const makeClient = (stale = false): AgentCoreRuntimeClient => ({
      async createSession({ runtimeCwd }) {
        const handle = encoder.encode(`takeover-session-${sessions.size + 1}`)
        sessions.set(decoder.decode(handle), runtimeCwd)
        return { handle, runtimeCwd }
      },
      async resumeSession({ handle }) {
        return { runtimeCwd: sessions.get(decoder.decode(handle))! }
      },
      async exec() {
        if (stale) staleExecs++
        return { exitCode: 0, stdout: encoder.encode(''), stderr: encoder.encode(''), truncated: false, durationMs: 1 }
      },
      async deleteSession() {},
    })
    const postgresA = new PostgresFencedSandboxHandleStore(connectionA.db, cipher)
    const delayedStore: FencedSandboxHandleStore = {
      claim: (input) => postgresA.claim(input),
      beginCreate: (fence) => postgresA.beginCreate(fence),
      async renew(fence, leaseForMs) {
        if (delayRenewal) await renewalGate
        return await postgresA.renew(fence, leaseForMs)
      },
      update: (fence, handle, version) => postgresA.update(fence, handle, version),
      publish: (fence) => postgresA.publish(fence),
      release: (fence) => postgresA.release(fence),
      delete: (fence, cleanup) => postgresA.delete(fence, cleanup),
    }
    const context = { workspaceId: 'takeover-ws', workspaceRoot: hostRoot, sessionId: 'session' }
    try {
      const oldAdapter = createAgentCoreRemoteEfsRuntimeMode({
        hostScope, tenantId: 'tenant', accessPointRoot: root, runtimeRoot: '/runtime',
        handleStore: delayedStore, agentCore: makeClient(true), leaseOwner: 'old-process', leaseForMs: 150,
      })
      const oldPair = await oldAdapter.create(context)
      delayRenewal = true
      const staleExecution = oldPair.sandbox.exec('must-not-run')
      await expect(staleExecution).rejects.toThrow(/fence was lost/)
      expect(staleExecs).toBe(0)

      const successorAdapter = createAgentCoreRemoteEfsRuntimeMode({
        hostScope, tenantId: 'tenant', accessPointRoot: root, runtimeRoot: '/runtime',
        handleStore: new PostgresFencedSandboxHandleStore(connectionB.db, cipher),
        agentCore: makeClient(), leaseOwner: 'successor-process', leaseForMs: 1_000,
      })
      const successor = await successorAdapter.create(context)
      releaseRenewal()
      await expect(oldPair.disposeRuntime?.()).rejects.toThrow(/fence/)
      await successor.disposeRuntime?.()
    } finally {
      releaseRenewal()
      await connectionB.sql`DELETE FROM fenced_sandbox_handles WHERE host_scope = ${hostScope}`
      await Promise.all([connectionA.sql.end(), connectionB.sql.end()])
    }
  }, 10_000)

  it('allows distinct workspace keys to acquire independently while rejecting one key twice', async () => {
    const store = new Store()
    const first = await fixture('one', { store })
    const secondRoot = join(first.root, 'tenant', 'two')
    await mkdir(secondRoot, { recursive: true })
    const runtimeRoots = new Map([[first.runtimeRoot, first.hostRoot], ['/runtime/tenant/two', secondRoot]])
    const remote = client(runtimeRoots)
    const adapter = createAgentCoreRemoteEfsRuntimeMode({
      hostScope: 'app', tenantId: 'tenant', accessPointRoot: first.root, runtimeRoot: '/runtime',
      handleStore: store, agentCore: remote.value, leaseOwner: 'host-1',
    })
    const one = await adapter.create(first.context)
    const two = await adapter.create({ workspaceId: 'two', workspaceRoot: secondRoot, sessionId: 's2' })
    await expect(adapter.create(first.context)).rejects.toThrow('owned by another runtime')
    expect([...store.rows.values()].map((row) => row.key.workspaceId).sort()).toEqual(['one', 'two'])
    await Promise.all([one.disposeRuntime?.(), two.disposeRuntime?.()])
  })
})
