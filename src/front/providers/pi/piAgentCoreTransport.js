/**
 * PiAgentCoreTransport — ChatTransport adapter bridging pi-agent-core's Agent
 * class to the Vercel AI SDK useChat hook.
 *
 * Converts pi-agent-core AgentEvents and AssistantMessageEvents into
 * AI SDK UIMessageChunk objects via a pure event state machine.
 *
 * The Agent instance is long-lived (created once, reused across sendMessages
 * calls) because it holds conversation state across turns.
 */

// ---------------------------------------------------------------------------
// Event State Machine (pure, testable)
// ---------------------------------------------------------------------------

/**
 * Creates initial event mapping state for a single sendMessages() call.
 * @param {number} messageTs - Timestamp for generating unique part IDs
 * @returns {EventState}
 */
export function createEventState(messageTs) {
  return {
    activeTextPartId: null,
    activeReasoningPartId: null,
    activeToolCalls: new Map(), // contentIndex -> { placeholderId, realId? }
    messageTs,
    finished: false,
  }
}

/**
 * Pure function: maps a single pi-agent-core event to zero or more AI SDK
 * UIMessageChunk objects plus the next state.
 *
 * @param {AgentEvent} event - pi-agent-core event
 * @param {EventState} state - current mapping state
 * @returns {{ chunks: UIMessageChunk[], nextState: EventState }}
 */
export function mapAgentEventToChunks(event, state) {
  // Guard: if finished, emit nothing
  if (state.finished) {
    return { chunks: [], nextState: state }
  }

  switch (event.type) {
    case 'agent_start': {
      const messageId = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `msg-${state.messageTs}-${Math.random().toString(36).slice(2, 8)}`
      return {
        chunks: [{ type: 'start', messageId }],
        nextState: state,
      }
    }

    case 'agent_end': {
      const nextState = { ...state, finished: true }
      return {
        chunks: [{ type: 'finish', finishReason: 'stop' }],
        nextState,
      }
    }

    case 'turn_start':
      return { chunks: [], nextState: state }

    case 'turn_end':
      return { chunks: [{ type: 'finish-step' }], nextState: state }

    case 'message_start':
    case 'message_end':
      return { chunks: [], nextState: state }

    case 'tool_execution_start':
      return { chunks: [], nextState: state }

    case 'tool_execution_update': {
      if (event.partialResult == null) {
        return { chunks: [], nextState: state }
      }
      return {
        chunks: [{
          type: 'tool-output-available',
          toolCallId: event.toolCallId,
          output: event.partialResult,
          preliminary: true,
        }],
        nextState: state,
      }
    }

    case 'tool_execution_end': {
      if (event.isError) {
        return {
          chunks: [{
            type: 'tool-output-error',
            toolCallId: event.toolCallId,
            errorText: String(event.result),
          }],
          nextState: state,
        }
      }
      return {
        chunks: [{
          type: 'tool-output-available',
          toolCallId: event.toolCallId,
          output: event.result,
        }],
        nextState: state,
      }
    }

    case 'message_update':
      return _mapAssistantMessageEvent(event, state)

    default:
      return { chunks: [], nextState: state }
  }
}

/**
 * Maps assistantMessageEvent sub-events within a message_update event.
 * @private
 */
function _mapAssistantMessageEvent(event, state) {
  const ame = event.assistantMessageEvent
  if (!ame) return { chunks: [], nextState: state }

  const { messageTs } = state

  switch (ame.type) {
    // Lifecycle events — no chunk emission
    case 'start':
    case 'done':
      return { chunks: [], nextState: state }

    // --- Text streaming ---
    case 'text_start': {
      const partId = `text-${ame.contentIndex}-${messageTs}`
      const nextState = { ...state, activeTextPartId: partId }
      return {
        chunks: [{ type: 'text-start', id: partId }],
        nextState,
      }
    }

    case 'text_delta':
      // H-5: guard against null ID (network hiccup may drop text_start)
      if (!state.activeTextPartId) return { chunks: [], nextState: state }
      return {
        chunks: [{
          type: 'text-delta',
          id: state.activeTextPartId,
          delta: ame.delta,
        }],
        nextState: state,
      }

    case 'text_end': {
      const nextState = { ...state, activeTextPartId: null }
      return {
        chunks: [{ type: 'text-end', id: state.activeTextPartId }],
        nextState,
      }
    }

    // --- Reasoning (thinking) streaming ---
    case 'thinking_start': {
      const partId = `reasoning-${ame.contentIndex}-${messageTs}`
      const nextState = { ...state, activeReasoningPartId: partId }
      return {
        chunks: [{ type: 'reasoning-start', id: partId }],
        nextState,
      }
    }

    case 'thinking_delta':
      // H-5: guard against null ID
      if (!state.activeReasoningPartId) return { chunks: [], nextState: state }
      return {
        chunks: [{
          type: 'reasoning-delta',
          id: state.activeReasoningPartId,
          delta: ame.delta,
        }],
        nextState: state,
      }

    case 'thinking_end': {
      const nextState = { ...state, activeReasoningPartId: null }
      return {
        chunks: [{ type: 'reasoning-end', id: state.activeReasoningPartId }],
        nextState,
      }
    }

    // --- Tool call streaming ---
    case 'toolcall_start': {
      const placeholderId = `pending-tool-${ame.contentIndex}-${messageTs}`
      const nextToolCalls = new Map(state.activeToolCalls)
      nextToolCalls.set(ame.contentIndex, { placeholderId })
      const nextState = { ...state, activeToolCalls: nextToolCalls }
      return {
        chunks: [{
          type: 'tool-input-start',
          toolCallId: placeholderId,
          toolName: '',
        }],
        nextState,
      }
    }

    case 'toolcall_delta': {
      const entry = state.activeToolCalls.get(ame.contentIndex)
      // P1: don't emit if entry missing (out-of-order events)
      if (!entry) return { chunks: [], nextState: state }
      return {
        chunks: [{
          type: 'tool-input-delta',
          toolCallId: entry.placeholderId,
          inputTextDelta: ame.delta,
        }],
        nextState: state,
      }
    }

    case 'toolcall_end': {
      const toolCall = ame.toolCall
      const nextToolCalls = new Map(state.activeToolCalls)
      // H-6: remove entry after emitting — prevents unbounded Map growth in long chats
      nextToolCalls.delete(ame.contentIndex)
      const nextState = { ...state, activeToolCalls: nextToolCalls }
      return {
        chunks: [{
          type: 'tool-input-available',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: toolCall.arguments,
        }],
        nextState,
      }
    }

    // --- Error ---
    case 'error': {
      const errorText = ame.error?.message || ame.reason || 'Unknown error'
      const nextState = { ...state, finished: true }
      return {
        chunks: [{ type: 'error', errorText }],
        nextState,
      }
    }

    default:
      return { chunks: [], nextState: state }
  }
}

// ---------------------------------------------------------------------------
// PiAgentCoreTransport class
// ---------------------------------------------------------------------------

export class PiAgentCoreTransport {
  /**
   * @param {Object} options
   * @param {Array} options.tools - PI tool definitions (from defaultTools.js)
   * @param {Function} [options.getApiKey] - Dynamic API key resolver
   * @param {Function} [options.convertToLlm] - Message converter for LLM calls
   * @param {string} [options.sessionId] - Initial session ID
   */
  constructor({ tools, getApiKey, convertToLlm, sessionId } = {}) {
    this._tools = tools || []
    this._getApiKey = getApiKey || null
    this._convertToLlm = convertToLlm || null
    this._sessionId = sessionId || null
    this._agent = null
    this._agentInitPromise = null // H-1: mutex for concurrent _ensureAgent calls
    this._agentVersion = 0 // P0: version token for reset-during-stream detection
  }

  get agent() {
    return this._agent
  }

  /**
   * Update tools without recreating the agent.
   * @param {Array} tools
   */
  updateTools(tools) {
    this._tools = tools || []
    if (this._agent) {
      this._agent.setTools(this._tools)
    }
  }

  /**
   * Lazily creates an Agent instance if one does not exist.
   * Called internally before each sendMessages() call.
   */
  async _ensureAgent() {
    if (this._agent) return
    // H-1: Mutex — if another call is already initializing, wait for it
    if (this._agentInitPromise) {
      await this._agentInitPromise
      return
    }
    this._agentInitPromise = this._initAgent()
    try {
      await this._agentInitPromise
    } finally {
      this._agentInitPromise = null
    }
  }

  async _initAgent() {
    // Dynamic imports to avoid pulling in pi-agent-core at module scope
    // (allows tree-shaking when not using browser mode)
    const { Agent } = await import('@mariozechner/pi-agent-core')
    const { getModel } = await import('@mariozechner/pi-ai')
    const { getPiAgentConfig } = await import('./agentConfig')

    const config = getPiAgentConfig()

    const model =
      getModel('anthropic', 'claude-sonnet-4-5-20250929') ||
      getModel('openai', 'gpt-4o-mini') ||
      getModel('google', 'gemini-2.5-flash') ||
      null

    if (!model) {
      throw new Error(
        'PiAgentCoreTransport: No model available. Ensure at least one provider API key is configured.',
      )
    }

    const agentOptions = {
      initialState: {
        systemPrompt: config.systemPrompt || 'You are a helpful coding assistant.',
        model,
        thinkingLevel: 'off',
        messages: [],
        tools: this._tools,
      },
    }

    if (this._convertToLlm) {
      agentOptions.convertToLlm = this._convertToLlm
    }

    this._agent = new Agent(agentOptions)

    if (this._sessionId) {
      this._agent.sessionId = this._sessionId
    }
  }

  /**
   * Reset the agent (e.g., on session switch). Aborts current streaming,
   * creates a new Agent with the given session data.
   * @param {Object} [sessionData] - Session data (messages, model, thinkingLevel)
   */
  resetAgent(sessionData) {
    this._agentVersion++ // P0: invalidate any in-flight sendMessages
    if (this._agent) {
      try { this._agent.abort() } catch (_) {}
    }
    this._agent = null
    this._agentInitPromise = null
    if (sessionData?.id) {
      this._sessionId = sessionData.id
    }
  }

  /**
   * Implements the ChatTransport interface for Vercel AI SDK useChat.
   *
   * @param {Object} options
   * @param {Array} options.messages - AI SDK UIMessage array
   * @param {AbortSignal} [options.abortSignal] - Signal to cancel streaming
   * @param {string} [options.trigger] - Trigger type ('user-message', 'regenerate-message', etc.)
   * @returns {ReadableStream<UIMessageChunk>}
   */
  async sendMessages({ messages, abortSignal, trigger }) {
    // Edge case: already aborted
    if (abortSignal?.aborted) {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'finish', finishReason: 'stop' })
          controller.close()
        },
      })
    }

    // Edge case: no user messages
    const userMessages = (messages || []).filter((m) => m.role === 'user')
    const lastUserMessage = userMessages[userMessages.length - 1]
    if (!lastUserMessage) {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'finish', finishReason: 'stop' })
          controller.close()
        },
      })
    }

    // Extract text from last user message
    let userText = ''
    if (typeof lastUserMessage.content === 'string') {
      userText = lastUserMessage.content
    } else if (Array.isArray(lastUserMessage.parts)) {
      userText = lastUserMessage.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('')
    } else if (typeof lastUserMessage.content === 'object' && Array.isArray(lastUserMessage.content)) {
      userText = lastUserMessage.content
        .filter((p) => p?.type === 'text')
        .map((p) => p.text)
        .join('')
    }

    const versionBefore = this._agentVersion
    await this._ensureAgent()

    // P0: if agent was reset during await, abort this stream
    if (versionBefore !== this._agentVersion) {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'finish', finishReason: 'stop' })
          controller.close()
        },
      })
    }

    // Wait for agent to be idle if already running
    if (this._agent.waitForIdle) {
      await this._agent.waitForIdle()
    }

    const agent = this._agent

    // H-3: track abort listener for cleanup
    let abortCleanup = null

    return new ReadableStream({
      start: (controller) => {
        let eventState = createEventState(Date.now())
        let unsubscribe = () => {}

        const enqueueChunks = (chunks) => {
          for (const chunk of chunks) {
            if (!eventState.finished || chunk.type === 'finish' || chunk.type === 'error') {
              controller.enqueue(chunk)
            }
          }
        }

        const closeStream = () => {
          if (!eventState.finished) {
            eventState = { ...eventState, finished: true }
          }
          try {
            controller.close()
          } catch (_) {
            // Stream may already be closed
          }
          unsubscribe()
        }

        // Subscribe to agent events for this sendMessages() call
        try {
          unsubscribe = agent.subscribe((event) => {
            const { chunks, nextState } = mapAgentEventToChunks(event, eventState)
            eventState = nextState

            if (chunks.length > 0) {
              enqueueChunks(chunks)
            }

            // If the mapping marked us finished, close the stream
            if (nextState.finished) {
              closeStream()
            }
          })
        } catch (err) {
          // P1: ensure cleanup if subscribe throws
          controller.enqueue({ type: 'error', errorText: String(err?.message || err) })
          closeStream()
          return
        }

        // Wire abort signal
        const onAbort = () => {
          if (!eventState.finished) {
            eventState = { ...eventState, finished: true }
            try { agent.abort() } catch (err) {
              // P1: surface abort errors instead of swallowing
              try { controller.enqueue({ type: 'error', errorText: String(err?.message || err) }) } catch (_) {}
            }
            try { controller.close() } catch (_) {}
            unsubscribe()
          }
          if (abortSignal) abortSignal.removeEventListener('abort', onAbort)
        }
        if (abortSignal) {
          abortSignal.addEventListener('abort', onAbort, { once: true })
          // H-2+M-3: store for cancel() cleanup
          abortCleanup = () => {
            abortSignal.removeEventListener('abort', onAbort)
            onAbort()
          }
        } else {
          abortCleanup = onAbort
        }

        // Start the agent loop
        agent.prompt(userText).catch((err) => {
          if (!eventState.finished) {
            controller.enqueue({ type: 'error', errorText: String(err?.message || err) })
            closeStream()
          }
        })
      },
      // H-2: Handle stream.cancel() (e.g., component unmount, in-app browser hiding)
      cancel() {
        if (abortCleanup) abortCleanup()
      },
    })
  }

  /**
   * No server-side stream to reconnect to in browser mode.
   * @returns {null}
   */
  async reconnectToStream() {
    return null
  }
}
