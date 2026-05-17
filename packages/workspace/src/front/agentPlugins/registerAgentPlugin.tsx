import { useEffect, useRef } from "react"
import {
  createCapturingBoringFrontAPI,
  type BoringFrontFactory,
  type CapturedBoringFrontRegistrations,
} from "../../shared/plugins/frontFactory"
import type { BoringPackageBoringField } from "../../shared/plugins/manifest"
import type { PanelConfig } from "../../shared/types/panel"
import type { SurfaceOpenRequest, SurfaceResolverConfig } from "../../shared/types/surface"
import type { CommandConfig } from "../registry/types"
import { useCommandRegistry, useRegistry, useSurfaceResolverRegistry } from "../registry/RegistryProvider"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from "./reloadEvent"

type BoringPluginEvent =
  | { type: "boring.plugin.load"; id: string; boring: BoringPackageBoringField; version: string; revision: number; frontUrl?: string }
  | { type: "boring.plugin.unload"; id: string; revision: number }
  | { type: "boring.plugin.error"; id: string; revision: number; message: string }

export interface RegisterAgentPluginOptions {
  apiBaseUrl?: string
  workspaceId?: string
  enabled?: boolean
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

function getRegistries(panels: ReturnType<typeof useRegistry>, commands: ReturnType<typeof useCommandRegistry>, surfaceResolvers: ReturnType<typeof useSurfaceResolverRegistry>) {
  return { panels, commands, surfaceResolvers }
}

async function defaultImportFront(frontUrl: string, revision: number): Promise<{ default?: BoringFrontFactory }> {
  return await import(/* @vite-ignore */ `${frontUrl}${frontUrl.includes("?") ? "&" : "?"}v=${revision}`) as { default?: BoringFrontFactory }
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
 * expected by the four atomic `replaceByPluginId` ops (panels, panel
 * commands, left tabs, surface resolvers). Providers, bindings, and
 * catalogs aren't returned by the hot front factory today — they
 * remain static-composition-only until the front asset loader grows
 * that support.
 */
function buildRegistryPayloads(
  pluginId: string,
  captured: CapturedBoringFrontRegistrations,
): {
  panels: PanelConfig[]
  commands: CommandConfig[]
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
  const surfaceResolvers: SurfaceResolverConfig[] = captured.surfaceResolvers.map((resolver) => ({
    id: resolver.id ?? `${pluginId}:${resolver.kind}`,
    source: resolver.source ?? "plugin",
    pluginId,
    resolve(request: SurfaceOpenRequest) {
      if (request.kind !== resolver.kind) return undefined
      return resolver.resolve(request) ?? undefined
    },
  }))
  return { panels, commands, surfaceResolvers }
}

/**
 * Atomic per-registry replace. Each registry sees exactly ONE emit —
 * never an intermediate empty state — fixing the prior in-place
 * register-then-prune transient that DockView could observe.
 *
 * Pi parity: `agent-session.js:1896 reload` — rebuild over diff, single
 * observable transition per registry.
 */
function commitCapturedFrontFactory(
  pluginId: string,
  captured: CapturedBoringFrontRegistrations,
  registries: ReturnType<typeof getRegistries>,
): void {
  const payloads = buildRegistryPayloads(pluginId, captured)
  registries.panels.replaceByPluginId(pluginId, payloads.panels)
  registries.commands.replaceByPluginId(pluginId, payloads.commands)
  registries.surfaceResolvers.replaceByPluginId(pluginId, payloads.surfaceResolvers)
}

function unregisterPlugin(pluginId: string, registries: ReturnType<typeof getRegistries>): void {
  registries.panels.replaceByPluginId(pluginId, [])
  registries.commands.replaceByPluginId(pluginId, [])
  registries.surfaceResolvers.replaceByPluginId(pluginId, [])
}

export function useAgentPluginHotReload(options: RegisterAgentPluginOptions): void {
  const panels = useRegistry()
  const commands = useCommandRegistry()
  const surfaceResolvers = useSurfaceResolverRegistry()
  const lastSeenRef = useRef(new Map<string, number>())
  const latestRequestedRef = useRef(new Map<string, number>())

  useEffect(() => {
    if (options.enabled === false || typeof EventSource === "undefined") return
    let disposed = false
    const registries = getRegistries(panels, commands, surfaceResolvers)
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
  }, [options.apiBaseUrl, options.workspaceId, options.enabled, options.importFront, panels, commands, surfaceResolvers])
}
