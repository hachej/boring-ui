import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { openDatabase } from '../../events/sqlStorage'
import { ErrorCode } from '../../../shared/error-codes'
import { ChannelBindingStore } from '../channelBindingStore'
import {
  ChannelIntentionService,
  createChannelIntentionRuntime,
  type ChannelIntentionQuestion,
  type ChannelIntentionRuntime,
} from '../channelIntentionService'

const bindingInput = {
  channel: 'whatsapp',
  conversationKey: '+41790000000',
  agentTypeId: 'default',
  workspaceId: 'workspace-1',
  authSubjectId: 'user-1',
  sessionKey: 'session-1',
} as const

function question(): ChannelIntentionQuestion {
  return {
    questionId: 'question-1',
    sessionId: bindingInput.sessionKey,
    ownerPrincipalId: bindingInput.authSubjectId,
    status: 'ready',
    title: 'Approve deployment?',
    context: 'Choose exactly one option.',
    schema: {
      wireVersion: 1,
      fields: [{
        type: 'radio',
        name: 'decision',
        label: 'Decision',
        options: [
          { value: 'approve', label: 'Approve' },
          { value: 'reject', label: 'Reject', description: 'Send it back' },
        ],
      }],
    },
  }
}

class FakeIntentionRuntime implements ChannelIntentionRuntime {
  readonly workspaceId = bindingInput.workspaceId
  readonly questions = new Map<string, ChannelIntentionQuestion>()
  readonly answers: Array<{ questionId: string; sessionId: string; values: Readonly<Record<string, string>> }> = []
  private readonly listeners = new Set<() => void>()

  async listPending() {
    return [...this.questions.values()].filter((entry) => entry.status === 'ready')
  }

  async getByQuestionId(questionId: string) {
    return this.questions.get(questionId) ?? null
  }

  async submitAnswer(questionId: string, sessionId: string, values: Readonly<Record<string, string>>) {
    const current = this.questions.get(questionId)
    if (!current || current.status !== 'ready') throw new Error('already answered')
    this.answers.push({ questionId, sessionId, values })
    this.questions.set(questionId, { ...current, status: 'answered' })
    this.emit()
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(value: ChannelIntentionQuestion) {
    this.questions.set(value.questionId, value)
    this.emit()
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}

async function withStore(run: (store: ChannelBindingStore, path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'boring-channel-intention-'))
  const path = join(dir, 'channels.sqlite')
  const db = openDatabase(path)
  try {
    const store = new ChannelBindingStore(db.sql, db.runTransaction)
    store.provision(bindingInput)
    await run(store, path)
  } finally {
    db.db.close()
    await rm(dir, { recursive: true, force: true })
  }
}

function inbound(providerMessageId: string, text: string) {
  return {
    channel: bindingInput.channel,
    conversationKey: bindingInput.conversationKey,
    providerMessageId,
    text,
    receivedAt: Date.now(),
  }
}

describe('ChannelIntentionService', () => {
  test('projects a two-choice ask_user intention and keeps it durable across restart', async () => {
    await withStore(async (store) => {
      const runtime = new FakeIntentionRuntime()
      const sent: string[] = []
      const adapter = { send: vi.fn(async ({ text }: { text: string }) => { sent.push(text) }) }
      runtime.publish(question())

      const first = new ChannelIntentionService(store, runtime, new Map([['whatsapp', adapter]]))
      first.start()
      await first.waitForIdle()
      await first.dispose()
      expect(sent).toEqual([
        'Approve deployment?\nChoose exactly one option.\n1. Approve\n2. Reject — Send it back\nReply with the option number or label.',
      ])
      expect(runtime.questions.get('question-1')?.status).toBe('ready')

      const restarted = new ChannelIntentionService(store, runtime, new Map([['whatsapp', adapter]]))
      restarted.start()
      await restarted.waitForIdle()
      expect(sent).toHaveLength(1)
      await restarted.dispose()
    })
  })

  test('rejects invalid choices, accepts a label, and consumes the answer exactly once', async () => {
    await withStore(async (store) => {
      const runtime = new FakeIntentionRuntime()
      const sent: string[] = []
      const service = new ChannelIntentionService(store, runtime, new Map([['whatsapp', {
        send: async ({ text }) => { sent.push(text) },
      }]]))
      runtime.publish(question())
      service.start()
      await service.waitForIdle()

      await expect(service.accept(inbound('wamid.invalid', 'maybe'), 'default')).resolves.toMatchObject({
        handled: true, accepted: false, duplicate: false,
      })
      await expect(service.accept(inbound('wamid.invalid', 'maybe'), 'default')).resolves.toMatchObject({
        handled: true, accepted: false, duplicate: true,
      })
      expect(sent.at(-1)).toBe('That is not a valid choice. Reply with 1 or 2.')

      await expect(service.accept(inbound('wamid.answer', 'Approve'), 'default')).resolves.toMatchObject({
        handled: true, accepted: true, duplicate: false,
      })
      expect(runtime.answers).toEqual([{
        questionId: 'question-1', sessionId: 'session-1', values: { decision: 'approve' },
      }])
      expect(runtime.questions.get('question-1')?.status).toBe('answered')
      expect(store.openIntentions()).toHaveLength(0)
      await expect(service.accept(inbound('wamid.answer', 'Approve'), 'default')).resolves.toEqual({
        handled: true, accepted: true, duplicate: true,
      })
      await expect(service.accept(inbound('wamid.late-answer', 'Reject'), 'default')).resolves.toEqual({
        handled: true, accepted: false, duplicate: false, questionId: 'question-1',
      })
      await service.dispose()
    })
  })

  test('recovers a claimed answer after a process restart without consuming it twice', async () => {
    await withStore(async (store, path) => {
      const runtime = new FakeIntentionRuntime()
      runtime.publish(question())
      const sent: string[] = []
      const first = new ChannelIntentionService(store, runtime, new Map([['whatsapp', {
        send: async ({ text }) => { sent.push(text) },
      }]]), { claimTtlMs: 5, retryDelayMs: 1 })
      first.start()
      await first.waitForIdle()
      const projected = store.activeIntention('whatsapp', bindingInput.conversationKey, 'default')!
      expect(store.claimIntentionReply(projected, 'wamid.crash', { decision: 'reject' }, 'dead-process', 5).disposition)
        .toBe('claimed')
      await first.dispose()
      await new Promise((resolve) => setTimeout(resolve, 8))
      expect(() => store.provision({ ...bindingInput, workspaceId: 'workspace-2' }))
        .toThrow(expect.objectContaining({ code: ErrorCode.enum.CHANNEL_BINDING_BUSY }))

      const secondDb = openDatabase(path)
      try {
        const restartedStore = new ChannelBindingStore(secondDb.sql, secondDb.runTransaction)
        const restarted = new ChannelIntentionService(restartedStore, runtime, new Map([['whatsapp', {
          send: async ({ text }) => { sent.push(text) },
        }]]), { claimTtlMs: 5, retryDelayMs: 1 })
        restarted.start()
        await restarted.waitForIdle()
        expect(runtime.answers).toEqual([{
          questionId: 'question-1', sessionId: 'session-1', values: { decision: 'reject' },
        }])
        expect(restartedStore.openIntentions()).toHaveLength(0)
        await restarted.dispose()
      } finally {
        secondDb.db.close()
      }
    })
  })

  test('reprojects a pending question onto a newly provisioned binding generation', async () => {
    await withStore(async (store) => {
      const runtime = new FakeIntentionRuntime()
      const sent: string[] = []
      const service = new ChannelIntentionService(store, runtime, new Map([['whatsapp', {
        send: async ({ text }) => { sent.push(text) },
      }]]))
      runtime.publish(question())
      service.start()
      await service.waitForIdle()
      expect(sent).toHaveLength(1)

      expect(store.provision(bindingInput).bindingVersion).toBe(2)
      runtime.publish(question())
      await service.waitForIdle()
      expect(sent).toHaveLength(2)
      await expect(service.accept(inbound('wamid.rebound', '2'), 'default')).resolves.toMatchObject({
        handled: true, accepted: true,
      })
      expect(runtime.answers.at(-1)?.values).toEqual({ decision: 'reject' })
      await service.dispose()
    })
  })

  test('retries durable invalid-choice feedback after a send failure', async () => {
    await withStore(async (store) => {
      const runtime = new FakeIntentionRuntime()
      runtime.publish(question())
      let attempts = 0
      const sent: string[] = []
      const service = new ChannelIntentionService(store, runtime, new Map([['whatsapp', {
        send: async ({ text }) => {
          attempts += 1
          if (attempts === 2) throw new Error('temporary provider failure')
          sent.push(text)
        },
      }]]), { claimTtlMs: 5, retryDelayMs: 1 })
      service.start()
      await service.waitForIdle()
      await expect(service.accept(inbound('wamid.invalid-retry', 'maybe'), 'default')).rejects.toThrow('temporary provider failure')
      await new Promise((resolve) => setTimeout(resolve, 8))
      await service.waitForIdle()
      expect(sent.at(-1)).toBe('That is not a valid choice. Reply with 1 or 2.')
      await expect(service.accept(inbound('wamid.invalid-retry', 'maybe'), 'default')).resolves.toMatchObject({
        handled: true, duplicate: true,
      })
      await service.dispose()
    })
  })

  test('schedules invalid-choice recovery when restart happens before claim expiry', async () => {
    await withStore(async (store) => {
      const runtime = new FakeIntentionRuntime()
      runtime.publish(question())
      const sent: string[] = []
      const first = new ChannelIntentionService(store, runtime, new Map([['whatsapp', {
        send: async ({ text }) => { sent.push(text) },
      }]]), { claimTtlMs: 20, retryDelayMs: 1 })
      first.start()
      await first.waitForIdle()
      await first.dispose()
      const projected = store.activeIntention('whatsapp', bindingInput.conversationKey, 'default')!
      expect(store.claimInvalidIntentionReply(projected, 'wamid.invalid-crash', 'dead-process', 20).disposition)
        .toBe('claimed')

      const restarted = new ChannelIntentionService(store, runtime, new Map([['whatsapp', {
        send: async ({ text }) => { sent.push(text) },
      }]]), { claimTtlMs: 20, retryDelayMs: 1 })
      restarted.start()
      await restarted.waitForIdle()
      expect(sent).toHaveLength(1)
      await new Promise((resolve) => setTimeout(resolve, 25))
      await restarted.waitForIdle()
      expect(sent).toEqual([
        expect.stringContaining('Approve deployment?'),
        'That is not a valid choice. Reply with 1 or 2.',
      ])
      await restarted.dispose()
    })
  })

  test('fences rebinding during invalid feedback and rejects a stale claim after expiry', async () => {
    await withStore(async (store) => {
      const runtime = new FakeIntentionRuntime()
      runtime.publish(question())
      const service = new ChannelIntentionService(store, runtime, new Map([['whatsapp', {
        send: async () => undefined,
      }]]), { claimTtlMs: 20, retryDelayMs: 1 })
      service.start()
      await service.waitForIdle()
      await service.dispose()
      const projected = store.activeIntention('whatsapp', bindingInput.conversationKey, 'default')!
      expect(store.claimInvalidIntentionReply(projected, 'wamid.invalid-rebind', 'dead-process', 20).disposition)
        .toBe('claimed')
      expect(() => store.provision({ ...bindingInput, workspaceId: 'workspace-2' }))
        .toThrow(expect.objectContaining({ code: ErrorCode.enum.CHANNEL_BINDING_BUSY }))
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(store.provision({ ...bindingInput, workspaceId: 'workspace-2' }).bindingVersion).toBe(2)
      expect(store.claimInvalidIntentionReply(projected, 'wamid.invalid-rebind', 'new-owner', 20).disposition)
        .toBe('no_intention')
    })
  })

  test('backfills an earlier invalid-feedback row so restart recovery can find it', async () => {
    await withStore(async (store, path) => {
      const runtime = new FakeIntentionRuntime()
      runtime.publish(question())
      const first = new ChannelIntentionService(store, runtime, new Map([['whatsapp', {
        send: async () => undefined,
      }]]), { claimTtlMs: 5, retryDelayMs: 1 })
      first.start()
      await first.waitForIdle()
      await first.dispose()
      const projected = store.activeIntention('whatsapp', bindingInput.conversationKey, 'default')!
      expect(store.claimInvalidIntentionReply(projected, 'wamid.legacy-invalid', 'dead-process', 5).disposition)
        .toBe('claimed')

      const secondDb = openDatabase(path)
      try {
        secondDb.sql.exec(`UPDATE boring_channel_intention_reply_dedupe SET binding_version=NULL
          WHERE provider_message_id='wamid.legacy-invalid'`)
        await new Promise((resolve) => setTimeout(resolve, 8))
        const restartedStore = new ChannelBindingStore(secondDb.sql, secondDb.runTransaction)
        expect(restartedStore.pendingInvalidIntentionReplies()).toEqual([
          expect.objectContaining({ providerMessageId: 'wamid.legacy-invalid' }),
        ])
      } finally {
        secondDb.db.close()
      }
    })
  })

  test('does not recover invalid feedback after the Inbox intention is answered', async () => {
    await withStore(async (store) => {
      const runtime = new FakeIntentionRuntime()
      runtime.publish(question())
      const sent: string[] = []
      const first = new ChannelIntentionService(store, runtime, new Map([['whatsapp', {
        send: async ({ text }) => { sent.push(text) },
      }]]), { claimTtlMs: 5, retryDelayMs: 1 })
      first.start()
      await first.waitForIdle()
      await first.dispose()
      const projected = store.activeIntention('whatsapp', bindingInput.conversationKey, 'default')!
      expect(store.claimInvalidIntentionReply(projected, 'wamid.invalid-stale', 'dead-process', 5).disposition)
        .toBe('claimed')
      runtime.questions.set('question-1', { ...question(), status: 'answered' })
      await new Promise((resolve) => setTimeout(resolve, 8))

      const restarted = new ChannelIntentionService(store, runtime, new Map([['whatsapp', {
        send: async ({ text }) => { sent.push(text) },
      }]]), { claimTtlMs: 5, retryDelayMs: 1 })
      restarted.start()
      await restarted.waitForIdle()
      expect(sent).toHaveLength(1)
      await restarted.dispose()
    })
  })

  test('adapts a real store/runtime-shaped pair and fences the owner principal', async () => {
    await withStore(async (store) => {
      const backing = new FakeIntentionRuntime()
      const runtime = createChannelIntentionRuntime(backing.workspaceId, backing, backing)
      const send = vi.fn(async () => undefined)
      const service = new ChannelIntentionService(store, runtime, new Map([['whatsapp', { send }]]))
      backing.publish({ ...question(), ownerPrincipalId: 'different-user' })
      service.start()
      await service.waitForIdle()
      expect(send).not.toHaveBeenCalled()
      expect(store.openIntentions()).toHaveLength(0)
      await service.dispose()
    })
  })

  test('does not project unsupported multi-field forms or questions from unbound web sessions', async () => {
    await withStore(async (store) => {
      const runtime = new FakeIntentionRuntime()
      runtime.publish({ ...question(), questionId: 'unbound', sessionId: 'web-session' })
      runtime.publish({
        ...question(),
        questionId: 'multi',
        schema: { wireVersion: 1, fields: [...question().schema!.fields, ...question().schema!.fields] },
      })
      const send = vi.fn(async () => undefined)
      const service = new ChannelIntentionService(store, runtime, new Map([['whatsapp', { send }]]))
      service.start()
      await service.waitForIdle()
      expect(send).not.toHaveBeenCalled()
      expect(store.openIntentions()).toHaveLength(0)
      await service.dispose()
    })
  })
})
