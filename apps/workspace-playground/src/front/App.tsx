import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createDeckPlugin } from "@hachej/boring-deck/front"
import type { DeckWidgetDefinition } from "@hachej/boring-deck/shared"
import { WorkspaceProvider } from "@hachej/boring-workspace"
import { WorkspaceAgentFront, WorkspaceFullPagePanel, parseFullPagePanelLocation } from "@hachej/boring-workspace/app/front"
import { createAskUserPlugin } from "@hachej/boring-ask-user/front"
import { diagramPlugin } from "@hachej/boring-diagram/front"
import { createTasksPlugin } from "@hachej/boring-tasks/front"
import { SHOWCASE_SESSION_ID, seedShowcase } from "./showcaseMessages"
import { LoadingStatesShowcase, type LoadingStateMode } from "./LoadingStatesShowcase"

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
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

// Decorative-only entries used to pad the session list when `?sessions=N`
// is requested (session-list volume/scroll demos). These never back a real
// server session — only the boot-created session (below) is ever selected
// by default, so they are never connected to.
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
  // The showcase route pre-seeds a client-side session id, but the chat pane
  // always talks to a real backend session (see packages/workspace's chat
  // pane, which requires params.sessionId and hydrates it over the network).
  // A session that only ever exists in localStorage 404s on hydrate, which is
  // what previously produced the permanent "session was not found" banner
  // and a disabled composer (gh-1452). `showcaseBootState` gates rendering
  // the chat panel until a real backend session has been created.
  const [showcaseBootState, setShowcaseBootState] = useState<"pending" | "ready" | "error">(showcase ? "pending" : "ready")
  const sessions = showcase ? showcaseSessions : undefined
  const liveShowcaseSessionIds = useRef(new Set<string>())
  const requestNewShowcaseSession = useCallback(async (title: string) => {
    const response = await fetch(`/api/v1/agents/${encodeURIComponent(defaultAgentTypeId)}/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-boring-workspace-id": "default",
      },
      body: JSON.stringify({ title }),
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
  }, [defaultAgentTypeId])
  const createShowcaseSession = useCallback(async () => {
    const session = await requestNewShowcaseSession("New chat")
    liveShowcaseSessionIds.current.add(session.id)
    setShowcaseSessions((current) => [...current, session])
    setShowcaseActiveSessionId(session.id)
    return session
  }, [requestNewShowcaseSession])
  // Boot the initial showcase session: create it on the real backend (with
  // retries to ride out a cold dev-server boot) before the composer is ever
  // shown, instead of pre-seeding a session id that never materializes
  // server-side.
  const showcaseBootStartedRef = useRef(false)
  useEffect(() => {
    if (!showcase || !metaLoaded || !defaultAgentTypeId) return
    if (showcaseBootStartedRef.current) return
    showcaseBootStartedRef.current = true
    let cancelled = false
    const maxAttempts = 5
    const boot = async () => {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const session = await requestNewShowcaseSession(showcaseSessionTitles[0] ?? "New chat")
          if (cancelled) return
          liveShowcaseSessionIds.current.add(session.id)
          seedShowcase(session.id)
          setShowcaseSessions((current) => [session, ...current])
          setShowcaseActiveSessionId(session.id)
          setShowcaseBootState("ready")
          return
        } catch {
          if (cancelled) return
          if (attempt === maxAttempts) {
            setShowcaseBootState("error")
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 300 * attempt))
        }
      }
    }
    void boot()
    return () => { cancelled = true }
  }, [defaultAgentTypeId, metaLoaded, requestNewShowcaseSession, showcase])
  const renameShowcaseSession = useCallback((sessionId: string, title: string) => {
    setShowcaseSessions((current) => current.map((session) => (
      session.id === sessionId ? { ...session, title, updatedAt: Date.now() } : session
    )))
  }, [])
  const handleActiveSessionIdChange = useCallback(
    (sessionId: string | null) => {
      if (showcase && sessionId) {
        if (!liveShowcaseSessionIds.current.has(sessionId)) seedShowcase(sessionId)
        setShowcaseActiveSessionId(sessionId)
      }
    },
    [showcase],
  )

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
        <div className="flex h-screen w-screen items-center justify-center bg-background p-6">
          <p role="alert" className="max-w-md text-center text-sm text-destructive">
            The showcase could not start its session. Reload to try again.
          </p>
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
      chatParams={{ thinkingControl: true }}
    />
  )
}
