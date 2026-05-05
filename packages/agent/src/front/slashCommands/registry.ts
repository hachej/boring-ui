export type SlashCommandHandler = (args: string, ctx: SlashCommandContext) => string | void

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
  setModel: (model: string) => boolean
  listCommands: () => SlashCommand[]
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
