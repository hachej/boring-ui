import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { openDatabase } from '../../events/sqlStorage'
import { ChannelBindingStore } from '../channelBindingStore'
import {
  ChannelIntentionService,
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
