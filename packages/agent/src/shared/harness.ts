import type { UIMessageChunk } from './message'
import type { SessionStore } from './session'

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

  /**
   * Resolved system prompt currently in effect for `sessionId`. Returns
   * `undefined` when the underlying runtime hasn't yet instantiated a
   * session (typical pre-first-turn state — pi creates lazily on first
   * `sendMessage`). Optional so non-pi harnesses can opt out cleanly.
   */
  getSystemPrompt?: (sessionId: string) => string | undefined

  /** Reload native agent resources/extensions for an existing session. */
  reloadSession?: (sessionId: string) => Promise<boolean>
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
