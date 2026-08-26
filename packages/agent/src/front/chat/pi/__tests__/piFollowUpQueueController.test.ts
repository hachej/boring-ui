import { describe, expect, it, vi } from 'vitest'
import type { FollowUpPayload, PiChatStatus, PromptPayload, QueuedUserMessage } from '../../../../shared/chat'
import { createInitialPiChatState, type PiChatState } from '../piChatReducer'
import {
  buildEditedQueuedDraft,
  createPiFollowUpQueueController,
  nextFollowUpClientSeq,
  type PiQueueSessionLike,
} from '../piFollowUpQueueController'

class FakeQueueSession implements PiQueueSessionLike {
  state: PiChatState
  prompts: PromptPayload[] = []
  followUps: FollowUpPayload[] = []
  clearQueue = vi.fn(async () => ({ accepted: true as const, cursor: 1, cleared: this.state.queue.followUps.length }))
  interrupt = vi.fn(async () => ({ accepted: true as const, cursor: 2 }))
  stop = vi.fn(async () => ({ accepted: true as const, cursor: 3, stopped: true as const, clearedQueue: this.state.queue.followUps }))

  constructor(status: PiChatStatus, followUps: QueuedUserMessage[] = []) {
    this.state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope', status })
    this.state = { ...this.state, queue: { followUps } }
  }

  getState(): PiChatState {
    return this.state
  }

  async prompt(payload: PromptPayload) {
    this.prompts.push(payload)
    return { accepted: true as const, cursor: 10, clientNonce: payload.clientNonce }
  }

  async followUp(payload: FollowUpPayload) {
    this.followUps.push(payload)
    return { accepted: true as const, cursor: 11, clientNonce: payload.clientNonce, clientSeq: payload.clientSeq, queued: true as const }
  }
}

function nonceFactory() {
  let index = 0
  return () => `nonce-${++index}`
}

describe('PiFollowUpQueueController', () => {
  it('sends idle composer submissions through prompt with attachments and generated nonce', async () => {
    const session = new FakeQueueSession('idle')
    const controller = createPiFollowUpQueueController(session, { createClientNonce: nonceFactory() })

    const result = await controller.submit({
      text: '  build this  ',
      attachments: [{ filename: 'spec.md', mediaType: 'text/markdown', url: '/files/spec.md' }],
      model: { provider: 'anthropic', id: 'claude' },
      thinkingLevel: 'medium',
    })

    expect(result).toEqual({ type: 'prompt', clientNonce: 'nonce-1', cursor: 10 })
    expect(session.prompts).toEqual([
      {
        message: 'build this',
        clientNonce: 'nonce-1',
        attachments: [{ filename: 'spec.md', mediaType: 'text/markdown', url: '/files/spec.md' }],
        model: { provider: 'anthropic', id: 'claude' },
        thinkingLevel: 'medium',
      },
    ])
    expect(session.followUps).toEqual([])
  })

  it('sends busy normal text as FIFO follow-ups with distinct nonce/seq even when text duplicates', async () => {
    const session = new FakeQueueSession('streaming', [
      { id: 'q-existing', kind: 'followup', clientNonce: 'existing', clientSeq: 4, displayText: 'same text' },
    ])
    const controller = createPiFollowUpQueueController(session, { createClientNonce: nonceFactory() })

    await expect(controller.submit({ text: 'same text' })).resolves.toEqual({ type: 'followup', clientNonce: 'nonce-1', clientSeq: 5, cursor: 11 })
    await expect(controller.submit({ text: 'same text' })).resolves.toEqual({ type: 'followup', clientNonce: 'nonce-2', clientSeq: 6, cursor: 11 })

    expect(session.prompts).toEqual([])
    expect(session.followUps).toEqual([
      { message: 'same text', clientNonce: 'nonce-1', clientSeq: 5 },
      { message: 'same text', clientNonce: 'nonce-2', clientSeq: 6 },
    ])
  })

  it('blocks attachment-only submits because Pi prompt payloads require text', async () => {
    const warnings: string[] = []
    const session = new FakeQueueSession('idle')
    const controller = createPiFollowUpQueueController(session, { onWarning: (message) => warnings.push(message) })

    await expect(controller.submit({ text: ' ', attachments: [{ filename: 'a.txt', url: '/a.txt' }] })).resolves.toMatchObject({
      type: 'blocked',
      reason: 'empty',
    })

    expect(session.prompts).toEqual([])
    expect(warnings).toEqual(['Enter a message before sending.'])
  })

  it('blocks busy attachments and slash commands instead of blindly queueing them', async () => {
    const warnings: string[] = []
    const session = new FakeQueueSession('streaming')
    const controller = createPiFollowUpQueueController(session, {
      createClientNonce: nonceFactory(),
      onWarning: (message) => warnings.push(message),
    })

    await expect(controller.submit({ text: 'with file', attachments: [{ filename: 'a.txt', url: '/a.txt' }] })).resolves.toMatchObject({
      type: 'blocked',
      reason: 'busy-attachments',
    })
    await expect(controller.submit({ text: '/reload' })).resolves.toMatchObject({
      type: 'blocked',
      reason: 'busy-slash-command',
    })
    await expect(controller.submit({ text: '/template expanded', kind: 'expanded-text' })).resolves.toEqual({
      type: 'followup',
      clientNonce: 'nonce-1',
      clientSeq: 1,
      cursor: 11,
    })

    expect(session.followUps).toEqual([{ message: '/template expanded', clientNonce: 'nonce-1', clientSeq: 1 }])
    expect(warnings).toEqual([
      'Attachments cannot be queued while the agent is responding. Send them after the current response finishes.',
      'Slash commands are not queued while the agent is responding.',
    ])
  })

  it('restores queued text into the draft before clearing the canonical server queue', async () => {
    const ordered: string[] = []
    const session = new FakeQueueSession('streaming', [
      { id: 'q1', kind: 'followup', displayText: 'first queued', clientSeq: 1 },
      { id: 'q2', kind: 'followup', displayText: 'second queued', clientSeq: 2 },
    ])
    session.clearQueue = vi.fn(async () => {
      ordered.push('clear')
      return { accepted: true, cursor: 12, cleared: 2 }
    })
    const controller = createPiFollowUpQueueController(session, {
      getDraft: () => 'existing draft',
      onDraftChange: (draft) => ordered.push(`draft:${draft}`),
    })

    await expect(controller.editQueued()).resolves.toEqual({
      type: 'cleared',
      draft: 'first queued\n\nsecond queued\n\nexisting draft',
    })

    expect(ordered).toEqual(['draft:first queued\n\nsecond queued\n\nexisting draft', 'clear'])
    expect(session.clearQueue).toHaveBeenCalledTimes(1)
  })

  it('preserves the restored draft and warns if queue clear fails', async () => {
    const warnings: string[] = []
    const drafts: string[] = []
    const session = new FakeQueueSession('streaming', [
      { id: 'q1', kind: 'followup', displayText: 'keep this', clientSeq: 1 },
    ])
    const failure = new Error('offline')
    session.clearQueue = vi.fn(async () => { throw failure })
    const controller = createPiFollowUpQueueController(session, {
      onDraftChange: (draft) => drafts.push(draft),
      onWarning: (message) => warnings.push(message),
    })

    await expect(controller.editQueued()).resolves.toEqual({
      type: 'clear-failed',
      draft: 'keep this',
      error: failure,
      message: 'Queued messages were copied into the composer, but the server queue was not cleared. They may still send unless you retry Edit queued or Stop.',
    })

    expect(drafts).toEqual(['keep this'])
    expect(warnings).toEqual(['Queued messages were copied into the composer, but the server queue was not cleared. They may still send unless you retry Edit queued or Stop.'])
  })

  it('does not clear the queue for empty edit or interrupt; stop remains the queue-clearing command', async () => {
    const warnings: string[] = []
    const session = new FakeQueueSession('streaming')
    const controller = createPiFollowUpQueueController(session, { onWarning: (message) => warnings.push(message) })

    await expect(controller.editQueued()).resolves.toEqual({ type: 'empty', message: 'No queued messages to edit.' })
    await controller.interrupt()
    await controller.stop()

    expect(session.clearQueue).not.toHaveBeenCalled()
    expect(session.interrupt).toHaveBeenCalledTimes(1)
    expect(session.stop).toHaveBeenCalledTimes(1)
    expect(warnings).toEqual(['No queued messages to edit.'])
  })
})

describe('Pi follow-up queue helpers', () => {
  it('calculates next seq from canonical queue and local outbox metadata, not text', () => {
    const state = createInitialPiChatState({ sessionId: 's1', storageScope: 'scope', status: 'streaming' })
    state.queue.followUps = [{ id: 'q1', kind: 'followup', displayText: 'same text', clientSeq: 2 }]
    state.optimisticOutbox = {
      a: { id: 'a', role: 'user', status: 'pending', clientNonce: 'a', clientSeq: 7, parts: [{ type: 'text', text: 'same text' }] },
      b: { id: 'b', role: 'user', status: 'pending', clientNonce: 'b', clientSeq: 4, parts: [{ type: 'text', text: 'different' }] },
    }

    expect(nextFollowUpClientSeq(state)).toBe(8)
    expect(nextFollowUpClientSeq(state, 10)).toBe(10)
  })

  it('joins queued text by blank lines before an existing draft', () => {
    expect(buildEditedQueuedDraft([
      { id: 'q1', kind: 'followup', displayText: 'first' },
      { id: 'q2', kind: 'followup', displayText: 'second' },
    ], 'draft')).toBe('first\n\nsecond\n\ndraft')
  })
})
