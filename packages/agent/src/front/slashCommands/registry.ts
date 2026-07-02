export type SlashCommandHandlerResult = string | void | { message?: string; preserveDraft?: boolean }
export type SlashCommandHandler = (args: string, ctx: SlashCommandContext) => SlashCommandHandlerResult | Promise<SlashCommandHandlerResult>
export type SlashCommandClickBehavior = 'execute' | 'insert' | 'disabled'

export interface SlashCommand {
  name: string
  description: string
  /**
   * - local: handled in the browser.
   * - skill: forwarded to the PI agent as `skill: <name>\n\n<args>`.
   * Server commands registered via `useServerCommands` omit `kind` (or set
   * it to `local`) — Pi handles execution natively so no frontend kind-check
   * is needed.
   */
  kind?: 'local' | 'skill'
  clickBehavior?: SlashCommandClickBehavior
  /**
   * Origin of the command, surfaced as a tag in the slash-command picker.
   * Mirrors Pi's command sources for server commands; `local` for built-in
   * browser commands. Display only.
   */
  source?: 'local' | 'extension' | 'prompt' | 'skill'
  /** Originating plugin/package name (when known), shown as a tag. */
  sourcePlugin?: string
  handler: SlashCommandHandler
}

export interface SlashCommandContext {
  sessionId: string
  clearMessages: () => void
  resetSession: () => void
  listCommands: () => SlashCommand[]
  reloadAgentPlugins: () => Promise<string>
  openModelPicker?: () => boolean | void
  selectComposerModel?: (query: string) => string | void
  openThinkingPicker?: () => boolean | void
  selectComposerThinking?: (query: string) => string | void
  /**
   * Drives the PluginUpdateStatus banner above the composer. The `/reload`
   * builtin prefers this over the inline-text path: it calls
   * `pluginUpdate.run()` which (1) sets the banner to "running", (2)
   * hits /api/v1/agent/reload, (3) transitions to "success" or "error"
   * with diagnostics. Returns a short string ack for the assistant
   * message bubble.
   */
  pluginUpdate?: {
    run: () => Promise<string>
  }
}

export interface CommandRegistry {
  register(cmd: SlashCommand): void
  unregister(name: string): void
  get(name: string): SlashCommand | undefined
  list(): SlashCommand[]
}

export function createCommandRegistry(initial?: SlashCommand[]): CommandRegistry {
  const commands = new Map<string, SlashCommand>()

  for (const cmd of initial ?? []) {
    commands.set(cmd.name, cmd)
  }

  return {
    register(cmd: SlashCommand) {
      commands.set(cmd.name, cmd)
    },
    unregister(name: string) {
      commands.delete(name)
    },
    get(name: string) {
      return commands.get(name)
    },
    list() {
      return Array.from(commands.values())
    },
  }
}
