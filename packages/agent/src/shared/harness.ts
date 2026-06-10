import type { SessionStore } from './session'
import type { TelemetrySink } from './telemetry'
import type { AgentTool } from './tool'

export interface AgentHarnessFactoryInput {
  tools: AgentTool[]
  /** Host/storage cwd used for harness-owned filesystem resources. */
  cwd: string
  /** Agent-visible cwd used by Pi/system prompt/session metadata. */
  runtimeCwd?: string
  systemPromptAppend?: string
  sessionNamespace?: string
  sessionDir?: string
  /**
   * Optional dynamic system-prompt source. Harness calls it whenever it
   * builds or rebuilds a session prompt and appends the returned string.
   * Workspace plugin layer wires this so live-reloaded plugins can contribute
   * prompt context without a workspace-injected harness extension.
   */
  systemPromptDynamic?: () => string | undefined | Promise<string | undefined>
  /** Host-provided telemetry sink. Optional and best-effort; harnesses may ignore it. */
  telemetry?: TelemetrySink
}

export type AgentHarnessFactory = (input: AgentHarnessFactoryInput) => AgentHarness | Promise<AgentHarness>

export interface AgentHarness {
  readonly id: string
  readonly placement: 'server' | 'browser'

  /** Session lifecycle; may delegate to an underlying runtime (e.g. pi's JSONL). */
  sessions: SessionStore

  /**
   * Resolved system prompt currently in effect for `sessionId`. Returns
   * `undefined` when the underlying runtime hasn't yet instantiated a
   * session (typical pre-first-turn state — pi creates lazily on the first
   * prompt). Optional so non-pi harnesses can opt out cleanly.
   */
  getSystemPrompt?: (sessionId: string) => string | undefined

  /**
   * Queue a follow-up message for delivery after the current turn. The
   * pi-chat service calls this when a prompt arrives mid-turn; the harness
   * records it (nonce-deduped) and hands it to pi's native follow-up queue.
   */
  followUp?(
    sessionId: string,
    text: string,
    attachments?: MessageAttachment[],
    displayText?: string,
    options?: FollowUpOptions,
  ): void | Promise<void>

  /**
   * Discard queued follow-up(s) for this session (called by the Stop button or
   * by a queued-message delete action). When `options` identifies a single
   * client message, implementations should remove only that item if possible.
   */
  clearFollowUp?(sessionId: string, options?: FollowUpOptions): void

  /** Reload native agent resources/extensions for an existing session. */
  reloadSession?: (sessionId: string) => Promise<boolean>
}

export interface FollowUpOptions {
  clientNonce?: string
  clientSeq?: number
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
