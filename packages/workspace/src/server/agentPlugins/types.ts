import type {
  BoringPackageBoringField,
  BoringPackagePiField,
} from "../../shared/plugins/manifest"
import type {
  BoringPluginEvent as SharedBoringPluginEvent,
  BoringPluginFrontTarget as SharedBoringPluginFrontTarget,
  BoringPluginListEntry as SharedBoringPluginListEntry,
  BoringPluginNativeFrontTarget as SharedBoringPluginNativeFrontTarget,
  BoringPluginNativeFrontTargetTrust as SharedBoringPluginNativeFrontTargetTrust,
} from "../../shared/plugins/runtimePluginTypes"

export type BoringPluginSourceKind = "internal" | "external"

export interface BoringPluginSource {
  rootDir: string
  kind: BoringPluginSourceKind
  workspaceId?: string
  /**
   * True when the user explicitly registered this directory as a plugin
   * source (e.g. a `packages` entry in Pi settings.json). Registered
   * sources that are missing, lack a package.json, or carry no plugin
   * metadata surface as preflight errors instead of being silently
   * skipped the way speculative scan roots are.
   */
  registered?: boolean
}

export type BoringPluginSourceInput = string | BoringPluginSource

export interface BoringServerPluginManifest {
  id: string
  rootDir: string
  version: string
  boring: BoringPackageBoringField
  /** True when package.json explicitly declares a boring manifest. Pi-only packages remain valid Pi resources but are not listed as Boring plugins. */
  hasBoring: boolean
  pi?: BoringPackagePiField
  frontPath?: string
  /** Legacy Vite-dev browser import fallback (`/@fs/...`). */
  frontUrl?: string
  serverPath?: string
  extensionPaths?: string[]
  skillPaths?: string[]
  source: BoringPluginSource
}

export type BoringPluginNativeFrontTargetTrust = SharedBoringPluginNativeFrontTargetTrust
export type BoringPluginNativeFrontTarget = SharedBoringPluginNativeFrontTarget
export type BoringPluginFrontTarget = SharedBoringPluginFrontTarget
export type BoringPluginListEntry = SharedBoringPluginListEntry

export interface BoringPluginFrontTargetResolverContext {
  revision: number
  /** Plugin-root-relative front entry path normalized for URL-like consumers. */
  frontEntrySubpath: string
}

export type BoringPluginFrontTargetResolver = (
  plugin: BoringServerPluginManifest,
  context: BoringPluginFrontTargetResolverContext,
) => BoringPluginFrontTarget | undefined

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
  | (Extract<SharedBoringPluginEvent, { type: "boring.plugin.load" }> & {
      /**
       * Non-empty when the plugin loaded but one or more server-side
       * surfaces still hold pre-load code. UI consumers should render
       * a "restart needed: <surfaces>" hint. Empty/omitted = fully
       * live.
       */
      requiresRestart?: PluginRestartSurface[]
    })
  | Extract<SharedBoringPluginEvent, { type: "boring.plugin.unload" }>
  | Extract<SharedBoringPluginEvent, { type: "boring.plugin.error" }>
