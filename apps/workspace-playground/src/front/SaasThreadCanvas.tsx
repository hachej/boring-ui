/**
 * The EMBEDDED workbench: an `ArtifactSurfacePane` plus the real
 * `WorkbenchActivityRail`, used by the thread page and by the Inbox's evidence
 * pane. The rail is the visual signature of an embedded workspace (#6b) — it
 * exists here and nowhere else in the shell, and its icons are the thread's
 * scope groups, not global tools.
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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Building2, FileText, Search, Sparkles, X, type LucideIcon } from "lucide-react"
// `FileTreePane` is the canonical Files-source chrome (root selector +
// refresh/upload) around the real tree. It was internal; this branch adds it to
// the package's public entry — the ONE package-export addition ruling 4 needs,
// because the pane reads the filesystem plugin's fetch-client context, which is
// NOT realm-shared, so a source import beside a dist `WorkspaceProvider` would
// have split that context and rendered an unconfigured tree.
import { ArtifactSurfacePane, FileTreePane, WorkbenchActivityRail, type FileTreeRootConfig } from "@hachej/boring-workspace"
// Internal source imports (the playground aliases `@` -> packages/workspace/src).
// `paneCollapseButton` and the bridge types carry no workspace context.
import { PaneCollapseButton } from "@/front/layout/paneCollapseButton"
import type { FileTreeBridge } from "@/front/bridge/types"
import {
  saasCanvasItem,
  saasThreadCanvas,
  saasThreadCanvasGroup,
  saasThreadCanvasGroups,
  type SaasCanvasGroup,
  type SaasCanvasItem,
} from "./SaasSpikeFixtures"
import { baseName, panelForPath, type SurfaceApi } from "./saasShell"

/** Panels the embedded canvas is allowed to mount. */
export const CANVAS_PANELS = ["markdown-editor", "code-editor", "csv-viewer", "saas-company", "saas-fund"]

function canvasPanelId(item: SaasCanvasItem): string {
  return `canvas:${item.id}`
}

/** Ad-hoc files opened from the tree popover get their own id space. */
function canvasTreePanelId(path: string): string {
  return `canvas:tree:${path}`
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
 * FILE ACCESS FROM THE CANVAS (convergence ruling 4).
 *
 * The working-files GROUP used to be a mounted column of fixture file panes.
 * It is now a POPOVER off the rail's files icon holding the REAL file tree —
 * whole workspace, real root selector, real search — so the canvas can reach
 * any file rather than the three someone seeded.
 *
 * `FileTreePane` owns the root selector and the refresh/upload actions but
 * deliberately does NOT own search ("search is owned by the shell's unified
 * catalog"). This popover is that shell here, so the search box lives in its
 * header and feeds the pane's `searchQuery` prop — the same seam the workbench
 * uses, not a second search implementation.
 */
/**
 * The deployment's filesystem roots, straight off the live catalog.
 *
 * `FileTreePane` renders its root SELECTOR only when its host hands it more
 * than one root — it does not go looking for a catalog itself. This popover is
 * the host, so it asks. A workspace with one filesystem correctly gets the
 * pane's single-root chrome instead of a dropdown with one entry.
 */
function useFilesystemRoots(): readonly FileTreeRootConfig[] | undefined {
  const [roots, setRoots] = useState<readonly FileTreeRootConfig[] | undefined>(undefined)
  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/v1/filesystems", { signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() as { filesystems?: FileTreeRootConfig[] } : null)
      .then((payload) => { if (payload?.filesystems?.length) setRoots(payload.filesystems) })
      .catch(() => { /* One root is the pane's own default; a failed catalog changes nothing. */ })
    return () => controller.abort()
  }, [])
  return roots
}

function CanvasFileTreePopover({
  activePath,
  onOpenFile,
  onDismiss,
}: {
  activePath: string | null
  onOpenFile: (path: string) => void
  onDismiss: () => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const roots = useFilesystemRoots()
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  // `FileTreeView` documents `searchQuery` as "already-debounced".
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 180)
    return () => clearTimeout(timer)
  }, [query])

  const activePathRef = useRef<string | null>(activePath)
  activePathRef.current = activePath
  const bridge = useMemo<FileTreeBridge>(() => ({
    openFile: async (path: string) => {
      onOpenFile(path)
      return { seq: 0, status: "ok" as const }
    },
    getActiveFile: () => activePathRef.current,
    select: () => () => {},
  }), [onOpenFile])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (rootRef.current?.contains(target)) return
      // The rail button that opened this popover toggles it itself; letting the
      // dismiss also fire would close and immediately reopen.
      if ((target as HTMLElement).closest?.('[data-boring-workspace-rail-id="files"]')) return
      // Radix Select (the root selector) portals its menu outside this subtree.
      if ((target as HTMLElement).closest?.("[data-radix-popper-content-wrapper]")) return
      onDismiss()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onDismiss() }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [onDismiss])

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Workspace files"
      data-boring-workspace-part="saas-canvas-files-popover"
      className="absolute inset-y-3 right-14 z-40 flex w-[288px] flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-2.5 py-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <input
          type="search"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search files…"
          aria-label="Search files"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <FileTreePane bridge={bridge} filesystem="user" roots={roots ? [...roots] : undefined} searchQuery={debouncedQuery} />
      </div>
      <p className="shrink-0 border-t border-border/70 px-3 py-1.5 text-[10px] text-muted-foreground/70">
        Live workspace · opening a file adds it to this canvas
      </p>
    </div>
  )
}

export function SaasThreadCanvas({
  threadId,
  focusItemId,
  onActiveItemChange,
  onClose,
  closeLabel = "Close canvas",
}: {
  threadId: string
  focusItemId: string | null
  onActiveItemChange: (itemId: string | null) => void
  onClose: () => void
  closeLabel?: string
}) {
  // Only the groups the rail MOUNTS. `files` is no longer one of them: the
  // files icon is a popover trigger now (ruling 4), and the fixture file items
  // in that group are reached from the transcript's artifact cards.
  const groups = useMemo(
    () => saasThreadCanvasGroups(threadId).filter((group) => group !== "files"),
    [threadId],
  )
  const focusItem = focusItemId ? saasCanvasItem(focusItemId) : undefined
  const [group, setGroup] = useState<SaasCanvasGroup>(() => focusItem?.group ?? groups[0] ?? "outputs")
  const [filesOpen, setFilesOpen] = useState(false)
  const [activePath, setActivePath] = useState<string | null>(null)
  const apiRef = useRef<SurfaceApi | null>(null)
  // Files opened from the popover: ad-hoc members of the `files` group, kept
  // per-canvas so switching groups and coming back does not lose them.
  const [treeFiles, setTreeFiles] = useState<readonly string[]>([])
  const treeFilesRef = useRef<readonly string[]>(treeFiles)
  treeFilesRef.current = treeFiles

  const mountGroup = useCallback((api: SurfaceApi, nextGroup: SaasCanvasGroup, focusId?: string | null) => {
    const items = saasThreadCanvasGroup(threadId, nextGroup)
    const extraPaths = nextGroup === "files" ? treeFilesRef.current : []
    const wanted = new Set([...items.map(canvasPanelId), ...extraPaths.map(canvasTreePanelId)])
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
    for (const path of extraPaths) {
      const id = canvasTreePanelId(path)
      if (api.getPanel(id)) continue
      api.addPanel({ id, component: panelForPath(path), title: baseName(path), params: { path, filesystem: "user", mode: "edit" } })
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

  /** Panel id -> the workspace path it edits, so the tree can highlight it. */
  const pathForPanel = useCallback((panelId: string | undefined): string | null => {
    if (!panelId) return null
    if (panelId.startsWith("canvas:tree:")) return panelId.slice("canvas:tree:".length)
    const item = saasCanvasItem(panelId.replace(/^canvas:/, ""))
    return item?.kind === "file" ? item.path ?? null : null
  }, [])

  const handleReady = useCallback((api: SurfaceApi) => {
    apiRef.current = api
    appliedFocusRef.current = focusRef.current
    mountGroup(api, group, focusRef.current)
    // Switching a canvas TAB moves the mark in the transcript, so the two
    // always point at each other (#7.4).
    api.onDidActivePanelChange?.(() => {
      const active = api.activePanel?.id
      setActivePath(pathForPanel(active))
      onActiveItemChange(active && !active.startsWith("canvas:tree:") ? active.replace(/^canvas:/, "") : null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountGroup, onActiveItemChange, pathForPanel])

  // Group changed — by the rail, or because a card named another group.
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const focus = focusRef.current
    const item = focus ? saasCanvasItem(focus) : undefined
    mountGroup(api, group, item?.group === group ? focus : null)
  }, [group, mountGroup, treeFiles])

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

  const openTreeFile = useCallback((path: string) => {
    setTreeFiles((current) => current.includes(path) ? current : [...current, path])
    setGroup("files")
    setActivePath(path)
    const api = apiRef.current
    const id = canvasTreePanelId(path)
    if (!api) return
    const existing = api.getPanel(id)
    if (existing) existing.api.setActive()
  }, [])

  // A tree file added while the files group is already mounted needs activating
  // after the mount effect has run.
  useEffect(() => {
    const api = apiRef.current
    if (!api || group !== "files" || !activePath) return
    api.getPanel(canvasTreePanelId(activePath))?.api.setActive()
  }, [activePath, group, treeFiles])

  const railEntries = useMemo(() => {
    const groupEntries = groups.map((item) => {
      const Icon = canvasGroupIcon[item]
      return {
        id: item,
        title: canvasGroupLabel[item],
        icon: <Icon className="h-4 w-4" />,
        active: group === item,
        focused: group === item,
        select: () => { setFilesOpen(false); setGroup(item) },
      }
    })
    const filesEntry = {
      id: "files",
      title: "Workspace files",
      icon: <FileText className="h-4 w-4" />,
      active: filesOpen || group === "files",
      focused: filesOpen || group === "files",
      select: () => setFilesOpen((open) => !open),
    }
    // Outputs, then files, then records — the ruled group order, with the
    // popover trigger taking the slot the files GROUP used to hold.
    return [groupEntries[0], filesEntry, ...groupEntries.slice(1)].filter(Boolean) as typeof groupEntries
  }, [filesOpen, group, groups])

  return (
    // `flex-1 min-w-0` is load-bearing: this root is itself a flex ITEM inside
    // the inset card, and without it the Dockview surface below collapsed to
    // zero width and the card rendered blank beside the rail.
    <div className="saas-canvas-quiet-tabs relative flex h-full min-h-0 w-full min-w-0 flex-1" data-boring-workspace-part="saas-thread-canvas">
      <div className="min-w-0 flex-1">
        <ArtifactSurfacePane
          storageKey={`boring-ui-v2:layout:saas-spike:canvas:${threadId}`}
          allowedPanels={CANVAS_PANELS}
          onReady={handleReady}
          className="h-full"
        />
      </div>
      {filesOpen ? (
        <CanvasFileTreePopover
          activePath={activePath}
          onOpenFile={openTreeFile}
          onDismiss={() => setFilesOpen(false)}
        />
      ) : null}
      {/* The embedded workspace's rail — the REAL `WorkbenchActivityRail` from
          the workbench, not a replica (#10). Same metrics, same quiet grey,
          same instant tooltips, same accent rule; only the entries are ours,
          scoped to this thread rather than to global workspace sources. */}
      <WorkbenchActivityRail
        side="right"
        aria-label="Canvas scope"
        className="border-l border-border/70"
        leading={(
          <PaneCollapseButton className="workbench-rail-action" label={closeLabel} side="left" onClick={onClose}>
            <X className="h-4 w-4" strokeWidth={1.75} />
          </PaneCollapseButton>
        )}
        entries={railEntries}
      />
    </div>
  )
}

/** The inset-card frame the canvas always sits in (ruling C). */
export function SaasCanvasCard({ children, minWidth }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col py-4 pr-4" style={minWidth ? { minWidth } : undefined}>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[10px] border border-border bg-popover shadow-sm">
        {children}
      </div>
    </div>
  )
}
