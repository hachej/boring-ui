import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { CHANNEL_DESCRIPTORS, channelDescriptor } from '../../../shared/channel'
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
      expect(calls.filter((call) => JSON.stringify(call.input).includes(bindingInput.conversationKey))).toEqual([])
      expect(first.getInbound(1)?.status).toBe('processed')
      expect(first.getInbound(2)?.status).toBe('processed')
    })
  })

  test('a provider replay after restart resumes committed but undrained work', async () => {
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
      expect(service.accept(inbound('wamid.restart'), 'default')).toMatchObject({ accepted: true, duplicate: true })
      await service.waitForIdle()
      expect(prompt).toHaveBeenCalledOnce()
      expect(second.getInbound(1)?.status).toBe('processed')
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
      expect(service.accept(inbound('unknown'), 'default')).toEqual({
        accepted: false,
        duplicate: false,
        code: CHANNEL_UNKNOWN_BINDING,
      })
      await service.waitForIdle()
      expect(invoker.createSession).not.toHaveBeenCalled()
      expect(firstDb.sql.exec('SELECT * FROM boring_channel_inbound_queue').toArray()).toEqual([])
    })
  })
})
