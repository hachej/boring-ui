import type { SessionStore } from './session'
import type { TelemetrySink } from './telemetry'
import type { AgentTool } from './tool'
import type { AgentSendInput, MessageAttachment } from './events'
import type { AgentSessionEvent, PromptOptions } from '@mariozechner/pi-coding-agent'

export interface AgentHarnessFactoryInput {
  tools: AgentTool[]
  /** Host/storage cwd used for harness-owned filesystem resources. */
  cwd: string
  /** Agent-visible cwd used by Pi/system prompt/session metadata. */
  runtimeCwd?: string
  systemPromptAppend?: string
  sessionNamespace?: string
  sessionRoot?: string
  sessionDir?: string
  /** Explicit direct/local capability for bare native Pi first sends. */
  nativeSessionStartEnabled?: boolean
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

export interface AgentCoreSessionSnapshot {
  state: unknown
  messages: readonly unknown[]
  isStreaming: boolean
  isRetrying: boolean
  retryAttempt: number
  pendingMessageCount: number
  steeringMessages: readonly string[]
  followUpMessages: readonly string[]
  followUpMode: 'all' | 'one-at-a-time'
  sessionId: string
  sessionName?: string
}

export type AgentCorePromptInput = string | { text: string; options?: PromptOptions }

export interface AgentCoreSessionAdapter {
  readSnapshot(): AgentCoreSessionSnapshot
  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  prompt(input: AgentCorePromptInput): Promise<void>
  followUp(text: string, options?: never): Promise<void>
  clearFollowUp(options?: never): void
  abort(): Promise<void>
  abortRetry?: () => void
  continueQueuedFollowUp?: () => Promise<void>
}

export type AgentCoreHarness = AgentHarness & {
  getPiSessionAdapter(input: AgentSendInput, ctx: RunContext): Promise<AgentCoreSessionAdapter>
  hasPiSession?: (sessionId: string, ctx?: { workspaceId?: string; userId?: string }) => boolean
}

export type AgentCoreHarnessFactory = (input: AgentHarnessFactoryInput) => AgentCoreHarness | Promise<AgentCoreHarness>

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

  /** Reload native agent resources/extensions for an existing session. */
  reloadSession?: (sessionId: string) => Promise<boolean>

  /**
   * Resource (skill/extension) load diagnostics for an existing session.
   * Returns `[]` when the session has no live agent session yet. Lets the
   * /reload route and the `plugin_diagnostics` tool surface silent
   * skill/extension load failures back to the UI and the agent.
   */
  getResourceDiagnostics?: (sessionId: string) => Array<{ source: string; message: string; path?: string }>

  /** List slash commands registered in the agent runtime for a given session. */
  getSlashCommands?: (sessionId: string, ctx: RunContext) => ReadonlyArray<AgentSlashCommandSummary> | Promise<ReadonlyArray<AgentSlashCommandSummary>>

  /**
   * Execute a named slash command registered via `pi.registerCommand` in a
   * plugin extension. Calls the handler in-process; the handler may dispatch
   * UI commands (openPanel, notify) through the workspace bridge. Throws if
   * the command is not found or the handler throws.
   */
  executeSlashCommand?: (sessionId: string, name: string, args: string, ctx: RunContext) => Promise<void>
}

export interface AgentSlashCommandSummary {
  name: string
  description?: string
  source: 'extension' | 'prompt' | 'skill'
  /**
   * Name of the originating plugin/package, when derivable from Pi's
   * sourceInfo (e.g. a `.pi/extensions/<name>` runtime plugin, or an
   * `npm:`/`git/` package). Surfaced as a tag in the slash-command picker.
   * Absent for built-in/top-level commands with no package origin.
   */
  sourcePlugin?: string
}

/* Resume is NOT a harness concern — see Stream resumption section.
   The HTTP route owns cursor buffering + replay; harness stays reconnect-unaware. */

export type { AgentSendInput, MessageAttachment }
/** @deprecated Use AgentSendInput.content. Kept so existing shared consumers compile during the P1 rename. */
export type SendMessageInput = AgentSendInput & {
  sessionId: string
  message: string
}

export interface RunContext {
  abortSignal: AbortSignal
  workdir: string
  workspaceId?: string
  requestId?: string
  userId?: string
  userEmail?: string
  userEmailVerified?: boolean
  /** When false, slash-command fallback through native model prompt must fail closed. */
  allowPromptDispatch?: boolean
}
