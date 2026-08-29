import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createDeckPlugin } from "@hachej/boring-deck/front"
import type { DeckWidgetDefinition } from "@hachej/boring-deck/shared"
import { WorkspaceProvider } from "@hachej/boring-workspace"
import { WorkspaceAgentFront, WorkspaceFullPagePanel, parseFullPagePanelLocation } from "@hachej/boring-workspace/app/front"
import { createAskUserPlugin } from "@hachej/boring-ask-user/front"
import { diagramPlugin } from "@hachej/boring-diagram/front"
import { createTasksPlugin } from "@hachej/boring-tasks/front"
import { SHOWCASE_SESSION_ID } from "./showcaseMessages"
import { LoadingStatesShowcase, type LoadingStateMode } from "./LoadingStatesShowcase"
import { SHOWCASE_SESSION_TITLE_TAG } from "../shared/showcaseSession"

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const showcaseSessionTitles = [
  "Navigation polish review",
  "Fix mobile drawer focus",
  "Investigate session persistence",
  "Prepare release checklist",
  "Review workspace permissions",
  "Refactor command routing",
  "Debug background task status",
  "Plan analytics dashboard",
  "Improve empty states",
  "Audit keyboard navigation",
  "Update onboarding copy",
  "Long-running migration follow-up and rollback planning",
  "Trace file synchronization",
  "Review pull request feedback",
  "Prototype data explorer",
  "Resolve flaky integration test",
  "Document runtime architecture",
  "Optimize initial workspace load",
  "Design notification preferences",
  "Test narrow viewport behavior",
  "Review dependency updates",
  "Investigate API timeout",
  "Draft customer handoff",
  "Polish dark mode contrast",
  "Verify deployment health",
  "Explore plugin permissions",
  "Triage accessibility findings",
  "Plan session search",
  "Compare model responses",
  "Archive completed experiments",
]

function showcaseSessionCount(): number {
  if (typeof window === "undefined") return 1
  const requested = Number(new URLSearchParams(window.location.search).get("sessions") ?? 1)
  return Number.isFinite(requested) ? Math.min(100, Math.max(1, Math.floor(requested))) : 1
}

// Decorative padding entries for the session list when `?sessions=N` is
// requested (session-list volume/scroll demos). They start with no backend
// session behind them — selecting one materializes a real session on demand
// (see handleActiveSessionIdChange) instead of ever connecting the chat pane
// to this placeholder id directly.
function createInitialShowcaseSessions() {
  const count = showcaseSessionCount()
  const now = Date.now()
  return Array.from({ length: Math.max(0, count - 1) }, (_, index) => ({
    id: `${SHOWCASE_SESSION_ID}-${index + 2}`,
    title: showcaseSessionTitles[(index + 1) % showcaseSessionTitles.length] ?? `Session ${index + 2}`,
    updatedAt: now - (index + 1) * 60_000,
  }))
}

function loadingStateMode(): LoadingStateMode | null {
  if (typeof window === "undefined") return null
  const mode = new URLSearchParams(window.location.search).get("loading-state")
  return mode === "workspace" || mode === "sessions" || mode === "workbench" || mode === "error" ? mode : null
}

function isFullPageRoute(): boolean {
  if (typeof window === "undefined") return false
  return window.location.pathname === "/full-page" || window.location.pathname === "/full-page/"
}

function isMultiFilesystemPlaygroundRoute(): boolean {
  if ((import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_PLAYGROUND_MULTI_FS === "1") return true
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("multiFilesystem") === "1"
}

interface WorkspaceMeta {
  projectName?: string
  workspaceId?: string
  defaultAgentTypeId?: string
}

const playgroundDeckWidgets: DeckWidgetDefinition[] = [
  {
    name: "PlaygroundBadge",
    display: "inline",
    render: ({ attrs }) => (
      <span className="inline-flex rounded-full border border-border/60 bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
        {attrs.text ?? "badge"}
      </span>
    ),
  },
]

const playgroundDeckPlugin = createDeckPlugin({
  widgets: playgroundDeckWidgets,
  theme: {
    className: "workspace-playground-deck",
    slideClassName: "workspace-playground-deck-slide",
  },
})

const askUserPlugin = createAskUserPlugin({ appLeftInbox: true })
const tasksPlugin = createTasksPlugin()
const workspacePlugins = [askUserPlugin, tasksPlugin, playgroundDeckPlugin, diagramPlugin]
const externalPluginsEnabled = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_BORING_EXTERNAL_PLUGINS === "1"

function resetPlaygroundStorageIfRequested(): void {
  if (typeof window === "undefined") return
  const params = new URLSearchParams(window.location.search)
  if (params.get("fresh") !== "1") return
  const prefixes = [
    "boring-ui-v2:layout:playground",
    "boring-workspace:",
    "boring-agent:",
  ]
  for (const key of Object.keys(window.localStorage)) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      window.localStorage.removeItem(key)
    }
  }
  params.delete("fresh")
  const nextSearch = params.toString()
  window.history.replaceState(null, "", `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`)
}

function WorkspaceFullPageShell({ agentTypeId }: { agentTypeId: string }) {
  const parsed = parseFullPagePanelLocation(window.location.search)

  if (!parsed.componentId || parsed.error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-lg rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-foreground">
          <div className="font-medium">Invalid full-page panel route</div>
          <div className="mt-1 text-muted-foreground">
            {parsed.error?.message ?? "Missing full-page panel component."}
          </div>
        </div>
      </div>
    )
  }

  return (
    <WorkspaceProvider
      agentTypeId={agentTypeId}
      apiBaseUrl=""
      plugins={workspacePlugins}
      persistenceEnabled
      manageDocumentTitle={false}
      workspaceId="playground-full-page"
      fullPageBasePath="/full-page"
    >
      <WorkspaceFullPagePanel componentId={parsed.componentId} params={parsed.params} />
    </WorkspaceProvider>
  )
}

export function WorkspaceShell() {
  resetPlaygroundStorageIfRequested()
  const showcase = useMemo(isShowcaseRoute, [])
  const loadingShowcase = useMemo(loadingStateMode, [])
  const fullPage = useMemo(isFullPageRoute, [])
  const multiFilesystem = useMemo(isMultiFilesystemPlaygroundRoute, [])
  const [defaultAgentTypeId, setDefaultAgentTypeId] = useState("")
  const [projectName, setProjectName] = useState("Workspace")
  const [workspaceId, setWorkspaceId] = useState("Workspace")
  const [metaLoaded, setMetaLoaded] = useState(Boolean(loadingShowcase))
  const [metaError, setMetaError] = useState<string | null>(null)
  const [showcaseActiveSessionId, setShowcaseActiveSessionId] = useState<string | undefined>(undefined)
  const [showcaseSessions, setShowcaseSessions] = useState(createInitialShowcaseSessions)
  // The showcase route used to pre-seed a client-side session id, but the
  // chat pane always talks to a real backend session (see packages/
  // workspace's chat pane, which requires params.sessionId and hydrates it
  // over the network). A session that only ever existed client-side 404'd on
  // hydrate, which is what produced the permanent "session was not found"
  // banner and a disabled composer (gh-1452). `showcaseBootState` gates
  // rendering the chat panel until a real backend session has been created.
  const [showcaseBootState, setShowcaseBootState] = useState<"pending" | "ready" | "error">(showcase ? "pending" : "ready")
  const sessions = showcase ? showcaseSessions : undefined
  const liveShowcaseSessionIds = useRef(new Set<string>())
  // Tab-scoped reuse key: bounds session accumulation from repeated boots in
  // the same browser tab (reload, HMR) to one durable session instead of one
  // per mount. sessionStorage (not localStorage) so the *pointer* never
  // outlives the tab. This alone does not bound the durable backend session
  // itself — closing the tab discards only this reuse pointer, and a new
  // tab/e2e context still creates its own session. Actual retention is
  // bounded by two other layers: the pagehide cleanup below (best-effort,
  // same boot) and the scripted dev server's boot-time sweep in
  // scriptedPiHarness.ts (authoritative backstop — deletes every
  // showcase-tagged session left empty by a *previous* boot, regardless of
  // which tab/context created it). See SHOWCASE_SESSION_TITLE_TAG.
  const showcaseBootStorageKey = "boring-ui-v2:showcase:boot-session-id"
  const requestNewShowcaseSession = useCallback(async (
    title: string,
    options: { requestId?: string; resumeSessionId?: string; timeoutMs?: number } = {},
  ) => {
    const controller = new AbortController()
    const timeoutId = options.timeoutMs !== undefined
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : undefined
    try {
      const response = await fetch(`/api/v1/agents/${encodeURIComponent(defaultAgentTypeId)}/sessions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-boring-workspace-id": "default",
        },
        body: JSON.stringify({
          // The backend-stored title is tagged and never surfaced — this UI
          // only ever renders the `title` this function returns below, taken
          // from the controlled `sessions` prop it builds client-side (see
          // ../shared/showcaseSession.ts). The tag lets the scripted dev
          // server's boot-time sweep find and delete stale, still-empty
          // showcase sessions without touching unrelated ones.
          title: `${SHOWCASE_SESSION_TITLE_TAG}${title}`,
          ...(options.requestId ? { requestId: options.requestId } : {}),
          ...(options.resumeSessionId ? { resumeSessionId: options.resumeSessionId } : {}),
        }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`showcase session create failed (${response.status})`)
      const payload = await response.json() as { agentTypeId?: string; sessionId?: string }
      if (!payload.sessionId) throw new Error("showcase session create returned no session id")
      return {
        id: payload.sessionId,
        agentTypeId: payload.agentTypeId ?? defaultAgentTypeId,
        title,
        updatedAt: Date.now(),
      }
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [defaultAgentTypeId])
  const createShowcaseSession = useCallback(async () => {
    const session = await requestNewShowcaseSession("New chat", { requestId: randomId(), timeoutMs: 8_000 })
    liveShowcaseSessionIds.current.add(session.id)
    setShowcaseSessions((current) => [...current, session])
    setShowcaseActiveSessionId(session.id)
    return session
  }, [requestNewShowcaseSession])
  // Boot the initial showcase session: create it on the real backend (with a
  // bounded, abort-timed retry to ride out a cold dev-server boot) before the
  // composer is ever shown, instead of pre-seeding a session id that never
  // materializes server-side. The request id is generated once and reused
  // across every retry attempt so a committed-but-lost response can't create
  // a second durable session (createSession is idempotent per requestId —
  // embeddedGateway.ts replays the original receipt for a repeated id).
  const showcaseBootStartedRef = useRef(false)
  const showcaseBootRequestIdRef = useRef<string | null>(null)
  const showcaseBootCancelRef = useRef(false)
  const bootShowcaseSession = useCallback(async () => {
    showcaseBootCancelRef.current = false
    showcaseBootStartedRef.current = true
    setShowcaseBootState("pending")
    if (!showcaseBootRequestIdRef.current) showcaseBootRequestIdRef.current = randomId()
    const requestId = showcaseBootRequestIdRef.current
    let resumeSessionId: string | undefined
    try {
      resumeSessionId = window.sessionStorage.getItem(showcaseBootStorageKey) ?? undefined
    } catch {
      /* sessionStorage unavailable (private mode, disabled storage) — always create fresh */
    }
    const maxAttempts = 5
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (showcaseBootCancelRef.current) return
      try {
        const session = await requestNewShowcaseSession(showcaseSessionTitles[0] ?? "New chat", {
          requestId,
          resumeSessionId,
          timeoutMs: 8_000,
        })
        if (showcaseBootCancelRef.current) return
        liveShowcaseSessionIds.current.add(session.id)
        try { window.sessionStorage.setItem(showcaseBootStorageKey, session.id) } catch { /* noop */ }
        setShowcaseSessions((current) => [session, ...current.filter((existing) => existing.id !== session.id)])
        setShowcaseActiveSessionId(session.id)
        setShowcaseBootState("ready")
        return
      } catch {
        if (showcaseBootCancelRef.current) return
        if (attempt === maxAttempts) {
          setShowcaseBootState("error")
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
      }
    }
  }, [requestNewShowcaseSession])
  useEffect(() => {
    if (!showcase || !metaLoaded || !defaultAgentTypeId) return
    if (showcaseBootStartedRef.current) return
    void bootShowcaseSession()
    return () => { showcaseBootCancelRef.current = true }
  }, [bootShowcaseSession, defaultAgentTypeId, metaLoaded, showcase])
  const retryShowcaseBoot = useCallback(() => {
    showcaseBootStartedRef.current = false
    void bootShowcaseSession()
  }, [bootShowcaseSession])
  const renameShowcaseSession = useCallback((sessionId: string, title: string) => {
    setShowcaseSessions((current) => current.map((session) => (
      session.id === sessionId ? { ...session, title, updatedAt: Date.now() } : session
    )))
  }, [])
  // Decorative rows (padding from `?sessions=N`) start with no backend
  // session behind them. Selecting one materializes a real session first —
  // guarded against a double-click by the in-memory
  // `materializingShowcaseSessionIds` set below — instead of ever handing
  // the chat pane an id that will 404 (gh-1452).
  //
  // The request id is freshly random per attempt, NOT derived from the
  // (fixed, deterministic) placeholder row id. A stable "showcase-row-<id>"
  // request id looked idempotent-safe, but the placeholder id is the exact
  // same string on every future page load/e2e run against this server —
  // so a *second* click across a completely unrelated later visit would
  // replay the ledger's very first receipt for it, handing back a stale
  // session that a previous visit's pagehide cleanup may have already
  // deleted. The `materializingShowcaseSessionIds` guard already prevents
  // a genuine double-click within one page's lifetime, so no cross-visit
  // request id is needed for that.
  const materializingShowcaseSessionIds = useRef(new Set<string>())
  const handleActiveSessionIdChange = useCallback(
    (sessionId: string | null) => {
      if (!showcase || !sessionId) return
      if (liveShowcaseSessionIds.current.has(sessionId)) {
        setShowcaseActiveSessionId(sessionId)
        return
      }
      if (materializingShowcaseSessionIds.current.has(sessionId)) return
      materializingShowcaseSessionIds.current.add(sessionId)
      const placeholderTitle = showcaseSessions.find((session) => session.id === sessionId)?.title ?? "New chat"
      void requestNewShowcaseSession(placeholderTitle, { requestId: randomId(), timeoutMs: 8_000 })
        .then((session) => {
          liveShowcaseSessionIds.current.add(session.id)
          setShowcaseSessions((current) => current.map((existing) => (existing.id === sessionId ? session : existing)))
          setShowcaseActiveSessionId(session.id)
        })
        .catch(() => {
          // Leave the active session untouched rather than switching into a
          // placeholder id that is guaranteed to 404.
        })
        .finally(() => {
          materializingShowcaseSessionIds.current.delete(sessionId)
        })
    },
    [requestNewShowcaseSession, showcase, showcaseSessions],
  )

  // Best-effort client-side cleanup, layered on top of the server's
  // boot-time sweep (scriptedPiHarness.ts): when the tab goes away, delete
  // any showcase session this tab created that never got a real turn.
  // `showcaseUsedSessionIds` is populated from `onPromptSubmitStarted`
  // (wired below via chatParams) so a session the visitor actually used is
  // never touched. `navigator.sendBeacon` cannot express this — it only
  // ever sends a POST and cannot set the workspace header the delete route
  // requires — so this uses `fetch` with `keepalive: true`, the documented
  // sendBeacon-equivalent for non-POST/authenticated pagehide requests.
  //
  // `pagehide` fires on an in-tab reload too, not just a real tab close —
  // deleting the reusable boot session here would race the *next* load's
  // resumeSessionId lookup and defeat the reload-reuse behavior above,
  // deleting a session the very next request expects to still exist. Skip
  // whichever session id is currently the sessionStorage reuse pointer;
  // its retention is already handled by that reuse path plus the server's
  // boot-time sweep, so only the *other* (non-resumable) live sessions —
  // decorative-row materializations, unused "New chat" clicks — need this
  // pagehide sweep at all.
  const showcaseUsedSessionIds = useRef(new Set<string>())
  useEffect(() => {
    if (!showcase) return
    const handlePageHide = () => {
      let resumePointerId: string | undefined
      try {
        resumePointerId = window.sessionStorage.getItem(showcaseBootStorageKey) ?? undefined
      } catch {
        /* sessionStorage unavailable — nothing to preserve for reuse */
      }
      for (const sessionId of liveShowcaseSessionIds.current) {
        if (sessionId === resumePointerId) continue
        if (showcaseUsedSessionIds.current.has(sessionId)) continue
        void fetch(`/api/v1/agents/${encodeURIComponent(defaultAgentTypeId)}/sessions/${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
          headers: { "x-boring-workspace-id": "default" },
          keepalive: true,
        }).catch(() => { /* best-effort — the boot-time sweep is the real backstop */ })
      }
    }
    window.addEventListener("pagehide", handlePageHide)
    return () => window.removeEventListener("pagehide", handlePageHide)
  }, [defaultAgentTypeId, showcase])

  useEffect(() => {
    if (loadingShowcase) return
    let cancelled = false
    void fetch("/api/v1/workspace/meta")
      .then(async (res) => {
        if (!res.ok) throw new Error(`workspace metadata request failed (${res.status})`)
        return await res.json() as WorkspaceMeta
      })
      .then((meta) => {
        if (cancelled) return
        const next = meta?.projectName?.trim()
        const nextWorkspaceId = meta?.workspaceId?.trim() || next
        const nextDefaultAgentTypeId = meta?.defaultAgentTypeId?.trim()
        if (!nextDefaultAgentTypeId) throw new Error("workspace metadata did not include a default agent")
        if (next && !showcase) {
          setProjectName(next)
        }
        if (nextWorkspaceId && !showcase) {
          setWorkspaceId(nextWorkspaceId)
        }
        if (nextDefaultAgentTypeId) setDefaultAgentTypeId(nextDefaultAgentTypeId)
        setMetaLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setMetaError("The playground could not load its agent roster. Reload to try again.")
      })
    return () => { cancelled = true }
  }, [showcase, loadingShowcase])

  if (loadingShowcase) {
    return <LoadingStatesShowcase mode={loadingShowcase} />
  }

  if (!metaLoaded || !defaultAgentTypeId) {
    if (metaError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-background p-6">
          <p role="alert" className="max-w-md text-center text-sm text-destructive">{metaError}</p>
        </div>
      )
    }
    return <div className="h-screen w-screen bg-background" />
  }

  if (showcase && showcaseBootState !== "ready") {
    if (showcaseBootState === "error") {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background p-6">
          <p role="alert" className="max-w-md text-center text-sm text-destructive">
            The showcase could not start its session.
          </p>
          <button
            type="button"
            onClick={retryShowcaseBoot}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            Retry
          </button>
        </div>
      )
    }
    return <div className="h-screen w-screen bg-background" />
  }

  if (fullPage) {
    return <WorkspaceFullPageShell agentTypeId={defaultAgentTypeId} />
  }

  return (
    <WorkspaceAgentFront
      workspaceId={showcase ? "default" : workspaceId}
      agentTypeId={defaultAgentTypeId}
      addressedAgentSelection={!showcase && !multiFilesystem}
      apiBaseUrl=""
      persistenceEnabled
      providerStorageKey={showcase ? "boring-ui-v2:layout:playground" : `boring-ui-v2:layout:playground:${multiFilesystem ? "multi-fs:" : ""}${workspaceId}`}
      appTitle={showcase ? "Boring" : projectName}
      workspaceLabel={showcase ? undefined : projectName}
      workspaceLayout={multiFilesystem ? "classic" : "plugin-tabs"}
      defaultSessionTitle="New chat"
      externalPlugins={externalPluginsEnabled}
      frontPluginHotReload={externalPluginsEnabled ? "vite" : undefined}
      fullPageBasePath="/full-page"
      provisionWorkspace={!showcase}
      sessions={sessions}
      activeSessionId={showcase ? showcaseActiveSessionId : undefined}
      onActiveSessionIdChange={handleActiveSessionIdChange}
      onSwitchSession={showcase ? handleActiveSessionIdChange : undefined}
      onCreateSession={showcase ? createShowcaseSession : undefined}
      onRenameSession={showcase ? renameShowcaseSession : undefined}
      plugins={workspacePlugins}
      chatParams={showcase ? {
        thinkingControl: true,
        onPromptSubmitStarted: ({ sessionId }: { sessionId: string }) => {
          showcaseUsedSessionIds.current.add(sessionId)
        },
      } : { thinkingControl: true }}
    />
  )
}
