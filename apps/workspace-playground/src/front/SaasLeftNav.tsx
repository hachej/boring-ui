/**
 * LEFT NAV — the Meridian shell's domain navigation, expanded and collapsed.
 *
 * ORDER IS RULED (convergence ruling 1): the Meridian header, then SEARCH at
 * the top with its ⌘K hint, then Inbox / Work / Agents / Library. Search sits
 * above everything because it is the fastest way into any of the four, not a
 * fifth destination parked under them.
 *
 * WORK IS DE-CROWDED (ruling 2): threads are listed directly — no THREADS
 * sub-label above a list that is obviously threads — and everything finished or
 * scheduled rolls up behind two muted drill-in rows: `Automations · N`, whose
 * count and destination are both the LIVE automation backend, and
 * `Archived · N`, whose rows are fixtures.
 *
 * COLLAPSE (ruling 3): the toggle lives at the right of the nav header, and the
 * collapsed state is a ~52px icon rail whose section icons open FLYOUTS — the
 * same rows the expanded section shows, in a floating panel. Collapse STATE is
 * `PluginTabsWorkspaceShell`'s (`collapsed` / `collapsedRail`); this file only
 * supplies the two faces and turns the shell's own floating control off.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  Archive,
  Bot,
  ChevronRight,
  Columns3,
  Inbox as InboxIcon,
  LayoutGrid,
  Library,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Table2,
  Workflow,
} from "lucide-react"
import { createAutomationClient } from "@hachej/boring-automation/front"
// Internal source imports. The playground aliases `@` -> packages/workspace/src.
// These modules import no workspace context, so pulling them from source next
// to a dist-built `WorkspaceProvider` cannot split a context.
import { AppLeftPaneAgentCard } from "@/front/layout/plugin-tabs/AppLeftPaneAgentCards"
import { AppSessionRow } from "@/front/layout/plugin-tabs/AppLeftPaneSessionRow"
import { RailAction } from "@/front/layout/plugin-tabs/AppLeftPaneActions"
import { PaneCollapseButton } from "@/front/layout/paneCollapseButton"
import {
  SAAS_AGENTS,
  SAAS_ARCHIVED_THREADS,
  SAAS_THREADS,
  SAAS_VIEWS,
  type SaasView,
  type SaasViewKind,
} from "./SaasSpikeFixtures"

const SAAS_AGENT_TYPE = "builder"

/**
 * Section children line up at ~26px from the pane edge, every section.
 *
 * The pane's own `px-2` (8) plus this (10) plus a row's `px-2` (8) puts every
 * child row's icon at 26px — one indent step, whatever the section, and whether
 * the row is an `AppSessionRow`, an agent card or a drill-in.
 */
const SECTION_INDENT = "pl-[10px]"

const viewKindIcon: Record<SaasViewKind, LucideIcon> = {
  collection: Table2,
  document: Library,
  dashboard: LayoutGrid,
  kanban: Columns3,
  chart: LayoutGrid,
}

export interface SaasNavActions {
  openInbox: () => void
  openThread: (threadId: string) => void
  openAgent: (agentId: string) => void
  openView: (view: SaasView) => void
  openAutomations: () => void
  openArchived: () => void
  openCommandPalette: () => void
}

/**
 * The LIVE automation count behind Work's drill-in row.
 *
 * The old fixture rows named three plausible automations that had nothing to do
 * with what the backend held. One count from `listAutomations` is both smaller
 * and true; a failed request shows no count rather than a guessed one.
 */
export function useLiveAutomationCount(): number | null {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const client = createAutomationClient({ apiBaseUrl: "" })
    void client.listAutomations({ signal: controller.signal })
      .then((automations) => setCount(automations.length))
      .catch(() => setCount(null))
    return () => controller.abort()
  }, [])
  return count
}

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
export function AttentionCount({ count }: { count: number }) {
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

/**
 * A muted drill-in: one row that stands for a whole list living elsewhere.
 * Quieter than a thread row on purpose — it is a door, not an item.
 */
function DrillIn({
  icon: Icon,
  label,
  count,
  onClick,
}: {
  icon: LucideIcon
  label: string
  count: number | null
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-boring-workspace-part={`saas-drill-in-${label.toLowerCase()}`}
      className="flex h-7 w-full items-center gap-2.5 rounded-md px-2 text-left text-[12px] text-muted-foreground/75 transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {label}
        {count === null ? "" : ` · ${count}`}
      </span>
      <ChevronRight className="size-3 shrink-0 opacity-50" strokeWidth={2} aria-hidden="true" />
    </button>
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
      {expanded ? <div className={`mt-0.5 ${SECTION_INDENT}`}>{children}</div> : null}
    </div>
  )
}

function MeridianMark() {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-foreground text-[11px] font-bold text-background">M</span>
  )
}

// ---------------------------------------------------------------------------
// SECTION BODIES — written once, rendered by both the expanded pane and the
// collapsed rail's flyouts. Two copies of the Work list is exactly how a
// collapsed rail drifts from the pane it stands in for.
// ---------------------------------------------------------------------------

function WorkRows({
  actions,
  activeThreadId,
  attentionThreadIds,
  automationCount,
}: {
  actions: SaasNavActions
  activeThreadId: string | null
  attentionThreadIds: ReadonlySet<string>
  automationCount: number | null
}) {
  return (
    <>
      {SAAS_THREADS.map((thread) => (
        <AppSessionRow
          key={thread.id}
          session={{ id: thread.id, agentTypeId: SAAS_AGENT_TYPE, title: thread.title, nativeSessionId: thread.id, hasAssistantReply: true }}
          state={activeThreadId === thread.id ? "active" : "normal"}
          pinned={false}
          affordances="console"
          compact
          attentionBadge={attentionThreadIds.has(thread.id) ? { kind: "approval", label: "approve", tone: "warning", priority: 20 } : undefined}
          onSwitch={() => actions.openThread(thread.id)}
        />
      ))}
      <div className="mt-1.5 border-t border-border/50 pt-1.5">
        <DrillIn icon={Workflow} label="Automations" count={automationCount} onClick={actions.openAutomations} />
        <DrillIn icon={Archive} label="Archived" count={SAAS_ARCHIVED_THREADS.length} onClick={actions.openArchived} />
      </div>
    </>
  )
}

function AgentRows({ actions, activeAgentId }: { actions: SaasNavActions; activeAgentId: string | null }) {
  return (
    <>
      {SAAS_AGENTS.map((agent) => (
        <AppLeftPaneAgentCard
          key={agent.id}
          agentTypeId={agent.id}
          label={agent.name}
          description={agent.role}
          filtered={false}
          active={activeAgentId === agent.id}
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
    </>
  )
}

function LibraryRows({ actions, activeViewId }: { actions: SaasNavActions; activeViewId: string | null }) {
  return (
    <>
      {SAAS_VIEWS.map((view) => {
        const KindIcon = viewKindIcon[view.kind]
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => actions.openView(view)}
            aria-current={activeViewId === view.id ? "page" : undefined}
            className="group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-[current=page]:bg-foreground/[0.07] aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            title={`${view.kind} · ${view.note}`}
          >
            <KindIcon className="size-3.5 shrink-0 text-muted-foreground/60" strokeWidth={1.75} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{view.title}</span>
          </button>
        )
      })}
    </>
  )
}

function UserFoot() {
  return (
    <div className="flex items-center gap-2 px-2 py-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-foreground/[0.09] text-[10px] font-semibold text-foreground">AK</span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-foreground">Alex Kim</span>
        <span className="block truncate text-[10px] text-muted-foreground">Investment team</span>
      </span>
    </div>
  )
}

export interface SaasNavState {
  actions: SaasNavActions
  activePageId: string | null
  activeThreadId: string | null
  activeAgentId: string | null
  activeViewId: string | null
  attentionThreadIds: ReadonlySet<string>
  automationCount: number | null
  onCollapse: () => void
  onExpand: () => void
}

export function SaasLeftNav({
  actions,
  activePageId,
  activeThreadId,
  activeAgentId,
  activeViewId,
  attentionThreadIds,
  automationCount,
  onCollapse,
}: SaasNavState) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(["work"]))
  const onToggle = useCallback((sectionId: string) => setExpanded((current) => toggleSet(current, sectionId)), [])
  const workAttention = SAAS_THREADS.filter((thread) => attentionThreadIds.has(thread.id)).length
  const agentAttention = SAAS_AGENTS.filter((agent) => agent.status === "Needs you").length

  return (
    <aside
      data-boring-workspace-part="app-left-pane"
      className="flex h-full min-h-0 w-56 shrink-0 flex-col border-r border-border/70 bg-[color:var(--surface-workbench-left)] px-2 py-3"
    >
      <div className="flex h-10 items-center gap-2 pl-2">
        <MeridianMark />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-[-0.015em] text-foreground">Meridian</span>
        {/* Ruling 3: the panel toggle belongs to the nav header, at its right. */}
        <PaneCollapseButton label="Hide app navigation" side="right" onClick={onCollapse} dataPart="saas-nav-collapse">
          <PanelLeftClose className="size-4" strokeWidth={1.75} />
        </PaneCollapseButton>
      </div>

      <nav aria-label="Main navigation" className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {/* 1. SEARCH — first, by convergence ruling 1. */}
        <NavEntry
          icon={Search}
          label="Search"
          onClick={actions.openCommandPalette}
          trailing={<kbd className="ml-auto shrink-0 rounded border border-border/70 bg-background px-1 text-[10px] font-medium tabular-nums text-muted-foreground/80">⌘K</kbd>}
        />

        {/* 2. INBOX — the single triage surface. */}
        <NavEntry
          icon={InboxIcon}
          label="Inbox"
          active={activePageId === "saas-inbox"}
          trailing={<AttentionCount count={attentionThreadIds.size} />}
          onClick={actions.openInbox}
        />

        {/* 3. WORK — threads, then the two muted drill-ins. */}
        <NavSection icon={Workflow} label="Work" sectionId="work" expanded={expanded.has("work")} onToggle={onToggle} attention={workAttention}>
          <WorkRows
            actions={actions}
            activeThreadId={activeThreadId}
            attentionThreadIds={attentionThreadIds}
            automationCount={automationCount}
          />
        </NavSection>

        {/* 4. AGENTS — the roster, using the shipped agent card. */}
        <NavSection icon={Bot} label="Agents" sectionId="agents" expanded={expanded.has("agents")} onToggle={onToggle} attention={agentAttention}>
          <AgentRows actions={actions} activeAgentId={activeAgentId} />
        </NavSection>

        {/* 5. LIBRARY — one entry per VIEW. */}
        <NavSection icon={Library} label="Library" sectionId="library" expanded={expanded.has("library")} onToggle={onToggle} attention={0}>
          <LibraryRows actions={actions} activeViewId={activeViewId} />
        </NavSection>
      </nav>

      <div className="mt-auto border-t border-border/60 pt-3">
        <UserFoot />
      </div>
    </aside>
  )
}

type FlyoutId = "work" | "agents" | "library"

const FLYOUT_TITLE: Record<FlyoutId, string> = {
  work: "Work",
  agents: "Agents",
  library: "Library",
}

/**
 * Collapsed nav: a ~52px icon rail built from the shipped `RailAction`.
 *
 * Section icons do not navigate — a domain has no single destination — so they
 * open a FLYOUT holding that section's own rows. Search and Inbox act directly,
 * because each of those IS one destination.
 */
export function SaasLeftRail({
  actions,
  activePageId,
  activeThreadId,
  activeAgentId,
  activeViewId,
  attentionThreadIds,
  automationCount,
  onExpand,
}: SaasNavState) {
  const [flyout, setFlyout] = useState<FlyoutId | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const close = useCallback(() => setFlyout(null), [])

  useEffect(() => {
    if (!flyout) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && rootRef.current?.contains(target)) return
      close()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close() }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [close, flyout])

  // A flyout row that navigates has done its job; leaving the panel open would
  // cover the thing it just opened.
  const navActions = useMemo<SaasNavActions>(() => ({
    openInbox: () => { close(); actions.openInbox() },
    openThread: (id) => { close(); actions.openThread(id) },
    openAgent: (id) => { close(); actions.openAgent(id) },
    openView: (view) => { close(); actions.openView(view) },
    openAutomations: () => { close(); actions.openAutomations() },
    openArchived: () => { close(); actions.openArchived() },
    openCommandPalette: () => { close(); actions.openCommandPalette() },
  }), [actions, close])

  const toggle = useCallback((id: FlyoutId) => setFlyout((current) => current === id ? null : id), [])
  const attention = attentionThreadIds.size

  return (
    <aside
      ref={rootRef}
      data-boring-workspace-part="app-left-rail"
      className="relative z-50 flex h-full w-[52px] shrink-0 flex-col items-center gap-1 border-r border-border/70 bg-[color:var(--surface-workbench-left)] px-1.5 pb-3 pt-3"
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center"><MeridianMark /></div>
      <PaneCollapseButton label="Open app navigation" side="right" onClick={onExpand} dataPart="saas-rail-expand">
        <PanelLeftOpen className="size-4" strokeWidth={1.75} />
      </PaneCollapseButton>
      <span aria-hidden="true" className="my-1 h-px w-6 shrink-0 bg-border/70" />

      <RailAction label="Search" icon={<Search className="size-4" strokeWidth={1.75} />} onClick={navActions.openCommandPalette} />
      <RailAction
        label={attention > 0 ? `Inbox — ${attention} waiting` : "Inbox"}
        icon={(
          <span className="relative grid place-items-center">
            <InboxIcon className="size-4" strokeWidth={1.75} />
            {/* Ruling 3: the collapsed rail shows attention as a DOT — a count
                badge does not survive a 52px rail legibly. */}
            {attention > 0 ? (
              <span
                data-boring-workspace-part="saas-rail-attention-dot"
                className="absolute -right-1 -top-1 size-2 rounded-full bg-amber-500 ring-2 ring-[color:var(--surface-workbench-left)]"
              />
            ) : null}
          </span>
        )}
        active={activePageId === "saas-inbox"}
        onClick={navActions.openInbox}
      />
      <RailAction label="Work" icon={<Workflow className="size-4" strokeWidth={1.75} />} active={flyout === "work"} onClick={() => toggle("work")} />
      <RailAction label="Agents" icon={<Bot className="size-4" strokeWidth={1.75} />} active={flyout === "agents"} onClick={() => toggle("agents")} />
      <RailAction label="Library" icon={<Library className="size-4" strokeWidth={1.75} />} active={flyout === "library"} onClick={() => toggle("library")} />

      <div className="mt-auto grid size-9 shrink-0 place-items-center">
        <span className="grid size-7 place-items-center rounded-full bg-foreground/[0.09] text-[10px] font-semibold text-foreground" title="Alex Kim · Investment team">AK</span>
      </div>

      {flyout ? (
        <div
          role="dialog"
          aria-label={FLYOUT_TITLE[flyout]}
          data-boring-workspace-part="saas-nav-flyout"
          data-flyout-id={flyout}
          className="absolute left-[calc(100%+6px)] top-3 z-50 flex max-h-[calc(100%-24px)] w-60 flex-col overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-2xl"
        >
          <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/75">{FLYOUT_TITLE[flyout]}</p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {flyout === "work" ? (
              <WorkRows
                actions={navActions}
                activeThreadId={activeThreadId}
                attentionThreadIds={attentionThreadIds}
                automationCount={automationCount}
              />
            ) : null}
            {flyout === "agents" ? <AgentRows actions={navActions} activeAgentId={activeAgentId} /> : null}
            {flyout === "library" ? <LibraryRows actions={navActions} activeViewId={activeViewId} /> : null}
          </div>
        </div>
      ) : null}
    </aside>
  )
}
