"use client"

import type { CSSProperties } from "react"
import type { PaneProps } from "@hachej/boring-workspace"
import { definePlugin, type BoringFrontFactoryWithId } from "@hachej/boring-workspace/plugin"
import {
  BORING_MCP_PLUGIN_ID,
  BORING_MCP_SOURCES_PANEL_ID,
  BORING_MCP_SOURCES_TAB_PANEL_ID,
  DEFAULT_MCP_PROVIDER_TEMPLATES,
  type McpProviderTemplate,
  type McpToolCatalogEntry,
} from "../shared"

export interface CreateBoringMcpPluginOptions {
  label?: string
  tabTitle?: string
  panelTitle?: string
  providers?: readonly McpProviderTemplate[]
  enabledProviderIds?: readonly string[]
  intro?: string
  governanceNotes?: readonly string[]
  catalogTools?: readonly McpToolCatalogEntry[]
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

function openSourcesPanel(containerApi: PaneProps["containerApi"]) {
  containerApi.addPanel({
    id: BORING_MCP_SOURCES_PANEL_ID,
    component: BORING_MCP_SOURCES_PANEL_ID,
    title: "MCP Sources",
  })
}

const styles: Record<string, CSSProperties> = {
  tab: { display: "flex", height: "100%", flexDirection: "column", gap: 10, padding: 10 },
  eyebrow: { margin: 0, color: "var(--muted-foreground)", fontSize: 10, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" },
  title: { margin: 0, fontSize: 18, letterSpacing: "-0.03em" },
  muted: { color: "var(--muted-foreground)", fontSize: 12, lineHeight: 1.45 },
  button: { width: "100%", border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", color: "var(--foreground)", cursor: "pointer", padding: "11px 12px", textAlign: "left" },
  note: { marginTop: "auto", border: "1px solid var(--border)", borderRadius: 16, background: "var(--card)", padding: 12 },
  panel: { minHeight: "100%", overflow: "auto", padding: 24, background: "var(--background)", color: "var(--foreground)" },
  hero: { display: "flex", justifyContent: "space-between", gap: 20, maxWidth: 1120, margin: "0 auto 18px" },
  heroTitle: { margin: 0, maxWidth: 760, fontSize: "clamp(34px, 5vw, 64px)", lineHeight: 0.95, letterSpacing: "-0.065em" },
  pillGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, maxWidth: 1120, margin: "0 auto 18px" },
  pill: { border: "1px solid var(--border)", borderRadius: 999, background: "var(--card)", padding: "10px 12px", fontSize: 12, fontWeight: 700, textAlign: "center" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, maxWidth: 1120, margin: "0 auto" },
  toolGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, maxWidth: 1120, margin: "18px auto 0" },
  card: { display: "flex", minHeight: 250, flexDirection: "column", border: "1px solid var(--border)", borderRadius: 24, background: "var(--card)", padding: 18 },
  cardTop: { display: "flex", justifyContent: "space-between", gap: 12 },
  badge: { border: "1px solid var(--border)", borderRadius: 999, padding: "5px 8px", color: "var(--muted-foreground)", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" },
  codeBox: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, maxWidth: 1120, margin: "18px auto 0" },
  codeCard: { border: "1px solid var(--border)", borderRadius: 22, background: "var(--card)", padding: 16 },
  code: { display: "block", overflow: "hidden", marginTop: 7, borderRadius: 8, background: "var(--muted)", padding: "7px 8px", color: "var(--muted-foreground)", fontSize: 12, textOverflow: "ellipsis", whiteSpace: "nowrap" },
  pre: { overflow: "auto", maxHeight: 150, borderRadius: 10, background: "var(--muted)", padding: 10, color: "var(--muted-foreground)", fontSize: 11 },
}

function SourcesTab({ containerApi, options }: PaneProps & { options: CreateBoringMcpPluginOptions }) {
  return (
    <div style={styles.tab}>
      <div>
        <p style={styles.eyebrow}>Context</p>
        <h2 style={styles.title}>{options.tabTitle ?? "Sources"}</h2>
        <p style={styles.muted}>Connect approved context providers behind governed MCP tools.</p>
      </div>
      <button type="button" style={styles.button} onClick={() => openSourcesPanel(containerApi)}>
        <strong>Manage sources</strong>
        <span style={{ ...styles.muted, display: "block", marginTop: 4 }}>Search, describe, and read-only call</span>
      </button>
      <div style={styles.note}>
        <strong>V0 rule</strong>
        <span style={{ ...styles.muted, display: "block", marginTop: 6 }}>Agents only see boring-mcp bridge tools. Provider meta-tools stay server-side.</span>
      </div>
    </div>
  )
}

function SourcesPanel({ options }: { options: CreateBoringMcpPluginOptions }) {
  const providers = resolveProviders(options)
  const governanceNotes = options.governanceNotes ?? defaultGovernanceNotes
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
      <section style={styles.grid} aria-label="Configured source providers">
        {providers.map((provider) => (
          <article key={provider.id} style={styles.card}>
            <div style={styles.cardTop}>
              <h2 style={{ margin: 0, fontSize: 24 }}>{provider.displayName}</h2>
              <span style={styles.badge}>{provider.readOnlyDefault ? "Read-only" : "Configured"}</span>
            </div>
            <p style={styles.muted}>Configured provider template. Connection, status, probe, and tool catalog wiring are supplied by the host app's boring-mcp backend.</p>
            <div style={styles.badge}>{provider.allowedTools.length} allowed read tools</div>
            <button type="button" disabled style={{ ...styles.button, cursor: "not-allowed", marginTop: "auto", color: "var(--muted-foreground)" }}>Connect through app backend</button>
          </article>
        ))}
      </section>
      <section style={styles.toolGrid} aria-label="Tool catalog preview">
        {(options.catalogTools ?? []).length === 0 ? (
          <article style={styles.codeCard}>
            <h2>Tool catalog</h2>
            <p style={styles.muted}>Host apps wire this panel to mcp_tools_search and mcp_tool_describe. No provider execution runs here.</p>
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

export function createBoringMcpPlugin(options: CreateBoringMcpPluginOptions = {}): BoringFrontFactoryWithId {
  const label = options.label ?? "Sources"
  return definePlugin({
    id: BORING_MCP_PLUGIN_ID,
    label,
    panels: [
      { id: BORING_MCP_SOURCES_TAB_PANEL_ID, label, placement: "left-tab", component: (props) => <SourcesTab {...props} options={options} /> },
      { id: BORING_MCP_SOURCES_PANEL_ID, label: options.panelTitle ?? "MCP Sources", placement: "center", component: () => <SourcesPanel options={options} /> },
    ],
    commands: [{ id: "boring-mcp.open-sources", title: "Open Sources", panelId: BORING_MCP_SOURCES_PANEL_ID, keywords: ["mcp", "sources", "context"] }],
  })
}

const boringMcpPlugin = createBoringMcpPlugin()
export default boringMcpPlugin
export * from "../shared"
