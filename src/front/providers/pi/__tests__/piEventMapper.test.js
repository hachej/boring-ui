import { describe, expect, it } from 'vitest'
import { mapAgentEventToChunks, createEventState } from '../piAgentCoreTransport'

/**
 * Tests for the pure event-to-chunk mapping function.
 * This tests the state machine that converts pi-agent-core AgentEvents
 * and AssistantMessageEvents into AI SDK UIMessageChunk objects.
 */

const TS = 1700000000000 // Fixed timestamp for deterministic test IDs

describe('piEventMapper', () => {
  describe('createEventState', () => {
    it('creates initial state with all required fields', () => {
      const state = createEventState(TS)
      expect(state).toEqual({
        activeTextPartId: null,
        activeReasoningPartId: null,
        activeToolCalls: new Map(),
        messageTs: TS,
        finished: false,
      })
    })
  })

  describe('agent lifecycle events', () => {
    it('agent_start emits start chunk with messageId', () => {
      const state = createEventState(TS)
      const { chunks, nextState } = mapAgentEventToChunks(
        { type: 'agent_start' },
        state,
      )
      expect(chunks).toHaveLength(1)
      expect(chunks[0].type).toBe('start')
      expect(chunks[0].messageId).toBeDefined()
      expect(typeof chunks[0].messageId).toBe('string')
      expect(nextState).toBe(state) // no state mutation needed
    })

    it('agent_end emits finish chunk', () => {
      const state = createEventState(TS)
      const { chunks, nextState } = mapAgentEventToChunks(
        { type: 'agent_end', messages: [] },
        state,
      )
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({ type: 'finish', finishReason: 'stop' })
      expect(nextState.finished).toBe(true)
    })

    it('agent_end after finished state emits nothing', () => {
      const state = { ...createEventState(TS), finished: true }
      const { chunks } = mapAgentEventToChunks(
        { type: 'agent_end', messages: [] },
        state,
      )
      expect(chunks).toHaveLength(0)
    })
  })

  describe('turn events', () => {
    it('turn_end emits finish-step chunk', () => {
      const state = createEventState(TS)
      const { chunks } = mapAgentEventToChunks(
        { type: 'turn_end', message: {}, toolResults: [] },
        state,
      )
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({ type: 'finish-step' })
    })

    it('turn_start emits nothing', () => {
      const state = createEventState(TS)
      const { chunks } = mapAgentEventToChunks(
        { type: 'turn_start' },
        state,
      )
      expect(chunks).toHaveLength(0)
    })
  })

  describe('text streaming', () => {
    it('text_start emits text-start chunk with correct id', () => {
      const state = createEventState(TS)
      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'text_start', contentIndex: 0, partial: {} },
      }
      const { chunks, nextState } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'text-start',
        id: `text-0-${TS}`,
      })
      expect(nextState.activeTextPartId).toBe(`text-0-${TS}`)
    })

    it('text_delta emits text-delta chunk with matching id and delta', () => {
      const state = { ...createEventState(TS), activeTextPartId: `text-0-${TS}` }
      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello ', partial: {} },
      }
      const { chunks } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'text-delta',
        id: `text-0-${TS}`,
        delta: 'Hello ',
      })
    })

    it('text_end emits text-end chunk and clears active text part', () => {
      const state = { ...createEventState(TS), activeTextPartId: `text-0-${TS}` }
      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Hello world', partial: {} },
      }
      const { chunks, nextState } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'text-end',
        id: `text-0-${TS}`,
      })
      expect(nextState.activeTextPartId).toBe(null)
    })

    it('multiple text blocks with different contentIndex get different part IDs', () => {
      let state = createEventState(TS)

      // First text block at contentIndex 0
      const { chunks: c1, nextState: s1 } = mapAgentEventToChunks({
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'text_start', contentIndex: 0, partial: {} },
      }, state)
      expect(c1[0].id).toBe(`text-0-${TS}`)

      const { nextState: s2 } = mapAgentEventToChunks({
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'A', partial: {} },
      }, s1)

      // Second text block at contentIndex 2
      const { chunks: c3 } = mapAgentEventToChunks({
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'text_start', contentIndex: 2, partial: {} },
      }, s2)
      expect(c3[0].id).toBe(`text-2-${TS}`)
      expect(c3[0].id).not.toBe(c1[0].id)
    })
  })

  describe('reasoning (thinking) streaming', () => {
    it('thinking_start emits reasoning-start chunk', () => {
      const state = createEventState(TS)
      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'thinking_start', contentIndex: 0, partial: {} },
      }
      const { chunks, nextState } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'reasoning-start',
        id: `reasoning-0-${TS}`,
      })
      expect(nextState.activeReasoningPartId).toBe(`reasoning-0-${TS}`)
    })

    it('thinking_delta emits reasoning-delta chunk', () => {
      const state = { ...createEventState(TS), activeReasoningPartId: `reasoning-0-${TS}` }
      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'Let me think...', partial: {} },
      }
      const { chunks } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'reasoning-delta',
        id: `reasoning-0-${TS}`,
        delta: 'Let me think...',
      })
    })

    it('thinking_end emits reasoning-end chunk and clears active reasoning part', () => {
      const state = { ...createEventState(TS), activeReasoningPartId: `reasoning-0-${TS}` }
      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: 'thought complete', partial: {} },
      }
      const { chunks, nextState } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'reasoning-end',
        id: `reasoning-0-${TS}`,
      })
      expect(nextState.activeReasoningPartId).toBe(null)
    })
  })

  describe('tool call streaming', () => {
    it('toolcall_start emits tool-input-start with placeholder ID', () => {
      const state = createEventState(TS)
      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, partial: {} },
      }
      const { chunks, nextState } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'tool-input-start',
        toolCallId: `pending-tool-1-${TS}`,
        toolName: '',
      })
      expect(nextState.activeToolCalls.get(1)).toEqual({
        placeholderId: `pending-tool-1-${TS}`,
      })
    })

    it('toolcall_delta emits tool-input-delta with matching placeholder', () => {
      const state = createEventState(TS)
      state.activeToolCalls.set(1, { placeholderId: `pending-tool-1-${TS}` })

      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1, delta: '{"path": "src/', partial: {} },
      }
      const { chunks } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'tool-input-delta',
        toolCallId: `pending-tool-1-${TS}`,
        inputTextDelta: '{"path": "src/',
      })
    })

    it('toolcall_end emits tool-input-available with REAL toolCallId, toolName, input', () => {
      const state = createEventState(TS)
      state.activeToolCalls.set(1, { placeholderId: `pending-tool-1-${TS}` })

      const toolCall = {
        id: 'toolu_abc123',
        name: 'read_file',
        arguments: { path: 'src/main.js' },
      }
      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: {
          type: 'toolcall_end',
          contentIndex: 1,
          toolCall,
          partial: {},
        },
      }
      const { chunks, nextState } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'tool-input-available',
        toolCallId: 'toolu_abc123',
        toolName: 'read_file',
        input: { path: 'src/main.js' },
      })
      // H-6: entry is cleaned up after toolcall_end to prevent unbounded Map growth
      expect(nextState.activeToolCalls.has(1)).toBe(false)
    })

    it('tool_execution_end (success) emits tool-output-available', () => {
      const state = createEventState(TS)
      const event = {
        type: 'tool_execution_end',
        toolCallId: 'toolu_abc123',
        toolName: 'read_file',
        result: { content: [{ type: 'text', text: 'file contents' }] },
        isError: false,
      }
      const { chunks } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'tool-output-available',
        toolCallId: 'toolu_abc123',
        output: { content: [{ type: 'text', text: 'file contents' }] },
      })
    })

    it('tool_execution_end (error) emits tool-output-error', () => {
      const state = createEventState(TS)
      const event = {
        type: 'tool_execution_end',
        toolCallId: 'toolu_abc123',
        toolName: 'read_file',
        result: 'ENOENT: no such file or directory',
        isError: true,
      }
      const { chunks } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'tool-output-error',
        toolCallId: 'toolu_abc123',
        errorText: 'ENOENT: no such file or directory',
      })
    })

    it('multiple concurrent tool calls tracked independently', () => {
      let state = createEventState(TS)

      // Tool call at contentIndex 1
      const { nextState: s1 } = mapAgentEventToChunks({
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, partial: {} },
      }, state)

      // Tool call at contentIndex 3
      const { nextState: s2 } = mapAgentEventToChunks({
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'toolcall_start', contentIndex: 3, partial: {} },
      }, s1)

      expect(s2.activeToolCalls.size).toBe(2)
      expect(s2.activeToolCalls.get(1).placeholderId).toBe(`pending-tool-1-${TS}`)
      expect(s2.activeToolCalls.get(3).placeholderId).toBe(`pending-tool-3-${TS}`)
    })
  })

  describe('interleaved events', () => {
    it('text -> tool call -> tool result -> text -> agent_end produces correct sequence', () => {
      let state = createEventState(TS)
      const allChunks = []

      const emit = (event) => {
        const { chunks, nextState } = mapAgentEventToChunks(event, state)
        allChunks.push(...chunks)
        state = nextState
      }

      // Text block
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_start', contentIndex: 0, partial: {} } })
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Let me read that file.', partial: {} } })
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Let me read that file.', partial: {} } })

      // Tool call
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, partial: {} } })
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1, delta: '{"path":"src/main.js"}', partial: {} } })
      emit({
        type: 'message_update', message: {}, assistantMessageEvent: {
          type: 'toolcall_end', contentIndex: 1,
          toolCall: { id: 'tc_1', name: 'read_file', arguments: { path: 'src/main.js' } },
          partial: {},
        },
      })

      // Tool execution
      emit({ type: 'tool_execution_end', toolCallId: 'tc_1', toolName: 'read_file', result: 'file contents', isError: false })

      // Second text block (new turn)
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_start', contentIndex: 0, partial: {} } })
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Here is the content.', partial: {} } })
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Here is the content.', partial: {} } })

      // Agent done
      emit({ type: 'agent_end', messages: [] })

      expect(allChunks.map((c) => c.type)).toEqual([
        'text-start',
        'text-delta',
        'text-end',
        'tool-input-start',
        'tool-input-delta',
        'tool-input-available',
        'tool-output-available',
        'text-start',
        'text-delta',
        'text-end',
        'finish',
      ])
    })
  })

  describe('multi-turn agent loop', () => {
    it('stream stays open across turns, closes only on agent_end', () => {
      let state = createEventState(TS)
      const allChunks = []

      const emit = (event) => {
        const { chunks, nextState } = mapAgentEventToChunks(event, state)
        allChunks.push(...chunks)
        state = nextState
      }

      // Turn 1
      emit({ type: 'turn_start' })
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_start', contentIndex: 0, partial: {} } })
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Turn 1', partial: {} } })
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Turn 1', partial: {} } })
      emit({ type: 'turn_end', message: {}, toolResults: [] })

      // Not finished yet
      expect(state.finished).toBe(false)

      // Turn 2
      emit({ type: 'turn_start' })
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_start', contentIndex: 0, partial: {} } })
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Turn 2', partial: {} } })
      emit({ type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Turn 2', partial: {} } })
      emit({ type: 'turn_end', message: {}, toolResults: [] })

      // Still not finished
      expect(state.finished).toBe(false)

      // Agent end
      emit({ type: 'agent_end', messages: [] })
      expect(state.finished).toBe(true)

      // Verify turn structure
      const types = allChunks.map((c) => c.type)
      expect(types).toContain('finish-step') // from turn_end
      expect(types.filter((t) => t === 'finish-step')).toHaveLength(2)
      expect(types[types.length - 1]).toBe('finish') // agent_end is last
    })
  })

  describe('error handling', () => {
    it('assistantMessageEvent error produces error chunk and sets finished', () => {
      const state = createEventState(TS)
      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'error', reason: 'error', error: { message: 'API rate limit exceeded' } },
      }
      const { chunks, nextState } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0].type).toBe('error')
      expect(chunks[0].errorText).toContain('API rate limit exceeded')
      expect(nextState.finished).toBe(true)
    })

    it('error with reason "aborted" produces error chunk', () => {
      const state = createEventState(TS)
      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'error', reason: 'aborted', error: { message: 'User cancelled' } },
      }
      const { chunks, nextState } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0].type).toBe('error')
      expect(nextState.finished).toBe(true)
    })

    it('agent_end after error does not double-finish', () => {
      let state = createEventState(TS)
      const allChunks = []

      const emit = (event) => {
        const { chunks, nextState } = mapAgentEventToChunks(event, state)
        allChunks.push(...chunks)
        state = nextState
      }

      // Error event
      emit({
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'error', reason: 'error', error: { message: 'fail' } },
      })

      // Agent end after error
      emit({ type: 'agent_end', messages: [] })

      // Only one error + no duplicate finish
      const types = allChunks.map((c) => c.type)
      expect(types.filter((t) => t === 'finish')).toHaveLength(0) // finish suppressed after error
      expect(types.filter((t) => t === 'error')).toHaveLength(1)
    })
  })

  describe('abort handling', () => {
    it('finished flag prevents post-close enqueues', () => {
      const state = { ...createEventState(TS), finished: true }

      // All events should produce empty chunks when finished
      const events = [
        { type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'late', partial: {} } },
        { type: 'turn_end', message: {}, toolResults: [] },
        { type: 'tool_execution_end', toolCallId: 'tc_1', toolName: 'x', result: 'y', isError: false },
      ]

      for (const event of events) {
        const { chunks } = mapAgentEventToChunks(event, state)
        expect(chunks).toHaveLength(0)
      }
    })
  })

  describe('message_start and message_end', () => {
    it('message_start emits nothing', () => {
      const state = createEventState(TS)
      const { chunks } = mapAgentEventToChunks(
        { type: 'message_start', message: {} },
        state,
      )
      expect(chunks).toHaveLength(0)
    })

    it('message_end emits nothing (text-end already covers it)', () => {
      const state = createEventState(TS)
      const { chunks } = mapAgentEventToChunks(
        { type: 'message_end', message: {} },
        state,
      )
      expect(chunks).toHaveLength(0)
    })
  })

  describe('assistantMessageEvent start/done', () => {
    it('assistantMessageEvent type "start" emits nothing', () => {
      const state = createEventState(TS)
      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'start', partial: {} },
      }
      const { chunks } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(0)
    })

    it('assistantMessageEvent type "done" emits nothing (agent_end handles it)', () => {
      const state = createEventState(TS)
      const event = {
        type: 'message_update',
        message: {},
        assistantMessageEvent: { type: 'done', reason: 'stop', message: {} },
      }
      const { chunks } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(0)
    })
  })

  describe('tool_execution_start and tool_execution_update', () => {
    it('tool_execution_start emits nothing', () => {
      const state = createEventState(TS)
      const event = {
        type: 'tool_execution_start',
        toolCallId: 'tc_1',
        toolName: 'read_file',
        args: { path: 'x' },
      }
      const { chunks } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(0)
    })

    it('tool_execution_update with non-null partialResult emits preliminary tool-output-available', () => {
      const state = createEventState(TS)
      const event = {
        type: 'tool_execution_update',
        toolCallId: 'tc_1',
        toolName: 'bash',
        args: {},
        partialResult: 'partial output line 1\n',
      }
      const { chunks } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'tool-output-available',
        toolCallId: 'tc_1',
        output: 'partial output line 1\n',
        preliminary: true,
      })
    })

    it('tool_execution_update with null partialResult emits nothing', () => {
      const state = createEventState(TS)
      const event = {
        type: 'tool_execution_update',
        toolCallId: 'tc_1',
        toolName: 'bash',
        args: {},
        partialResult: null,
      }
      const { chunks } = mapAgentEventToChunks(event, state)
      expect(chunks).toHaveLength(0)
    })
  })
})
