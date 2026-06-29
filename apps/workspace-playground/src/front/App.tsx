import { useCallback, useEffect, useMemo, useState } from "react"
import { createDeckPlugin } from "@hachej/boring-deck/front"
import type { DeckWidgetDefinition } from "@hachej/boring-deck/shared"
import { WorkspaceProvider } from "@hachej/boring-workspace"
import { WorkspaceAgentFront, WorkspaceFullPagePanel, parseFullPagePanelLocation } from "@hachej/boring-workspace/app/front"
import { askUserPlugin } from "@hachej/boring-ask-user/front"
import { SHOWCASE_SESSION_ID, seedShowcase } from "./showcaseMessages"

function isShowcaseRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("showcase") === "1"
}

function isFullPageRoute(): boolean {
  if (typeof window === "undefined") return false
  return window.location.pathname === "/full-page" || window.location.pathname === "/full-page/"
}

// `?multi=1` renders a populated multi-project app-left pane with mock data, so
// the design can be reviewed with realistic content (not an empty new-user shell).
function isMultiRoute(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("multi") === "1"
}

const HOUR = 1000 * 60 * 60
const MULTI_NOW = 1_782_240_000_000
// Active project's sessions (the workspaceId below). Two are pinned.
const MULTI_SESSIONS = [
  { id: "m-s1", title: "Q3 revenue analysis", updatedAt: MULTI_NOW - HOUR * 0.4 },
  { id: "m-s2", title: "Churn cohort breakdown", updatedAt: MULTI_NOW - HOUR * 3 },
  { id: "m-s3", title: "Pricing experiment readout", updatedAt: MULTI_NOW - HOUR * 26 },
  { id: "m-s4", title: "Onboarding funnel deep-dive", updatedAt: MULTI_NOW - HOUR * 52 },
  { id: "m-s5", title: "Net revenue retention model", updatedAt: MULTI_NOW - HOUR * 70 },
  { id: "m-s6", title: "Board deck — Q3 numbers", updatedAt: MULTI_NOW - HOUR * 120 },
]
const MULTI_PROJECTS = [
  { id: "proj-alpha", name: "Revenue analytics", available: true, sessionCount: 6, blockedCount: 1 },
  {
    id: "proj-beta",
    name: "Growth experiments",
    available: true,
    sessionCount: 4,
    blockedCount: 2,
    sessions: [
      { id: "b1", title: "Landing page A/B test", updatedAt: MULTI_NOW - HOUR * 5 },
      { id: "b2", title: "Referral loop model", updatedAt: MULTI_NOW - HOUR * 30 },
      { id: "b3", title: "Activation email copy", updatedAt: MULTI_NOW - HOUR * 96 },
      { id: "b4", title: "Paywall placement test", updatedAt: MULTI_NOW - HOUR * 140 },
    ],
  },
  {
    id: "proj-gamma",
    name: "Data platform",
    available: true,
    sessionCount: 3,
    sessions: [
      { id: "g1", title: "dbt model refactor", updatedAt: MULTI_NOW - HOUR * 8 },
      { id: "g2", title: "Warehouse cost audit", updatedAt: MULTI_NOW - HOUR * 44 },
      { id: "g3", title: "Event schema migration", updatedAt: MULTI_NOW - HOUR * 200 },
    ],
  },
  {
    id: "proj-delta",
    name: "Customer research",
    available: true,
    sessionCount: 2,
    sessions: [
      { id: "d1", title: "Churn interview synthesis", updatedAt: MULTI_NOW - HOUR * 18 },
      { id: "d2", title: "NPS verbatim themes", updatedAt: MULTI_NOW - HOUR * 60 },
    ],
  },
  { id: "proj-epsilon", name: "Marketing ops", available: true, sessionCount: 9 },
]

if (typeof window !== "undefined" && isMultiRoute()) {
  try {
    // Two pinned sessions from the active project + one pinned project.
    window.localStorage.setItem("boring-workspace:pinned-sessions:proj-alpha", JSON.stringify({ ids: ["m-s2", "m-s6"] }))
    window.localStorage.setItem("boring-workspace:pinned-projects", JSON.stringify({ ids: ["proj-gamma"] }))
  } catch {
    // ignore storage failures in the mock
  }
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

const workspacePlugins = [askUserPlugin, playgroundDeckPlugin]
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
  const fullPage = useMemo(isFullPageRoute, [])
  const multi = useMemo(isMultiRoute, [])
  const [projectName, setProjectName] = useState("Workspace")
  const [workspaceId, setWorkspaceId] = useState("Workspace")
  const [metaLoaded, setMetaLoaded] = useState(showcase || fullPage)

  const sessions = useMemo(
    () =>
      showcase
        ? [
            {
              id: SHOWCASE_SESSION_ID,
              title: "Showcase conversation",
              updatedAt: Date.now(),
            },
          ]
        : undefined,
    [showcase],
  )
  const handleActiveSessionIdChange = useCallback(
    (sessionId: string | null) => {
      if (showcase && sessionId) seedShowcase(sessionId)
    },
    [showcase],
  )

  useEffect(() => {
    if (showcase || fullPage) return
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
  }, [showcase, fullPage])

  if (showcase) seedShowcase(SHOWCASE_SESSION_ID)

  if (fullPage) {
    return <WorkspaceFullPageShell />
  }

  if (multi) {
    return (
      <WorkspaceAgentFront
        workspaceId="proj-alpha"
        apiBaseUrl=""
        workspaceLayout="plugin-tabs"
        appLeftLayoutMode="multi-project"
        appTitle="Acme Analytics"
        workspaceLabel="Revenue analytics"
        workspaceSectionTitle="Projects"
        provisionWorkspace={false}
        sessions={MULTI_SESSIONS}
        appLeftProjects={MULTI_PROJECTS}
        appLeftActiveProjectId="proj-alpha"
        onSwitchAppLeftProject={() => {}}
        onOpenAppLeftProjectSession={() => {}}
        onShowMoreAppLeftProjectSessions={() => {}}
        onCreateAppLeftProject={() => {}}
        onOpenAppLeftProjectSettings={() => {}}
        onOpenAppLeftProjectInNewTab={() => {}}
        plugins={workspacePlugins}
        chatParams={{ thinkingControl: true }}
      />
    )
  }

  if (!metaLoaded) {
    return <div className="h-screen w-screen bg-background" />
  }

  return (
    <WorkspaceAgentFront
      workspaceId={showcase ? "playground" : workspaceId}
      apiBaseUrl=""
      persistenceEnabled
      providerStorageKey={showcase ? "boring-ui-v2:layout:playground" : `boring-ui-v2:layout:playground:${workspaceId}`}
      workspaceLayout="plugin-tabs"
      appLeftHeaderMode="hidden"
      appTitle={showcase ? "Boring" : projectName}
      workspaceLabel={showcase ? undefined : projectName}
      defaultSessionTitle={showcase ? "New session" : projectName}
      externalPlugins={externalPluginsEnabled}
      frontPluginHotReload={externalPluginsEnabled ? "vite" : undefined}
      fullPageBasePath="/full-page"
      provisionWorkspace={!showcase}
      sessions={sessions}
      activeSessionId={showcase ? SHOWCASE_SESSION_ID : undefined}
      onActiveSessionIdChange={handleActiveSessionIdChange}
      plugins={workspacePlugins}
      chatParams={{ thinkingControl: true }}
    />
  )
}
