import * as React from "react"
import * as ReactDom from "react-dom"
import * as ReactDomClient from "react-dom/client"
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime"
import * as ReactJsxRuntime from "react/jsx-runtime"
import { useEffect, useRef, useState } from "react"
import type { ErrorCode } from "@hachej/boring-agent/shared"
import {
  createCapturingBoringFrontAPI,
  type BoringFrontFactoryWithId,
  type CapturedBoringFrontRegistrations,
} from "../../shared/plugins/frontFactory"
import type { BoringPluginEvent, BoringPluginFrontTarget } from "../../shared/plugins/runtimePluginTypes"
import type { CatalogConfig } from "../../shared/plugins/types"
import type { PanelConfig } from "../../shared/types/panel"
import type { SurfaceOpenRequest, SurfaceResolverConfig } from "../../shared/types/surface"
import type { CommandConfig } from "../registry/types"
import { useCatalogRegistry, useCommandRegistry, useRegistry, useSurfaceResolverRegistry } from "../registry/RegistryProvider"
import { WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT } from "./reloadEvent"

const PLUGIN_LOAD_FAILED_CODE = "PLUGIN_LOAD_FAILED" satisfies ErrorCode

declare global {
  // Native runtime plugin modules are transformed by the CLI runtime host, not
  // bundled into the app. Keep React imports shared with the host app so plugin
  // components can use hooks without loading a second React copy.
  // eslint-disable-next-line no-var
  var __BORING_RUNTIME_SINGLETONS__: Record<string, unknown> | undefined
}

globalThis.__BORING_RUNTIME_SINGLETONS__ = {
  ...globalThis.__BORING_RUNTIME_SINGLETONS__,
  react: React,
  "react-dom": ReactDom,
  "react-dom/client": ReactDomClient,
  "react/jsx-dev-runtime": ReactJsxDevRuntime,
  "react/jsx-runtime": ReactJsxRuntime,
}

type RuntimePluginBrowserEvent =
  | (Extract<BoringPluginEvent, { type: "boring.plugin.load" }> & { workspaceId?: string; replay?: boolean })
  | (Extract<BoringPluginEvent, { type: "boring.plugin.unload" }> & { workspaceId?: string; replay?: boolean })
  | (Extract<BoringPluginEvent, { type: "boring.plugin.error" }> & { workspaceId?: string; replay?: boolean })
  | { type: "boring.plugin.replay-complete"; workspaceId?: string; replay?: boolean }

export interface RegisterAgentPluginOptions {
  apiBaseUrl?: string
  workspaceId?: string
  enabled?: boolean
  authHeaders?: Record<string, string>
  importFront?: (frontUrl: string, revision: number) => Promise<{ default?: BoringFrontFactoryWithId }>
  // Bounded retry for transient cold-start front-import failures (singleton
  // graph not yet warm after a hard refresh). Exposed mainly for tests.
  frontImportRetry?: { attempts?: number; delayMs?: number }
  // Reports an exhausted front import failure back to the server diagnostics
  // channel. Defaults to a fetch POST; overridable for tests.
  reportFrontError?: (report: FrontErrorReport) => void
}

export interface FrontErrorReport {
  pluginId: string
  revision: number
  message: string
  url?: string
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

// Posts an exhausted front import failure to the server so it surfaces in the
// runtime-plugin-diagnostics response and the plugin_diagnostics agent tool —
// otherwise a plugin that fails to evaluate in the browser looks healthy
// server-side (its manifest scan and runtime transform both succeeded).
function postFrontError(
  options: Pick<RegisterAgentPluginOptions, "apiBaseUrl" | "workspaceId" | "authHeaders">,
  report: FrontErrorReport,
): void {
  if (typeof fetch !== "function") return
  const url = withWorkspaceId(
    joinUrl(options.apiBaseUrl ?? "", `/api/v1/agent-plugins/${encodeURIComponent(report.pluginId)}/front-error`),
    options.workspaceId,
  )
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(options.authHeaders ?? {}) },
    body: JSON.stringify({ revision: report.revision, message: report.message, ...(report.url ? { url: report.url } : {}) }),
    keepalive: true,
  }).catch(() => {
    // Best-effort: a failed report-back must never break plugin loading.
  })
}

function resolveFrontUrl(frontUrl: string, apiBaseUrl: string | undefined): string {
  if (!apiBaseUrl || isAbsoluteModuleUrl(frontUrl)) return frontUrl
  return joinUrl(apiBaseUrl, frontUrl.startsWith("/") ? frontUrl : `/${frontUrl}`)
}

function resolveFrontEntryUrl(
  event: Extract<RuntimePluginBrowserEvent, { type: "boring.plugin.load" }>,
  apiBaseUrl: string | undefined,
): string | undefined {
  if (!event.frontTarget?.entryUrl) return undefined
  return resolveFrontUrl(event.frontTarget.entryUrl, apiBaseUrl)
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

async function defaultImportFront(frontUrl: string, revision: number): Promise<{ default?: BoringFrontFactoryWithId }> {
  // Vite's browser module graph can retain stale dynamically imported
  // .pi extension modules across dev-server restarts or repeated plugin
  // revisions. Add a per-import salt so /reload always asks Vite for a
  // fresh transform instead of reusing an old React-Refresh-instrumented
  // module that may carry a stale hook dispatcher.
  return await import(/* @vite-ignore */ appendFrontImportRevision(frontUrl, revision, Date.now())) as { default?: BoringFrontFactoryWithId }
}

// Wrap the default import in a 30-second timeout so a hung asset server
// (slow CDN, unreachable Vite dev server) doesn't block the SSE handler indefinitely.
// Dynamic import() cannot be aborted, so we race against a timer and let the
// import settle in the background if it loses.
const FRONT_IMPORT_TIMEOUT_MS = 30_000

async function timedImport(frontUrl: string, revision: number): Promise<{ default?: BoringFrontFactoryWithId }> {
  let settled = false
  const timeout = new Promise<{ default?: BoringFrontFactoryWithId }>((_, reject) => {
    setTimeout(() => {
      if (!settled) reject(new Error(`importFront timed out after ${FRONT_IMPORT_TIMEOUT_MS}ms (plugin asset at ${frontUrl})`))
    }, FRONT_IMPORT_TIMEOUT_MS)
  })
  const result = await Promise.race([
    import(/* @vite-ignore */ appendFrontImportRevision(frontUrl, revision, Date.now())) as Promise<{ default?: BoringFrontFactoryWithId }>,
    timeout,
  ])
  settled = true
  return result
}

async function captureFrontFactory(pluginId: string, frontUrl: string, revision: number, importFront: RegisterAgentPluginOptions["importFront"] = timedImport): Promise<CapturedBoringFrontRegistrations> {
  const mod = await importFront(frontUrl, revision)
  if (typeof mod.default !== "function" || typeof mod.default.pluginId !== "string") {
    throw new Error(`plugin ${pluginId} front module must default-export definePlugin({ id, ... })`)
  }
  if (mod.default.pluginId !== pluginId) {
    throw new Error(`plugin ${pluginId} front module id mismatch: default export is branded as ${JSON.stringify(mod.default.pluginId)}`)
  }
  const api = createCapturingBoringFrontAPI({ pluginId })
  await mod.default(api)
  return api.flush()
}

// Cold-start retry for plugin front imports. On a hard refresh while the
// embedded Vite plugin runtime is still warming, the imported module can
// evaluate against a not-yet-ready singleton graph and throw (the silent
// "keeping previous version" + "definePlugin: id is required" path). That
// failure is transient — a moment later the same revision imports cleanly —
// but it used to be permanent until a revision bump or workspace switch. Retry
// the import (NOT the register) with exponential backoff so the plugin
// recovers in place. The budget must outlast a cold-start server stall (a
// hard reload can race tens of seconds of server-side warmup work): 7
// attempts at 750ms doubling ≈ 47s of cover, capped at 10s per wait.
const FRONT_IMPORT_RETRY_ATTEMPTS = 7
const FRONT_IMPORT_RETRY_DELAY_MS = 750
const FRONT_IMPORT_RETRY_MAX_DELAY_MS = 10_000

async function importFrontWithRetry({
  pluginId,
  frontEntryUrl,
  revision,
  importFront,
  isStale,
  attempts = FRONT_IMPORT_RETRY_ATTEMPTS,
  delayMs = FRONT_IMPORT_RETRY_DELAY_MS,
}: {
  pluginId: string
  frontEntryUrl: string
  revision: number
  importFront: RegisterAgentPluginOptions["importFront"]
  isStale: () => boolean
  attempts?: number
  delayMs?: number
}): Promise<CapturedBoringFrontRegistrations> {
  const maxAttempts = Math.max(1, attempts)
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (isStale()) throw lastError ?? new Error(`plugin ${pluginId} front import superseded`)
    try {
      return await captureFrontFactory(pluginId, frontEntryUrl, revision, importFront)
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts - 1 || isStale()) break
      console.warn(
        `[boring-ui] plugin ${pluginId} front import failed (attempt ${attempt + 1}/${maxAttempts}); retrying`,
        error,
      )
      const backoff = Math.min(delayMs * 2 ** attempt, FRONT_IMPORT_RETRY_MAX_DELAY_MS)
      await new Promise((resolve) => setTimeout(resolve, backoff))
    }
  }
  throw lastError
}

/**
 * Translate a CapturedBoringFrontRegistrations into the registry shapes
 * expected by the atomic `replaceByPluginId` ops. Providers and bindings
 * remain static-composition-only until the front asset loader can mount a
 * dynamic provider subtree safely.
 */
function buildRegistryPayloads(
  pluginId: string,
  revision: number,
  captured: CapturedBoringFrontRegistrations,
): {
  panels: PanelConfig[]
  commands: CommandConfig[]
  catalogs: CatalogConfig[]
  surfaceResolvers: SurfaceResolverConfig[]
} {
  const panels: PanelConfig[] = []
  const panelsById = new Map(captured.panels.map((panel) => [panel.id, panel]))
  for (const panel of captured.panels) {
    panels.push({
      id: panel.id,
      title: panel.label ?? panel.id,
      component: panel.component,
      placement: panel.placement ?? "center",
      source: panel.source ?? "plugin",
      pluginId,
      pluginRevision: revision,
      ...(panel.icon ? { icon: panel.icon } : {}),
      ...(panel.requiresCapabilities ? { requiresCapabilities: panel.requiresCapabilities } : {}),
      ...(panel.essential !== undefined ? { essential: panel.essential } : {}),
      ...(panel.lazy !== undefined ? { lazy: panel.lazy } : {}),
      ...(panel.chromeless !== undefined ? { chromeless: panel.chromeless } : {}),
    } as PanelConfig)
  }
  for (const tab of captured.leftTabs) {
    const referencedPanel = panelsById.get(tab.panelId)
    if (!tab.component && !referencedPanel) {
      // A leftTab pointing at an unknown panelId renders an empty pane —
      // almost always a typo in the plugin (the panel id and the tab's
      // panelId drifted apart). Be loud: the silent fallback cost real
      // debugging time in the field.
      console.warn(
        `[boring-ui] plugin "${pluginId}": left tab "${tab.id}" references unknown panelId "${tab.panelId}" `
        + `(registered panels: ${[...panelsById.keys()].join(", ") || "none"}). The tab will render empty.`,
      )
    }
    panels.push({
      id: tab.id,
      title: tab.title,
      component: tab.component ?? referencedPanel?.component ?? (() => null),
      placement: "left-tab",
      source: tab.source ?? "plugin",
      pluginId,
      pluginRevision: revision,
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
    ...(command.keywords ? { keywords: command.keywords } : command.panelId ? { keywords: [command.panelId] } : {}),
    ...(command.shortcut ? { shortcut: command.shortcut } : {}),
    ...(command.when ? { when: command.when } : {}),
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
  revision: number,
  captured: CapturedBoringFrontRegistrations,
  registries: ReturnType<typeof getRegistries>,
): void {
  if (captured.providers.length > 0 || captured.bindings.length > 0) {
    warnUnsupportedDynamicContributions(pluginId, captured)
    // Provider/binding contributions require mounting in the provider tree,
    // which hot reload cannot do safely yet. Keep any provider/binding from the
    // statically mounted app, but still refresh hot-swappable panel/command/
    // catalog/resolver outputs. If a newly-added panel depends on an unmounted
    // provider, the panel render self-test reports that concrete render error.
  }
  const payloads = buildRegistryPayloads(pluginId, revision, captured)
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

/**
 * True when a dispatched WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT originates from
 * the `/reload` slash command (ChatPanel's `callPluginReload`) rather than from
 * this hook's own per-plugin lifecycle dispatches. The hook always tags its
 * dispatches with a `type` of "boring.plugin.*"; the `/reload` POST forwards the
 * server response (`{ reloaded, restartWarnings, diagnostics }`), which has no
 * such `type`. We listen only for the `/reload` variant so we never re-trigger
 * ourselves from our own events.
 */
function isPluginReloadCommandEvent(detail: unknown): boolean {
  if (!detail || typeof detail !== "object") return true
  const type = (detail as { type?: unknown }).type
  return typeof type !== "string" || !type.startsWith("boring.plugin.")
}

export function useAgentPluginHotReload(options: RegisterAgentPluginOptions): void {
  const panels = useRegistry()
  const commands = useCommandRegistry()
  const catalogs = useCatalogRegistry()
  const surfaceResolvers = useSurfaceResolverRegistry()
  const lastSeenRef = useRef(new Map<string, number>())
  const latestRequestedRef = useRef(new Map<string, number>())
  const replaySeenRef = useRef(new Set<string>())
  // Tracks plugins that were successfully registered via commitCapturedFrontFactory.
  // The SSE channel only carries external plugins (internal ones are statically
  // bundled by the app and filtered server-side), so this hook owns the full
  // lifecycle of everything it sees here.
  const registeredRef = useRef(new Set<string>())
  // Bumped by a window listener whenever `/reload` runs (while hot reload is
  // active). Included in the EventSource effect deps so `/reload` reopens the
  // stream and re-imports, mirroring a workspace switch — without a full remount.
  // `reloadReconnectRef` marks the reconnect as reload-triggered so that (a) the
  // outgoing effect's cleanup KEEPS plugin registrations in place (the replay
  // swaps them atomically; tearing them down here briefly removes the panels from
  // the registry and therefore from the live dock's component map, which the dock
  // never re-adds without a remount — the "plugin vanishes on /reload" bug), and
  // (b) the next connection re-imports the replayed current bundles even at an
  // unchanged revision.
  const [reloadNonce, setReloadNonce] = useState(0)
  const reloadReconnectRef = useRef(false)

  useEffect(() => {
    if (options.enabled === false || typeof EventSource === "undefined") return
    const onReloadCommand = (raw: Event) => {
      const detail = (raw as CustomEvent).detail
      if (!isPluginReloadCommandEvent(detail)) return
      reloadReconnectRef.current = true
      setReloadNonce((n) => n + 1)
    }
    window.addEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, onReloadCommand as EventListener)
    return () => window.removeEventListener(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, onReloadCommand as EventListener)
  }, [options.enabled])

  useEffect(() => {
    if (options.enabled === false || typeof EventSource === "undefined") return
    // A `/reload`-triggered reconnect must re-import the replayed current bundles
    // even though their revision is unchanged. Rather than clearing the
    // revision-dedupe maps (which would drop the knowledge needed to prune deleted
    // plugins on replay-complete), keep them and let `forceReimport` bypass the
    // revision gate for the replayed snapshot below. The cache-busting timestamp in
    // `appendFrontImportRevision` ensures a fresh module instance loads.
    const forceReimport = reloadReconnectRef.current
    reloadReconnectRef.current = false
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
        let event: Extract<RuntimePluginBrowserEvent, { type: "boring.plugin.load" }> | undefined
        let pendingTracked = false
        try {
          event = JSON.parse(raw.data) as Extract<RuntimePluginBrowserEvent, { type: "boring.plugin.load" }>
          if (disposed) return
          if (event.workspaceId && options.workspaceId && event.workspaceId !== options.workspaceId) return
          if (event.replay) replaySeenRef.current.add(event.id)
          // On a `/reload`-triggered reconnect, re-import the replayed snapshot even
          // at an unchanged revision (its registrations were kept, not torn down).
          const bypassGate = forceReimport && event.replay === true
          const lastSeen = lastSeenRef.current.get(event.id) ?? 0
          const latestRequested = latestRequestedRef.current.get(event.id) ?? 0
          if (!bypassGate && event.revision <= Math.max(lastSeen, latestRequested)) return
          latestRequestedRef.current.set(event.id, event.revision)
          const frontEntryUrl = resolveFrontEntryUrl(event, options.apiBaseUrl)
          if (frontEntryUrl) {
            pendingTracked = true
            window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
              detail: {
                type: "boring.plugin.front-pending",
                id: event.id,
                revision: event.revision,
                workspaceId: event.workspaceId ?? options.workspaceId,
                replay: event.replay,
              },
            }))
          }
          let captured: CapturedBoringFrontRegistrations | null = null
          try {
            captured = frontEntryUrl
              ? await importFrontWithRetry({
                  pluginId: event.id,
                  frontEntryUrl,
                  revision: event.revision,
                  importFront: options.importFront,
                  isStale: () =>
                    disposed || latestRequestedRef.current.get(event!.id) !== event!.revision,
                  ...(options.frontImportRetry?.attempts !== undefined ? { attempts: options.frontImportRetry.attempts } : {}),
                  ...(options.frontImportRetry?.delayMs !== undefined ? { delayMs: options.frontImportRetry.delayMs } : {}),
                })
              : null
          } catch (error) {
            throw {
              stage: "import",
              error,
            }
          }
          if (disposed) return
          if (latestRequestedRef.current.get(event.id) !== event.revision) return
          if (!bypassGate && event.revision <= (lastSeenRef.current.get(event.id) ?? 0)) return
          if (!captured) {
            // Only unregister if we previously dynamically loaded a front module for
            // this plugin. Static/internal plugins (no frontTarget) are registered by
            // the app bootstrap and must not be cleared by the SSE reload hook —
            // doing so removes their panels from the registry while their providers
            // remain mounted, which causes "must be rendered under Provider" errors.
            if (registeredRef.current.has(event.id)) {
              unregisterPlugin(event.id, registries)
              registeredRef.current.delete(event.id)
            }
            lastSeenRef.current.set(event.id, event.revision)
            return
          }
          // Atomic per-registry replace: `replaceByPluginId` drops
          // owned entries and registers the new set in a single emit.
          // Subscribers (including DockView) see exactly one
          // transition — never an intermediate empty state.
          try {
            commitCapturedFrontFactory(event.id, event.revision, captured, registries)
          } catch (error) {
            throw {
              stage: "register",
              error,
            }
          }
          registeredRef.current.add(event.id)
          lastSeenRef.current.set(event.id, event.revision)
          window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: event }))
        } catch (error) {
          if (event && latestRequestedRef.current.get(event.id) === event.revision) {
            latestRequestedRef.current.delete(event.id)
          }
          const stage = typeof error === "object" && error && "stage" in error && (error as { stage?: unknown }).stage === "register"
            ? "register"
            : "import"
          const actualError = typeof error === "object" && error && "error" in error
            ? (error as { error: unknown }).error
            : error
          if (disposed) return
          const label = event?.id ?? "<malformed>"
          const message = actualError instanceof Error ? actualError.message : String(actualError)
          console.error(`[boring-ui] failed to load plugin ${label}; keeping previous version`, actualError)
          if (event) {
            const failedFrontUrl = resolveFrontEntryUrl(event, options.apiBaseUrl)
            const report: FrontErrorReport = {
              pluginId: event.id,
              revision: event.revision,
              message,
              ...(failedFrontUrl ? { url: failedFrontUrl } : {}),
            }
            if (options.reportFrontError) options.reportFrontError(report)
            else postFrontError(options, report)
            window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
              detail: {
                type: "boring.plugin.front-error",
                id: event.id,
                revision: event.revision,
                workspaceId: event.workspaceId ?? options.workspaceId,
                message,
                code: PLUGIN_LOAD_FAILED_CODE,
                stage,
                replay: event.replay,
              },
            }))
          }
        } finally {
          if (pendingTracked && event) {
            window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
              detail: {
                type: "boring.plugin.front-settled",
                id: event.id,
                revision: event.revision,
                workspaceId: event.workspaceId ?? options.workspaceId,
                replay: event.replay,
              },
            }))
          }
        }
      })()
    }

    const handleUnload = (raw: MessageEvent) => {
      if (disposed) return
      try {
        const event = JSON.parse(raw.data) as Extract<RuntimePluginBrowserEvent, { type: "boring.plugin.unload" }>
        if (event.workspaceId && options.workspaceId && event.workspaceId !== options.workspaceId) return
        const lastSeen = lastSeenRef.current.get(event.id) ?? 0
        const latestRequested = latestRequestedRef.current.get(event.id) ?? 0
        if (event.revision <= Math.max(lastSeen, latestRequested)) return
        latestRequestedRef.current.set(event.id, event.revision)
        if (registeredRef.current.has(event.id)) {
          unregisterPlugin(event.id, registries)
          registeredRef.current.delete(event.id)
        }
        lastSeenRef.current.set(event.id, event.revision)
        window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: event }))
      } catch (error) {
        console.error("[boring-ui] failed to process plugin unload event", error)
      }
    }

    const handleError = (raw: MessageEvent) => {
      if (disposed) return
      try {
        const event = JSON.parse(raw.data) as Extract<RuntimePluginBrowserEvent, { type: "boring.plugin.error" }>
        if (event.workspaceId && options.workspaceId && event.workspaceId !== options.workspaceId) return
        console.error(`[boring-ui] plugin ${event.id} failed to reload: ${event.message}`)
        // Dispatch so the plugin inspector / UI knows about the error.
        window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
          detail: {
            type: "boring.plugin.error",
            id: event.id,
            revision: event.revision,
            workspaceId: event.workspaceId ?? options.workspaceId,
            message: event.message,
          },
        }))
      } catch (error) {
        console.error("[boring-ui] failed to process plugin error event", error)
      }
    }

    const handleReplayComplete = (raw: MessageEvent) => {
      if (disposed) return
      try {
        const event = JSON.parse(raw.data) as Extract<RuntimePluginBrowserEvent, { type: "boring.plugin.replay-complete" }>
        if (event.workspaceId && options.workspaceId && event.workspaceId !== options.workspaceId) return
        const replaySeen = replaySeenRef.current
        for (const [pluginId, revision] of lastSeenRef.current.entries()) {
          if (replaySeen.has(pluginId)) continue
          // Only unregister if the plugin was dynamically loaded — static/internal
          // plugins keep their bootstrap registrations across workspace reconnects.
          if (registeredRef.current.has(pluginId)) {
            unregisterPlugin(pluginId, registries)
            registeredRef.current.delete(pluginId)
          }
          lastSeenRef.current.delete(pluginId)
          latestRequestedRef.current.delete(pluginId)
          window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, {
            detail: {
              type: "boring.plugin.unload",
              id: pluginId,
              revision: revision + 1,
              workspaceId: event.workspaceId ?? options.workspaceId,
              replay: true,
            },
          }))
        }
        replaySeen.clear()
        window.dispatchEvent(new CustomEvent(WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT, { detail: event }))
      } catch (error) {
        console.error("[boring-ui] failed to process plugin replay-complete event", error)
      }
    }

    es.addEventListener("boring.plugin.load", handleLoad as EventListener)
    es.addEventListener("boring.plugin.unload", handleUnload as EventListener)
    es.addEventListener("boring.plugin.error", handleError as EventListener)
    es.addEventListener("boring.plugin.replay-complete", handleReplayComplete as EventListener)
    return () => {
      disposed = true
      // Keep registrations across a `/reload`-triggered reconnect: the immediately
      // following connection replays and atomically swaps each plugin in place
      // (replaceByPluginId), and replay-complete prunes any plugin missing from the
      // new snapshot. A full teardown here would briefly unregister the panels —
      // removing them from the live dock's component map, which the dock never
      // re-adds without a remount. Only tear down for genuine disconnects
      // (workspace switch, hot-reload disabled, unmount), where reloadReconnectRef
      // is false.
      if (!reloadReconnectRef.current) {
        // Only unregister dynamically-loaded plugins. Static/internal plugins keep
        // their bootstrap registrations — the WorkspaceProvider re-runs bootstrap on
        // remount (workspace switch) which re-registers them.
        for (const pluginId of registeredRef.current) unregisterPlugin(pluginId, registries)
        registeredRef.current.clear()
        lastSeenRef.current.clear()
        latestRequestedRef.current.clear()
        replaySeenRef.current.clear()
      }
      es.close()
    }
  }, [options.apiBaseUrl, options.workspaceId, options.enabled, options.authHeaders, options.importFront, options.frontImportRetry, panels, commands, catalogs, surfaceResolvers, reloadNonce])
}
