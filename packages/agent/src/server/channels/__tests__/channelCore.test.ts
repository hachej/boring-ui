import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { CHANNEL_DESCRIPTORS, channelDescriptor } from '../../../shared/channel'
import { ErrorCode } from '../../../shared/error-codes'
import { openDatabase } from '../../events/sqlStorage'
import { ChannelBindingStore } from '../channelBindingStore'
import { PiSessionStore } from '../../harness/pi-coding-agent/sessions'
import {
  CHANNEL_UNKNOWN_BINDING,
  ChannelInboundService,
  type ChannelAgentInvoker,
} from '../channelInboundService'

async function withStores(run: (input: {
  first: ChannelBindingStore
  second: ChannelBindingStore
  firstDb: ReturnType<typeof openDatabase>
  secondDb: ReturnType<typeof openDatabase>
  path: string
}) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'boring-channel-'))
  const path = join(dir, 'channels.sqlite')
  const firstDb = openDatabase(path)
  const secondDb = openDatabase(path)
  try {
    await run({
      first: new ChannelBindingStore(firstDb.sql, firstDb.runTransaction),
      second: new ChannelBindingStore(secondDb.sql, secondDb.runTransaction),
      firstDb,
      secondDb,
      path,
    })
  } finally {
    secondDb.db.close()
    firstDb.db.close()
    await rm(dir, { recursive: true, force: true })
  }
}

const bindingInput = {
  channel: 'whatsapp',
  conversationKey: '+41790000000',
  agentTypeId: 'default',
  workspaceId: 'workspace-1',
  authSubjectId: 'user-1',
} as const

function inbound(providerMessageId: string, text = 'hello') {
  return {
    channel: 'whatsapp',
    conversationKey: bindingInput.conversationKey,
    providerMessageId,
    text,
    receivedAt: Date.now(),
  }
}

describe('channel registry', () => {
  test('resolves rendering policy from descriptors with web as the default', () => {
    expect(channelDescriptor()).toEqual(CHANNEL_DESCRIPTORS.get('web'))
    expect(channelDescriptor('web')?.canOriginateIdentity).toBe(true)
    expect(channelDescriptor('whatsapp')).toMatchObject({
      sessionsReadOnlyInWorkspace: true,
      dialect: 'whatsapp/markdown',
    })
  })

  test('persists originChannel on sessions and defaults existing creation to web', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'boring-channel-session-'))
    try {
      const sessions = new PiSessionStore('/workspace', { sessionDir: dir })
      const web = await sessions.create({ workspaceId: 'workspace-1' })
      const whatsapp = await sessions.create(
        { workspaceId: 'workspace-1' },
        { originChannel: 'whatsapp' },
      )
      expect((await sessions.load({ workspaceId: 'workspace-1' }, web.id)).originChannel).toBe('web')
      expect((await sessions.load({ workspaceId: 'workspace-1' }, whatsapp.id)).originChannel).toBe('whatsapp')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('ChannelBindingStore', () => {
  test('atomically deduplicates an inbound across a database restart', async () => {
    await withStores(async ({ first, second, firstDb }) => {
      first.provision(bindingInput)
      const accepted = first.enqueueInbound(inbound('wamid.1'), 'default')
      expect(accepted.disposition).toBe('enqueued')
      expect(second.enqueueInbound(inbound('wamid.1'), 'default')).toMatchObject({ disposition: 'duplicate' })
      const queueRows = firstDb.sql.exec('SELECT * FROM boring_channel_inbound_queue').toArray()
      const dedupeRows = firstDb.sql.exec('SELECT * FROM boring_channel_inbound_dedupe').toArray()
      expect(queueRows).toHaveLength(1)
      expect(dedupeRows).toHaveLength(1)
    })
  })

  test('provision returns its own atomic write result across two connections', async () => {
    await withStores(async ({ first, second }) => {
      const firstResult = first.provision(bindingInput)
      const secondResult = second.provision({
        ...bindingInput,
        workspaceId: 'workspace-2',
        authSubjectId: 'user-2',
      })
      expect(firstResult).toMatchObject({
        workspaceId: 'workspace-1',
        authSubjectId: 'user-1',
        bindingVersion: 1,
      })
      expect(secondResult).toMatchObject({
        workspaceId: 'workspace-2',
        authSubjectId: 'user-2',
        bindingVersion: 2,
      })
    })
  })

  test('resets the outbound cursor on every composite identity change', async () => {
    await withStores(async ({ first }) => {
      const initial = first.provision({ ...bindingInput, sessionKey: 'same-session-id' })
      expect(first.claimOutbound(initial, 'cursor-owner')).toBe(true)
      expect(first.compareAndSetOutboundCursor(initial, 'cursor-owner', 'offset-7')).toBe(true)
      first.releaseOutbound('cursor-owner')
      const rebound = first.provision({
        ...bindingInput,
        workspaceId: 'workspace-2',
        authSubjectId: 'user-2',
        sessionKey: 'same-session-id',
        outboundCursor: 'new-stream-tail',
      })
      expect(rebound.outboundCursor).toBe('new-stream-tail')
      expect(rebound.bindingVersion).toBe(2)
    })
  })

  test('blocks reprovisioning while a generation owns outbound delivery', async () => {
    await withStores(async ({ first, second }) => {
      const binding = first.provision({ ...bindingInput, sessionKey: 'session-1' })
      expect(first.claimOutbound(binding, 'outbound-owner', 5)).toBe(true)
      expect(() => second.provision({ ...bindingInput, workspaceId: 'workspace-2', sessionKey: 'session-2' }))
        .toThrow(expect.objectContaining({ code: ErrorCode.enum.CHANNEL_BINDING_BUSY }))
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(() => second.provision({ ...bindingInput, workspaceId: 'workspace-2', sessionKey: 'session-2' }))
        .toThrow(expect.objectContaining({ code: ErrorCode.enum.CHANNEL_BINDING_BUSY }))
      first.releaseOutbound('outbound-owner')
      expect(second.provision({ ...bindingInput, workspaceId: 'workspace-2', sessionKey: 'session-2' }))
        .toMatchObject({ workspaceId: 'workspace-2', bindingVersion: 2, outboundCursor: '-1' })
    })
  })

  test('rejects state mutation from an expired outbound owner after takeover', async () => {
    await withStores(async ({ first, second }) => {
      const binding = first.provision({ ...bindingInput, sessionKey: 'session-1' })
      expect(first.claimOutbound(binding, 'stale-owner', 5)).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(second.claimOutbound(binding, 'current-owner', 1_000)).toBe(true)
      expect(first.markSessionGone(binding, 'stale-owner')).toBe(false)
      expect(first.compareAndSetOutboundCursor(binding, 'stale-owner', 'offset-lost')).toBe(false)
      expect(first.getBinding('whatsapp', bindingInput.conversationKey, 'default')).toMatchObject({
        sessionKey: 'session-1', outboundCursor: '-1',
      })
      second.releaseOutbound('current-owner')
    })
  })

  test('owner-token CAS admits one session during a concurrent create race', async () => {
    await withStores(async ({ first, second }) => {
      const binding = first.provision(bindingInput)
      let allocations = 0
      const admitted: string[] = []
      const options = {
        reservationTtlMs: 1_000,
        initialBackoffMs: 1,
        allocate: async () => {
          allocations += 1
          await new Promise((resolve) => setTimeout(resolve, 10))
          return `session-${allocations}`
        },
        admit: async (sessionKey: string) => { admitted.push(sessionKey) },
      }
      const [left, right] = await Promise.all([
        first.ensureSession(binding, options),
        second.ensureSession(binding, options),
      ])
      expect(allocations).toBe(1)
      expect(admitted).toEqual(['session-1'])
      expect(left.sessionKey).toBe('session-1')
      expect(right.sessionKey).toBe('session-1')
      expect([left.created, right.created].sort()).toEqual([false, true])
    })
  })

  test('a stale creator cannot clobber a reclaimed owner', async () => {
    await withStores(async ({ first, second }) => {
      const binding = first.provision(bindingInput)
      const admitted: string[] = []
      let releaseFirst!: () => void
      const stalled = new Promise<void>((resolve) => { releaseFirst = resolve })
      const firstRun = first.ensureSession(binding, {
        reservationTtlMs: 15,
        initialBackoffMs: 1,
        maxReservationCycles: 5,
        allocate: async () => { await stalled; return 'stale-session' },
        admit: async (sessionKey) => { admitted.push(sessionKey) },
      })
      await new Promise((resolve) => setTimeout(resolve, 25))
      const secondRun = second.ensureSession(binding, {
        reservationTtlMs: 100,
        initialBackoffMs: 1,
        maxReservationCycles: 5,
        allocate: async () => 'winner-session',
        admit: async (sessionKey) => { admitted.push(sessionKey) },
      })
      releaseFirst()
      const [staleResult, winnerResult] = await Promise.all([firstRun, secondRun])
      expect(admitted).toEqual(['winner-session'])
      expect(staleResult.sessionKey).toBe('winner-session')
      expect(winnerResult.sessionKey).toBe('winner-session')
      expect(first.getBinding('whatsapp', bindingInput.conversationKey, 'default')?.sessionKey).toBe('winner-session')
    })
  })
})

describe('ChannelInboundService fake-channel path', () => {
  test('acks durable enqueue, orders prompt/followUp, and never passes the phone handle to agent APIs', async () => {
    await withStores(async ({ first }) => {
      first.provision(bindingInput)
      const calls: Array<{ kind: string; input: object }> = []
      let busy = false
      const invoker: ChannelAgentInvoker = {
        async createSession(input) {
          calls.push({ kind: 'create', input })
          return 'session-1'
        },
        async isSessionBusy(input) {
          calls.push({ kind: 'status', input })
          return busy
        },
        async prompt(input) {
          calls.push({ kind: 'prompt', input })
          busy = true
        },
        async followUp(input) {
          calls.push({ kind: 'followUp', input })
        },
      }
      const service = new ChannelInboundService(first, invoker)
      expect(service.accept(inbound('wamid.1', 'first'), 'default')).toMatchObject({ accepted: true, duplicate: false })
      expect(service.accept(inbound('wamid.2', 'second'), 'default')).toMatchObject({ accepted: true, duplicate: false })
      await service.waitForIdle()

      expect(calls.map((call) => call.kind)).toEqual(['create', 'prompt', 'status', 'followUp'])
      expect(calls.filter((call) => call.kind === 'prompt' || call.kind === 'followUp')
        .map((call) => (call.input as { deliverySequence: number }).deliverySequence)).toEqual([1, 2])
      expect(calls.filter((call) => JSON.stringify(call.input).includes(bindingInput.conversationKey))).toEqual([])
      expect(first.getInbound(1)?.status).toBe('processed')
      expect(first.getInbound(2)?.status).toBe('processed')
    })
  })

  test('service startup resumes committed but undrained work without a provider replay', async () => {
    await withStores(async ({ first, second }) => {
      first.provision({ ...bindingInput, sessionKey: 'session-1' })
      expect(first.enqueueInbound(inbound('wamid.restart'), 'default').disposition).toBe('enqueued')
      const prompt = vi.fn(async () => {})
      const service = new ChannelInboundService(second, {
        createSession: vi.fn(),
        isSessionBusy: vi.fn(async () => false),
        prompt,
        followUp: vi.fn(),
      })
      await service.waitForIdle()
      expect(prompt).toHaveBeenCalledOnce()
      expect(second.getInbound(1)?.status).toBe('processed')
    })
  })

  test('transient database contention retries without another inbound', async () => {
    await withStores(async ({ first }) => {
      first.provision({ ...bindingInput, sessionKey: 'session-1' })
      first.enqueueInbound(inbound('wamid.busy'), 'default')
      const nextPending = first.nextPending.bind(first)
      vi.spyOn(first, 'nextPending')
        .mockImplementationOnce(() => { throw new Error('transient database contention') })
        .mockImplementation(nextPending)
      const prompt = vi.fn(async () => {})
      const service = new ChannelInboundService(first, {
        createSession: vi.fn(),
        isSessionBusy: vi.fn(async () => false),
        prompt,
        followUp: vi.fn(),
      }, { drainRetryMs: 1 })
      await service.waitForIdle()
      expect(prompt).toHaveBeenCalledOnce()
      expect(first.getInbound(1)?.status).toBe('processed')
    })
  })

  test('heartbeat contention reclaims work without another inbound', async () => {
    await withStores(async ({ first }) => {
      first.provision({ ...bindingInput, sessionKey: 'session-1' })
      first.enqueueInbound(inbound('wamid.heartbeat'), 'default')
      const renewInbound = first.renewInbound.bind(first)
      vi.spyOn(first, 'renewInbound')
        .mockImplementationOnce(() => { throw new Error('transient heartbeat contention') })
        .mockImplementation(renewInbound)
      const delivered = new Set<string>()
      const prompt = vi.fn(async (input: { requestId: string }) => {
        if (!delivered.has(input.requestId)) {
          delivered.add(input.requestId)
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      })
      const service = new ChannelInboundService(first, {
        createSession: vi.fn(),
        isSessionBusy: vi.fn(async () => false),
        prompt,
        followUp: vi.fn(),
      }, { inboundClaimTtlMs: 15, drainRetryMs: 1 })
      await service.waitForIdle()
      expect(prompt).toHaveBeenCalledTimes(2)
      expect(delivered).toEqual(new Set(['channel:whatsapp:wamid.heartbeat']))
      expect(first.getInbound(1)?.status).toBe('processed')
    })
  })

  test('startup parks accepted work for a binding revoked before restart', async () => {
    await withStores(async ({ first, second }) => {
      first.provision({ ...bindingInput, sessionKey: 'session-1' })
      first.enqueueInbound(inbound('wamid.revoked'), 'default')
      second.provision({ ...bindingInput, status: 'revoked', sessionKey: 'session-1' })
      const invoker = {
        createSession: vi.fn(),
        isSessionBusy: vi.fn(),
        prompt: vi.fn(),
        followUp: vi.fn(),
      } as unknown as ChannelAgentInvoker
      const service = new ChannelInboundService(second, invoker)
      await service.waitForIdle()
      expect(invoker.prompt).not.toHaveBeenCalled()
      expect(second.getInbound(1)).toMatchObject({
        status: 'parked',
        errorCode: 'CHANNEL_BINDING_REVOKED',
      })
    })
  })

  test('re-provisioning parks queued content instead of crossing tenant boundaries', async () => {
    await withStores(async ({ first, second }) => {
      first.provision({ ...bindingInput, sessionKey: 'session-1' })
      expect(first.enqueueInbound(inbound('wamid.tenant'), 'default').disposition).toBe('enqueued')
      second.provision({
        ...bindingInput,
        workspaceId: 'workspace-2',
        authSubjectId: 'user-2',
        sessionKey: 'session-2',
      })
      const invoker = {
        createSession: vi.fn(),
        isSessionBusy: vi.fn(),
        prompt: vi.fn(),
        followUp: vi.fn(),
      } as unknown as ChannelAgentInvoker
      const service = new ChannelInboundService(second, invoker)
      await service.waitForIdle()
      expect(invoker.prompt).not.toHaveBeenCalled()
      expect(second.getInbound(1)).toMatchObject({
        status: 'parked',
        errorCode: 'CHANNEL_BINDING_REVOKED',
        workspaceId: 'workspace-1',
        authSubjectId: 'user-1',
      })
    })
  })

  test('a service starting during a live claim preserves cross-process order', async () => {
    await withStores(async ({ first, secondDb }) => {
      first.provision({ ...bindingInput, sessionKey: 'session-1' })
      first.enqueueInbound(inbound('wamid.concurrent.1', 'first'), 'default')
      first.enqueueInbound(inbound('wamid.concurrent.2', 'second'), 'default')
      const calls: string[] = []
      let releaseFirst!: () => void
      let markStarted!: () => void
      const started = new Promise<void>((resolve) => { markStarted = resolve })
      const blocked = new Promise<void>((resolve) => { releaseFirst = resolve })
      const invoker: ChannelAgentInvoker = {
        createSession: vi.fn(),
        isSessionBusy: vi.fn(async () => false),
        async prompt(input) {
          calls.push(input.text)
          if (input.text === 'first') {
            markStarted()
            await blocked
          }
        },
        followUp: vi.fn(),
      }
      const firstService = new ChannelInboundService(first, invoker, { inboundClaimTtlMs: 30 })
      await started
      const lateStore = new ChannelBindingStore(secondDb.sql, secondDb.runTransaction)
      const secondService = new ChannelInboundService(lateStore, invoker, { inboundClaimTtlMs: 30 })
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(calls).toEqual(['first'])
      releaseFirst()
      await Promise.all([firstService.waitForIdle(), secondService.waitForIdle()])
      expect(calls).toEqual(['first', 'second'])
      expect(first.getInbound(1)?.status).toBe('processed')
      expect(first.getInbound(2)?.status).toBe('processed')
    })
  })

  test('fails unknown senders closed without creating a session or account', async () => {
    await withStores(async ({ first, firstDb }) => {
      const invoker = {
        createSession: vi.fn(),
        isSessionBusy: vi.fn(),
        prompt: vi.fn(),
        followUp: vi.fn(),
      } as unknown as ChannelAgentInvoker
      const service = new ChannelInboundService(first, invoker)
      const expectedUnknown = {
        accepted: false,
        duplicate: false,
        code: CHANNEL_UNKNOWN_BINDING,
      }
      expect(service.accept(inbound('unknown'), 'default')).toEqual(expectedUnknown)
      expect(service.accept(inbound('unknown'), 'default')).toEqual(expectedUnknown)
      await service.waitForIdle()
      expect(invoker.createSession).not.toHaveBeenCalled()
      expect(firstDb.sql.exec('SELECT * FROM boring_channel_inbound_queue').toArray()).toEqual([])
      expect(firstDb.sql.exec('SELECT * FROM boring_channel_inbound_dedupe').toArray()).toEqual([])

      first.provision({ ...bindingInput, sessionKey: 'session-after-provision' })
      expect(service.accept(inbound('unknown'), 'default')).toMatchObject({ accepted: true, duplicate: false })
      await service.waitForIdle()
      expect(invoker.prompt).toHaveBeenCalledOnce()
    })
  })
})
