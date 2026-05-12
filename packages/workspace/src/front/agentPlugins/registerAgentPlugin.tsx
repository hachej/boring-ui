import { useEffect, useRef } from "react"
import {
  createCapturingBoringFrontAPI,
  type BoringFrontFactory,
  type CapturedBoringFrontRegistrations,
} from "../../shared/plugins/frontFactory"
import type { SurfaceOpenRequest } from "../../shared/types/surface"
import { useCommandRegistry, useRegistry, useSurfaceResolverRegistry } from "../registry/RegistryProvider"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from "./reloadEvent"

interface BoringPackageField {
  front?: string
  label?: string
  panels?: Array<{ id: string; title?: string }>
  commands?: Array<{ id: string; title: string; panelId?: string }>
  leftTabs?: Array<{ id: string; title: string; panelId: string }>
  surfaceResolvers?: Array<{ id: string; surfaceKind: string; panelId: string }>
  systemPrompt?: string
  derivesFrom?: string
}

type BoringPluginEvent =
  | { type: "boring.plugin.load"; id: string; boring: BoringPackageField; version: string; revision: number; frontUrl?: string }
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

function commitMetadataOnly(pluginId: string, boring: BoringPackageField, registries: ReturnType<typeof getRegistries>): void {
  for (const panel of boring.panels ?? []) {
    registries.panels.register(panel.id, {
      title: panel.title ?? panel.id,
      component: () => null,
      placement: "center",
      source: "plugin",
      pluginId,
    })
  }
  for (const tab of boring.leftTabs ?? []) {
    registries.panels.register(tab.id, {
      title: tab.title,
      component: () => null,
      placement: "left-tab",
      source: "plugin",
      pluginId,
    })
  }
  for (const command of boring.commands ?? []) {
    registries.commands.registerCommand({
      id: command.id,
      title: command.title,
      run: () => undefined,
      pluginId,
    })
  }
  for (const resolver of boring.surfaceResolvers ?? []) {
    registries.surfaceResolvers.register(resolver.id, {
      source: "plugin",
      pluginId,
      resolve(request: SurfaceOpenRequest) {
        if (request.kind !== resolver.surfaceKind) return undefined
        return { component: resolver.panelId, id: `${pluginId}:${resolver.id}` }
      },
    })
  }
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

function commitCapturedFrontFactory(pluginId: string, captured: CapturedBoringFrontRegistrations, registries: ReturnType<typeof getRegistries>): void {
  // Dynamic hot reload can atomically replace registry-owned contributions.
  // Providers, bindings, and catalogs need a React render boundary and remain
  // static-composition-only until the front asset loader grows that support.
  for (const panel of captured.panels) {
    registries.panels.register(panel.id, {
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
    })
  }
  for (const tab of captured.leftTabs) {
    registries.panels.register(tab.id, {
      title: tab.title,
      component: tab.component ?? (() => null),
      placement: "left-tab",
      source: tab.source ?? "plugin",
      pluginId,
      ...(tab.icon ? { icon: tab.icon } : {}),
      ...(tab.requiresCapabilities ? { requiresCapabilities: tab.requiresCapabilities } : {}),
      ...(tab.lazy !== undefined ? { lazy: tab.lazy } : {}),
      ...(tab.chromeless !== undefined ? { chromeless: tab.chromeless } : {}),
    })
  }
  for (const command of captured.panelCommands) {
    registries.commands.registerCommand({
      id: command.id,
      title: command.title,
      run: command.run ?? (() => undefined),
      pluginId,
    })
  }
  for (const resolver of captured.surfaceResolvers) {
    registries.surfaceResolvers.register(resolver.id ?? `${pluginId}:${resolver.kind}`, {
      source: resolver.source ?? "plugin",
      pluginId,
      resolve(request: SurfaceOpenRequest) {
        if (request.kind !== resolver.kind) return undefined
        return resolver.resolve(request) ?? undefined
      },
    })
  }
}

function unregisterPlugin(pluginId: string, registries: ReturnType<typeof getRegistries>): void {
  registries.panels.unregisterByPluginId(pluginId)
  registries.commands.unregisterByPluginId(pluginId)
  registries.surfaceResolvers.unregisterByPluginId(pluginId)
}

function capturedIds(pluginId: string, captured: CapturedBoringFrontRegistrations): {
  panels: Set<string>
  commands: Set<string>
  surfaceResolvers: Set<string>
} {
  return {
    panels: new Set([...captured.panels, ...captured.leftTabs].map((entry) => entry.id)),
    commands: new Set(captured.panelCommands.map((entry) => entry.id)),
    surfaceResolvers: new Set(
      captured.surfaceResolvers.map((entry) => entry.id ?? `${pluginId}:${entry.kind}`),
    ),
  }
}

function metadataIds(pluginId: string, boring: BoringPackageField): {
  panels: Set<string>
  commands: Set<string>
  surfaceResolvers: Set<string>
} {
  return {
    panels: new Set([
      ...(boring.panels ?? []).map((entry) => entry.id),
      ...(boring.leftTabs ?? []).map((entry) => entry.id),
    ]),
    commands: new Set((boring.commands ?? []).map((entry) => entry.id)),
    surfaceResolvers: new Set(
      (boring.surfaceResolvers ?? []).map((entry) => entry.id ?? `${pluginId}:${entry.surfaceKind}`),
    ),
  }
}

function pruneMissingPluginContributions(
  pluginId: string,
  keep: ReturnType<typeof capturedIds>,
  registries: ReturnType<typeof getRegistries>,
): void {
  for (const panel of registries.panels.list()) {
    if (panel.pluginId === pluginId && !keep.panels.has(panel.id)) registries.panels.unregister(panel.id)
  }
  for (const command of registries.commands.getCommands()) {
    if (command.pluginId === pluginId && !keep.commands.has(command.id)) registries.commands.unregisterCommand(command.id)
  }
  for (const resolver of registries.surfaceResolvers.list()) {
    if (resolver.pluginId === pluginId && !keep.surfaceResolvers.has(resolver.id)) {
      registries.surfaceResolvers.unregister(resolver.id)
    }
  }
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
        const event = JSON.parse(raw.data) as Extract<BoringPluginEvent, { type: "boring.plugin.load" }>
        if (disposed) return
        const lastSeen = lastSeenRef.current.get(event.id) ?? 0
        const latestRequested = latestRequestedRef.current.get(event.id) ?? 0
        if (event.revision <= Math.max(lastSeen, latestRequested)) return
        latestRequestedRef.current.set(event.id, event.revision)
        try {
          const captured = event.frontUrl
            ? await captureFrontFactory(event.id, event.frontUrl, event.revision, options.importFront)
            : null
          if (disposed) return
          if (latestRequestedRef.current.get(event.id) !== event.revision) return
          if (event.revision <= (lastSeenRef.current.get(event.id) ?? 0)) return
          // Replace contributions in-place. A transient unregister makes
          // already-mounted panes briefly resolve to null; DockView may then
          // discard the tab before the replacement registration arrives.
          // Registering over the same ids is atomic for mounted wrappers and
          // preserves old state until the new component is ready.
          const keep = captured ? capturedIds(event.id, captured) : metadataIds(event.id, event.boring)
          if (captured) commitCapturedFrontFactory(event.id, captured, registries)
          else commitMetadataOnly(event.id, event.boring, registries)
          pruneMissingPluginContributions(event.id, keep, registries)
          lastSeenRef.current.set(event.id, event.revision)
          window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: event }))
        } catch (error) {
          console.error(`[boring-ui] failed to load plugin ${event.id}; keeping previous version`, error)
        }
      })()
    }

    const handleUnload = (raw: MessageEvent) => {
      if (disposed) return
      const event = JSON.parse(raw.data) as Extract<BoringPluginEvent, { type: "boring.plugin.unload" }>
      const lastSeen = lastSeenRef.current.get(event.id) ?? 0
      const latestRequested = latestRequestedRef.current.get(event.id) ?? 0
      if (event.revision <= Math.max(lastSeen, latestRequested)) return
      latestRequestedRef.current.set(event.id, event.revision)
      unregisterPlugin(event.id, registries)
      lastSeenRef.current.set(event.id, event.revision)
      window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: event }))
    }

    const handleError = (raw: MessageEvent) => {
      if (disposed) return
      const event = JSON.parse(raw.data) as Extract<BoringPluginEvent, { type: "boring.plugin.error" }>
      console.error(`[boring-ui] plugin ${event.id} failed to reload: ${event.message}`)
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
