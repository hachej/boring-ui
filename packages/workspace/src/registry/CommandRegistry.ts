import type { CommandConfig } from "./types"

export class CommandRegistry {
  private commands = new Map<string, CommandConfig>()

  registerCommand(config: CommandConfig): void {
    this.commands.set(config.id, config)
  }

  getCommand(id: string): CommandConfig | undefined {
    return this.commands.get(id)
  }

  getCommands(): CommandConfig[] {
    return Array.from(this.commands.values())
  }

  getActiveCommands(): CommandConfig[] {
    return this.getCommands().filter((cmd) => {
      if (!cmd.when) return true
      try {
        return cmd.when()
      } catch {
        return false
      }
    })
  }
}
