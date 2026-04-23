type UIMessageChunk = unknown

interface SessionStore {
  // Concrete session contract lands in the dedicated session bead.
}

export interface AgentHarness {
  readonly id: string
  readonly placement: 'server' | 'browser'

  /** Send a user message. Yields AI SDK UIMessage stream chunks. */
  sendMessage(
    input: SendMessageInput,
    ctx: RunContext,
  ): AsyncIterable<UIMessageChunk>

  /** Session lifecycle; may delegate to an underlying runtime (e.g. pi's JSONL). */
  sessions: SessionStore
}

/* Resume is NOT a harness concern — see Stream resumption section.
   The HTTP route owns cursor buffering + replay; harness stays reconnect-unaware. */

export interface SendMessageInput {
  sessionId: string
  message: string
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high'
  model?: {
    provider: string
    id: string
  }
}

export interface RunContext {
  abortSignal: AbortSignal
  workdir: string
  userId?: string
}
