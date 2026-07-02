"use client"

import { useEffect, useState } from "react"
import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import {
  BORING_MCP_PLUGIN_ID,
  DEFAULT_MCP_PROVIDER_TEMPLATES,
  type McpProviderId,
  type McpProviderTemplate,
  type McpSourceStatus,
  type McpSourceStatusPayload,
  type McpToolCatalogEntry,
} from "../shared"

type MaybePromise<T> = T | Promise<T>
export type BoringMcpSourceActionResult = McpSourceStatusPayload | void

export interface BoringMcpSourceActions {
  onConnect?: (providerId: McpProviderId) => MaybePromise<BoringMcpSourceActionResult>
  onRefreshStatus?: (sourceId: string, providerId: McpProviderId) => MaybePromise<BoringMcpSourceActionResult>
  onDisconnect?: (sourceId: string, providerId: McpProviderId) => MaybePromise<BoringMcpSourceActionResult>
  onViewTools?: (sourceId: string, providerId: McpProviderId) => MaybePromise<void>
  onListTools?: (sourceId: string, providerId: McpProviderId, refresh?: boolean) => MaybePromise<McpToolCatalogEntry[]>
}

export interface BoringMcpProviderSetupState {
  providerId: McpProviderId
  enabled: boolean
  message?: string
}

export interface BoringMcpSourceApiOptions {
  enabled: boolean
  baseUrl?: string
  workspaceId?: string
  resolveWorkspaceId?: () => string | undefined
  openConnectUrl?: (url: string) => void
}

export interface CreateBoringMcpPluginOptions {
  label?: string
  tabTitle?: string
  providers?: readonly McpProviderTemplate[]
  enabledProviderIds?: readonly string[]
  sourceStatuses?: readonly McpSourceStatusPayload[]
  sourceActions?: BoringMcpSourceActions
  sourceApi?: BoringMcpSourceApiOptions
  providerSetup?: readonly BoringMcpProviderSetupState[]
  connectionUnavailableMessage?: string
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ")
}

function resolveProviders(options: CreateBoringMcpPluginOptions): readonly McpProviderTemplate[] {
  const providers = options.providers ?? DEFAULT_MCP_PROVIDER_TEMPLATES
  const enabled = new Set(options.enabledProviderIds ?? providers.map((provider) => provider.id))
  return providers.filter((provider) => enabled.has(provider.id))
}

function findSourceStatus(provider: McpProviderTemplate, statuses: readonly McpSourceStatusPayload[] = []): McpSourceStatusPayload | undefined {
  const matches = statuses.filter((status) => status.source.provider === provider.id)
  return matches.find((status) => status.source.status === "connected")
    ?? matches.find((status) => status.source.status !== "revoked")
    ?? matches[0]
}

function providerSetupState(provider: McpProviderTemplate, options: CreateBoringMcpPluginOptions): BoringMcpProviderSetupState | undefined {
  return options.providerSetup?.find((setup) => setup.providerId === provider.id)
}

function actionErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "MCP action failed. Please try again."
}

function upsertSourceStatus(statuses: readonly McpSourceStatusPayload[], next: BoringMcpSourceActionResult): McpSourceStatusPayload[] {
  if (!next) return [...statuses]
  const index = statuses.findIndex((status) => status.source.id === next.source.id)
  if (index === -1) return [...statuses, next]
  return statuses.map((status, itemIndex) => itemIndex === index ? next : status)
}

function resolveSourceApiWorkspaceId(sourceApi: BoringMcpSourceApiOptions): string {
  const workspaceId = sourceApi.workspaceId ?? sourceApi.resolveWorkspaceId?.()
  if (!workspaceId) throw new Error("Open a workspace before connecting MCP.")
  return workspaceId
}

function sourceApiUrl(sourceApi: BoringMcpSourceApiOptions, path: string): string {
  const base = sourceApi.baseUrl?.replace(/\/$/, "") ?? ""
  return `${base}${path}`
}

async function readSourceApiJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch((): unknown => undefined)
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
      ? payload.message
      : "MCP API request failed."
    throw new Error(message)
  }
  return payload as T
}

async function sourceApiRequest<T>(sourceApi: BoringMcpSourceApiOptions, path: string, body?: Record<string, unknown>): Promise<T> {
  const workspaceId = resolveSourceApiWorkspaceId(sourceApi)
  const response = await fetch(sourceApiUrl(sourceApi, path), {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-boring-workspace-id": workspaceId,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return readSourceApiJson<T>(response)
}

function defaultOpenConnectUrl(url: string): void {
  if (typeof window === "undefined") return
  window.open(url, "_blank", "noopener,noreferrer")
}

function openPendingConnectWindow(sourceApi: BoringMcpSourceApiOptions): Window | undefined {
  if (sourceApi.openConnectUrl || typeof window === "undefined") return undefined
  const popup = window.open("about:blank", "_blank")
  if (!popup) throw new Error("Popup blocked. Allow popups for this site and try connecting again.")
  try { popup.opener = null } catch { /* best effort */ }
  return popup
}

function navigatePendingConnectWindow(popup: Window | undefined, url: string | undefined): void {
  if (!popup) {
    if (url) defaultOpenConnectUrl(url)
    return
  }
  if (!url) {
    popup.close()
    return
  }
  popup.location.href = url
}

function createBrowserSourceActions(sourceApi: BoringMcpSourceApiOptions): BoringMcpSourceActions {
  return {
    async onConnect(providerId) {
      const popup = openPendingConnectWindow(sourceApi)
      try {
        const result = await sourceApiRequest<{ status: McpSourceStatusPayload; connectUrl?: string }>(sourceApi, "/api/v1/boring-mcp/connect", { provider: providerId })
        if (sourceApi.openConnectUrl && result.connectUrl) sourceApi.openConnectUrl(result.connectUrl)
        else navigatePendingConnectWindow(popup, result.connectUrl)
        return result.status
      } catch (error) {
        popup?.close()
        throw error
      }
    },
    async onRefreshStatus(sourceId) {
      const result = await sourceApiRequest<{ status: McpSourceStatusPayload }>(sourceApi, "/api/v1/boring-mcp/refresh", { sourceId })
      return result.status
    },
    async onDisconnect(sourceId) {
      const result = await sourceApiRequest<{ status: McpSourceStatusPayload }>(sourceApi, "/api/v1/boring-mcp/disconnect", { sourceId })
      return result.status
    },
    async onListTools(sourceId, _providerId, refresh) {
      const result = await sourceApiRequest<{ tools: McpToolCatalogEntry[] }>(sourceApi, "/api/v1/boring-mcp/tools", { sourceId, refresh: refresh === true })
      return result.tools
    },
  }
}

function statusLabel(status: McpSourceStatus | undefined): string {
  switch (status) {
    case "connected": return "Connected"
    case "expired": return "Expired"
    case "error": return "Needs attention"
    case "revoked": return "Disconnected"
    case "unconfigured": return "Not connected"
    default: return "Not connected"
  }
}

function statusBadgeClass(status: McpSourceStatus | undefined): string {
  switch (status) {
    case "connected": return "border-accent/40 bg-accent/10 text-foreground"
    case "expired":
    case "error": return "border-amber-500/35 bg-amber-500/10 text-foreground"
    default: return "border-border/70 bg-muted/50 text-muted-foreground"
  }
}

function McpIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 8h10" />
      <path d="M7 12h10" />
      <path d="M7 16h6" />
      <rect x="4" y="4" width="16" height="16" rx="4" />
    </svg>
  )
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={cx("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

function ActionButton({ children, disabled, tone = "secondary", onClick, title }: {
  children: string
  disabled?: boolean
  tone?: "primary" | "secondary" | "danger"
  onClick?: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      className={cx(
        "rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" && "border-accent/60 bg-accent text-accent-foreground hover:bg-accent/90",
        tone === "danger" && "border-destructive/30 bg-card/70 text-muted-foreground hover:border-destructive/50 hover:text-destructive",
        tone === "secondary" && "border-border/70 bg-card/70 text-muted-foreground hover:border-border hover:text-foreground",
      )}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.()
      }}
    >
      {children}
    </button>
  )
}

interface ProviderRowProps {
  provider: McpProviderTemplate
  providerSetup?: BoringMcpProviderSetupState
  connectionUnavailableMessage?: string
  sourceStatus?: McpSourceStatusPayload
  actions: BoringMcpSourceActions
  pending?: string
  expanded: boolean
  tools?: readonly McpToolCatalogEntry[]
  toolsPending?: boolean
  toolsError?: string
  runAction: (key: string, action: () => MaybePromise<BoringMcpSourceActionResult>) => void
  onToggle: (provider: McpProviderTemplate, sourceStatus?: McpSourceStatusPayload) => void
  onLoadTools: (sourceId: string, providerId: McpProviderId, refresh?: boolean) => void
}

function ProviderRow({ provider, providerSetup, connectionUnavailableMessage, sourceStatus, actions, pending, expanded, tools, toolsPending, toolsError, runAction, onToggle, onLoadTools }: ProviderRowProps) {
  const source = sourceStatus?.source
  const setupEnabled = providerSetup?.enabled ?? true
  const status = source?.status
  const sourceId = source?.id
  const connectLabel = status === "expired" || status === "error" ? "Reconnect" : "Connect"
  const showConnect = status !== "connected"
  const connectBlockedByStatus = Boolean(sourceStatus && !sourceStatus.connectable)
  const connectUnavailable = !setupEnabled || !actions.onConnect || connectBlockedByStatus
  const connectDisabled = connectUnavailable || pending === `${provider.id}:connect`
  const refreshDisabled = !sourceId || !actions.onRefreshStatus || pending === `${provider.id}:refresh`
  const disconnectDisabled = !sourceId || !sourceStatus?.canDisconnect || !actions.onDisconnect || pending === `${provider.id}:disconnect`
  const unavailableMessage = connectBlockedByStatus
    ? "This MCP cannot start a new connection in its current state. Refresh status or disconnect first."
    : providerSetup?.message
      ?? connectionUnavailableMessage
      ?? "Ask an admin to wire this app's MCP backend."
  const fallbackTools = provider.allowedTools.map((toolName): McpToolCatalogEntry => ({
    sourceId: sourceId ?? `template:${provider.id}`,
    provider: provider.id,
    toolName,
    displayName: toolName.replace(/[_:.-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
    summary: "Available after this MCP is connected.",
    inputSchema: {},
    risk: "read",
    enabled: status === "connected",
    blockedReasons: status === "connected" ? [] : ["Connect this MCP to discover the live tool schema."],
    schemaHash: "template",
    nativeRef: { provider: provider.id, action: toolName },
  }))
  const visibleTools = tools ?? fallbackTools

  return (
    <li className="rounded-xl border border-border/60 bg-card/70 px-3 py-2.5 transition-colors hover:border-border hover:bg-muted/50">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={expanded}
          aria-label={`${provider.displayName} MCP`}
          onClick={() => onToggle(provider, sourceStatus)}
        >
          <ChevronIcon open={expanded} />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="truncate text-sm font-medium text-foreground">{provider.displayName}</div>
              <span className={cx("rounded border px-1.5 py-0.5 text-[10px] font-medium", statusBadgeClass(status))}>{statusLabel(status)}</span>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              {source?.providerAccountLabel ? `Account: ${source.providerAccountLabel}` : source ? "Account connected through server-owned MCP credentials" : "No account connected yet."}
            </div>
            {source?.lastVerifiedAt ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">Last verified: {source.lastVerifiedAt}</div> : null}
          </div>
        </button>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {showConnect ? (
            <ActionButton
              tone="primary"
              disabled={connectDisabled}
              title={connectUnavailable && showConnect ? unavailableMessage : undefined}
              onClick={() => actions.onConnect && runAction(`${provider.id}:connect`, () => actions.onConnect?.(provider.id))}
            >
              {!setupEnabled || !actions.onConnect ? "Admin setup required" : connectLabel}
            </ActionButton>
          ) : null}
          {sourceId ? (
            <ActionButton
              disabled={refreshDisabled}
              onClick={() => actions.onRefreshStatus && runAction(`${provider.id}:refresh`, () => actions.onRefreshStatus?.(sourceId, provider.id))}
            >
              Refresh status
            </ActionButton>
          ) : null}
          {sourceId && sourceStatus?.canDisconnect ? (
            <ActionButton
              tone="danger"
              disabled={disconnectDisabled}
              onClick={() => actions.onDisconnect && runAction(`${provider.id}:disconnect`, () => actions.onDisconnect?.(sourceId, provider.id))}
            >
              Disconnect
            </ActionButton>
          ) : null}
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 border-t border-border/50 pt-3">
          {connectUnavailable && showConnect ? <div className="mb-3 text-xs text-muted-foreground">{unavailableMessage}</div> : null}
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-foreground">Tools</div>
              <p className="text-[11px] text-muted-foreground">{status === "connected" ? "Live tool catalog exposed through governed read-only MCP." : "Tools that become available after connecting this MCP."}</p>
            </div>
            {sourceId && status === "connected" && actions.onListTools ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/70 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-border hover:text-foreground disabled:opacity-50"
                disabled={toolsPending}
                onClick={(event) => {
                  event.stopPropagation()
                  onLoadTools(sourceId, provider.id, true)
                }}
              >
                <RefreshIcon className={cx("h-3 w-3", toolsPending && "animate-spin")} />
                Refresh tools
              </button>
            ) : null}
          </div>
          {toolsError ? <div role="alert" className="mb-2 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">{toolsError}</div> : null}
          {toolsPending && !tools ? (
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">Loading tools…</div>
          ) : visibleTools.length === 0 ? (
            <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">No tools returned for this MCP yet.</div>
          ) : (
            <ul role="list" className="grid gap-1.5">
              {visibleTools.map((tool) => (
                <li key={`${tool.sourceId}:${tool.toolName}`} className="rounded-lg border border-border/60 bg-background/60 px-2.5 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-foreground">{tool.toolName}</div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{tool.summary || tool.description || "MCP tool"}</p>
                    </div>
                    <span className={cx("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", tool.enabled ? "bg-accent/10 text-foreground" : "bg-muted text-muted-foreground")}>{tool.enabled ? "enabled" : "blocked"}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  )
}

export function BoringMcpSourcesPanel({ options }: { options: CreateBoringMcpPluginOptions }) {
  const providers = resolveProviders(options)
  const sourceApi = options.sourceApi?.enabled ? options.sourceApi : undefined
  const browserActions = sourceApi ? createBrowserSourceActions(sourceApi) : {}
  const actions = { ...browserActions, ...(options.sourceActions ?? {}) }
  const [sourceStatuses, setSourceStatuses] = useState<readonly McpSourceStatusPayload[]>(options.sourceStatuses ?? [])
  const [pending, setPending] = useState<string | undefined>()
  const [actionError, setActionError] = useState<string | undefined>()
  const [expandedProviderId, setExpandedProviderId] = useState<string | undefined>()
  const [toolsBySourceId, setToolsBySourceId] = useState<Record<string, McpToolCatalogEntry[]>>({})
  const [toolsPendingSourceId, setToolsPendingSourceId] = useState<string | undefined>()
  const [toolsErrors, setToolsErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    setSourceStatuses(options.sourceStatuses ?? [])
  }, [options.sourceStatuses])

  useEffect(() => {
    if (!sourceApi) return
    let cancelled = false
    void (async () => {
      try {
        const result = await sourceApiRequest<{ sourceStatuses: McpSourceStatusPayload[] }>(sourceApi, "/api/v1/boring-mcp/sources")
        if (!cancelled) setSourceStatuses(result.sourceStatuses)
      } catch (error) {
        if (!cancelled) setActionError(actionErrorMessage(error))
      }
    })()
    return () => { cancelled = true }
  }, [sourceApi?.enabled, sourceApi?.baseUrl, sourceApi?.workspaceId, sourceApi?.resolveWorkspaceId])

  const loadTools = (sourceId: string, providerId: McpProviderId, refresh = false) => {
    if (!actions.onListTools) return
    if (!refresh && toolsBySourceId[sourceId]) return
    setToolsPendingSourceId(sourceId)
    setToolsErrors((current) => ({ ...current, [sourceId]: "" }))
    void (async () => {
      try {
        const tools = await actions.onListTools?.(sourceId, providerId, refresh)
        setToolsBySourceId((current) => ({ ...current, [sourceId]: tools ?? [] }))
      } catch (error) {
        setToolsErrors((current) => ({ ...current, [sourceId]: actionErrorMessage(error) }))
      } finally {
        setToolsPendingSourceId((current) => current === sourceId ? undefined : current)
      }
    })()
  }

  const runAction = (key: string, action: () => MaybePromise<BoringMcpSourceActionResult>) => {
    setPending(key)
    setActionError(undefined)
    void (async () => {
      try {
        const result = await action()
        setSourceStatuses((current) => upsertSourceStatus(current, result))
      } catch (error) {
        setActionError(actionErrorMessage(error))
      } finally {
        setPending((current) => current === key ? undefined : current)
      }
    })()
  }

  const toggleProvider = (provider: McpProviderTemplate, sourceStatus?: McpSourceStatusPayload) => {
    const next = expandedProviderId === provider.id ? undefined : provider.id
    setExpandedProviderId(next)
    if (next && sourceStatus?.source.status === "connected" && sourceStatus.source.id) {
      actions.onViewTools?.(sourceStatus.source.id, provider.id)
      loadTools(sourceStatus.source.id, provider.id, false)
    }
  }

  return (
    <div className="boring-scrollbar-discreet min-h-0 flex-1 overflow-y-auto p-4">
      {actionError ? (
        <div role="alert" aria-live="polite" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}
      {providers.length === 0 ? (
        <div className="flex h-full min-h-[180px] items-center justify-center text-center text-sm text-muted-foreground">
          <div>
            <div className="font-medium text-foreground/80">No MCP providers enabled</div>
            <p className="mt-1 max-w-xs">Enable a provider template to connect MCP tools.</p>
          </div>
        </div>
      ) : (
        <ul role="list" className="grid gap-2">
          {providers.map((provider) => {
            const sourceStatus = findSourceStatus(provider, sourceStatuses)
            const sourceId = sourceStatus?.source.id
            return (
              <ProviderRow
                key={provider.id}
                provider={provider}
                providerSetup={providerSetupState(provider, options)}
                connectionUnavailableMessage={options.connectionUnavailableMessage}
                sourceStatus={sourceStatus}
                actions={actions}
                pending={pending}
                expanded={expandedProviderId === provider.id}
                tools={sourceId ? toolsBySourceId[sourceId] : undefined}
                toolsPending={sourceId ? toolsPendingSourceId === sourceId : false}
                toolsError={sourceId ? toolsErrors[sourceId] : undefined}
                runAction={runAction}
                onToggle={toggleProvider}
                onLoadTools={loadTools}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}

export interface BoringMcpSourcesOverlayProps {
  options?: CreateBoringMcpPluginOptions
  onClose?: () => void
  headerInsetStart?: boolean
  headerInsetEnd?: boolean
}

export function BoringMcpSourcesOverlay({ options = {}, onClose, headerInsetStart = false, headerInsetEnd = false }: BoringMcpSourcesOverlayProps) {
  return (
    <div data-boring-workspace-part="boring-mcp-sources-overlay" className="flex h-full min-h-0 flex-col bg-background">
      <header className={cx(
        "flex h-12 shrink-0 items-center justify-between border-b border-border/60",
        headerInsetStart ? "pl-12" : "pl-4",
        headerInsetEnd ? "pr-16" : "pr-4",
      )}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-foreground/[0.06] text-muted-foreground">
            <McpIcon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">{options.tabTitle ?? options.label ?? "MCP"}</h2>
            <p className="truncate text-xs text-muted-foreground">Connected MCP providers and governed tools</p>
          </div>
        </div>
        {onClose ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close MCP"
              title="Close"
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon />
            </button>
          </div>
        ) : null}
      </header>
      <BoringMcpSourcesPanel options={options} />
    </div>
  )
}

// Legacy package-manifest identity hook. The actual MCP UI is mounted by the
// host app as an app-left management overlay, not through Workbench registries.
export function createBoringMcpPlugin(options: CreateBoringMcpPluginOptions = {}): BoringFrontFactoryWithId {
  return definePlugin({
    id: BORING_MCP_PLUGIN_ID,
    label: options.label ?? "MCP",
  })
}

const boringMcpPlugin = createBoringMcpPlugin()
export default boringMcpPlugin
export * from "../shared"
