/**
 * Generic plugin lifecycle bus shared by front and server sides.
 *
 * Pi parity (@mariozechner/pi-coding-agent
 * `core/extensions/runner.js:48 emitSessionShutdownEvent`):
 *  - events fire only when at least one handler is registered
 *    (`hasHandlers` gate) so an idle reload pays no cost.
 *  - handler errors are isolated; one failing handler doesn't abort the
 *    bus (`core/extensions/loader.js:288` error continuation).
 *
 * Pi parity (`core/agent-session.js:1912`): a `reason: "startup" |
 * "reload"` discriminates initial install from rebuild.
 */

export type PluginLifecycleReason = "startup" | "reload"

export interface PluginShutdownEvent {
  type: "plugin_shutdown"
  pluginId: string
  reason: PluginLifecycleReason
}

export interface PluginStartEvent {
  type: "plugin_start"
  pluginId: string
  reason: PluginLifecycleReason
}

export type PluginLifecycleEvent = PluginShutdownEvent | PluginStartEvent

export type PluginLifecycleHandler<E extends PluginLifecycleEvent = PluginLifecycleEvent> = (
  event: E,
) => void | Promise<void>

export class LifecycleBus {
  private handlers = new Map<PluginLifecycleEvent["type"], Set<PluginLifecycleHandler>>()

  on<T extends PluginLifecycleEvent["type"]>(
    type: T,
    handler: PluginLifecycleHandler<Extract<PluginLifecycleEvent, { type: T }>>,
  ): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as PluginLifecycleHandler)
    return () => {
      set!.delete(handler as PluginLifecycleHandler)
    }
  }

  hasHandlers(type: PluginLifecycleEvent["type"]): boolean {
    const set = this.handlers.get(type)
    return Boolean(set && set.size > 0)
  }

  async emit(event: PluginLifecycleEvent): Promise<void> {
    const set = this.handlers.get(event.type)
    if (!set || set.size === 0) return
    for (const handler of [...set]) {
      try {
        await handler(event)
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          `[boring-workspace] plugin lifecycle handler threw for ${event.type}:`,
          error instanceof Error ? error.message : error,
        )
      }
    }
  }
}
