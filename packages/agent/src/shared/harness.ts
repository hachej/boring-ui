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

  /**
   * Queue a follow-up message for delivery after the current streaming turn.
   * When called while a `sendMessage` stream is active, the harness keeps
   * the HTTP stream open after `agent_end` and processes the follow-up as a
   * second turn in the same response — no extra round-trip needed.
   * A `data-followup-consumed` chunk is emitted before the follow-up turn so
   * the client can clear its pending-message bubble immediately.
   */
  followUp?(sessionId: string, text: string): void

  /**
   * Discard any queued follow-up for this session (called by the Stop button).
   */
  clearFollowUp?(sessionId: string): void
}

/* Resume is NOT a harness concern — see Stream resumption section.
   The HTTP route owns cursor buffering + replay; harness stays reconnect-unaware. */

export interface MessageAttachment {
  filename?: string
  mediaType?: string
  /** data: URL (base64) or remote URL */
  url: string
}

export interface SendMessageInput {
  sessionId: string
  message: string
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high'
  model?: {
    provider: string
    id: string
  }
  attachments?: MessageAttachment[]
}

export interface RunContext {
  abortSignal: AbortSignal
  workdir: string
  userId?: string
}
