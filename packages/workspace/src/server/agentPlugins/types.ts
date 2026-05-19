import type {
  BoringPackageBoringField,
  BoringPackagePiField,
} from "../../shared/plugins/manifest"

export interface BoringServerPluginManifest {
  id: string
  rootDir: string
  version: string
  boring: BoringPackageBoringField
  pi?: BoringPackagePiField
  frontPath?: string
  frontUrl?: string
  serverPath?: string
  extensionPaths?: string[]
  skillPaths?: string[]
}

/**
 * Surfaces whose changes the hot-reload pipeline can't re-load mid-
 * session — set when a plugin's load DID succeed but a sub-surface
 * (the agent-tools registry, Fastify routes) carries stale code from
 * the previous revision. The /reload caller (chat UI, verify-plugin,
 * etc.) should surface a "restart needed for X" warning.
 *
 * - `'routes'`: a `WorkspaceServerPlugin.routes` function changed. The
 *   workspace's Fastify instance can't unregister + re-register routes
 *   mid-flight; the previous routes stay live until next boot.
 * - `'agentTools'`: a `WorkspaceServerPlugin.agentTools` array changed.
 *   The current Pi session still has the old tool list; new sessions
 *   get the new list.
 * - Multiple surfaces: order is deterministic (`routes` before
 *   `agentTools`) so subscribers can format consistently.
 */
export type PluginRestartSurface = "routes" | "agentTools"

export type BoringPluginEvent =
  | {
      type: "boring.plugin.load"
      id: string
      boring: BoringPackageBoringField
      version: string
      revision: number
      frontUrl?: string
      /**
       * Non-empty when the plugin loaded but one or more server-side
       * surfaces still hold pre-load code. UI consumers should render
       * a "restart needed: <surfaces>" hint. Empty/omitted = fully
       * live.
       */
      requiresRestart?: PluginRestartSurface[]
    }
  | { type: "boring.plugin.unload"; id: string; revision: number }
  | { type: "boring.plugin.error"; id: string; revision: number; message: string }

export interface BoringPluginListEntry {
  id: string
  boring: BoringPackageBoringField
  pi?: BoringPackagePiField
  version: string
  revision: number
  frontUrl?: string
}
