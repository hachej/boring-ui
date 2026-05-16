/**
 * Front-side plugin lifecycle bus. Re-exports the shared generic bus
 * (see `packages/workspace/src/shared/plugins/lifecycleBus.ts`) under
 * the existing front-facing type names so import sites don't churn.
 */
export {
  LifecycleBus as PluginLifecycleBus,
  type PluginLifecycleEvent,
  type PluginLifecycleHandler,
  type PluginLifecycleReason,
  type PluginShutdownEvent,
  type PluginStartEvent,
} from "../../shared/plugins/lifecycleBus"
