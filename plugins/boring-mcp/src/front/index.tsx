"use client"

import { useEffect, useState, type CSSProperties } from "react"
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
  panelTitle?: string
  providers?: readonly McpProviderTemplate[]
  enabledProviderIds?: readonly string[]
  intro?: string
  governanceNotes?: readonly string[]
  catalogTools?: readonly McpToolCatalogEntry[]
  sourceStatuses?: readonly McpSourceStatusPayload[]
  sourceActions?: BoringMcpSourceActions
  sourceApi?: BoringMcpSourceApiOptions
  providerSetup?: readonly BoringMcpProviderSetupState[]
  connectionUnavailableMessage?: string
}

const defaultGovernanceNotes = [
  "Read-only by default",
  "No raw tokens to agents or browser",
  "Audit and redaction before output",
  "Personal and company context stay separate",
]

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
  return error instanceof Error && error.message ? error.message : "Source action failed. Please try again."
}

function upsertSourceStatus(statuses: readonly McpSourceStatusPayload[], next: BoringMcpSourceActionResult): McpSourceStatusPayload[] {
  if (!next) return [...statuses]
  const index = statuses.findIndex((status) => status.source.id === next.source.id)
  if (index === -1) return [...statuses, next]
  return statuses.map((status, itemIndex) => itemIndex === index ? next : status)
}

function defaultWorkspaceIdFromLocation(): string | undefined {
  if (typeof window === "undefined") return undefined
  const url = new URL(window.location.href)
  const queryWorkspaceId = url.searchParams.get("workspaceId")?.trim()
  if (queryWorkspaceId) return queryWorkspaceId
  const match = url.pathname.match(/\/(?:workspace|w)\/([^/?#]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

function resolveSourceApiWorkspaceId(sourceApi: BoringMcpSourceApiOptions): string {
  const workspaceId = sourceApi.workspaceId ?? sourceApi.resolveWorkspaceId?.() ?? defaultWorkspaceIdFromLocation()
  if (!workspaceId) throw new Error("Open a workspace before connecting sources.")
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
      : "Source API request failed."
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

function statusTone(status: McpSourceStatus | undefined): CSSProperties {
  switch (status) {
    case "connected": return { borderColor: "color-mix(in srgb, var(--accent) 55%, var(--border))", color: "var(--foreground)" }
    case "expired":
    case "error": return { borderColor: "color-mix(in srgb, #f59e0b 55%, var(--border))", color: "var(--foreground)" }
    default: return { color: "var(--muted-foreground)" }
  }
}


const styles: Record<string, CSSProperties> = {
  tab: { display: "flex", height: "100%", flexDirection: "column", gap: 10, padding: 10 },
  eyebrow: { margin: 0, color: "var(--muted-foreground)", fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" },
  title: { margin: 0, fontSize: 18, letterSpacing: "-0.03em" },
  muted: { color: "var(--muted-foreground)", fontSize: 12, lineHeight: 1.45 },
  button: { width: "100%", border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", color: "var(--foreground)", cursor: "pointer", padding: "11px 12px", textAlign: "left" },
  primaryButton: { border: "1px solid var(--accent)", borderRadius: 12, background: "var(--accent)", color: "var(--accent-foreground)", cursor: "pointer", padding: "10px 12px", fontWeight: 800 },
  secondaryButton: { border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", color: "var(--foreground)", cursor: "pointer", padding: "10px 12px", fontWeight: 700 },
  dangerButton: { border: "1px solid color-mix(in srgb, #ef4444 55%, var(--border))", borderRadius: 12, background: "var(--card)", color: "var(--foreground)", cursor: "pointer", padding: "10px 12px", fontWeight: 700 },
  disabledButton: { border: "1px solid var(--border)", borderRadius: 12, background: "var(--muted)", color: "var(--muted-foreground)", cursor: "not-allowed", padding: "10px 12px", fontWeight: 700 },
  note: { marginTop: "auto", border: "1px solid var(--border)", borderRadius: 16, background: "var(--card)", padding: 12 },
  overlay: { display: "flex", height: "100%", minHeight: 0, flexDirection: "column", background: "var(--background)", color: "var(--foreground)" },
  overlayHeader: { display: "flex", minHeight: 48, flexShrink: 0, alignItems: "center", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--border)", padding: "0 16px" },
  overlayTitle: { margin: 0, fontSize: 14, fontWeight: 700, letterSpacing: "-0.02em" },
  overlayDescription: { margin: 0, overflow: "hidden", color: "var(--muted-foreground)", fontSize: 12, textOverflow: "ellipsis", whiteSpace: "nowrap" },
  closeButton: { border: "1px solid transparent", borderRadius: 10, background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", padding: "6px 9px", fontSize: 18, lineHeight: 1 },
  panel: { minHeight: "100%", overflow: "auto", padding: 24, background: "var(--background)", color: "var(--foreground)" },
  hero: { display: "flex", justifyContent: "space-between", gap: 20, maxWidth: 1120, margin: "0 auto 18px" },
  heroTitle: { margin: 0, maxWidth: 760, fontSize: "clamp(34px, 5vw, 64px)", lineHeight: 0.95, letterSpacing: "-0.065em" },
  pillGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, maxWidth: 1120, margin: "0 auto 18px" },
  pill: { border: "1px solid var(--border)", borderRadius: 999, background: "var(--card)", padding: "10px 12px", fontSize: 12, fontWeight: 700, textAlign: "center" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, maxWidth: 1120, margin: "0 auto" },
  toolGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, maxWidth: 1120, margin: "18px auto 0" },
  card: { display: "flex", minHeight: 280, flexDirection: "column", border: "1px solid var(--border)", borderRadius: 24, background: "var(--card)", padding: 18 },
  cardTop: { display: "flex", justifyContent: "space-between", gap: 12 },
  badge: { border: "1px solid var(--border)", borderRadius: 999, padding: "5px 8px", color: "var(--muted-foreground)", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" },
  meta: { display: "grid", gap: 6, margin: "12px 0" },
  actionRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: "auto" },
  codeBox: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, maxWidth: 1120, margin: "18px auto 0" },
  codeCard: { border: "1px solid var(--border)", borderRadius: 22, background: "var(--card)", padding: 16 },
  code: { display: "block", overflow: "hidden", marginTop: 7, borderRadius: 8, background: "var(--muted)", padding: "7px 8px", color: "var(--muted-foreground)", fontSize: 12, textOverflow: "ellipsis", whiteSpace: "nowrap" },
  pre: { overflow: "auto", maxHeight: 150, borderRadius: 10, background: "var(--muted)", padding: 10, color: "var(--muted-foreground)", fontSize: 11 },
}

function ActionButton({ children, disabled, tone = "secondary", onClick }: { children: string; disabled?: boolean; tone?: "primary" | "secondary" | "danger"; onClick?: () => void }) {
  const style = disabled ? styles.disabledButton : tone === "primary" ? styles.primaryButton : tone === "danger" ? styles.dangerButton : styles.secondaryButton
  return <button type="button" disabled={disabled} style={style} onClick={onClick}>{children}</button>
}

function ProviderCard({ provider, options, actions, sourceStatuses, pending, runAction }: {
  provider: McpProviderTemplate
  options: CreateBoringMcpPluginOptions
  actions: BoringMcpSourceActions
  sourceStatuses: readonly McpSourceStatusPayload[]
  pending?: string
  runAction: (key: string, action: () => MaybePromise<BoringMcpSourceActionResult>) => void
}) {
  const sourceStatus = findSourceStatus(provider, sourceStatuses)
  const source = sourceStatus?.source
  const setup = providerSetupState(provider, options)
  const setupEnabled = setup?.enabled ?? true
  const status = source?.status
  const sourceId = source?.id
  const connectLabel = status === "expired" || status === "error" ? "Reconnect" : "Connect"
  const showConnect = status !== "connected"
  const connectBlockedByStatus = Boolean(sourceStatus && !sourceStatus.connectable)
  const connectUnavailable = !setupEnabled || !actions.onConnect || connectBlockedByStatus
  const connectDisabled = connectUnavailable || pending === `${provider.id}:connect`
  const refreshDisabled = !sourceId || !actions.onRefreshStatus || pending === `${provider.id}:refresh`
  const disconnectDisabled = !sourceId || !sourceStatus?.canDisconnect || !actions.onDisconnect || pending === `${provider.id}:disconnect`
  const viewToolsDisabled = !sourceId || !sourceStatus?.canProbe || !actions.onViewTools || pending === `${provider.id}:tools`
  const unavailableMessage = connectBlockedByStatus
    ? "This source cannot start a new connection in its current state. Refresh status or disconnect first."
    : setup?.message
      ?? options.connectionUnavailableMessage
      ?? "Ask an admin to wire this app's boring-mcp source actions."

  return (
    <article style={styles.card}>
      <div style={styles.cardTop}>
        <h2 style={{ margin: 0, fontSize: 24 }}>{provider.displayName}</h2>
        <span style={{ ...styles.badge, ...statusTone(status) }}>{statusLabel(status)}</span>
      </div>
      <p style={styles.muted}>Configured provider template. Connection, status, probe, and tool catalog wiring are supplied by the host app's boring-mcp backend.</p>
      <div style={styles.meta}>
        <span style={styles.badge}>{provider.allowedTools.length} allowed read tools</span>
        {source?.providerAccountLabel && <span style={styles.muted}>Account: <strong>{source.providerAccountLabel}</strong></span>}
        {source?.lastVerifiedAt && <span style={styles.muted}>Last verified: {source.lastVerifiedAt}</span>}
        {!source && <span style={styles.muted}>No account connected yet.</span>}
        {connectUnavailable && showConnect && <span style={styles.muted}>{unavailableMessage}</span>}
      </div>
      <div style={styles.actionRow}>
        {showConnect ? (
          <ActionButton
            tone="primary"
            disabled={connectDisabled}
            onClick={() => actions.onConnect && runAction(`${provider.id}:connect`, () => actions.onConnect?.(provider.id))}
          >
            {!setupEnabled || !actions.onConnect ? "Admin setup required" : connectLabel}
          </ActionButton>
        ) : (
          <ActionButton
            tone="primary"
            disabled={viewToolsDisabled}
            onClick={() => sourceId && actions.onViewTools && runAction(`${provider.id}:tools`, () => actions.onViewTools?.(sourceId, provider.id))}
          >
            View tools
          </ActionButton>
        )}
        {sourceId && (
          <ActionButton
            disabled={refreshDisabled}
            onClick={() => actions.onRefreshStatus && runAction(`${provider.id}:refresh`, () => actions.onRefreshStatus?.(sourceId, provider.id))}
          >
            Refresh status
          </ActionButton>
        )}
        {sourceId && sourceStatus?.canDisconnect && (
          <ActionButton
            tone="danger"
            disabled={disconnectDisabled}
            onClick={() => actions.onDisconnect && runAction(`${provider.id}:disconnect`, () => actions.onDisconnect?.(sourceId, provider.id))}
          >
            Disconnect
          </ActionButton>
        )}
      </div>
    </article>
  )
}

export function BoringMcpSourcesPanel({ options }: { options: CreateBoringMcpPluginOptions }) {
  const providers = resolveProviders(options)
  const governanceNotes = options.governanceNotes ?? defaultGovernanceNotes
  const sourceApi = options.sourceApi?.enabled ? options.sourceApi : undefined
  const browserActions = sourceApi ? createBrowserSourceActions(sourceApi) : {}
  const actions = { ...browserActions, ...(options.sourceActions ?? {}) }
  const [sourceStatuses, setSourceStatuses] = useState<readonly McpSourceStatusPayload[]>(options.sourceStatuses ?? [])
  const [pending, setPending] = useState<string | undefined>()
  const [actionError, setActionError] = useState<string | undefined>()

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
  }, [sourceApi])

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
        setPending(undefined)
      }
    })()
  }

  return (
    <main style={styles.panel}>
      <section style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Sources</p>
          <h1 style={styles.heroTitle}>{options.panelTitle ?? "Connect context safely."}</h1>
          <p style={{ ...styles.muted, maxWidth: 680, fontSize: 15 }}>{options.intro ?? "Sources are read-only by default and routed through governed MCP tools."}</p>
        </div>
        <div style={styles.note}><strong>boring-mcp</strong><span style={{ ...styles.muted, display: "block", marginTop: 6 }}>Reusable plugin foundation</span></div>
      </section>
      <section style={styles.pillGrid} aria-label="MCP governance guarantees">
        {governanceNotes.map((note) => <div key={note} style={styles.pill}>{note}</div>)}
      </section>
      {actionError && <div role="alert" style={{ ...styles.codeCard, maxWidth: 1120, margin: "0 auto 18px", borderColor: "color-mix(in srgb, #ef4444 55%, var(--border))" }}>{actionError}</div>}
      <section style={styles.grid} aria-label="Configured source providers">
        {providers.map((provider) => <ProviderCard key={provider.id} provider={provider} options={options} actions={actions} sourceStatuses={sourceStatuses} pending={pending} runAction={runAction} />)}
      </section>
      <section style={styles.toolGrid} aria-label="Tool catalog preview">
        {(options.catalogTools ?? []).length === 0 ? (
          <article style={styles.codeCard}>
            <h2>Tool catalog</h2>
            <p style={styles.muted}>Connected sources can expose their enabled read-only tools here after the host app wires mcp_tools_search and mcp_tool_describe.</p>
          </article>
        ) : options.catalogTools?.map((tool) => (
          <article key={`${tool.sourceId}:${tool.toolName}`} style={styles.codeCard}>
            <div style={styles.cardTop}>
              <h2 style={{ margin: 0 }}>{tool.displayName}</h2>
              <span style={styles.badge}>{tool.enabled ? "Enabled" : "Blocked"}</span>
            </div>
            <p style={styles.muted}>{tool.summary}</p>
            {!tool.enabled && <p style={styles.muted}>Blocked: {tool.blockedReasons.join(", ")}</p>}
            <code style={styles.code}>{tool.toolName}</code>
            <pre style={styles.pre}>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
          </article>
        ))}
      </section>
      <section style={styles.codeBox}>
        <div style={styles.codeCard}>
          <h2>Browser can call</h2>
          <code style={styles.code}>app-owned boring-mcp source APIs</code>
          <code style={styles.code}>connect / status / disconnect</code>
          <code style={styles.code}>search / describe / read-only call</code>
        </div>
        <div style={styles.codeCard}>
          <h2>Browser never receives</h2>
          <code style={styles.code}>provider OAuth tokens</code>
          <code style={styles.code}>MCP session headers</code>
          <code style={styles.code}>raw connector API keys</code>
        </div>
      </section>
    </main>
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
    <div data-boring-workspace-part="boring-mcp-sources-overlay" style={styles.overlay}>
      <header style={{
        ...styles.overlayHeader,
        paddingLeft: headerInsetStart ? 48 : 16,
        paddingRight: headerInsetEnd ? 64 : 16,
      }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={styles.overlayTitle}>{options.tabTitle ?? options.label ?? "Sources"}</h2>
          <p style={styles.overlayDescription}>Connect approved context sources through governed MCP tools.</p>
        </div>
        {onClose ? <button type="button" aria-label="Close Sources" style={styles.closeButton} onClick={onClose}>×</button> : null}
      </header>
      <div style={{ minHeight: 0, flex: 1, overflow: "auto" }}>
        <BoringMcpSourcesPanel options={options} />
      </div>
    </div>
  )
}

export function createBoringMcpPlugin(options: CreateBoringMcpPluginOptions = {}): BoringFrontFactoryWithId {
  return definePlugin({
    id: BORING_MCP_PLUGIN_ID,
    label: options.label ?? "Sources",
  })
}

const boringMcpPlugin = createBoringMcpPlugin()
export default boringMcpPlugin
export * from "../shared"
