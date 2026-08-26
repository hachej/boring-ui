/**
 * The SaaS spike shell, RE-COMPOSED from shipped components.
 *
 * LAYOUT (the converged Meridian canvas), left to right:
 *
 *     NAV (domains)  |  VIEW EXPLORER  |  CONTENT
 *
 * There is no global chat column and no global activity rail. Chat is not a
 * column here — it is what a THREAD is, so "talk to the agent" navigates to
 * Work rather than opening a sidecar (convergence ruling 6). The rail survives
 * in exactly one place — the thread canvas — where it is the visual signature
 * of an EMBEDDED workspace.
 *
 * What each existing block gave us:
 *
 *   - `PluginTabsWorkspaceShell` — the outer frame: left pane, collapsed rail,
 *     resize handle, mobile Sheet. A dumb frame taking
 *     `leftPane`/`collapsedRail`/`children`; this shell drives its collapse
 *     state and supplies its own header toggle instead of the shell's floating
 *     one (`showCollapseControl={false}`).
 *   - `ArtifactSurfacePane` — the Dockview surface, used TWICE: once for the
 *     content column, once for the thread canvas.
 *   - `FileTreeView` / `FileTreePane` — the REAL file tree, against the live
 *     agent API. The one thing on this screen that is not fixture data.
 *   - `DataExplorer` (`@hachej/boring-data-explorer`) — Companies and Funds in
 *     the explorer column, fed by fixture adapters.
 *   - `CodeEditorPane` / `MarkdownEditorPane` / `csv-viewer`, via the registry.
 *   - `InboxOverlay` + `HumanArtifactList` — the real triage surface, over the
 *     real attention store, with real artifact cards.
 *   - `AutomationPanel` — the real automation page, over live rows.
 *   - `JobThreadView` + `SaasSpikeFixtures` — this branch's own thread mock.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { Archive, Building2, Columns3, FileText, Landmark, MessageSquare } from "lucide-react"
import { Button, StatusBadge } from "@hachej/boring-ui-kit"
import {
  ArtifactSurfacePane,
  FileTreeView,
  WorkspaceProvider,
  WorkspaceShellCapabilitiesProvider,
  useWorkspaceAttention,
  type HumanArtifact,
  type PaneProps,
  type PanelConfig,
  type WorkspaceShellArtifactTarget,
  type WorkspaceShellCapabilities,
  type WorkspaceShellCapabilityResult,
} from "@hachej/boring-workspace"
import { DataExplorer } from "@hachej/boring-data-explorer/front"
import { InboxOverlay, createAskUserPlugin } from "@hachej/boring-ask-user/front"
import { AutomationPanel, boringAutomationPlugin } from "@hachej/boring-automation/front"
// Internal source imports. The playground aliases `@` -> packages/workspace/src
// (see vite.config.ts). This module imports no workspace context, so pulling it
// from source next to a dist-built `WorkspaceProvider` cannot split a context.
import { PluginTabsWorkspaceShell } from "@/front/layout/plugin-tabs/PluginTabsWorkspaceShell"
import { JobThreadView } from "./JobThreadView"
import { SaasLeftNav, SaasLeftRail, useLiveAutomationCount, type SaasNavActions } from "./SaasLeftNav"
import { CANVAS_PANELS, SaasCanvasCard, SaasThreadCanvas } from "./SaasThreadCanvas"
import {
  activateDockPanel,
  openContentFile,
  openSaasAgent,
  openSaasArchived,
  openSaasAutomations,
  openSaasCompany,
  openSaasFund,
  openSaasInbox,
  openSaasThread,
  openSaasView,
  openSaasViewById,
  shellRef,
  type CenterPage,
  type CenterState,
  type SurfaceApi,
} from "./saasShell"
import {
  SAAS_AGENTS,
  SAAS_ARCHIVED_THREADS,
  SAAS_ARTIFACTS,
  SAAS_CANVAS_SURFACE_KIND,
  SAAS_COMPANIES,
  SAAS_COMPANY_ADAPTER,
  SAAS_COMPANY_FACETS,
  SAAS_FUNDS,
  SAAS_FUND_ADAPTER,
  SAAS_FUND_FACETS,
  SAAS_THREADS,
  SAAS_VIEWS,
  saasCanvasItem,
  saasInboxArtifacts,
  saasThreadCanvas,
  type SaasArtifact,
  type SaasThread,
  type SaasView,
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

/** The thread a record's "Ask agent" should land on (ruling 6). */
function threadForCompany(companyId: string): SaasThread | undefined {
  return SAAS_THREADS.find((thread) => thread.companyIds.includes(companyId))
}

function threadForFund(fundId: string): SaasThread | undefined {
  return SAAS_THREADS.find((thread) => thread.fundId === fundId)
}

/**
 * "Ask agent" — the ONLY chat affordance a record page gets.
 *
 * The global chat column is retired: a sidecar that talks about the pane you
 * are looking at is a second conversation surface competing with the thread
 * that already owns that work. So this navigates INTO Work.
 */
function AskAgentButton({ thread }: { thread: SaasThread | undefined }) {
  if (!thread) return null
  return (
    <Button
      variant="outline"
      size="sm"
      data-boring-workspace-part="saas-ask-agent"
      onClick={() => openSaasThread(thread.id)}
    >
      <MessageSquare className="size-3.5" strokeWidth={1.75} />
      Ask agent
    </Button>
  )
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

/**
 * The Inbox is the PRODUCT inbox (ruling B): `InboxOverlay` from the ask-user
 * plugin, the same component the app-left Inbox action opens. It reads the
 * shared attention store, which this spike seeds with fixture blockers — so
 * what renders here is the real triage surface over our data, not a lookalike.
 *
 * `onClose` is a no-op: the overlay is designed to be dismissible, but here it
 * IS the page, and a page has nothing to dismiss to.
 */
/**
 * INBOX EVIDENCE (convergence ruling 5).
 *
 * Nothing new is rendered for the artifact cards: seeding each blocker with
 * `inbox.artifacts` is enough, because `InboxOverlay` already expands an item
 * into `HumanArtifactList` and routes a click through `openHumanArtifact` ->
 * `shell.openArtifact`. The shell is normally `WorkspaceAgentFront`; here the
 * spike IS the shell, so it answers that capability itself and turns the
 * request into the SAME inset canvas the thread page uses.
 *
 * The identifier the two ends agree on is the canvas item id, carried as the
 * artifact's `target` under this shell's own `surfaceKind`.
 */
function inboxEvidenceTarget(target: WorkspaceShellArtifactTarget | null): { threadId: string; itemId: string } | null {
  if (!target || target.type !== "surface") return null
  if (target.surfaceKind !== SAAS_CANVAS_SURFACE_KIND || !target.target) return null
  const itemId = target.target
  const thread = SAAS_THREADS.find((candidate) => saasThreadCanvas(candidate.id).some((item) => item.id === itemId))
  return thread ? { threadId: thread.id, itemId } : null
}

function InboxPage() {
  const [evidence, setEvidence] = useState<{ threadId: string; itemId: string } | null>(null)
  const shell = useMemo<WorkspaceShellCapabilities>(() => {
    const unavailable = (message: string): WorkspaceShellCapabilityResult => ({ success: false, reason: "open-failed", message })
    return {
      openArtifact: (target) => {
        const resolved = inboxEvidenceTarget(target)
        if (!resolved) return { success: false, reason: "no-artifact", message: "This item has no evidence the canvas can open." }
        setEvidence(resolved)
        return { success: true }
      },
      // A thread IS the chat here, so "open the chat" is a navigation, not a
      // detached window; the full-chat and detached forms answer the same way.
      openDetachedChat: (ref) => { openSaasThread(ref.sessionId); return { success: true } },
      openFullChat: (ref) => { openSaasThread(ref.sessionId); return { success: true } },
      openInboxItem: () => unavailable("The Inbox is already the open page."),
    }
  }, [])

  const item = evidence ? saasCanvasItem(evidence.itemId) : undefined

  return (
    <div className="flex h-full min-h-0 bg-background" data-boring-workspace-part="saas-inbox-page" data-evidence-open={evidence ? "true" : "false"}>
      <div className="min-w-[420px] flex-1">
        <WorkspaceShellCapabilitiesProvider value={shell}>
          <InboxOverlay onClose={() => {}} pinStorageKey="boring-ui-v2:saas-spike:inbox-pins" />
        </WorkspaceShellCapabilitiesProvider>
      </div>
      {evidence ? (
        <div className="flex min-h-0 w-[52%] min-w-[420px] flex-col border-l border-border/70">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-4">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-foreground/[0.07] text-muted-foreground"><FileText className="size-3.5" strokeWidth={1.75} /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-foreground">{item?.title ?? "Evidence"}</p>
              <p className="truncate text-[11px] text-muted-foreground">{item?.meta ?? "Attached to this decision"}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => openSaasThread(evidence.threadId)}>Open thread</Button>
          </div>
          <SaasCanvasCard>
            <SaasThreadCanvas
              key={evidence.threadId}
              threadId={evidence.threadId}
              focusItemId={evidence.itemId}
              onActiveItemChange={() => {}}
              onClose={() => setEvidence(null)}
              closeLabel="Close evidence"
            />
          </SaasCanvasCard>
        </div>
      ) : null}
    </div>
  )
}

/**
 * ARCHIVED THREADS — where Work's second drill-in lands (ruling 2).
 *
 * A page-mode list, deliberately plain: the archive is a place you visit to
 * find one closed thread, not a surface that needs its own machinery.
 */
function ArchivedPage() {
  return (
    <div className="h-full overflow-y-auto bg-background p-8" data-boring-workspace-part="saas-archived-page">
      <Breadcrumbs trail={[{ label: "Work" }, { label: "Archived" }]} />
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">Archived threads</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        {SAAS_ARCHIVED_THREADS.length} threads closed out of Work. Fixture rows — nothing in this spike archives a thread yet.
      </p>
      <section className="mt-8 max-w-3xl">
        <div className="divide-y divide-border/60 border-t border-border/70">
          {SAAS_ARCHIVED_THREADS.map((thread) => (
            <div key={thread.id} className="flex items-center gap-4 py-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/70 bg-muted/30 text-muted-foreground"><Archive className="size-3.5" strokeWidth={1.75} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{thread.title}</span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">{thread.subject}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{thread.outcome}</span>
              <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70">{thread.closedAt}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

/**
 * Automations open the REAL automation page (ruling A): `AutomationPanel` from
 * `@hachej/boring-automation`, the same component its overlay and centre panel
 * render. The playground dev server now registers the plugin's own routes with
 * its default file store, so this page lists, creates and edits automations for
 * real rather than showing an error state.
 */
function AutomationsPage() {
  return (
    <div className="h-full min-h-0 bg-background" data-boring-workspace-part="saas-automations-page">
      <AutomationPanel />
    </div>
  )
}

// ---------------------------------------------------------------------------
// THREAD = chat that summons a canvas (#5, #6b, #7). The canvas itself lives
// in `SaasThreadCanvas.tsx`, because the Inbox mounts the same one as its
// evidence pane (ruling 5).
// ---------------------------------------------------------------------------

/**
 * Transcript floor: `max-w-[680px]` plus its `px-4` gutters. Below this the
 * conversation would reflow when the canvas opens, which ruling (D) forbids.
 */
const CHAT_MIN_WIDTH = 712
const CANVAS_MIN_WIDTH = 360

/**
 * A thread. Opens as PURE CHAT; the conversation summons the canvas (#7).
 *
 * The canvas is closed until an inline artifact card is clicked, which keeps
 * the continuity rule intact — a thread still reads as today's chat until the
 * moment you ask it for more.
 */
function ThreadPage({ threadId }: { threadId: string }) {
  const thread = SAAS_THREADS.find((item) => item.id === threadId)
  const items = threadId ? saasThreadCanvas(threadId) : []
  const [openItemId, setOpenItemId] = useState<string | null>(null)
  // Ruling (D): the transcript keeps IDENTICAL styling with the canvas open.
  // The transcript is `mx-auto max-w-[680px] px-4`, so anything under 712px
  // would start squeezing it and the conversation would visibly restyle. That
  // is the floor here and in the drag handler — the canvas yields, never the
  // chat.
  const [chatWidth, setChatWidth] = useState(CHAT_MIN_WIDTH)
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
    setChatWidth(Math.max(CHAT_MIN_WIDTH, Math.min(total - CANVAS_MIN_WIDTH, drag.startWidth + (event.clientX - drag.startX))))
  }, [])
  const onDragEnd = useCallback(() => { dragRef.current = null }, [])

  if (!thread) {
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
                if (event.key === "ArrowLeft") setChatWidth((width) => Math.max(CHAT_MIN_WIDTH, width - 24))
                if (event.key === "ArrowRight") setChatWidth((width) => width + 24)
              }}
              className="relative w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary/40 focus-visible:bg-primary/50 focus-visible:outline-none"
            >
              <span aria-hidden="true" className="absolute inset-y-0 -left-1.5 -right-1.5" />
            </div>
            {/* Ruling (C): the canvas is an INSET CARD inside the thread frame,
                not a flush full-height column. The frame's own chrome is
                visible around it on three sides. */}
            <SaasCanvasCard minWidth={CANVAS_MIN_WIDTH}>
              <SaasThreadCanvas
                threadId={threadId}
                focusItemId={openItemId}
                onActiveItemChange={(itemId) => { if (itemId) setOpenItemId(itemId) }}
                onClose={() => setOpenItemId(null)}
              />
            </SaasCanvasCard>
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
function AgentPage({ agentId }: { agentId: string }) {
  const agent = SAAS_AGENTS.find((item) => item.id === agentId)
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
              onClick={() => openSaasThread(thread.id)}
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
function CompanyRecord({ companyId, embedded = false }: { companyId: string; embedded?: boolean }) {
  const company = SAAS_COMPANIES.find((item) => item.id === companyId)
  if (!company) return <div className="grid h-full place-items-center bg-background p-8 text-sm text-muted-foreground">Company not found.</div>
  const fund = SAAS_FUNDS.find((item) => item.id === company.fundId)
  const documents = company.documentIds
    .map((id) => SAAS_ARTIFACTS.find((item) => item.id === id))
    .filter((item): item is SaasArtifact => Boolean(item))
  const threads = company.threadIds
    .map((id) => SAAS_THREADS.find((item) => item.id === id))
    .filter((item): item is SaasThread => Boolean(item))
  return (
    <div className={`h-full overflow-y-auto bg-background ${embedded ? "p-5" : "p-8"}`}>
      {embedded ? null : (
        <div className="flex items-start justify-between gap-4">
          <Breadcrumbs
            trail={[
              { label: "Companies", onClick: () => openSaasViewById("view-companies") },
              { label: company.name },
            ]}
          />
          <AskAgentButton thread={threadForCompany(company.id)} />
        </div>
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

function FundRecord({ fundId, embedded = false }: { fundId: string; embedded?: boolean }) {
  const fund = SAAS_FUNDS.find((item) => item.id === fundId)
  if (!fund) return <div className="grid h-full place-items-center bg-background p-8 text-sm text-muted-foreground">Fund not found.</div>
  const companies = SAAS_COMPANIES.filter((company) => company.fundId === fund.id)
  return (
    <div className={`h-full overflow-y-auto bg-background ${embedded ? "p-5" : "p-8"}`}>
      {embedded ? null : (
        <div className="flex items-start justify-between gap-4">
          <Breadcrumbs
            trail={[
              { label: "Funds", onClick: () => openSaasViewById("view-funds") },
              { label: fund.name },
            ]}
          />
          <AskAgentButton thread={threadForFund(fund.id)} />
        </div>
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

/**
 * Front plugins this shell needs.
 *
 * `ask-user` supplies the questions runtime `InboxOverlay` reads from — the
 * Inbox is the product's, so its context has to be the product's too.
 * `boring-automation` supplies the runtime provider behind `AutomationPanel`.
 * `filesystemPlugin` is NOT listed: `WorkspaceProvider` registers it as a
 * default, and passing it again throws `plugin "filesystem" registered twice`.
 */
const saasPlugins = [createAskUserPlugin({ appLeftInbox: false }), boringAutomationPlugin]

/**
 * DOCK panels only (#9).
 *
 * Threads, agents and the Inbox are gone from this registry: they are pages
 * now, and leaving them registered would have left a way to open one as a tab.
 * The record panes stay registered because the thread CANVAS mounts them as
 * artifact tabs — the same components the centre renders as pages.
 */
const SAAS_PANEL_IDS = [
  "saas-overview",
  "saas-kanban-placeholder",
  "saas-companies-home",
  "saas-funds-home",
  "saas-file-home",
  "saas-company",
  "saas-fund",
] as const

/** Dock wrappers: the canvas addresses record pages by panel id and params. */
function CompanyRecordPane({ params }: PaneProps<{ companyId?: string; embedded?: boolean }>) {
  if (!params?.companyId) return null
  return <CompanyRecord companyId={params.companyId} embedded={params.embedded} />
}

function FundRecordPane({ params }: PaneProps<{ fundId?: string; embedded?: boolean }>) {
  if (!params?.fundId) return null
  return <FundRecord fundId={params.fundId} embedded={params.embedded} />
}

function saasPanels(): PanelConfig[] {
  const panel = (id: string, title: string, component: PanelConfig["component"]): PanelConfig =>
    ({ id, title, placement: "shared-dockview", source: "app", component })
  return [
    panel("saas-overview", "Portfolio overview", OverviewPanel),
    panel("saas-kanban-placeholder", "Diligence pipeline", KanbanPlaceholderPanel),
    panel("saas-companies-home", "Companies", CompaniesHomePanel),
    panel("saas-funds-home", "Funds", FundsHomePanel),
    panel("saas-file-home", "Files", FileHomePanel),
    panel("saas-company", "Company", CompanyRecordPane),
    panel("saas-fund", "Fund", FundRecordPane),
  ]
}

/**
 * The centre in PAGE mode. No tab chrome; a page replaces what was there.
 *
 * A thread deliberately gets no page wrapper of its own — ruling #8: it must
 * land on the clean session-chat surface, full bleed. `JobThreadView` already
 * carries the chat's own header, so anything added here would be the second
 * header the ruling forbids.
 */
function CenterPageView({ page }: { page: CenterPage }) {
  if (page.kind === "thread") return <ThreadPage threadId={page.threadId} />
  if (page.kind === "agent") return <AgentPage agentId={page.agentId} />
  if (page.kind === "company") return <CompanyRecord companyId={page.companyId} />
  if (page.kind === "fund") return <FundRecord fundId={page.fundId} />
  if (page.kind === "automations") return <AutomationsPage />
  if (page.kind === "archived") return <ArchivedPage />
  return <InboxPage />
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
        label: thread.subject,
        inbox: {
          kind: "approval",
          sourceLabel: thread.title,
          updatedAt: new Date(),
          // Ruling 5: a decision arrives WITH its evidence. These are real
          // `HumanArtifact`s — the same shape the ask-user tool emits — so the
          // shipped `HumanArtifactList` renders the cards and the shipped
          // `openHumanArtifact` path opens them.
          artifacts: saasInboxArtifacts(thread.id) as HumanArtifact[],
        },
        sessionBadge: { kind: "approval", label: "approve", tone: "warning", priority: 20 },
      })
    }
  }, [addBlocker])
  return null
}

const FILES_VIEW = SAAS_VIEWS.find((view) => view.id === "view-files")!

/**
 * The Library's Dockview. Mounted only in dock mode, so a thread cannot have a
 * stale tab strip behind it.
 */
function DockCenter() {
  const handleReady = useCallback((api: SurfaceApi) => {
    shellRef.content = api
    if (shellRef.dockTarget) activateDockPanel(api, shellRef.dockTarget)
  }, [])

  // The handle must not outlive the surface: a queued request after unmount
  // has to queue, not land on a dead api.
  useEffect(() => () => { shellRef.content = null }, [])

  return (
    <ArtifactSurfacePane
      storageKey="boring-ui-v2:layout:saas-spike:content"
      allowedPanels={[...SAAS_PANEL_IDS, ...CANVAS_PANELS]}
      onReady={handleReady}
      className="h-full"
    />
  )
}

function SaasSpikeShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [view, setView] = useState<SaasView>(FILES_VIEW)
  const [center, setCenter] = useState<CenterState>({ mode: "page", page: { kind: "inbox" } })
  const [explorerWidth, setExplorerWidth] = useState(320)
  const { blockers } = useWorkspaceAttention()
  const automationCount = useLiveAutomationCount()
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
    shellRef.setCenter = setCenter
    return () => { shellRef.setView = null; shellRef.setCenter = null }
  }, [])

  const actions = useMemo<SaasNavActions>(() => ({
    openInbox: openSaasInbox,
    openThread: openSaasThread,
    openAgent: openSaasAgent,
    openView: openSaasView,
    openAutomations: openSaasAutomations,
    openArchived: openSaasArchived,
    openCommandPalette: () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))
    },
  }), [])

  const activePageId = center.mode === "page"
    ? (center.page.kind === "inbox" ? "saas-inbox" : `saas-${center.page.kind}`)
    : null
  const activeThreadId = center.mode === "page" && center.page.kind === "thread" ? center.page.threadId : null
  const activeAgentId = center.mode === "page" && center.page.kind === "agent" ? center.page.agentId : null

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

  // Both nav faces read the SAME state object, which is what keeps the
  // collapsed rail's flyouts from drifting from the expanded pane.
  const navState = {
    actions,
    activePageId,
    activeThreadId,
    activeAgentId,
    activeViewId: center.mode === "dock" ? view.id : null,
    attentionThreadIds,
    automationCount,
    onCollapse: () => setCollapsed(true),
    onExpand: () => setCollapsed(false),
  }

  return (
    <PluginTabsWorkspaceShell
      collapsed={collapsed}
      onCollapse={() => setCollapsed(true)}
      onExpand={() => setCollapsed(false)}
      // Ruling 3: the toggle lives in the nav header / rail, not floating over
      // the shell's top-left corner.
      showCollapseControl={false}
      leftPane={<SaasLeftNav {...navState} />}
      collapsedRail={<SaasLeftRail {...navState} />}
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

        {/* Column 3 — CONTENT, in one of two modes (#8, #9). */}
        <div className="min-w-0 flex-1" data-boring-workspace-part="saas-center" data-center-mode={center.mode}>
          {center.mode === "dock" ? <DockCenter /> : <CenterPageView page={center.page} />}
        </div>
      </div>
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
