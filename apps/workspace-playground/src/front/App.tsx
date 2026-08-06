import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createDeckPlugin } from "@hachej/boring-deck/front"
import type { DeckWidgetDefinition } from "@hachej/boring-deck/shared"
import { FileTreePane, WorkspaceProvider } from "@hachej/boring-workspace"
import { WorkspaceAgentFront, WorkspaceFullPagePanel, parseFullPagePanelLocation } from "@hachej/boring-workspace/app/front"
import { definePlugin, type WorkspaceSourceProps } from "@hachej/boring-workspace/plugin"
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

function createInitialShowcaseSessions() {
  const count = showcaseSessionCount()
  const now = Date.now()
  return Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? SHOWCASE_SESSION_ID : `${SHOWCASE_SESSION_ID}-${index + 1}`,
    title: showcaseSessionTitles[index % showcaseSessionTitles.length] ?? `Session ${index + 1}`,
    updatedAt: now - index * 60_000,
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
  return (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_PLAYGROUND_MULTI_FS === "1"
}

function factoryAgentsEnabled(): boolean {
  return (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_BORING_FACTORY_AGENTS === "1"
}

interface WorkspaceMeta {
  projectName?: string
  workspaceId?: string
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

function MultiFilesystemFileTreeSource(props: WorkspaceSourceProps) {
  return (
    <FileTreePane
      {...props}
      params={{
        ...(props.params as Record<string, unknown> | undefined),
        chromeless: false,
        roots: [
          {
            filesystem: "user",
            label: "Workspace",
            rootDir: ".",
            access: "readwrite",
            searchPlaceholder: "Search workspace files...",
          },
          {
            filesystem: "company_context",
            label: "Company",
            rootDir: "/",
            access: "readonly",
            searchPlaceholder: "Filter company files...",
          },
        ],
      } as Parameters<typeof FileTreePane>[0]["params"]}
    />
  )
}

const multiFilesystemPlaygroundPlugin = definePlugin({
  id: "workspace-playground-multi-fs",
  label: "Workspace playground multi-filesystem fixtures",
  workspaceSources: [
    {
      id: "files",
      label: "Files",
      source: "app",
      component: MultiFilesystemFileTreeSource,
    },
  ],
})

const askUserPlugin = createAskUserPlugin({ appLeftInbox: true })
const tasksPlugin = createTasksPlugin()
const workspacePlugins = [askUserPlugin, tasksPlugin, playgroundDeckPlugin, diagramPlugin]
const multiFilesystemWorkspacePlugins = [askUserPlugin, tasksPlugin, playgroundDeckPlugin, diagramPlugin, multiFilesystemPlaygroundPlugin]
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

function WorkspaceFullPageShell() {
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
      agentTypeId="default"
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
  const factoryAgents = useMemo(factoryAgentsEnabled, [])
  const defaultAgentTypeId = factoryAgents ? "boring-concierge" : "default"
  const activeWorkspacePlugins = multiFilesystem ? multiFilesystemWorkspacePlugins : workspacePlugins
  const [projectName, setProjectName] = useState("Workspace")
  const [workspaceId, setWorkspaceId] = useState("Workspace")
  const [metaLoaded, setMetaLoaded] = useState(showcase || fullPage)
  const [showcaseActiveSessionId, setShowcaseActiveSessionId] = useState(SHOWCASE_SESSION_ID)
  const [showcaseSessions, setShowcaseSessions] = useState(createInitialShowcaseSessions)
  const sessions = showcase ? showcaseSessions : undefined
  const liveShowcaseSessionIds = useRef(new Set<string>())
  const createShowcaseSession = useCallback(async () => {
    const response = await fetch("/api/v1/agents/default/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-boring-workspace-id": "default",
      },
      body: JSON.stringify({ title: "New chat" }),
    })
    if (!response.ok) throw new Error(`showcase session create failed (${response.status})`)
    const payload = await response.json() as { agentTypeId?: string; sessionId?: string }
    if (!payload.sessionId) throw new Error("showcase session create returned no session id")
    const session = {
      id: payload.sessionId,
      agentTypeId: payload.agentTypeId ?? "default",
      title: "New chat",
      updatedAt: Date.now(),
    }
    liveShowcaseSessionIds.current.add(session.id)
    setShowcaseSessions((current) => [...current, session])
    setShowcaseActiveSessionId(session.id)
    return session
  }, [])
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
    if (showcase || loadingShowcase || fullPage) return
    let cancelled = false
    void fetch("/api/v1/workspace/meta")
      .then(async (res) => res.ok ? await res.json() as WorkspaceMeta : null)
      .then((meta) => {
        if (cancelled) return
        const next = meta?.projectName?.trim()
        const nextWorkspaceId = meta?.workspaceId?.trim() || next
        if (next) {
          setProjectName(next)
        }
        if (nextWorkspaceId) {
          setWorkspaceId(nextWorkspaceId)
        }
        setMetaLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setMetaLoaded(true)
      })
    return () => { cancelled = true }
  }, [showcase, loadingShowcase, fullPage])

  if (showcase) seedShowcase(SHOWCASE_SESSION_ID)

  if (loadingShowcase) {
    return <LoadingStatesShowcase mode={loadingShowcase} />
  }

  if (fullPage) {
    return <WorkspaceFullPageShell />
  }

  if (!metaLoaded) {
    return <div className="h-screen w-screen bg-background" />
  }

  return (
    <WorkspaceAgentFront
      workspaceId={showcase ? "default" : workspaceId}
      agentTypeId={defaultAgentTypeId}
      showAgentSelector={factoryAgents && !showcase}
      donateActiveChatTransportToDetached
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
      plugins={activeWorkspacePlugins}
      chatParams={{ thinkingControl: true }}
    />
  )
}
