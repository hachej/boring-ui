import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { restoreEnvForTest, setEnvForTest } from '../../config/env'
import { PiChatEventMapper } from '../../pi-chat/piChatEvents'
import { createScriptedPiHarness } from '../scriptedPiHarness'

describe('createScriptedPiHarness', () => {
  it('clears the selected queued follow-up by client selector', async () => {
    const harness = createScriptedPiHarness({ tools: [], cwd: '/workspace' })
    const adapter = await harness.getPiSessionAdapter({ sessionId: 's1', message: '' }, {
      abortSignal: new AbortController().signal,
      workdir: '/workspace',
    })

    await adapter.followUp('first', { displayText: 'first', clientNonce: 'nonce-1', clientSeq: 1 })
    await adapter.followUp('second', { displayText: 'second', clientNonce: 'nonce-2', clientSeq: 2 })
    await adapter.followUp('third', { displayText: 'third', clientNonce: 'nonce-3', clientSeq: 3 })

    adapter.clearFollowUp({ clientNonce: 'nonce-2', clientSeq: 2 })

    expect(adapter.readSnapshot().followUpMessages).toEqual(['first', 'third'])
  })

  it('keeps snapshot messages synchronized with in-flight scripted events', async () => {
    const harness = createScriptedPiHarness({ tools: [], cwd: '/workspace' })
    const adapter = await harness.getPiSessionAdapter({ sessionId: 's1', message: '' }, {
      abortSignal: new AbortController().signal,
      workdir: '/workspace',
    })
    const snapshotAtToolResult = new Promise<ReturnType<typeof adapter.readSnapshot>>((resolve) => {
      adapter.subscribe((event) => {
        if (event.type === 'tool_execution_end') resolve(adapter.readSnapshot())
      })
    })

    const prompt = adapter.prompt('inspect workspace')
    const snapshot = await snapshotAtToolResult

    expect(snapshot.isStreaming).toBe(true)
    const serialized = JSON.stringify(snapshot.messages)
    expect(serialized).toContain('u1')
    expect(serialized).toContain('a1')
    expect(serialized).toContain('Reasoning visible')
    expect(serialized).toContain('TOOL_E2E_OUTPUT')

    await prompt
    expect(adapter.readSnapshot().isStreaming).toBe(false)
  })

  it('can emit multiple reasoning parts for browser baseline fixtures', async () => {
    const previous = setEnvForTest('BORING_AGENT_E2E_SCRIPTED_PI_REASONING_PARTS', '2')
    try {
      const harness = createScriptedPiHarness({ tools: [], cwd: '/workspace' })
      const adapter = await harness.getPiSessionAdapter({ sessionId: 's1', message: '' }, {
        abortSignal: new AbortController().signal,
        workdir: '/workspace',
      })
      const snapshotAtMessageEnd = new Promise<ReturnType<typeof adapter.readSnapshot>>((resolve) => {
        adapter.subscribe((event) => {
          if (event.type === 'message_end') resolve(adapter.readSnapshot())
        })
      })

      const prompt = adapter.prompt('inspect workspace')
      const snapshot = await snapshotAtMessageEnd

      const assistant = snapshot.messages.find((message) => (message as { role?: unknown }).role === 'assistant') as { content?: Array<Record<string, unknown>> } | undefined
      const reasoningParts = assistant?.content?.filter((part) => part.type === 'reasoning') ?? []
      expect(reasoningParts).toEqual([
        expect.objectContaining({ id: 'r1', text: 'Reasoning visible' }),
        expect.objectContaining({ id: 'r2', text: 'Second reasoning visible' }),
      ])

      await prompt
    } finally {
      restoreEnvForTest('BORING_AGENT_E2E_SCRIPTED_PI_REASONING_PARTS', previous)
    }
  })

  it('cancels the scripted turn when aborted', async () => {
    const harness = createScriptedPiHarness({ tools: [], cwd: '/workspace' })
    const adapter = await harness.getPiSessionAdapter({ sessionId: 's1', message: '' }, {
      abortSignal: new AbortController().signal,
      workdir: '/workspace',
    })
    const events: Array<Record<string, unknown>> = []
    const firstMessage = new Promise<void>((resolve) => {
      adapter.subscribe((event) => {
        events.push(event as Record<string, unknown>)
        if (event.type === 'message_start') resolve()
      })
    })

    const prompt = adapter.prompt('inspect workspace')
    await firstMessage
    await adapter.abort()
    await prompt
    await sleep(25)

    expect(adapter.readSnapshot().isStreaming).toBe(false)
    expect(events.filter((event) => event.type === 'agent_end')).toEqual([
      expect.objectContaining({
        status: 'aborted',
        messages: [expect.objectContaining({ role: 'assistant', stopReason: 'aborted' })],
      }),
    ])
    const mapper = new PiChatEventMapper({ sessionId: 's1' })
    const mapped = events.flatMap((event) => mapper.map(event))
    expect(mapped.find((event) => event.type === 'agent-end')).toMatchObject({
      type: 'agent-end',
      status: 'aborted',
    })
    expect(JSON.stringify(events)).not.toContain('PI_NATIVE_ASSISTANT_DONE')
  })

  it('continues the next queued follow-up after an abort', async () => {
    const harness = createScriptedPiHarness({ tools: [], cwd: '/workspace' })
    const adapter = await harness.getPiSessionAdapter({ sessionId: 's1', message: '' }, {
      abortSignal: new AbortController().signal,
      workdir: '/workspace',
    })
    const events: Array<Record<string, unknown>> = []
    const firstMessage = new Promise<void>((resolve) => {
      adapter.subscribe((event) => {
        events.push(event as Record<string, unknown>)
        if (event.type === 'message_start') resolve()
      })
    })
    const queuedUser = new Promise<Record<string, unknown>>((resolve) => {
      adapter.subscribe((event) => {
        if (event.type !== 'message_start') return
        const text = JSON.stringify(event)
        if (text.includes('next queued')) resolve(event as Record<string, unknown>)
      })
    })

    await adapter.followUp('next queued', { displayText: 'next queued', clientNonce: 'nonce-next', clientSeq: 1 })
    const prompt = adapter.prompt('initial prompt')
    await firstMessage
    await adapter.abort()
    await prompt
    await sleep(25)
    expect(events.some((event) => event.type === 'message_start' && JSON.stringify(event).includes('next queued'))).toBe(false)
    expect(adapter.readSnapshot().followUpMessages).toEqual(['next queued'])
    await adapter.continueQueuedFollowUp?.()

    const queued = await queuedUser

    expect(queued).toMatchObject({
      type: 'message_start',
      message: expect.objectContaining({
        role: 'user',
        clientNonce: 'nonce-next',
        clientSeq: 1,
      }),
    })
    expect(adapter.readSnapshot().followUpMessages).toEqual([])
    expect(JSON.stringify(adapter.readSnapshot().messages)).toContain('next queued')
  })
})
