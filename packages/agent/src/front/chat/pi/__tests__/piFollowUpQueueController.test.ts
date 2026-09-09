import { describe, expect, it, vi } from 'vitest'
import type { FollowUpPayload, PiChatStatus, PromptPayload, QueuedUserMessage, QueueClearPayload } from '../../../../shared/chat'
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
  clearQueue = vi.fn(async (payload: QueueClearPayload = {}) => {
    const before = this.state.queue.followUps
    const after = before.filter((followUp) => {
      if (payload.clientNonce && followUp.clientNonce !== payload.clientNonce) return true
      if (payload.clientSeq !== undefined && followUp.clientSeq !== payload.clientSeq) return true
      // A selector-less payload is a full clear: nothing survives.
      return false
    })
    this.state = { ...this.state, queue: { followUps: after } }
    return { accepted: true as const, cursor: 1, cleared: before.length - after.length }
  })
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

  it('copies the complete queue snapshot before one full clear', async () => {
    const ordered: string[] = []
    const session = new FakeQueueSession('streaming', [
      { id: 'q1', kind: 'followup', displayText: 'first queued', clientSeq: 1 },
      { id: 'q2', kind: 'followup', displayText: 'second queued', clientSeq: 2 },
    ])
    const clearQueue = session.clearQueue
    session.clearQueue = vi.fn(async (payload?: QueueClearPayload) => {
      ordered.push(`clear:${payload?.clientSeq ?? 'all'}`)
      return clearQueue(payload)
    })
    const controller = createPiFollowUpQueueController(session, {
      getDraft: () => 'existing draft',
      onDraftChange: (draft) => ordered.push(`draft:${draft}`),
    })

    await expect(controller.editQueued()).resolves.toEqual({
      type: 'cleared',
      draft: 'first queued\n\nsecond queued\n\nexisting draft',
    })

    expect(ordered).toEqual([
      'draft:first queued\n\nsecond queued\n\nexisting draft',
      'clear:all',
    ])
    expect(session.state.queue.followUps).toEqual([])
  })

  it('keeps the complete recovered snapshot when a later selected clear fails', async () => {
    const warnings: string[] = []
    const drafts: string[] = []
    const session = new FakeQueueSession('streaming', [
      { id: 'q1', kind: 'followup', displayText: 'restored', clientSeq: 1 },
      { id: 'q2', kind: 'followup', displayText: 'still queued', clientSeq: 2 },
    ])
    const clearQueue = session.clearQueue
    const failure = new Error('offline')
    let remainingFailures = 2
    session.clearQueue = vi.fn(async (payload?: QueueClearPayload) => {
      if (remainingFailures-- > 0) throw failure
      return clearQueue(payload)
    })
    let draft = ''
    const controller = createPiFollowUpQueueController(session, {
      getDraft: () => draft,
      onDraftChange: (next) => {
        draft = next
        drafts.push(next)
      },
      onWarning: (message) => warnings.push(message),
    })

    await expect(controller.editQueued()).resolves.toEqual({
      type: 'clear-failed',
      draft: 'restored\n\nstill queued',
      error: failure,
      message: 'Queued messages were copied into the composer, but the server queue was not cleared. They may still send unless you retry Edit or Remove.',
    })

    expect(drafts).toEqual(['restored\n\nstill queued'])
    expect(session.state.queue.followUps).toHaveLength(2)
    expect(warnings).toEqual(['Queued messages were copied into the composer, but the server queue was not cleared. They may still send unless you retry Edit or Remove.'])

    await expect(controller.editQueued()).resolves.toMatchObject({ type: 'clear-failed', draft: 'restored\n\nstill queued' })
    expect(drafts).toEqual(['restored\n\nstill queued'])
    expect(session.state.queue.followUps).toHaveLength(2)

  })

  it('fences concurrent edits behind one destructive clear', async () => {
    const session = new FakeQueueSession('streaming', [
      { id: 'q1', kind: 'followup', displayText: 'first queued', clientSeq: 1 },
      { id: 'q2', kind: 'followup', displayText: 'second queued', clientSeq: 2 },
    ])
    const clearQueue = session.clearQueue
    let releaseFirstClear!: () => void
    const firstClearGate = new Promise<void>((resolve) => { releaseFirstClear = resolve })
    let firstClear = true
    session.clearQueue = vi.fn(async (payload?: QueueClearPayload) => {
      if (firstClear) {
        firstClear = false
        await firstClearGate
      }
      return clearQueue(payload)
    })
    let draft = ''
    const drafts: string[] = []
    const controller = createPiFollowUpQueueController(session, {
      getDraft: () => draft,
      onDraftChange: (next) => {
        draft = next
        drafts.push(next)
      },
    })

    const first = controller.editQueued()
    const second = controller.editQueued()
    releaseFirstClear()
    const results = await Promise.all([first, second])

    expect(results.map((result) => result.type)).toEqual(['cleared', 'busy'])
    expect(draft).toBe('first queued\n\nsecond queued')
    expect(drafts).toEqual(['first queued\n\nsecond queued'])
    expect(session.clearQueue).toHaveBeenCalledTimes(1)
    expect(session.state.queue.followUps).toEqual([])
  })

  it('falls back to copy-all + full clear when the queue contains metadata-free items', async () => {
    const warnings: string[] = []
    const session = new FakeQueueSession('streaming', [
      { id: 'legacy', kind: 'followup', displayText: 'legacy queued' },
    ])
    const drafts: string[] = []
    const controller = createPiFollowUpQueueController(session, {
      getDraft: () => 'existing draft',
      onDraftChange: (draft) => drafts.push(draft),
      onWarning: (message) => warnings.push(message),
    })

    await expect(controller.editQueued()).resolves.toEqual({
      type: 'cleared',
      draft: 'legacy queued\n\nexisting draft',
    })
    expect(session.clearQueue).toHaveBeenCalledTimes(1)
    expect(session.clearQueue).toHaveBeenCalledWith()
    expect(drafts).toEqual(['legacy queued\n\nexisting draft'])
    expect(session.state.queue.followUps).toEqual([])
    expect(warnings).toEqual([])
  })

  it('uses the legacy full clear when only some queue items are metadata-free', async () => {
    const session = new FakeQueueSession('streaming', [
      { id: 'q1', kind: 'followup', displayText: 'selectable queued', clientSeq: 1 },
      { id: 'legacy', kind: 'followup', displayText: 'legacy queued' },
    ])
    const controller = createPiFollowUpQueueController(session, {})

    await expect(controller.editQueued()).resolves.toEqual({
      type: 'cleared',
      draft: 'selectable queued\n\nlegacy queued',
    })
    // One full clear, not a selector clear that would strand the legacy item.
    expect(session.clearQueue).toHaveBeenCalledTimes(1)
    expect(session.state.queue.followUps).toEqual([])
  })

  it('removeAllQueued clears the complete held queue', async () => {
    const queued = [
      { id: 'q1', kind: 'followup' as const, clientNonce: 'nonce-1', clientSeq: 1, displayText: 'first held' },
      { id: 'q2', kind: 'followup' as const, clientNonce: 'nonce-2', clientSeq: 2, displayText: 'second held' },
    ]
    const session = new FakeQueueSession('streaming', queued)
    const controller = createPiFollowUpQueueController(session, {})

    await expect(controller.removeAllQueued()).resolves.toEqual({ ok: true })

    expect(session.clearQueue).toHaveBeenCalledTimes(1)
    expect(session.clearQueue).toHaveBeenCalledWith()
    expect(session.state.queue.followUps).toEqual([])
  })

  it('keeps the queue and warns when removeAllQueued fails', async () => {
    const warnings: string[] = []
    const queued = [{ id: 'q1', kind: 'followup' as const, displayText: 'queued' }]
    const session = new FakeQueueSession('streaming', queued)
    session.clearQueue = vi.fn(async () => { throw new Error('offline') })
    const controller = createPiFollowUpQueueController(session, { onWarning: (message) => warnings.push(message) })

    await expect(controller.removeAllQueued()).resolves.toMatchObject({ ok: false })

    expect(session.state.queue.followUps).toHaveLength(1)
    expect(warnings).toHaveLength(1)
  })

  it('nudge releases every held message: resume-interrupt plus full queue drain', async () => {
    const queued = [
      { id: 'q1', kind: 'followup' as const, clientNonce: 'nonce-1', clientSeq: 1, displayText: 'first held' },
      { id: 'q2', kind: 'followup' as const, clientNonce: 'nonce-2', clientSeq: 2, displayText: 'second held' },
    ]
    const session = new FakeQueueSession('streaming', queued)
    const controller = createPiFollowUpQueueController(session, {})

    await controller.resumeQueued()

    // Nudge is exactly the resume-interrupt: abort the run and release the
    // whole held queue server-side (modeled here by draining after accept).
    expect(session.interrupt).toHaveBeenCalledWith({ queueAction: 'resume' })
    await session.clearQueue()
    expect(session.interrupt).toHaveBeenCalledTimes(1)
    expect(session.stop).not.toHaveBeenCalled()
    expect(session.state.queue.followUps).toEqual([])
  })

  it('edited queued content survives release into the agent as a prompt', async () => {
    let draft = ''
    const prompts: PromptPayload[] = []
    const session = new FakeQueueSession('streaming', [
      { id: 'q1', kind: 'followup' as const, clientNonce: 'nonce-1', clientSeq: 1, displayText: 'original text' },
    ])
    session.prompt = vi.fn(async (payload: PromptPayload) => {
      prompts.push(payload)
      return { accepted: true as const, cursor: 10, clientNonce: payload.clientNonce }
    })
    const controller = createPiFollowUpQueueController(session, {
      getDraft: () => draft,
      onDraftChange: (next) => { draft = next },
    })

    await controller.editQueued()
    expect(draft).toBe('original text')

    // Run ended; the recovered (and hand-edited) draft is submitted normally.
    session.state = { ...session.state, status: 'idle' }
    const result = await controller.submit({ text: 'edited while queued' })
    expect(result.type).toBe('prompt')
    expect(prompts[0]?.message).toBe('edited while queued')
    expect(prompts[0]?.message).not.toBe('original text')
  })

  it('does not clear the queue for empty edit or interrupt; stop remains the queue-clearing command', async () => {
    const warnings: string[] = []
    const session = new FakeQueueSession('streaming')
    const controller = createPiFollowUpQueueController(session, { onWarning: (message) => warnings.push(message) })

    await expect(controller.editQueued()).resolves.toEqual({ type: 'empty', message: 'No queued messages to edit.' })
    await controller.interrupt({ queueAction: 'hold' })
    await controller.resumeQueued()
    await controller.stop()

    expect(session.clearQueue).not.toHaveBeenCalled()
    expect(session.interrupt).toHaveBeenNthCalledWith(1, { queueAction: 'hold' })
    expect(session.interrupt).toHaveBeenNthCalledWith(2, { queueAction: 'resume' })
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
