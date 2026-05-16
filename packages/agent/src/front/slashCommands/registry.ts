export type SlashCommandHandler = (args: string, ctx: SlashCommandContext) => string | void | Promise<string | void>

export interface SlashCommand {
  name: string
  description: string
  /** 'skill' commands are forwarded to the PI agent as `skill: <name>\n\n<args>` instead of running locally. */
  kind?: 'local' | 'skill'
  handler: SlashCommandHandler
}

export interface SlashCommandContext {
  sessionId: string
  clearMessages: () => void
  resetSession: () => void
  /** Explicit provider-qualified model selection (`provider:id` or `{ provider, id }`). */
  setModel: (model: string | { provider: string; id: string }) => boolean
  listCommands: () => SlashCommand[]
  reloadAgentPlugins: () => Promise<string>
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
    get(name: string) {
      return commands.get(name)
    },
    list() {
      return Array.from(commands.values())
    },
  }
}
