import type { CommandConfig } from "./types"

export class CommandRegistry {
  private commands = new Map<string, CommandConfig>()
  private listeners = new Set<() => void>()
  private snapshotCache: readonly CommandConfig[] | null = null

  registerCommand(config: CommandConfig): void {
    this.commands.set(config.id, config)
    this.emit()
  }

  unregisterByPluginId(pluginId: string): void {
    let changed = false
    for (const [id, cmd] of this.commands) {
      if (cmd.pluginId === pluginId) {
        this.commands.delete(id)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  unregisterCommand(id: string): void {
    if (this.commands.delete(id)) this.emit()
  }

  /**
   * Atomic replace by pluginId: drop owned commands and register the new
   * set in one emit. Pi parity for reload semantics.
   */
  replaceByPluginId(pluginId: string, commands: CommandConfig[]): void {
    let changed = false
    for (const [id, cmd] of this.commands) {
      if (cmd.pluginId === pluginId) {
        this.commands.delete(id)
        changed = true
      }
    }
    for (const config of commands) {
      this.commands.set(config.id, { ...config, pluginId })
      changed = true
    }
    if (changed) this.emit()
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

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  getSnapshot = (): readonly CommandConfig[] => {
    if (!this.snapshotCache) {
      this.snapshotCache = this.getCommands()
    }
    return this.snapshotCache
  }

  private emit(): void {
    this.snapshotCache = null
    for (const cb of [...this.listeners]) cb()
  }
}
