/**
 * The SaaS spike's shell handle and its openers.
 *
 * Module scope on purpose: the openers are called from module-level components
 * (a record page's breadcrumb has to be able to go back to its collection, the
 * nav has to be able to open a page) while the centre mode and the explorer are
 * React state. Keeping the handle here rather than inside `SaasSpike.tsx` is
 * also what lets the nav, the canvas and the pages live in their own files
 * without importing each other.
 */
import type { PaneProps } from "@hachej/boring-workspace"
import { SAAS_VIEWS, type SaasView } from "./SaasSpikeFixtures"

/** Dockview's container api, borrowed off PaneProps so the spike needs no direct dockview dep. */
export type SurfaceApi = PaneProps["containerApi"]

/**
 * CENTER MODES (owner rulings #8, #9).
 *
 *   - "dock"  — Library artifacts: files, saved views, collection homes,
 *               dashboards. Tab strip allowed; that is what Dockview is for.
 *   - "page"  — everything else: a thread, an agent, a record, the Inbox, the
 *               automation page, the archived list. No tab chrome, and opening
 *               one REPLACES the centre rather than accumulating a tab.
 */
export type CenterPage =
  | { kind: "inbox" }
  | { kind: "automations" }
  | { kind: "archived" }
  | { kind: "thread"; threadId: string }
  | { kind: "agent"; agentId: string }
  | { kind: "company"; companyId: string }
  | { kind: "fund"; fundId: string }

export type CenterState = { mode: "dock" } | { mode: "page"; page: CenterPage }

/**
 * VIEW EXPLORER presence, derived from the active centre — never a separate
 * toggle. Library entries (`openSaasView`) put the centre in dock mode, which
 * is the only mode with an explorer; every page destination (a thread, the
 * Inbox, an agent, a record, automations, archived) is page mode, which has
 * none. Deriving from `center` here — rather than a boolean flipped by each
 * nav handler — is what stops the explorer persisting outside the Library:
 * there is no second state to forget to clear.
 */
export function explorerVisibleForCenter(center: CenterState): boolean {
  return center.mode === "dock"
}

export interface DockRequest {
  id: string
  component: string
  title: string
  params?: Record<string, unknown>
}

export const shellRef: {
  content: SurfaceApi | null
  setView: ((view: SaasView) => void) | null
  setCenter: ((center: CenterState) => void) | null
  /**
   * The panel the dock SHOULD be showing. Declarative, and deliberately never
   * cleared: under StrictMode the surface mounts, unmounts and remounts, so a
   * queue that was consumed by the first (discarded) mount left the Library
   * showing an empty dock. Re-applying the same request on every ready is
   * idempotent, and it also restores the right tab on the way back to Library.
   */
  dockTarget: DockRequest | null
} = { content: null, setView: null, setCenter: null, dockTarget: null }

export function activateDockPanel(api: SurfaceApi, config: DockRequest): void {
  const existing = api.getPanel(config.id)
  if (existing) {
    existing.api.setActive()
    return
  }
  api.addPanel({ id: config.id, component: config.component, title: config.title, params: config.params })
}

/**
 * Show a Library artifact: switch the centre to dock mode and open its tab.
 *
 * Switching modes unmounts/mounts the surface, so the request is recorded and
 * re-applied on the next ready rather than being lost with the old instance.
 */
export function openDockPanel(config: DockRequest): void {
  shellRef.dockTarget = config
  shellRef.setCenter?.({ mode: "dock" })
  const api = shellRef.content
  if (api) activateDockPanel(api, config)
}

/** Show a PAGE: replaces the centre outright. */
export function openCenterPage(page: CenterPage): void {
  shellRef.setCenter?.({ mode: "page", page })
}

/**
 * Extension -> registered panel id.
 *
 * Mirrors `filesystemSurfaceResolver`. The real resolver runs inside
 * `SurfaceShell.openFile`, and a bare `ArtifactSurfacePane` has no open-file
 * logic of its own, so the handful of extensions the fixtures use are mapped
 * here rather than reimplementing the resolver.
 */
export function panelForPath(path: string): string {
  if (/\.mdx?$/i.test(path)) return "markdown-editor"
  if (/\.(csv|tsv)$/i.test(path)) return "csv-viewer"
  return "code-editor"
}

export function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

/** A file is a Library artifact, so it opens as a dock tab. */
export function openContentFile(path: string): void {
  openDockPanel({
    id: `file:${path}`,
    component: panelForPath(path),
    title: baseName(path),
    params: { path, filesystem: "user", mode: "edit" },
  })
}

/**
 * Select a view: mount its explorer in column 2, open its home in column 3.
 * Every Library view is an artifact view, so every one of them is dock mode.
 */
export function openSaasView(view: SaasView | undefined): void {
  if (!view) return
  shellRef.setView?.(view)
  openDockPanel({ id: view.homePanel, component: view.homePanel, title: view.title })
}

export function openSaasViewById(viewId: string): void {
  openSaasView(SAAS_VIEWS.find((view) => view.id === viewId))
}

// Records, threads, agents, the Inbox, automations and the archive are PAGES.
export function openSaasCompany(companyId: string): void {
  openCenterPage({ kind: "company", companyId })
}

export function openSaasFund(fundId: string): void {
  openCenterPage({ kind: "fund", fundId })
}

export function openSaasThread(threadId: string): void {
  openCenterPage({ kind: "thread", threadId })
}

export function openSaasAgent(agentId: string): void {
  openCenterPage({ kind: "agent", agentId })
}

export function openSaasInbox(): void {
  openCenterPage({ kind: "inbox" })
}

export function openSaasAutomations(): void {
  openCenterPage({ kind: "automations" })
}

export function openSaasArchived(): void {
  openCenterPage({ kind: "archived" })
}

// ---------------------------------------------------------------------------
// REAL THREAD SESSIONS (weekend follow-up ruling).
//
// A thread mounts the shipped chat, and the shipped chat needs a REAL session
// id from the live agent API — not a fixture string. One real session is
// created lazily per fixture thread, on first open, via the same
// `POST /api/v1/agents/:id/sessions` endpoint `App.tsx`'s showcase route
// already uses. The mapping is remembered in localStorage so re-opening a
// thread reuses its session rather than minting a new one on every click.
// ---------------------------------------------------------------------------

const THREAD_SESSION_STORAGE_KEY = "boring-ui-v2:saas-spike:thread-sessions"

function readThreadSessionMap(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(THREAD_SESSION_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {}
  } catch {
    return {}
  }
}

/** The remembered real session id for a fixture thread, if one was already created. */
export function readSaasThreadSessionId(threadId: string): string | null {
  return readThreadSessionMap()[threadId] ?? null
}

/** Remember a fixture thread's real session id across reloads. Best-effort. */
export function storeSaasThreadSessionId(threadId: string, sessionId: string): void {
  if (typeof window === "undefined") return
  try {
    const map = readThreadSessionMap()
    map[threadId] = sessionId
    window.localStorage.setItem(THREAD_SESSION_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Best-effort: a failed write just means the next open creates a new session.
  }
}

/** Create a real session against the live agent API. Throws on failure — callers surface it honestly. */
export async function createSaasThreadSession(agentTypeId: string, workspaceId: string, title: string): Promise<string> {
  const response = await fetch(`/api/v1/agents/${encodeURIComponent(agentTypeId)}/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-boring-workspace-id": workspaceId,
    },
    body: JSON.stringify({ title }),
  })
  if (!response.ok) throw new Error(`session create failed (${response.status})`)
  const payload = await response.json() as { sessionId?: string }
  if (!payload.sessionId) throw new Error("session create returned no session id")
  return payload.sessionId
}
