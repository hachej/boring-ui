import type { CommandConfig } from "../types/panel"

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
   *
   * Collision policy: a new command id already owned by a DIFFERENT pluginId
   * is skipped with a warning — preserves cross-plugin isolation on reload.
   */
  replaceByPluginId(pluginId: string, commands: CommandConfig[]): void {
    const ownedIds = new Set<string>()
    for (const [id, cmd] of this.commands) {
      if (cmd.pluginId === pluginId) ownedIds.add(id)
    }
    if (ownedIds.size === 0 && commands.length === 0) return

    let changed = ownedIds.size > 0
    for (const id of ownedIds) this.commands.delete(id)
    for (const config of commands) {
      const existing = this.commands.get(config.id)
      if (existing && existing.pluginId !== pluginId) {
        // eslint-disable-next-line no-console
        console.warn(
          `[CommandRegistry] plugin "${pluginId}" tried to register command "${config.id}" already owned by "${existing.pluginId ?? 'system'}" — skipped`,
        )
        continue
      }
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
