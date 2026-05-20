import { useEffect, useRef } from "react"
import {
  createCapturingBoringFrontAPI,
  type BoringFrontFactory,
  type CapturedBoringFrontRegistrations,
} from "../../shared/plugins/frontFactory"
import type { BoringPackageBoringField } from "../../shared/plugins/manifest"
import type { CatalogConfig } from "../../shared/plugins/types"
import type { PanelConfig } from "../../shared/types/panel"
import type { SurfaceOpenRequest, SurfaceResolverConfig } from "../../shared/types/surface"
import type { CommandConfig } from "../registry/types"
import { useCatalogRegistry, useCommandRegistry, useRegistry, useSurfaceResolverRegistry } from "../registry/RegistryProvider"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from "./reloadEvent"

type BoringPluginEvent =
  | { type: "boring.plugin.load"; id: string; boring: BoringPackageBoringField; version: string; revision: number; frontUrl?: string }
  | { type: "boring.plugin.unload"; id: string; revision: number }
  | { type: "boring.plugin.error"; id: string; revision: number; message: string }

export interface RegisterAgentPluginOptions {
  apiBaseUrl?: string
  workspaceId?: string
  enabled?: boolean
  authHeaders?: Record<string, string>
  importFront?: (frontUrl: string, revision: number) => Promise<{ default?: BoringFrontFactory }>
}

function joinUrl(base: string, path: string): string {
  if (!base) return path
  return `${base.replace(/\/$/, "")}${path}`
}

function withWorkspaceId(url: string, workspaceId: string | undefined): string {
  if (!workspaceId) return url
  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}workspaceId=${encodeURIComponent(workspaceId)}`
}

function isAbsoluteModuleUrl(url: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url) || url.startsWith("//")
}

function resolveFrontUrl(frontUrl: string, apiBaseUrl: string | undefined): string {
  if (!apiBaseUrl || isAbsoluteModuleUrl(frontUrl)) return frontUrl
  return joinUrl(apiBaseUrl, frontUrl.startsWith("/") ? frontUrl : `/${frontUrl}`)
}

function getRegistries(
  panels: ReturnType<typeof useRegistry>,
  commands: ReturnType<typeof useCommandRegistry>,
  catalogs: ReturnType<typeof useCatalogRegistry>,
  surfaceResolvers: ReturnType<typeof useSurfaceResolverRegistry>,
) {
  return { panels, commands, catalogs, surfaceResolvers }
}

function getAuthHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

function hasBearerAuth(headers: Record<string, string> | undefined): boolean {
  return /^Bearer\s+\S+/i.test(getAuthHeader(headers, "authorization") ?? "")
}

export function appendFrontImportRevision(frontUrl: string, revision: number, cacheBust?: string | number): string {
  const withRevision = `${frontUrl}${frontUrl.includes("?") ? "&" : "?"}v=${revision}`
  return cacheBust === undefined ? withRevision : `${withRevision}&t=${encodeURIComponent(String(cacheBust))}`
}

async function defaultImportFront(frontUrl: string, revision: number): Promise<{ default?: BoringFrontFactory }> {
  // Vite's browser module graph can retain stale dynamically imported
  // .pi extension modules across dev-server restarts or repeated plugin
  // revisions. Add a per-import salt so /reload always asks Vite for a
  // fresh transform instead of reusing an old React-Refresh-instrumented
  // module that may carry a stale hook dispatcher.
  return await import(/* @vite-ignore */ appendFrontImportRevision(frontUrl, revision, Date.now())) as { default?: BoringFrontFactory }
}

async function captureFrontFactory(pluginId: string, frontUrl: string, revision: number, importFront: RegisterAgentPluginOptions["importFront"] = defaultImportFront): Promise<CapturedBoringFrontRegistrations> {
  const mod = await importFront(frontUrl, revision)
  if (typeof mod.default !== "function") throw new Error(`plugin ${pluginId} front module must default-export a BoringFrontFactory`)
  const api = createCapturingBoringFrontAPI({ pluginId })
  await mod.default(api)
  return api.flush()
}

/**
 * Translate a CapturedBoringFrontRegistrations into the registry shapes
 * expected by the atomic `replaceByPluginId` ops. Providers and bindings
 * remain static-composition-only until the front asset loader can mount a
 * dynamic provider subtree safely.
 */
function buildRegistryPayloads(
  pluginId: string,
  captured: CapturedBoringFrontRegistrations,
): {
  panels: PanelConfig[]
  commands: CommandConfig[]
  catalogs: CatalogConfig[]
  surfaceResolvers: SurfaceResolverConfig[]
} {
  const panels: PanelConfig[] = []
  for (const panel of captured.panels) {
    panels.push({
      id: panel.id,
      title: panel.label ?? panel.id,
      component: panel.component,
      placement: panel.placement ?? "center",
      source: panel.source ?? "plugin",
      pluginId,
      ...(panel.icon ? { icon: panel.icon } : {}),
      ...(panel.requiresCapabilities ? { requiresCapabilities: panel.requiresCapabilities } : {}),
      ...(panel.essential !== undefined ? { essential: panel.essential } : {}),
      ...(panel.lazy !== undefined ? { lazy: panel.lazy } : {}),
      ...(panel.chromeless !== undefined ? { chromeless: panel.chromeless } : {}),
    } as PanelConfig)
  }
  for (const tab of captured.leftTabs) {
    panels.push({
      id: tab.id,
      title: tab.title,
      component: tab.component ?? (() => null),
      placement: "left-tab",
      source: tab.source ?? "plugin",
      pluginId,
      ...(tab.icon ? { icon: tab.icon } : {}),
      ...(tab.requiresCapabilities ? { requiresCapabilities: tab.requiresCapabilities } : {}),
      ...(tab.lazy !== undefined ? { lazy: tab.lazy } : {}),
      ...(tab.chromeless !== undefined ? { chromeless: tab.chromeless } : {}),
    } as PanelConfig)
  }
  const commands: CommandConfig[] = captured.panelCommands.map((command) => ({
    id: command.id,
    title: command.title,
    run: command.run ?? (() => undefined),
    pluginId,
  }))
  const catalogs: CatalogConfig[] = captured.catalogs.map((catalog) => ({
    ...catalog,
    pluginId,
  }))
  const surfaceResolvers: SurfaceResolverConfig[] = captured.surfaceResolvers.map((resolver) => ({
    id: resolver.id ?? `${pluginId}:${resolver.kind}`,
    source: resolver.source ?? "plugin",
    pluginId,
    resolve(request: SurfaceOpenRequest) {
      if (request.kind !== resolver.kind) return undefined
      return resolver.resolve(request) ?? undefined
    },
  }))
  return { panels, commands, catalogs, surfaceResolvers }
}

/**
 * Atomic per-registry replace. Each registry sees exactly ONE emit —
 * never an intermediate empty state — fixing the prior in-place
 * register-then-prune transient that DockView could observe.
 *
 * Pi parity: `agent-session.js:1896 reload` — rebuild over diff, single
 * observable transition per registry.
 */
function warnUnsupportedDynamicContributions(pluginId: string, captured: CapturedBoringFrontRegistrations): void {
  const unsupported = [
    captured.providers.length > 0 ? `${captured.providers.length} provider(s)` : null,
    captured.bindings.length > 0 ? `${captured.bindings.length} binding(s)` : null,
  ].filter(Boolean).join(" and ")
  if (!unsupported) return
  console.warn(
    `[boring-ui] hot-loaded plugin "${pluginId}" registered ${unsupported}. ` +
      "Dynamic provider/binding mounting is not implemented yet, so this plugin's hot-loaded UI contributions were skipped to avoid rendering panels without their required provider tree.",
  )
}

function ownerLabel(pluginId: string | undefined): string {
  return pluginId ?? "system/builtin"
}

function outputCollisionError(
  pluginId: string,
  kind: "panel" | "command" | "catalog" | "surface-resolver",
  id: string,
  existingOwner: string | undefined,
): Error {
  const suggestedId = `${pluginId}.${kind === "panel" ? "panel" : kind}`
  return new Error(
    `PLUGIN_OUTPUT_ID_COLLISION: plugin "${pluginId}" tried to register ${kind} "${id}" ` +
      `already owned by "${ownerLabel(existingOwner)}". Use a namespaced id like "${suggestedId}".`,
  )
}

function assertNoOutputCollisions(
  pluginId: string,
  payloads: ReturnType<typeof buildRegistryPayloads>,
  registries: ReturnType<typeof getRegistries>,
): void {
  for (const panel of payloads.panels) {
    const existing = registries.panels.get(panel.id)
    if (existing && existing.pluginId !== pluginId) {
      throw outputCollisionError(pluginId, "panel", panel.id, existing.pluginId)
    }
  }
  for (const command of payloads.commands) {
    const existing = registries.commands.getCommand(command.id)
    if (existing && existing.pluginId !== pluginId) {
      throw outputCollisionError(pluginId, "command", command.id, existing.pluginId)
    }
  }
  for (const catalog of payloads.catalogs) {
    const existing = registries.catalogs.get(catalog.id)
    if (existing && existing.pluginId !== pluginId) {
      throw outputCollisionError(pluginId, "catalog", catalog.id, existing.pluginId)
    }
  }
  for (const resolver of payloads.surfaceResolvers) {
    const existing = registries.surfaceResolvers.get(resolver.id)
    if (existing && existing.pluginId !== pluginId) {
      throw outputCollisionError(pluginId, "surface-resolver", resolver.id, existing.pluginId)
    }
  }
}

function commitCapturedFrontFactory(
  pluginId: string,
  captured: CapturedBoringFrontRegistrations,
  registries: ReturnType<typeof getRegistries>,
): void {
  if (captured.providers.length > 0 || captured.bindings.length > 0) {
    warnUnsupportedDynamicContributions(pluginId, captured)
    unregisterPlugin(pluginId, registries)
    return
  }
  const payloads = buildRegistryPayloads(pluginId, captured)
  assertNoOutputCollisions(pluginId, payloads, registries)
  registries.panels.replaceByPluginId(pluginId, payloads.panels)
  registries.commands.replaceByPluginId(pluginId, payloads.commands)
  registries.catalogs.replaceByPluginId(pluginId, payloads.catalogs)
  registries.surfaceResolvers.replaceByPluginId(pluginId, payloads.surfaceResolvers)
}

function unregisterPlugin(pluginId: string, registries: ReturnType<typeof getRegistries>): void {
  registries.panels.replaceByPluginId(pluginId, [])
  registries.commands.replaceByPluginId(pluginId, [])
  registries.catalogs.replaceByPluginId(pluginId, [])
  registries.surfaceResolvers.replaceByPluginId(pluginId, [])
}

export function useAgentPluginHotReload(options: RegisterAgentPluginOptions): void {
  const panels = useRegistry()
  const commands = useCommandRegistry()
  const catalogs = useCatalogRegistry()
  const surfaceResolvers = useSurfaceResolverRegistry()
  const lastSeenRef = useRef(new Map<string, number>())
  const latestRequestedRef = useRef(new Map<string, number>())

  useEffect(() => {
    if (options.enabled === false || typeof EventSource === "undefined") return
    if (hasBearerAuth(options.authHeaders)) {
      console.warn(
        "[boring-ui] front plugin hot reload disabled: native EventSource cannot send Authorization bearer headers, and this server does not advertise a token-query fallback for /api/v1/agent-plugins/events.",
      )
      return
    }
    let disposed = false
    const registries = getRegistries(panels, commands, catalogs, surfaceResolvers)
    const url = withWorkspaceId(joinUrl(options.apiBaseUrl ?? "", "/api/v1/agent-plugins/events"), options.workspaceId)
    const es = new EventSource(url, { withCredentials: true })

    const handleLoad = (raw: MessageEvent) => {
      void (async () => {
        let event: Extract<BoringPluginEvent, { type: "boring.plugin.load" }> | undefined
        try {
          event = JSON.parse(raw.data) as Extract<BoringPluginEvent, { type: "boring.plugin.load" }>
          if (disposed) return
          const lastSeen = lastSeenRef.current.get(event.id) ?? 0
          const latestRequested = latestRequestedRef.current.get(event.id) ?? 0
          if (event.revision <= Math.max(lastSeen, latestRequested)) return
          latestRequestedRef.current.set(event.id, event.revision)
          const captured = event.frontUrl
            ? await captureFrontFactory(event.id, resolveFrontUrl(event.frontUrl, options.apiBaseUrl), event.revision, options.importFront)
            : null
          if (disposed) return
          if (latestRequestedRef.current.get(event.id) !== event.revision) return
          if (event.revision <= (lastSeenRef.current.get(event.id) ?? 0)) return
          if (!captured) {
            unregisterPlugin(event.id, registries)
            lastSeenRef.current.set(event.id, event.revision)
            window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: event }))
            return
          }
          // Atomic per-registry replace: `replaceByPluginId` drops
          // owned entries and registers the new set in a single emit.
          // Subscribers (including DockView) see exactly one
          // transition — never an intermediate empty state.
          commitCapturedFrontFactory(event.id, captured, registries)
          lastSeenRef.current.set(event.id, event.revision)
          window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: event }))
        } catch (error) {
          if (event && latestRequestedRef.current.get(event.id) === event.revision) {
            latestRequestedRef.current.delete(event.id)
          }
          const label = event?.id ?? "<malformed>"
          console.error(`[boring-ui] failed to load plugin ${label}; keeping previous version`, error)
        }
      })()
    }

    const handleUnload = (raw: MessageEvent) => {
      if (disposed) return
      try {
        const event = JSON.parse(raw.data) as Extract<BoringPluginEvent, { type: "boring.plugin.unload" }>
        const lastSeen = lastSeenRef.current.get(event.id) ?? 0
        const latestRequested = latestRequestedRef.current.get(event.id) ?? 0
        if (event.revision <= Math.max(lastSeen, latestRequested)) return
        latestRequestedRef.current.set(event.id, event.revision)
        unregisterPlugin(event.id, registries)
        lastSeenRef.current.set(event.id, event.revision)
        window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: event }))
      } catch (error) {
        console.error("[boring-ui] failed to process plugin unload event", error)
      }
    }

    const handleError = (raw: MessageEvent) => {
      if (disposed) return
      try {
        const event = JSON.parse(raw.data) as Extract<BoringPluginEvent, { type: "boring.plugin.error" }>
        console.error(`[boring-ui] plugin ${event.id} failed to reload: ${event.message}`)
      } catch (error) {
        console.error("[boring-ui] failed to process plugin error event", error)
      }
    }

    es.addEventListener("boring.plugin.load", handleLoad as EventListener)
    es.addEventListener("boring.plugin.unload", handleUnload as EventListener)
    es.addEventListener("boring.plugin.error", handleError as EventListener)
    return () => {
      disposed = true
      latestRequestedRef.current.clear()
      es.close()
    }
  }, [options.apiBaseUrl, options.workspaceId, options.enabled, options.authHeaders, options.importFront, panels, commands, catalogs, surfaceResolvers])
}
