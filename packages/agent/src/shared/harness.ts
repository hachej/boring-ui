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
