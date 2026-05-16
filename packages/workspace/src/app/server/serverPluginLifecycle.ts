/**
 * Server-side plugin lifecycle bus. Re-exports the shared generic bus
 * (see `packages/workspace/src/shared/plugins/lifecycleBus.ts`) under
 * server-facing type names so import sites don't churn. Consumers
 * differ from the front (Fastify routes / bridge subscriptions vs
 * React shell) but the bus mechanics are identical.
 */
export {
  LifecycleBus as ServerPluginLifecycleBus,
  type PluginLifecycleEvent as ServerPluginLifecycleEvent,
  type PluginLifecycleHandler as ServerPluginLifecycleHandler,
  type PluginLifecycleReason as ServerPluginLifecycleReason,
  type PluginShutdownEvent as ServerPluginShutdownEvent,
  type PluginStartEvent as ServerPluginStartEvent,
} from "../../shared/plugins/lifecycleBus"
