/**
 * Server-side plugin lifecycle bus. Same shape as the front-side bus
 * (`packages/workspace/src/front/plugin/pluginLifecycle.ts`), separate
 * file because the consumers differ:
 *
 *  - Front: React shell + plugin authors that subscribe to
 *    `plugin_shutdown` / `plugin_start` to flush UI state.
 *  - Server: Fastify-side plugins that subscribe to clean up async
 *    resources (file watchers, timers, bridge subscriptions) before
 *    their module is re-imported by Phase 5's reload.
 *
 * Pi parity (`@mariozechner/pi-coding-agent`
 * `core/extensions/runner.js:48 emitSessionShutdownEvent`): events fire
 * only when at least one handler is registered, so an idle reload pays
 * no cost for unsubscribed events.
 *
 * Pi parity (`core/agent-session.js:1912`): the `reason` field
 * differentiates `startup` (initial install) from `reload` (rebuild).
 */

export type ServerPluginLifecycleReason = "startup" | "reload"

export interface ServerPluginShutdownEvent {
  type: "plugin_shutdown"
  pluginId: string
  reason: ServerPluginLifecycleReason
}

export interface ServerPluginStartEvent {
  type: "plugin_start"
  pluginId: string
  reason: ServerPluginLifecycleReason
}

export type ServerPluginLifecycleEvent = ServerPluginShutdownEvent | ServerPluginStartEvent

export type ServerPluginLifecycleHandler<E extends ServerPluginLifecycleEvent = ServerPluginLifecycleEvent> = (
  event: E,
) => void | Promise<void>

export class ServerPluginLifecycleBus {
  private handlers = new Map<ServerPluginLifecycleEvent["type"], Set<ServerPluginLifecycleHandler>>()

  on<E extends ServerPluginLifecycleEvent>(
    type: E["type"],
    handler: ServerPluginLifecycleHandler<E>,
  ): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as ServerPluginLifecycleHandler)
    return () => {
      set!.delete(handler as ServerPluginLifecycleHandler)
    }
  }

  hasHandlers(type: ServerPluginLifecycleEvent["type"]): boolean {
    const set = this.handlers.get(type)
    return Boolean(set && set.size > 0)
  }

  async emit(event: ServerPluginLifecycleEvent): Promise<void> {
    const set = this.handlers.get(event.type)
    if (!set || set.size === 0) return
    const snapshot = [...set]
    for (const handler of snapshot) {
      try {
        await handler(event)
      } catch (error) {
        // Pi parity: handler failures are diagnostics, not aborts.
        // (`core/extensions/loader.js:288` records errors and continues.)
        // eslint-disable-next-line no-console
        console.warn(
          `[boring-workspace] server plugin lifecycle handler threw for ${event.type} (${event.pluginId}):`,
          error instanceof Error ? error.message : error,
        )
      }
    }
  }
}
