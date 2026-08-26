/**
 * `?saasSpike=1` — hybrid SaaS + Agent shell, RE-COMPOSED (owner correction).
 *
 * The first cut of this spike hand-built a shell, a nav, two `<table>`s and a
 * fake file tree. That was the wrong artifact: it proved a picture, not the
 * product. This version proves the product by REUSING what already ships and
 * only re-organizing it. What each block gave us:
 *
 *   - `PluginTabsWorkspaceShell` (packages/workspace, plugin-tabs layout) — the
 *     real outer frame: left pane, collapsed rail, resize handle, mobile Sheet,
 *     and the floating collapse button. It is a dumb 2-column frame that takes
 *     `leftPane` / `collapsedRail` / `children`, so re-composition is exactly
 *     what it is for.
 *   - `SurfaceShell` (the workbench) — the vertical plugin icon RAIL, the
 *     source pane beside it, and the Dockview centre with real tabs. This is
 *     the owner's "additional column" gesture, and it is not ours to rebuild.
 *   - `filesystemPlugin` — the REAL file tree, against the live playground agent
 *     API. It browses `apps/workspace-playground/workspace` for real; it is the
 *     only part of this screen that is not fixture data.
 *   - `createDataCatalogPlugin` + `DataExplorer` — Companies and Funds, as rail
 *     TOOLS, fed by fixture adapters. No backend.
 *   - `AppLeftPaneAgentCard`, `AppSessionRow`, `RailAction` — the real left-pane
 *     row/card/rail primitives, imported from source (all three are
 *     context-free, so they compose safely here).
 *   - `JobThreadView` + `SaasSpikeFixtures` — kept verbatim from this branch.
 *   - `useWorkspaceAttention` — the real Inbox/attention store. Fixture blockers
 *     are seeded into it, so the Inbox badge and the collapsed-Work rollup are
 *     computed by the shipped code path, not by counting fixtures by hand.
 *
 * IA (owner ruling): the RAIL is tools, the NAV is domains. Nav order is fixed:
 * Inbox (first — single triage surface), Work, Agents, Library, Search.
 *
 * Everything the nav opens lands in the SAME Dockview centre. The chat column
 * is one more column beside it, never a navigation.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  Bot,
  Building2,
  ChevronRight,
  Columns3,
  Inbox as InboxIcon,
  Landmark,
  LayoutGrid,
  Library,
  type LucideIcon,
  Search,
  Sparkles,
  Table2,
  Workflow,
  X,
} from "lucide-react"
import { Button, Chip, StatusBadge, Textarea } from "@hachej/boring-ui-kit"
import {
  SurfaceShell,
  WorkspaceProvider,
  useWorkspaceAttention,
  type PaneProps,
  type PanelConfig,
  type SurfaceShellApi,
} from "@hachej/boring-workspace"
import { createDataCatalogPlugin } from "@hachej/boring-data-catalog/front"
// Internal source imports. The playground aliases `@` -> packages/workspace/src
// (see vite.config.ts). These three modules import no workspace context, so
// pulling them from source next to a dist-built `WorkspaceProvider` cannot
// split a context — the one hazard that would matter here. Anything
// context-dependent is read through the package entry above instead.
import { PluginTabsWorkspaceShell } from "@/front/layout/plugin-tabs/PluginTabsWorkspaceShell"
import { AppLeftPaneAgentCard } from "@/front/layout/plugin-tabs/AppLeftPaneAgentCards"
import { AppSessionRow } from "@/front/layout/plugin-tabs/AppLeftPaneSessionRow"
import { RailAction } from "@/front/layout/plugin-tabs/AppLeftPaneActions"
import { JobThreadView } from "./JobThreadView"
import {
  SAAS_AGENTS,
  SAAS_AUTOMATIONS,
  SAAS_COMPANIES,
  SAAS_COMPANY_ADAPTER,
  SAAS_COMPANY_FACETS,
  SAAS_FUNDS,
  SAAS_FUND_ADAPTER,
  SAAS_FUND_FACETS,
  SAAS_SAVED_VIEWS,
  SAAS_THREADS,
  type SaasAgent,
  type SaasSavedView,
  type SaasThread,
  type SaasViewKind,
} from "./SaasSpikeFixtures"

const SAAS_AGENT_TYPE = "builder"

function statusTone(status: SaasThread["status"]): "warning" | "info" | "success" {
  if (status === "Needs you") return "warning"
  if (status === "Complete") return "success"
  return "info"
}

/** Threads waiting on a human — the one number the Inbox entry is allowed to show. */
function needsYouThreads(): readonly SaasThread[] {
  return SAAS_THREADS.filter((thread) => thread.status === "Needs you")
}

// ---------------------------------------------------------------------------
// PANELS — everything the nav opens is a registered Dockview panel, so the
// centre is always the real surface and never a bespoke router.
// ---------------------------------------------------------------------------

/**
 * The Overview tiles are the one surface kept deliberately bespoke.
 *
 * There is no dashboard/stat-tile primitive in `packages/ui`, and the deck
 * plugin's widgets are chart/markdown widgets bound to a deck document rather
 * than free-standing KPI tiles — wiring a deck document to render four numbers
 * would be more scaffolding than the numbers. Four tiles of plain markup is the
 * honest smaller thing.
 */
function OverviewPanel() {
  const sectors = new Set(SAAS_COMPANIES.map((company) => company.sector)).size
  const tiles = [
    { label: "Companies tracked", value: String(SAAS_COMPANIES.length), note: `Across ${sectors} sectors` },
    { label: "Funds", value: String(SAAS_FUNDS.length), note: "$2.2B fixture AUM" },
    { label: "Open threads", value: String(SAAS_THREADS.filter((thread) => thread.status !== "Complete").length), note: "2 active today" },
    { label: "Needs you", value: String(needsYouThreads().length), note: "Decisions waiting" },
  ]
  return (
    <div className="h-full overflow-y-auto bg-background p-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">Saved dashboard</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">Portfolio overview</h1>
      <section aria-label="Portfolio summary" className="mt-8 grid overflow-hidden rounded-xl border border-border/70 bg-card sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile, index) => (
          <div
            key={tile.label}
            className={[
              "min-h-32 px-5 py-5",
              index > 0 ? "border-t border-border/60 xl:border-l xl:border-t-0" : "",
              index % 2 === 1 ? "sm:border-l" : "",
              index === 1 ? "sm:border-t-0" : "",
            ].join(" ")}
          >
            <span className="text-xs font-medium text-muted-foreground">{tile.label}</span>
            <span className="mt-3 block text-3xl font-semibold tracking-[-0.04em] text-foreground">{tile.value}</span>
            <span className="mt-2 block text-xs text-muted-foreground/75">{tile.note}</span>
          </div>
        ))}
      </section>
    </div>
  )
}

function InboxPanel({ params }: PaneProps<{ onOpenThread?: (threadId: string) => void }>) {
  const waiting = needsYouThreads()
  return (
    <div className="h-full overflow-y-auto bg-background p-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">Triage</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">Inbox</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        Every decision the portfolio is waiting on, in one place. Nothing else in this app is allowed to be a second triage surface.
      </p>
      {waiting.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Nothing needs you.</p>
      ) : (
        <div className="mt-8 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
          {waiting.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => params?.onOpenThread?.(thread.id)}
              className="group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{thread.title}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{thread.subject}</span>
              </span>
              <StatusBadge tone="warning">{thread.status}</StatusBadge>
              <span className="w-16 text-right text-xs text-muted-foreground/70">{thread.updatedAt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ThreadPanel({ params }: PaneProps<{ threadId?: string }>) {
  const thread = SAAS_THREADS.find((item) => item.id === params?.threadId)
  if (!thread) return <div className="grid h-full place-items-center bg-background p-8 text-sm text-muted-foreground">Thread not found.</div>
  return <JobThreadView fixture={thread.job} />
}

/**
 * Agent detail.
 *
 * The shipped `AgentPage` (packages/workspace .../chrome/skills/AgentPage.tsx)
 * is the right component in shape, but it reads its skills/tools through
 * `useWorkspacePluginClient()`, which resolves against a live
 * `/api/v1/agents/:id/{skills,tools}` — there is no fixture seam on it short of
 * mocking the hook, which is a test affordance and not an app one. So the agent
 * page here is a small fixture stand-in that reuses `AppLeftPaneAgentCard` for
 * the identity block and lists the agent's threads. Called out rather than
 * dressed up as reuse.
 */
function AgentPanel({ params }: PaneProps<{ agentId?: string; onOpenThread?: (threadId: string) => void }>) {
  const agent = SAAS_AGENTS.find((item) => item.id === params?.agentId)
  if (!agent) return <div className="grid h-full place-items-center bg-background p-8 text-sm text-muted-foreground">Agent not found.</div>
  const threads = agent.threadIds.map((id) => SAAS_THREADS.find((thread) => thread.id === id)).filter((thread): thread is SaasThread => Boolean(thread))
  return (
    <div className="h-full overflow-y-auto bg-background p-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/75">Agent</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">{agent.name}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{agent.role}</p>
      <section className="mt-8">
        <h2 className="border-b border-border/70 pb-3 text-sm font-semibold text-foreground">Threads this agent is on</h2>
        <div className="divide-y divide-border/60">
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => params?.onOpenThread?.(thread.id)}
              className="group flex w-full items-center gap-4 px-1 py-4 text-left hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{thread.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{thread.subject}</span>
              </span>
              <StatusBadge tone={statusTone(thread.status)}>{thread.status}</StatusBadge>
            </button>
          ))}
        </div>
      </section>
      <p className="mt-10 text-xs text-muted-foreground/70">
        Fixture agent page. The shipped Agent page (skills + tools) needs a live agent API and has no fixture seam.
      </p>
    </div>
  )
}

function KanbanPlaceholderPanel() {
  return (
    <div className="grid h-full place-items-center bg-background p-8 text-center">
      <div>
        <span className="mx-auto grid size-10 place-items-center rounded-lg border border-border/70 bg-muted/30 text-muted-foreground"><Columns3 className="size-4" /></span>
        <h1 className="mt-4 text-sm font-semibold text-foreground">Diligence pipeline</h1>
        <p className="mt-1 max-w-xs text-sm leading-6 text-muted-foreground">
          A saved view of kind <code>kanban</code>. No kanban component exists in the repo yet, so this entry is a placeholder — it holds the shelf slot without pretending to be built.
        </p>
      </div>
    </div>
  )
}

const SAAS_PANEL_IDS = ["saas-overview", "saas-inbox", "saas-thread", "saas-agent", "saas-kanban-placeholder"] as const

function saasPanels(): PanelConfig[] {
  return [
    { id: "saas-overview", title: "Portfolio overview", placement: "shared-dockview", source: "app", component: OverviewPanel },
    { id: "saas-inbox", title: "Inbox", placement: "shared-dockview", source: "app", component: InboxPanel },
    { id: "saas-thread", title: "Thread", placement: "shared-dockview", source: "app", component: ThreadPanel },
    { id: "saas-agent", title: "Agent", placement: "shared-dockview", source: "app", component: AgentPanel },
    { id: "saas-kanban-placeholder", title: "Diligence pipeline", placement: "shared-dockview", source: "app", component: KanbanPlaceholderPanel },
  ]
}

// ---------------------------------------------------------------------------
// RAIL TOOLS — Companies and Funds are workspace SOURCES, exactly like Files.
// `createDataCatalogPlugin` registers the rail icon, the source pane (a
// `DataExplorer` over our fixture adapter) and the centre visualization panel.
// The visualization panel ids below are the same ids the Library's saved-view
// entries carry, which is what makes "one view, two doors" literally true.
// ---------------------------------------------------------------------------

const companiesPlugin = createDataCatalogPlugin({
  id: "saas-companies",
  label: "Companies",
  adapter: SAAS_COMPANY_ADAPTER,
  facets: SAAS_COMPANY_FACETS,
  workspacePageIcon: Building2,
  visualizationPanelId: "saas-companies-visualization",
  visualizationTitle: "Companies",
  searchPlaceholder: "Search companies…",
  emptyState: "No companies match these filters",
})

const fundsPlugin = createDataCatalogPlugin({
  id: "saas-funds",
  label: "Funds",
  adapter: SAAS_FUND_ADAPTER,
  facets: SAAS_FUND_FACETS,
  workspacePageIcon: Landmark,
  visualizationPanelId: "saas-funds-visualization",
  visualizationTitle: "Funds",
  searchPlaceholder: "Search funds…",
  emptyState: "No funds match these filters",
})

// `filesystemPlugin` is NOT listed here: `WorkspaceProvider` already registers
// it as a default, and passing it again throws `plugin "filesystem" registered
// twice`. The real file tree arrives through that default, not through us.
const saasPlugins = [companiesPlugin, fundsPlugin]

const viewKindIcon: Record<SaasViewKind, LucideIcon> = {
  collection: Table2,
  document: Library,
  dashboard: LayoutGrid,
  kanban: Columns3,
  chart: LayoutGrid,
}

// ---------------------------------------------------------------------------
// LEFT NAV — domains, in the owner's fixed order.
//
// Collapse/rollup idioms are lifted from `AppLeftPaneConsoleSpike`: one
// `ReadonlySet<string>` of expanded section ids toggled through `toggleSet`, and
// the rule that a COLLAPSED header states what is actionable while an EXPANDED
// one goes silent because its rows say it themselves.
// ---------------------------------------------------------------------------

function toggleSet(current: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(current)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function NavEntry({
  icon: Icon,
  label,
  active,
  trailing,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active?: boolean
  trailing?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-[current=page]:bg-foreground/[0.07] aria-[current=page]:font-medium aria-[current=page]:text-foreground"
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {trailing}
    </button>
  )
}

/** The amber attention count. One component, so Inbox and a collapsed Work header cannot drift. */
function AttentionCount({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      data-boring-workspace-part="saas-attention-count"
      className="ml-auto rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold tabular-nums text-amber-700 dark:text-amber-300"
    >
      {count}
    </span>
  )
}

function NavSection({
  icon: Icon,
  label,
  sectionId,
  expanded,
  onToggle,
  attention,
  children,
}: {
  icon: LucideIcon
  label: string
  sectionId: string
  expanded: boolean
  onToggle: (sectionId: string) => void
  attention: number
  children: ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(sectionId)}
        aria-expanded={expanded}
        className="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/75 transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <ChevronRight
          className={`size-3 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          strokeWidth={2}
          aria-hidden="true"
        />
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {/* Collapsed says what is actionable; expanded goes quiet. */}
        {expanded ? null : <AttentionCount count={attention} />}
      </button>
      {expanded ? <div className="mt-0.5 pl-2">{children}</div> : null}
    </div>
  )
}

function SubGroupLabel({ children }: { children: ReactNode }) {
  return <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/60">{children}</p>
}

interface SaasNavActions {
  openInbox: () => void
  openThread: (threadId: string) => void
  openAgent: (agentId: string) => void
  openSavedView: (view: SaasSavedView) => void
  openFilesTool: () => void
  openCommandPalette: () => void
}

function SaasLeftNav({
  actions,
  activePanelId,
  attentionThreadIds,
}: {
  actions: SaasNavActions
  activePanelId: string | null
  attentionThreadIds: ReadonlySet<string>
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(["work"]))
  const onToggle = useCallback((sectionId: string) => setExpanded((current) => toggleSet(current, sectionId)), [])
  const workAttention = SAAS_THREADS.filter((thread) => attentionThreadIds.has(thread.id)).length
  const agentAttention = SAAS_AGENTS.filter((agent) => agent.status === "Needs you").length

  return (
    <aside
      data-boring-workspace-part="app-left-pane"
      className="flex h-full min-h-0 w-56 shrink-0 flex-col border-r border-border/70 bg-[color:var(--surface-workbench-left)] px-2 py-3"
    >
      <div className="flex h-10 items-center gap-2 pl-9">
        <span className="grid size-6 place-items-center rounded-md bg-foreground text-[11px] font-bold text-background">M</span>
        <span className="text-sm font-semibold tracking-[-0.015em] text-foreground">Meridian</span>
      </div>

      <nav aria-label="Main navigation" className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {/* 1. INBOX — first, by owner ruling: the single triage surface. */}
        <NavEntry
          icon={InboxIcon}
          label="Inbox"
          active={activePanelId === "saas-inbox"}
          trailing={<AttentionCount count={attentionThreadIds.size} />}
          onClick={actions.openInbox}
        />

        {/* 2. WORK — Threads + Automations. */}
        <NavSection icon={Workflow} label="Work" sectionId="work" expanded={expanded.has("work")} onToggle={onToggle} attention={workAttention}>
          <SubGroupLabel>Threads</SubGroupLabel>
          {SAAS_THREADS.map((thread) => (
            <AppSessionRow
              key={thread.id}
              session={{ id: thread.id, agentTypeId: SAAS_AGENT_TYPE, title: thread.title, nativeSessionId: thread.id, hasAssistantReply: true }}
              state={activePanelId === `saas-thread:${thread.id}` ? "active" : "normal"}
              pinned={false}
              affordances="console"
              compact
              attentionBadge={attentionThreadIds.has(thread.id) ? { kind: "approval", label: "approve", tone: "warning", priority: 20 } : undefined}
              onSwitch={() => actions.openThread(thread.id)}
            />
          ))}
          <SubGroupLabel>Automations</SubGroupLabel>
          {SAAS_AUTOMATIONS.map((automation) => (
            <div key={automation.id} className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-foreground/25" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate" title={`${automation.cadence} · last run ${automation.lastRun}`}>{automation.title}</span>
            </div>
          ))}
          <p className="px-2 pb-1 pt-1.5 text-[10px] leading-4 text-muted-foreground/60">
            Fixture rows — the automation plugin needs its own backend.
          </p>
        </NavSection>

        {/* 3. AGENTS — the roster, using the shipped agent card. */}
        <NavSection icon={Bot} label="Agents" sectionId="agents" expanded={expanded.has("agents")} onToggle={onToggle} attention={agentAttention}>
          {SAAS_AGENTS.map((agent) => (
            <AppLeftPaneAgentCard
              key={agent.id}
              agentTypeId={agent.id}
              label={agent.name}
              description={agent.role}
              filtered={false}
              active={activePanelId === `saas-agent:${agent.id}`}
              showSessionCount={false}
              stats={{
                sessions: agent.threadIds.length,
                working: agent.status === "Working" ? 1 : 0,
                attention: agent.status === "Needs you" ? 1 : 0,
              }}
              onCreateSession={() => actions.openAgent(agent.id)}
              showCreate={false}
              onToggleFilter={() => actions.openAgent(agent.id)}
            />
          ))}
        </NavSection>

        {/* 4. LIBRARY — a VIEW library: files subtree + saved views of any kind. */}
        <NavSection icon={Library} label="Library" sectionId="library" expanded={expanded.has("library")} onToggle={onToggle} attention={0}>
          <SubGroupLabel>Files</SubGroupLabel>
          <NavEntry icon={Library} label="Browse workspace files" onClick={actions.openFilesTool} />
          <p className="px-2 pb-1 pt-1 text-[10px] leading-4 text-muted-foreground/60">
            Opens the real file tree in the rail — live workspace, not fixtures.
          </p>
          <SubGroupLabel>Saved views</SubGroupLabel>
          {SAAS_SAVED_VIEWS.map((view) => {
            const KindIcon = viewKindIcon[view.kind]
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => actions.openSavedView(view)}
                aria-current={activePanelId === view.panel ? "page" : undefined}
                className="group flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-[current=page]:bg-foreground/[0.07] aria-[current=page]:text-foreground"
              >
                <KindIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" strokeWidth={1.75} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{view.title}</span>
                  <span className="block truncate text-[10px] text-muted-foreground/60">{view.kind} · {view.note}</span>
                </span>
              </button>
            )
          })}
        </NavSection>

        {/* 5. SEARCH — the shipped command palette. */}
        <NavEntry icon={Search} label="Search" onClick={actions.openCommandPalette} />
      </nav>

      <div className="mt-auto border-t border-border/60 pt-3">
        <div className="flex items-center gap-2 px-2 py-2">
          <span className="grid size-7 place-items-center rounded-full bg-foreground/[0.09] text-[10px] font-semibold text-foreground">AK</span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-foreground">Alex Kim</span>
            <span className="block truncate text-[10px] text-muted-foreground">Investment team</span>
          </span>
        </div>
      </div>
    </aside>
  )
}

/** Collapsed nav, built from the shipped `RailAction`. */
function SaasLeftRail({ actions, attention }: { actions: SaasNavActions; attention: number }) {
  return (
    <aside
      data-boring-workspace-part="app-left-rail"
      className="flex h-full w-11 shrink-0 flex-col items-center gap-1 border-r border-border/70 bg-[color:var(--surface-workbench-left)] pb-3 pt-14"
    >
      <RailAction
        label="Inbox"
        icon={<InboxIcon className="size-4" strokeWidth={1.75} />}
        onClick={actions.openInbox}
        trailing={attention > 0 ? <AttentionCount count={attention} /> : undefined}
      />
      <RailAction label="Search" icon={<Search className="size-4" strokeWidth={1.75} />} onClick={actions.openCommandPalette} />
    </aside>
  )
}

// ---------------------------------------------------------------------------
// CHAT COLUMN — one more column beside the current pane. Never a navigation.
//
// Honest note on reuse: `PiChatComposerSurface` is a fully controlled component
// with ~45 required props whose entire state machine lives in `PiChatPanel`,
// and `ChatPanelHost` needs a live workspace/session. Neither has a fixture
// seam. The established precedent on this branch is `JobThreadView`, which
// replicates the chat surface's RESOLVED classes rather than importing it —
// "same pixels, no variant". This column follows that same precedent.
// ---------------------------------------------------------------------------

function ChatColumn({ contextLabel, onClose }: { contextLabel: string | null; onClose: () => void }) {
  const [draft, setDraft] = useState("")
  const suggestions = contextLabel
    ? ["Summarize what changed", "What needs my decision?", "Show the supporting evidence"]
    : ["Review portfolio changes", "Show everything that needs me", "Start Acme diligence"]
  return (
    <aside
      data-boring-workspace-part="saas-contextual-chat"
      className="flex w-[380px] min-w-[320px] shrink-0 flex-col border-l border-border/70 bg-[color:var(--surface-chat)]"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <span className="grid size-7 place-items-center rounded-full bg-foreground/[0.07] text-foreground"><Sparkles className="size-3.5" strokeWidth={1.75} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold text-foreground">{contextLabel ?? "Chat"}</h2>
          <p className="text-[11px] text-muted-foreground">Context follows the active pane</p>
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Close chat" onClick={onClose}><X className="size-3.5" /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {contextLabel ? <Chip className="max-w-full"><span className="truncate">{contextLabel}</span></Chip> : null}
        <div className="mt-8">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
            <span className="size-1.5 rounded-full bg-success" />Agent ready
          </div>
          <p className="mt-3 text-sm leading-6 text-foreground">
            I have the active pane and its linked artifacts in context. What would you like to understand or produce?
          </p>
        </div>
        <div className="mt-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">Suggested</p>
          <div className="mt-2 flex flex-col gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setDraft(suggestion)}
                className="rounded-lg border border-border/70 bg-background px-3 py-2.5 text-left text-xs leading-5 text-foreground transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t border-border/70 p-3">
        <div className="rounded-xl border border-border/80 bg-background focus-within:ring-2 focus-within:ring-ring/30">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            placeholder="Ask in this context…"
            className="min-h-20 resize-none border-0 bg-transparent text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <span className="text-[10px] text-muted-foreground/65">Fixture · composer visual only</span>
            <Button size="icon-xs" disabled aria-label="Send fixture message"><ChevronRight className="size-3" /></Button>
          </div>
        </div>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------

/**
 * Fixture attention, seeded into the REAL attention store.
 *
 * The Inbox badge and the collapsed-Work rollup then come out of the shipped
 * code path. If this seeding is wrong, the badges are wrong — which is the
 * point of not counting fixtures by hand in the nav.
 */
function SaasAttentionSeed() {
  const { addBlocker } = useWorkspaceAttention()
  useEffect(() => {
    for (const thread of needsYouThreads()) {
      addBlocker({
        id: `saas-spike:${thread.id}`,
        reason: "ask-user.approval",
        sessionId: thread.id,
        agentTypeId: SAAS_AGENT_TYPE,
        inbox: { kind: "approval", sourceLabel: thread.title },
        sessionBadge: { kind: "approval", label: "approve", tone: "warning", priority: 20 },
      })
    }
  }, [addBlocker])
  return null
}

function SaasSpikeShell() {
  const surfaceRef = useRef<SurfaceShellApi | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  const [activeTitle, setActiveTitle] = useState<string | null>(null)
  const { blockers } = useWorkspaceAttention()

  const attentionThreadIds = useMemo(() => {
    const ids = new Set<string>()
    for (const blocker of blockers) if (blocker.sessionId) ids.add(blocker.sessionId)
    return ids
  }, [blockers])

  const openThread = useCallback((threadId: string) => {
    const thread = SAAS_THREADS.find((item) => item.id === threadId)
    surfaceRef.current?.openPanel({
      id: `saas-thread:${threadId}`,
      component: "saas-thread",
      title: thread?.title ?? "Thread",
      params: { threadId },
    })
  }, [])

  const actions = useMemo<SaasNavActions>(() => ({
    openInbox: () => surfaceRef.current?.openPanel({ id: "saas-inbox", component: "saas-inbox", title: "Inbox", params: { onOpenThread: openThread } }),
    openThread,
    openAgent: (agentId: string) => {
      const agent = SAAS_AGENTS.find((item) => item.id === agentId)
      surfaceRef.current?.openPanel({
        id: `saas-agent:${agentId}`,
        component: "saas-agent",
        title: agent?.name ?? "Agent",
        params: { agentId, onOpenThread: openThread },
      })
    },
    openSavedView: (view: SaasSavedView) => {
      // The saved view carries the panel id the RAIL tool registers, so the
      // library entry and the rail tool land on ONE panel instance.
      surfaceRef.current?.openPanel({ id: view.panel, component: view.panel, title: view.title })
    },
    // The Files tool is a rail source; revealing the workspace root opens it.
    openFilesTool: () => surfaceRef.current?.expandToFile("."),
    openCommandPalette: () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))
    },
  }), [openThread])

  // Land on the Inbox: it is the single triage surface, so it is also the
  // thing that should already be open when the app opens.
  const handleReady = useCallback((api: SurfaceShellApi) => {
    surfaceRef.current = api
    api.openPanel({ id: "saas-inbox", component: "saas-inbox", title: "Inbox", params: { onOpenThread: openThread } })
  }, [openThread])

  const handleChange = useCallback((snapshot: { openTabs: { id: string; title: string }[]; activeTab: string | null }) => {
    setActivePanelId(snapshot.activeTab)
    setActiveTitle(snapshot.openTabs.find((tab) => tab.id === snapshot.activeTab)?.title ?? null)
  }, [])

  return (
    <PluginTabsWorkspaceShell
      collapsed={collapsed}
      onCollapse={() => setCollapsed(true)}
      onExpand={() => setCollapsed(false)}
      leftPane={<SaasLeftNav actions={actions} activePanelId={activePanelId} attentionThreadIds={attentionThreadIds} />}
      collapsedRail={<SaasLeftRail actions={actions} attention={attentionThreadIds.size} />}
    >
      <div className="flex h-full min-h-0 w-full">
        <div className="min-w-0 flex-1">
          <SurfaceShell
            storageKey="boring-ui-v2:layout:saas-spike"
            extraPanels={[...SAAS_PANEL_IDS, "saas-companies-visualization", "saas-funds-visualization"]}
            showCloseAction={false}
            hideLevelOneHeader
            onReady={handleReady}
            onChange={handleChange}
          />
        </div>
        {chatOpen ? <ChatColumn contextLabel={activeTitle} onClose={() => setChatOpen(false)} /> : null}
      </div>
      {chatOpen ? null : (
        <div className="absolute bottom-4 right-4 z-50">
          <Button size="sm" onClick={() => setChatOpen(true)}><Sparkles className="size-3.5" />Chat</Button>
        </div>
      )}
    </PluginTabsWorkspaceShell>
  )
}

interface WorkspaceMeta {
  workspaceId?: string
  projectName?: string
  defaultAgentTypeId?: string
}

export function SaasSpike() {
  // The file tree is REAL, so this route needs the same workspace identity the
  // main playground route resolves. Fixtures cover everything else.
  const [meta, setMeta] = useState<WorkspaceMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetch("/api/v1/workspace/meta")
      .then(async (response) => {
        if (!response.ok) throw new Error(`workspace metadata request failed (${response.status})`)
        return await response.json() as WorkspaceMeta
      })
      .then((value) => { if (!cancelled) setMeta(value) })
      .catch(() => { if (!cancelled) setError("The SaaS spike could not reach the workspace API. The file tree needs it; reload to try again.") })
    return () => { cancelled = true }
  }, [])

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-6">
        <p role="alert" className="max-w-md text-center text-sm text-destructive">{error}</p>
      </div>
    )
  }
  if (!meta) return <div className="h-screen w-screen bg-background" />

  return (
    <WorkspaceProvider
      agentTypeId={meta.defaultAgentTypeId ?? SAAS_AGENT_TYPE}
      apiBaseUrl=""
      workspaceId={meta.workspaceId ?? "Workspace"}
      appTitle="Meridian"
      workspaceLabel={meta.projectName ?? "Portfolio"}
      plugins={saasPlugins}
      panels={saasPanels()}
      persistenceEnabled
      storageKey="boring-ui-v2:layout:saas-spike"
      manageDocumentTitle={false}
      bridgeEndpoint={null}
    >
      <SaasAttentionSeed />
      <div className="h-screen w-screen">
        <SaasSpikeShell />
      </div>
    </WorkspaceProvider>
  )
}
