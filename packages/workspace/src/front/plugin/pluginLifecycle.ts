/**
 * Front-side plugin lifecycle bus. Mirrors Pi's
 * `extensions/runner.js:emitSessionShutdownEvent` shape: emit a typed
 * event to all subscribers; gate emit on `hasHandlers` so we don't fan
 * out work when nothing listens.
 *
 * Used by Phase 5 when /reload re-resolves directory-source plugins.
 * The shell can subscribe to:
 *
 *   - `plugin_shutdown { pluginId, reason }` — fired right before the
 *     workspace replaces a plugin's outputs in the registries. Plugins
 *     may use the hook to flush pending state, close subscriptions, etc.
 *   - `plugin_start    { pluginId, reason }` — fired after the new
 *     outputs land. `reason` is `"startup"` for the initial mount and
 *     `"reload"` for /reload-driven rebuilds (Pi parity:
 *     `agent-session.js:1912` fires `session_start { reason: "reload" }`).
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

export class PluginLifecycleBus {
  private handlers = new Map<PluginLifecycleEvent["type"], Set<PluginLifecycleHandler>>()

  on<E extends PluginLifecycleEvent>(type: E["type"], handler: PluginLifecycleHandler<E>): () => void {
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

  /** Pi parity (`extensions/runner.js:48`): only emit when at least one handler exists. */
  hasHandlers(type: PluginLifecycleEvent["type"]): boolean {
    const set = this.handlers.get(type)
    return Boolean(set && set.size > 0)
  }

  async emit(event: PluginLifecycleEvent): Promise<void> {
    const set = this.handlers.get(event.type)
    if (!set || set.size === 0) return
    // Snapshot — handlers may unsubscribe during iteration.
    const snapshot = [...set]
    for (const handler of snapshot) {
      try {
        await handler(event)
      } catch (error) {
        // Plugin handlers are isolation boundaries. One failure doesn't stop
        // the rest — same posture as Pi's loadExtensions error continuation
        // (extensions/loader.js:288).
        // eslint-disable-next-line no-console
        console.warn(
          `[boring-workspace] plugin lifecycle handler threw for ${event.type} (${event.pluginId}):`,
          error instanceof Error ? error.message : error,
        )
      }
    }
  }
}
