/**
 * The SaaS spike shell, RE-COMPOSED from shipped components.
 *
 * LAYOUT (owner refinements #4 and #6), left to right:
 *
 *     NAV (domains)  |  VIEW EXPLORER  |  CONTENT  [ | contextual chat ]
 *
 * There is no global activity rail. The rail was removed by ruling once the
 * Library became the view switcher: two switchers for one job is redundant
 * chrome. It survives in exactly one place — the thread canvas (#6b) — where
 * it is the visual signature of an EMBEDDED workspace.
 *
 * What each existing block gave us:
 *
 *   - `PluginTabsWorkspaceShell` — the outer frame: left pane, collapsed rail,
 *     resize handle, mobile Sheet, floating collapse button. A dumb frame
 *     taking `leftPane`/`collapsedRail`/`children`.
 *   - `ArtifactSurfacePane` — the Dockview surface, used TWICE: once for the
 *     content column, once for the thread canvas. Same engine, and the reason
 *     the canvas needed no new machinery. (`SurfaceShell` was the earlier
 *     choice, but it hard-wires its sources pane and rail to the RIGHT of the
 *     centre; with the rail gone and the explorer required on the LEFT, the
 *     bare surface is the piece that actually fits.)
 *   - `FileTreeView` — the REAL file tree, against the live agent API. The one
 *     thing on this screen that is not fixture data; its edits really save.
 *   - `DataExplorer` (`@hachej/boring-data-explorer`) — Companies and Funds in
 *     the explorer column, fed by fixture adapters. No backend.
 *   - `CodeEditorPane` / `MarkdownEditorPane` / `csv-viewer`, via the registry —
 *     the canvas opens real files in the workspace's own editors, which autosave
 *     to `POST /api/v1/files`.
 *   - `AppLeftPaneAgentCard`, `AppSessionRow`, `RailAction` — real left-pane
 *     row/card/rail primitives.
 *   - `JobThreadView` + `SaasSpikeFixtures` — this branch's own thread mock,
 *     extended with inline artifact cards.
 *   - `useWorkspaceAttention` — the real Inbox store, seeded with fixture
 *     blockers so badges are computed by shipped code.
 *
 * NAV order is fixed: Inbox (single triage surface) / Work / Agents / Library /
 * Search. Selecting a Library view mounts its explorer and opens its home —
 * one mechanism, driven by the `SAAS_VIEWS` table.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import {
  Bot,
  Building2,
  ChevronRight,
  Columns3,
  FileText,
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
  ArtifactSurfacePane,
  FileTreeView,
  WorkspaceProvider,
  useWorkspaceAttention,
  type PaneProps,
  type PanelConfig,
} from "@hachej/boring-workspace"
import { DataExplorer } from "@hachej/boring-data-explorer/front"
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
  SAAS_ARTIFACTS,
  SAAS_COMPANIES,
  SAAS_COMPANY_ADAPTER,
  SAAS_COMPANY_FACETS,
  SAAS_FUNDS,
  SAAS_FUND_ADAPTER,
  SAAS_FUND_FACETS,
  SAAS_THREADS,
  SAAS_VIEWS,
  saasCanvasItem,
  saasThreadCanvas,
  saasThreadCanvasGroup,
  saasThreadCanvasGroups,
  type SaasArtifact,
  type SaasCanvasGroup,
  type SaasCanvasItem,
  type SaasThread,
  type SaasView,
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

/** Dockview's container api, borrowed off PaneProps so the spike needs no direct dockview dep. */
type SurfaceApi = PaneProps["containerApi"]

/**
 * The live shell handle.
 *
 * Module scope on purpose: panels are module-level components (a breadcrumb in
 * a record page has to be able to go back to its collection), and the explorer
 * column is React state. One mutable handle, set on mount, is the smallest
 * thing that lets a panel, the nav and the explorer agree on one shell.
 */
const shellRef: {
  content: SurfaceApi | null
  setView: ((view: SaasView) => void) | null
} = { content: null, setView: null }

/** Open (or re-activate) a panel in the CONTENT column. Idempotent on id. */
function openContentPanel(config: { id: string; component: string; title: string; params?: Record<string, unknown> }): void {
  const api = shellRef.content
  if (!api) return
  const existing = api.getPanel(config.id)
  if (existing) {
    existing.api.setActive()
    return
  }
  api.addPanel({ id: config.id, component: config.component, title: config.title, params: config.params })
}

/**
 * Extension -> registered panel id.
 *
 * Mirrors `filesystemSurfaceResolver`. The real resolver runs inside
 * `SurfaceShell.openFile`, and a bare `ArtifactSurfacePane` has no open-file
 * logic of its own, so the handful of extensions the fixtures use are mapped
 * here rather than reimplementing the resolver.
 */
function panelForPath(path: string): string {
  if (/\.mdx?$/i.test(path)) return "markdown-editor"
  if (/\.(csv|tsv)$/i.test(path)) return "csv-viewer"
  return "code-editor"
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

/** Open a REAL workspace file in the content column, in its real editor. */
function openContentFile(path: string): void {
  openContentPanel({
    id: `file:${path}`,
    component: panelForPath(path),
    title: baseName(path),
    params: { path, filesystem: "user", mode: "edit" },
  })
}

/**
 * Select a view. THE mechanism, used by the Library nav and by in-page
 * breadcrumbs:
 *
 *   (a) mount the view's source in the EXPLORER column, and
 *   (b) open the view's home in the CONTENT column.
 *
 * Content-only views (dashboard, kanban) still set the explorer state — the
 * explorer simply renders nothing to drill for them, rather than blanking to
 * an empty gutter.
 */
function openSaasView(view: SaasView | undefined): void {
  if (!view) return
  shellRef.setView?.(view)
  openContentPanel({ id: view.homePanel, component: view.homePanel, title: view.title })
}

function openSaasCompany(companyId: string): void {
  const company = SAAS_COMPANIES.find((item) => item.id === companyId)
  openContentPanel({
    id: `saas-company:${companyId}`,
    component: "saas-company",
    title: company?.name ?? "Company",
    params: { companyId },
  })
}

function openSaasFund(fundId: string): void {
  const fund = SAAS_FUNDS.find((item) => item.id === fundId)
  openContentPanel({
    id: `saas-fund:${fundId}`,
    component: "saas-fund",
    title: fund?.name ?? "Fund",
    params: { fundId },
  })
}

function openSaasThread(threadId: string): void {
  const thread = SAAS_THREADS.find((item) => item.id === threadId)
  openContentPanel({
    id: `saas-thread:${threadId}`,
    component: "saas-thread",
    title: thread?.title ?? "Thread",
    params: { threadId },
  })
}

/** Content-column breadcrumb. The first crumb returns to the view's home. */
function Breadcrumbs({ trail }: { trail: readonly { label: string; onClick?: () => void }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {trail.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
          {index > 0 ? <span className="text-muted-foreground/40" aria-hidden="true">/</span> : null}
          {crumb.onClick ? (
            <button
              type="button"
              onClick={crumb.onClick}
              className="truncate rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {crumb.label}
            </button>
          ) : (
            <span className={index === trail.length - 1 ? "truncate font-medium text-foreground" : "truncate"}>{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
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

// ---------------------------------------------------------------------------
// THREAD = chat | CANVAS (owner refinement #5).
//
// The canvas is an EMBEDDED WORKBENCH: a second `ArtifactSurfacePane` — the
// very component SurfaceShell uses for its own centre — mounted inside a panel
// of the outer one. Same engine, scoped chrome: tabs and panes, no activity
// rail, no source pane, because ArtifactSurfacePane never had those; the rail
// lives in SurfaceShell alone.
//
// Two rules make the nesting safe, both from reading the dock code:
//   1. DISTINCT `storageKey`. ArtifactSurfacePane defaults to
//      "boring-ui-v2:surface", which the outer instance also uses — sharing it
//      would have the two layouts overwrite each other.
//   2. DISJOINT panel ids. `DockviewShell` subscribes EVERY instance to the
//      global `workspaceEvents` bus and applies `panelClose` against its own
//      api, so an id present in both surfaces would close in both. Canvas ids
//      are therefore prefixed `canvas:`, never the outer's `file:<key>`.
// ---------------------------------------------------------------------------

const CANVAS_PANELS = ["markdown-editor", "code-editor", "csv-viewer", "saas-company", "saas-fund"]

function canvasPanelId(item: SaasCanvasItem): string {
  return `canvas:${item.id}`
}

const canvasGroupIcon: Record<SaasCanvasGroup, LucideIcon> = {
  outputs: Sparkles,
  files: FileText,
  records: Building2,
}

const canvasGroupLabel: Record<SaasCanvasGroup, string> = {
  outputs: "Outputs",
  files: "Working files",
  records: "Referenced records",
}

/**
 * The canvas surface: an embedded `ArtifactSurfacePane` plus its own slim rail.
 *
 * The rail is the visual signature of an embedded workspace (#6b) — it exists
 * HERE and nowhere else in the shell, and its icons are the thread's scope
 * groups, not global tools. Switching group swaps which pane set the canvas
 * shows, so the rail is a real switcher rather than decoration.
 *
 * Two rules make nesting a second Dockview inside the content one safe, both
 * read out of the dock code:
 *   1. DISTINCT `storageKey` — the default is shared, and two surfaces on it
 *      would overwrite each other's layout.
 *   2. DISJOINT panel ids — `DockviewShell` subscribes EVERY instance to the
 *      global `workspaceEvents` bus and applies `panelClose` to its own api, so
 *      an id in both surfaces would close in both. Canvas ids are prefixed
 *      `canvas:`; the content column uses `file:` / `saas-*`.
 */
function ThreadCanvas({
  threadId,
  focusItemId,
  onActiveItemChange,
  onClose,
}: {
  threadId: string
  focusItemId: string | null
  onActiveItemChange: (itemId: string | null) => void
  onClose: () => void
}) {
  const groups = useMemo(() => saasThreadCanvasGroups(threadId), [threadId])
  const focusItem = focusItemId ? saasCanvasItem(focusItemId) : undefined
  const [group, setGroup] = useState<SaasCanvasGroup>(() => focusItem?.group ?? groups[0] ?? "outputs")
  const apiRef = useRef<SurfaceApi | null>(null)

  const mountGroup = useCallback((api: SurfaceApi, nextGroup: SaasCanvasGroup, focusId?: string | null) => {
    const items = saasThreadCanvasGroup(threadId, nextGroup)
    const wanted = new Set(items.map(canvasPanelId))
    for (const panel of [...api.panels]) {
      if (!wanted.has(panel.id)) api.removePanel(panel)
    }
    for (const item of items) {
      const id = canvasPanelId(item)
      if (api.getPanel(id)) continue
      if (item.kind === "file" && item.path) {
        api.addPanel({
          id,
          component: panelForPath(item.path),
          title: item.title,
          // A real path in edit mode: these panes autosave to
          // POST /api/v1/files, so edits here land on disk for real.
          params: { path: item.path, filesystem: "user", mode: "edit" },
        })
      } else if (item.kind === "company" && item.recordId) {
        api.addPanel({ id, component: "saas-company", title: item.title, params: { companyId: item.recordId, embedded: true } })
      } else if (item.kind === "fund" && item.recordId) {
        api.addPanel({ id, component: "saas-fund", title: item.title, params: { fundId: item.recordId, embedded: true } })
      }
    }
    const target = focusId ? items.find((item) => item.id === focusId) : items[0]
    if (target) api.getPanel(canvasPanelId(target))?.api.setActive()
  }, [threadId])

  // The last focus request already applied. Without it, every group change
  // re-ran the focus effect, which saw the focused artifact in a DIFFERENT
  // group and snapped the rail straight back — the rail looked inert.
  const appliedFocusRef = useRef<string | null>(null)
  const focusRef = useRef<string | null>(focusItemId)
  focusRef.current = focusItemId

  const handleReady = useCallback((api: SurfaceApi) => {
    apiRef.current = api
    appliedFocusRef.current = focusRef.current
    mountGroup(api, group, focusRef.current)
    // Switching a canvas TAB moves the mark in the transcript, so the two
    // always point at each other (#7.4).
    api.onDidActivePanelChange?.(() => {
      const active = api.activePanel?.id
      onActiveItemChange(active ? active.replace(/^canvas:/, "") : null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountGroup, onActiveItemChange])

  // Group changed — by the rail, or because a card named another group.
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const focus = focusRef.current
    const item = focus ? saasCanvasItem(focus) : undefined
    mountGroup(api, group, item?.group === group ? focus : null)
  }, [group, mountGroup])

  // A NEW focus request from the transcript.
  useEffect(() => {
    if (!focusItemId || appliedFocusRef.current === focusItemId) return
    appliedFocusRef.current = focusItemId
    const item = saasCanvasItem(focusItemId)
    if (!item) return
    if (item.group !== group) {
      // The group effect above mounts and focuses it.
      setGroup(item.group)
      return
    }
    const api = apiRef.current
    if (api) mountGroup(api, group, focusItemId)
  }, [focusItemId, group, mountGroup])

  return (
    <div className="flex h-full min-h-0" data-boring-workspace-part="saas-thread-canvas">
      <div className="min-w-0 flex-1">
        <ArtifactSurfacePane
          storageKey={`boring-ui-v2:layout:saas-spike:canvas:${threadId}`}
          allowedPanels={CANVAS_PANELS}
          onReady={handleReady}
          className="h-full"
        />
      </div>
      {/* The embedded workspace's own rail. Scoped to this thread. */}
      <nav
        aria-label="Canvas scope"
        data-boring-workspace-part="saas-canvas-rail"
        className="flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border/70 bg-[color:var(--surface-workbench-left)] py-2"
      >
        {/* Close lives on the rail, not floating over the tab strip, where it
            collided with Dockview's own header controls. */}
        <RailAction label="Close canvas" icon={<X className="size-4" strokeWidth={1.75} />} onClick={onClose} />
        <span className="my-1 h-px w-5 bg-border" aria-hidden="true" />
        {groups.map((item) => {
          const Icon = canvasGroupIcon[item]
          return (
            <RailAction
              key={item}
              label={canvasGroupLabel[item]}
              icon={<Icon className="size-4" strokeWidth={1.75} />}
              active={group === item}
              onClick={() => setGroup(item)}
            />
          )
        })}
      </nav>
    </div>
  )
}

/**
 * A thread. Opens as PURE CHAT; the conversation summons the canvas (#7).
 *
 * The canvas is closed until an inline artifact card is clicked, which keeps
 * the continuity rule intact — a thread still reads as today's chat until the
 * moment you ask it for more.
 */
function ThreadPanel({ params }: PaneProps<{ threadId?: string }>) {
  const threadId = params?.threadId
  const thread = SAAS_THREADS.find((item) => item.id === threadId)
  const items = threadId ? saasThreadCanvas(threadId) : []
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  const [chatWidth, setChatWidth] = useState(620)
  const splitRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const artifactBinding = useMemo(() => ({
    byId: new Map(items.map((item) => [item.id, { id: item.id, title: item.title, meta: item.meta, kind: item.kind }])),
    activeId: openItemId,
    onOpen: (artifactId: string) => setOpenItemId(artifactId),
  }), [items, openItemId])

  const onDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { startX: event.clientX, startWidth: chatWidth }
  }, [chatWidth])
  const onDragMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const total = splitRef.current?.getBoundingClientRect().width ?? 0
    // Chat min-width is protected; the canvas keeps a floor of its own so the
    // handle can never collapse either side into an unusable sliver.
    setChatWidth(Math.max(420, Math.min(total - 360, drag.startWidth + (event.clientX - drag.startX))))
  }, [])
  const onDragEnd = useCallback(() => { dragRef.current = null }, [])

  if (!thread || !threadId) {
    return <div className="grid h-full place-items-center bg-background p-8 text-sm text-muted-foreground">Thread not found.</div>
  }

  const canvasOpen = openItemId !== null

  return (
    <div ref={splitRef} className="h-full min-h-0" data-boring-workspace-part="saas-thread-split" data-canvas-open={canvasOpen ? "true" : "false"}>
      <JobThreadView
        fixture={thread.job}
        artifacts={artifactBinding}
        canvas={canvasOpen ? (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat and canvas"
              tabIndex={0}
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") setChatWidth((width) => Math.max(420, width - 24))
                if (event.key === "ArrowRight") setChatWidth((width) => width + 24)
              }}
              className="relative w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40 focus-visible:bg-primary/50 focus-visible:outline-none"
            >
              <span aria-hidden="true" className="absolute inset-y-0 -left-1.5 -right-1.5" />
            </div>
            <div className="flex min-h-0 min-w-[360px] flex-1 flex-col">
              <ThreadCanvas
                threadId={threadId}
                focusItemId={openItemId}
                onActiveItemChange={(itemId) => { if (itemId) setOpenItemId(itemId) }}
                onClose={() => setOpenItemId(null)}
              />
            </div>
          </>
        ) : undefined}
        chatWidth={canvasOpen ? chatWidth : undefined}
      />
    </div>
  )
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

/**
 * A view's HOME: what the content column shows when a collection view is
 * selected but nothing is picked yet. Deliberately a summary, not a second
 * copy of the list — the list lives in the explorer column, and repeating it
 * here is what would make the two columns read as duplicates.
 */
function CollectionHome({ collection }: { collection: "companies" | "funds" }) {
  const isCompanies = collection === "companies"
  const title = isCompanies ? "Companies" : "Funds"
  const total = isCompanies ? SAAS_COMPANIES.length : SAAS_FUNDS.length
  // Group by something that actually GROUPS. Sector is near-unique across the
  // fixture companies, so a sector breakdown was twelve rows of "1" — a
  // summary that tells you nothing. Fund and status both have real spread.
  const groups = isCompanies
    ? countBy(SAAS_COMPANIES.map((company) => SAAS_FUNDS.find((fund) => fund.id === company.fundId)?.name ?? "Unassigned"))
    : countBy(SAAS_FUNDS.map((fund) => fund.status))
  const groupLabel = isCompanies ? "By fund" : "By status"
  return (
    <div className="h-full overflow-y-auto bg-background p-8">
      <Breadcrumbs trail={[{ label: title }]} />
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        {total} records. Search and filter them in the explorer on the left, then pick one to open its record here.
      </p>
      <section className="mt-8 max-w-xl">
        <h2 className="border-b border-border/70 pb-3 text-sm font-semibold text-foreground">{groupLabel}</h2>
        <dl className="divide-y divide-border/60">
          {groups.map(([name, count]) => (
            <div key={name} className="flex items-center justify-between gap-4 py-2.5">
              <dt className="min-w-0 truncate text-sm text-foreground">{name}</dt>
              <dd className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

/**
 * Two panel ids, one component. They must be separate registrations rather
 * than one parameterised panel: a rail click opens a source's `defaultPanelId`
 * with no params, so a shared panel would not know which collection it is.
 */
function CompaniesHomePanel() {
  return <CollectionHome collection="companies" />
}

function FundsHomePanel() {
  return <CollectionHome collection="funds" />
}

function countBy(values: readonly string[]): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function FileHomePanel() {
  return (
    <div className="grid h-full place-items-center bg-background p-8 text-center">
      <div>
        <span className="mx-auto grid size-10 place-items-center rounded-lg border border-border/70 bg-muted/30 text-muted-foreground"><FileText className="size-4" /></span>
        <h1 className="mt-4 text-sm font-semibold text-foreground">Select a file</h1>
        <p className="mt-1 max-w-xs text-sm leading-6 text-muted-foreground">
          The tree on the left is the real workspace. Pick a file to open it here.
        </p>
      </div>
    </div>
  )
}

/**
 * Company record page — the detail half of master-detail, and the same
 * component the thread canvas cross-mounts.
 */
function CompanyRecordPanel({ params }: PaneProps<{ companyId?: string; embedded?: boolean }>) {
  const company = SAAS_COMPANIES.find((item) => item.id === params?.companyId)
  if (!company) return <div className="grid h-full place-items-center bg-background p-8 text-sm text-muted-foreground">Company not found.</div>
  const fund = SAAS_FUNDS.find((item) => item.id === company.fundId)
  const documents = company.documentIds
    .map((id) => SAAS_ARTIFACTS.find((item) => item.id === id))
    .filter((item): item is SaasArtifact => Boolean(item))
  const threads = company.threadIds
    .map((id) => SAAS_THREADS.find((item) => item.id === id))
    .filter((item): item is SaasThread => Boolean(item))
  const embedded = params?.embedded === true
  return (
    <div className={`h-full overflow-y-auto bg-background ${embedded ? "p-5" : "p-8"}`}>
      {embedded ? null : (
        <Breadcrumbs
          trail={[
            { label: "Companies", onClick: () => openSaasView(SAAS_VIEWS.find((view) => view.id === "view-companies")) },
            { label: company.name },
          ]}
        />
      )}
      <h1 className={`mt-2 font-semibold tracking-[-0.025em] text-foreground ${embedded ? "text-lg" : "text-2xl"}`}>{company.name}</h1>
      <p className="mt-1 text-xs text-muted-foreground">{company.sector} · {company.stage} · {company.headquarters}</p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{company.summary}</p>
      <section className="mt-6">
        <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-border/70">
          {company.metrics.map((metric, index) => (
            <div key={metric.label} className={`px-4 py-4 ${index > 0 ? "border-l border-border/60" : ""}`}>
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">{metric.label}</p>
              <p className="mt-2 text-xl font-semibold tracking-[-0.025em] text-foreground">{metric.value}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-8">
        <h2 className="border-b border-border/70 pb-3 text-sm font-semibold text-foreground">Documents</h2>
        <div className="divide-y divide-border/60">
          {documents.map((document) => (
            <div key={document.id} className="flex items-center gap-3 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/70 bg-muted/30 text-muted-foreground"><FileText className="size-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{document.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{document.kind} · {document.updatedAt}</span>
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-8">
        <h2 className="border-b border-border/70 pb-3 text-sm font-semibold text-foreground">Threads about this company</h2>
        <div className="divide-y divide-border/60">
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              onClick={() => openSaasThread(thread.id)}
              className="flex w-full items-center gap-3 py-3 text-left hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
      <dl className="mt-8 max-w-md divide-y divide-border/60 border-t border-border/70 text-sm">
        <div className="flex justify-between gap-4 py-2.5"><dt className="text-xs text-muted-foreground">Fund</dt><dd className="text-foreground">{fund?.name}</dd></div>
        <div className="flex justify-between gap-4 py-2.5"><dt className="text-xs text-muted-foreground">Ownership</dt><dd className="text-foreground">{company.ownership}</dd></div>
        <div className="flex justify-between gap-4 py-2.5"><dt className="text-xs text-muted-foreground">Last update</dt><dd className="text-foreground">{company.lastUpdate}</dd></div>
      </dl>
    </div>
  )
}

function FundRecordPanel({ params }: PaneProps<{ fundId?: string; embedded?: boolean }>) {
  const fund = SAAS_FUNDS.find((item) => item.id === params?.fundId)
  if (!fund) return <div className="grid h-full place-items-center bg-background p-8 text-sm text-muted-foreground">Fund not found.</div>
  const companies = SAAS_COMPANIES.filter((company) => company.fundId === fund.id)
  const embedded = params?.embedded === true
  return (
    <div className={`h-full overflow-y-auto bg-background ${embedded ? "p-5" : "p-8"}`}>
      {embedded ? null : (
        <Breadcrumbs
          trail={[
            { label: "Funds", onClick: () => openSaasView(SAAS_VIEWS.find((view) => view.id === "view-funds")) },
            { label: fund.name },
          ]}
        />
      )}
      <h1 className={`mt-2 font-semibold tracking-[-0.025em] text-foreground ${embedded ? "text-lg" : "text-2xl"}`}>{fund.name}</h1>
      <p className="mt-1 text-xs text-muted-foreground">{fund.strategy} · {fund.vintage} vintage · {fund.status}</p>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{fund.summary}</p>
      <dl className="mt-6 grid grid-cols-3 overflow-hidden rounded-lg border border-border/70">
        {[{ label: "Strategy", value: fund.strategy }, { label: "Fixture AUM", value: fund.aum }, { label: "Companies", value: String(companies.length) }].map((item, index) => (
          <div key={item.label} className={`px-4 py-4 ${index > 0 ? "border-l border-border/60" : ""}`}>
            <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">{item.label}</dt>
            <dd className="mt-2 text-sm font-semibold text-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>
      <section className="mt-8">
        <h2 className="border-b border-border/70 pb-3 text-sm font-semibold text-foreground">Portfolio companies</h2>
        <div className="divide-y divide-border/60">
          {companies.map((company) => (
            <button
              key={company.id}
              type="button"
              onClick={() => openSaasCompany(company.id)}
              className="flex w-full items-center gap-4 py-3 text-left hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{company.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{company.sector} · {company.stage}</span>
              </span>
              <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">{company.lastUpdate}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

const SAAS_PANEL_IDS = [
  "saas-overview",
  "saas-inbox",
  "saas-thread",
  "saas-agent",
  "saas-kanban-placeholder",
  "saas-companies-home",
  "saas-funds-home",
  "saas-file-home",
  "saas-company",
  "saas-fund",
] as const

function saasPanels(): PanelConfig[] {
  const panel = (id: string, title: string, component: PanelConfig["component"]): PanelConfig =>
    ({ id, title, placement: "shared-dockview", source: "app", component })
  return [
    panel("saas-overview", "Portfolio overview", OverviewPanel),
    panel("saas-inbox", "Inbox", InboxPanel),
    panel("saas-thread", "Thread", ThreadPanel),
    panel("saas-agent", "Agent", AgentPanel),
    panel("saas-kanban-placeholder", "Diligence pipeline", KanbanPlaceholderPanel),
    panel("saas-companies-home", "Companies", CompaniesHomePanel),
    panel("saas-funds-home", "Funds", FundsHomePanel),
    panel("saas-file-home", "Files", FileHomePanel),
    panel("saas-company", "Company", CompanyRecordPanel),
    panel("saas-fund", "Fund", FundRecordPanel),
  ]
}

// ---------------------------------------------------------------------------
// VIEW EXPLORER — column 2, directly right of the nav (#6).
//
// Whatever the selected Library view is, its explorer mounts here and STAYS
// mounted while records are drilled in the content column. That persistence is
// the master-detail feel; it is also why the explorer is a plain column rather
// than a Dockview pane.
//
// Note on `createDataCatalogPlugin`: the earlier cut used it to register
// Companies/Funds as workbench SOURCES so they appeared as rail icons. With the
// global rail removed by ruling, a source has nowhere to appear, and the plugin
// contributes nothing this shell can use. `DataExplorer` — the reusable block
// inside it — is mounted directly instead, over the same fixture adapters.
// ---------------------------------------------------------------------------

function ExplorerHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="shrink-0 border-b border-border/70 px-3 py-2.5">
      <p className="truncate text-[13px] font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function ViewExplorer({ view }: { view: SaasView }) {
  const fileBridge = useMemo(() => ({
    openFile: async (path: string) => {
      openContentFile(path)
      return { seq: 0, status: "ok" as const }
    },
    getActiveFile: () => null,
    select: () => () => {},
  }), [])

  if (view.kind === "document") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ExplorerHeader title="Files" subtitle="Live workspace — edits save" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FileTreeView bridge={fileBridge} filesystem="user" className="h-full" />
        </div>
      </div>
    )
  }

  if (view.kind === "collection") {
    const companies = view.id === "view-companies"
    return (
      <div className="flex h-full min-h-0 flex-col">
        <DataExplorer
          adapter={companies ? SAAS_COMPANY_ADAPTER : SAAS_FUND_ADAPTER}
          facets={companies ? SAAS_COMPANY_FACETS : SAAS_FUND_FACETS}
          onActivate={(row) => (companies ? openSaasCompany(row.id) : openSaasFund(row.id))}
          toolbarTitle={view.title}
          toolbarIcon={companies ? Building2 : Landmark}
          searchPlaceholder={`Search ${view.title.toLowerCase()}…`}
          emptyState={`No ${view.title.toLowerCase()} match these filters`}
          className="h-full"
        />
      </div>
    )
  }

  // Dashboards and kanbans have nothing to drill.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ExplorerHeader title={view.title} subtitle={view.kind} />
      <p className="px-3 py-4 text-[11px] leading-5 text-muted-foreground">
        This view has no explorer — it opens straight into the content column.
      </p>
    </div>
  )
}

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
  openView: (view: SaasView) => void
  openCommandPalette: () => void
}

function SaasLeftNav({
  actions,
  activePanelId,
  activeViewId,
  attentionThreadIds,
}: {
  actions: SaasNavActions
  activePanelId: string | null
  activeViewId: string | null
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

        {/* 4. LIBRARY — one entry per VIEW. A file is a view; so is a
            collection, a dashboard and a kanban. No sub-groups: the flat list
            IS the ruling ("1 entry = 1 view"). */}
        <NavSection icon={Library} label="Library" sectionId="library" expanded={expanded.has("library")} onToggle={onToggle} attention={0}>
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

const FILES_VIEW = SAAS_VIEWS.find((view) => view.id === "view-files")!

function SaasSpikeShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [activePanelId, setActivePanelId] = useState<string | null>(null)
  const [activeTitle, setActiveTitle] = useState<string | null>(null)
  const [view, setView] = useState<SaasView>(FILES_VIEW)
  const [explorerWidth, setExplorerWidth] = useState(320)
  const { blockers } = useWorkspaceAttention()
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const attentionThreadIds = useMemo(() => {
    const ids = new Set<string>()
    for (const blocker of blockers) if (blocker.sessionId) ids.add(blocker.sessionId)
    return ids
  }, [blockers])

  // The module-level handle is what lets a record page's breadcrumb, the nav
  // and the explorer all drive one shell.
  useEffect(() => {
    shellRef.setView = setView
    return () => { shellRef.setView = null }
  }, [])

  const actions = useMemo<SaasNavActions>(() => ({
    openInbox: () => openContentPanel({ id: "saas-inbox", component: "saas-inbox", title: "Inbox", params: { onOpenThread: openSaasThread } }),
    openThread: openSaasThread,
    openAgent: (agentId: string) => {
      const agent = SAAS_AGENTS.find((item) => item.id === agentId)
      openContentPanel({
        id: `saas-agent:${agentId}`,
        component: "saas-agent",
        title: agent?.name ?? "Agent",
        params: { agentId, onOpenThread: openSaasThread },
      })
    },
    openView: openSaasView,
    openCommandPalette: () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))
    },
  }), [])

  const handleReady = useCallback((api: SurfaceApi) => {
    shellRef.content = api
    // Land on the Inbox — the single triage surface — with Files in the
    // explorer so column 2 is never an empty gutter.
    openContentPanel({ id: "saas-inbox", component: "saas-inbox", title: "Inbox", params: { onOpenThread: openSaasThread } })
    api.onDidActivePanelChange?.(() => {
      const active = api.activePanel
      setActivePanelId(active?.id ?? null)
      setActiveTitle(active?.title ?? null)
    })
  }, [])

  const onDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { startX: event.clientX, startWidth: explorerWidth }
  }, [explorerWidth])
  const onDragMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    setExplorerWidth(Math.max(220, Math.min(460, drag.startWidth + (event.clientX - drag.startX))))
  }, [])
  const onDragEnd = useCallback(() => { dragRef.current = null }, [])

  return (
    <PluginTabsWorkspaceShell
      collapsed={collapsed}
      onCollapse={() => setCollapsed(true)}
      onExpand={() => setCollapsed(false)}
      leftPane={(
        <SaasLeftNav
          actions={actions}
          activePanelId={activePanelId}
          activeViewId={view.id}
          attentionThreadIds={attentionThreadIds}
        />
      )}
      collapsedRail={<SaasLeftRail actions={actions} attention={attentionThreadIds.size} />}
    >
      <div className="flex h-full min-h-0 w-full">
        {/* Column 2 — the VIEW EXPLORER, directly right of the nav. */}
        <aside
          data-boring-workspace-part="saas-view-explorer"
          className="flex min-h-0 shrink-0 flex-col border-r border-border/70 bg-[color:var(--surface-workbench-left)]"
          style={{ width: explorerWidth }}
        >
          <ViewExplorer view={view} />
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize view explorer"
          tabIndex={0}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setExplorerWidth((width) => Math.max(220, width - 16))
            if (event.key === "ArrowRight") setExplorerWidth((width) => Math.min(460, width + 16))
          }}
          className="relative w-px shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 focus-visible:bg-primary/50 focus-visible:outline-none"
        >
          <span aria-hidden="true" className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>

        {/* Column 3 — CONTENT. The same Dockview surface the canvas embeds. */}
        <div className="min-w-0 flex-1">
          <ArtifactSurfacePane
            storageKey="boring-ui-v2:layout:saas-spike:content"
            allowedPanels={[...SAAS_PANEL_IDS, ...CANVAS_PANELS]}
            onReady={handleReady}
            className="h-full"
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
